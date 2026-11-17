import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@ocall/database';
import {
  PASS_KIND_LABELS,
  type PassRules,
  type PassStatus,
  addDays,
  computeSaleTotals,
  hasOrganizationWideScope,
  localMoment,
  passPhotoRequired,
  passState,
  periodEndDate,
  suspensionExtensionDays,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { StorageService } from '../../common/storage/storage.service';
import { type UploadedImage, normalizePhoto } from '../../common/storage/photo';
import { findSellingEstablishment } from '../pos/pos-scope';
import { SalesService } from '../pos/sales.service';
import { dbDay, lockPass, retainHolderPhoto, toDay } from '../ticket-issuance/pass-activation';
import { PassQrSigner, newLinkToken, newPublicId } from './pass-qr';
import type { CreatePassOrderDto, PassesQueryDto, RenewPassDto } from './pass.dto';

type Tx = Prisma.TransactionClient;
type PassEventType = Prisma.PassEventCreateInput['type'];

/** Photo déposée mais pas encore rattachée à un pass : conservée 30 jours au plus. */
const UNLINKED_PHOTO_RETENTION_DAYS = 30;

const NOT_FOUND = { code: 'PASS_NOT_FOUND', message: 'Pass introuvable.' };
const conflict = (code: string, message: string) => new ConflictException({ code, message });

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const PASS_SELECT = {
  id: true,
  organizationId: true,
  offerId: true,
  customerId: true,
  kind: true,
  holderName: true,
  photoFileId: true,
  rules: true,
  status: true,
  startDate: true,
  endDate: true,
  publicId: true,
  qrVersion: true,
  linkTokenHash: true,
  linkIssuedAt: true,
  suspendedAt: true,
  suspensionReason: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  customer: { select: { firstName: true, lastName: true, phone: true, anonymizedAt: true } },
  periods: {
    select: {
      id: true,
      saleId: true,
      status: true,
      isRenewal: true,
      startDate: true,
      endDate: true,
      price: true,
      entriesUsed: true,
      extendedDays: true,
      paidAt: true,
      createdAt: true,
      sale: { select: { number: true, establishmentId: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
} as const satisfies Prisma.PassSelect;

type PassRow = Prisma.PassGetPayload<{ select: typeof PASS_SELECT }>;

/**
 * Ocall Parc sprint 8 : pass et abonnements des visiteurs. La vente réutilise intégralement le moteur
 * de la caisse (session de caisse, numérotation, idempotence, paiement, fidélité via la fiche client) ;
 * le pass n'est utilisable qu'après le paiement (activation dans la transaction d'encaissement).
 */
@Injectable()
export class PassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly signer: PassQrSigner,
  ) {}

  // ─── Lecture ───

  /** Pass visibles : ceux de l'organisation, et hors OWNER/ADMIN, ceux valables dans un parc du membre. */
  private scope(auth: TenantContext): Prisma.PassWhereInput {
    const where: Prisma.PassWhereInput = { organizationId: auth.membership.organizationId };
    if (!hasOrganizationWideScope(auth.membership.role)) {
      where.offer = {
        sites: {
          some: { establishment: { assignments: { some: { membershipId: auth.membership.id } } } },
        },
      };
    }
    return where;
  }

  /** Offres en vente aujourd'hui dans un parc (guichet). */
  async sellableOffers(auth: TenantContext, establishmentId: string) {
    const establishment = await findSellingEstablishment(
      this.prisma,
      auth,
      establishmentId,
      'PARK',
    );
    const today = localMoment(new Date(), establishment.timezone).date;
    const day = toDay(today);
    const offers = await this.prisma.passOffer.findMany({
      where: {
        organizationId: auth.membership.organizationId,
        isActive: true,
        sites: { some: { establishmentId: establishment.id, isActive: true } },
        AND: [
          { OR: [{ saleFrom: null }, { saleFrom: { lte: day } }] },
          { OR: [{ saleUntil: null }, { saleUntil: { gte: day } }] },
        ],
      },
      select: {
        id: true,
        kind: true,
        name: true,
        description: true,
        price: true,
        durationUnit: true,
        durationValue: true,
        totalEntries: true,
        dailyEntries: true,
        allowedWeekdays: true,
        qrMode: true,
        photoRequired: true,
        conditions: true,
        sites: {
          where: { isActive: true },
          select: { establishmentId: true, price: true, establishment: { select: { name: true } } },
        },
      },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
    return {
      today,
      offers: offers.map(({ sites, ...o }) => ({
        ...o,
        price: sites.find((s) => s.establishmentId === establishment.id)?.price ?? o.price,
        sites: sites.map((s) => ({
          establishmentId: s.establishmentId,
          name: s.establishment.name,
        })),
      })),
    };
  }

  async list(auth: TenantContext, query: PassesQueryDto) {
    const q = query.q?.trim();
    const rows = await this.prisma.pass.findMany({
      where: {
        ...this.scope(auth),
        status: query.status,
        customerId: query.customerId,
        ...(q && {
          OR: [
            { holderName: { contains: q, mode: 'insensitive' } },
            { customer: { phone: { contains: q.replace(/[^\d+]/g, '') || q } } },
          ],
        }),
      },
      select: PASS_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.summary(r));
  }

  async get(auth: TenantContext, id: string) {
    const row = await this.prisma.pass.findFirst({
      where: { ...this.scope(auth), id },
      select: {
        ...PASS_SELECT,
        events: {
          select: {
            id: true,
            type: true,
            reason: true,
            metadata: true,
            createdAt: true,
            actorMembershipId: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
        cards: {
          select: {
            id: true,
            cardNumber: true,
            status: true,
            replacesCardId: true,
            revokedAt: true,
            revokeReason: true,
            printRequestedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        scans: {
          select: {
            id: true,
            result: true,
            refusalReason: true,
            entryPoint: true,
            localDate: true,
            createdAt: true,
            establishment: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
      },
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    const actors = await this.actorNames(row.events.map((e) => e.actorMembershipId));
    const rules = row.rules as unknown as PassRules;
    return {
      ...this.summary(row),
      photoUrl: row.photoFileId
        ? this.storage.temporaryUrl(
            { id: row.photoFileId, organizationId: row.organizationId },
            auth.user.id,
          ).url
        : null,
      // QR fixe (pass journalier / hebdomadaire) : remis ou imprimé au guichet. Le QR dynamique d'un
      // abonnement n'est servi qu'au titulaire, par son lien personnel.
      staticQr:
        rules.qrMode === 'STATIC' && row.status !== 'CANCELLED'
          ? this.signer.staticQr(row.publicId, row.qrVersion)
          : null,
      events: row.events.map(({ actorMembershipId, metadata, ...e }) => ({
        ...e,
        metadata: (metadata ?? null) as Record<string, unknown> | null,
        actor: actorMembershipId ? (actors.get(actorMembershipId) ?? null) : null,
      })),
      cards: row.cards,
      scans: row.scans.map(({ establishment, localDate, ...s }) => ({
        ...s,
        localDate: localDate ? dbDay(localDate) : null,
        establishmentName: establishment.name,
      })),
    };
  }

  private summary(r: PassRow) {
    const rules = r.rules as unknown as PassRules;
    const today = localMoment(new Date(), rules.timezone).date;
    const startDate = dbDay(r.startDate);
    const endDate = dbDay(r.endDate);
    const current = r.periods.find(
      (p) =>
        p.status === 'PAID' &&
        p.startDate &&
        p.endDate &&
        dbDay(p.startDate) <= today &&
        today <= dbDay(p.endDate),
    );
    return {
      id: r.id,
      offerId: r.offerId,
      customerId: r.customerId,
      kind: r.kind,
      holderName: r.holderName,
      phone: r.customer.anonymizedAt ? null : r.customer.phone,
      hasPhoto: r.photoFileId !== null,
      rules,
      status: r.status,
      state: passState(r.status as PassStatus, startDate, endDate, today),
      startDate,
      endDate,
      today,
      entriesLeft:
        current && rules.totalEntries !== null
          ? Math.max(0, rules.totalEntries - current.entriesUsed)
          : null,
      hasLink: r.linkTokenHash !== null,
      linkIssuedAt: r.linkIssuedAt,
      suspendedAt: r.suspendedAt,
      suspensionReason: r.suspensionReason,
      cancelledAt: r.cancelledAt,
      cancelReason: r.cancelReason,
      pendingRenewal: r.periods.some((p) => p.isRenewal && p.status === 'PENDING'),
      periods: r.periods.map(({ sale, ...p }) => ({
        ...p,
        startDate: p.startDate ? dbDay(p.startDate) : null,
        endDate: p.endDate ? dbDay(p.endDate) : null,
        saleNumber: sale.number,
      })),
      createdAt: r.createdAt,
    };
  }

  private async actorNames(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((i): i is string => i !== null))];
    if (unique.length === 0) return new Map<string, string>();
    const rows = await this.prisma.organizationMembership.findMany({
      where: { id: { in: unique } },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
    });
    return new Map(rows.map((m) => [m.id, `${m.user.firstName} ${m.user.lastName}`]));
  }

  /** Pass visible et verrouillé (dans une transaction), pour toute modification. */
  private async lockVisible(tx: Tx, auth: TenantContext, id: string) {
    const visible = await tx.pass.findFirst({
      where: { ...this.scope(auth), id },
      select: { id: true },
    });
    if (!visible) throw new NotFoundException(NOT_FOUND);
    await lockPass(tx, id);
    return tx.pass.findUniqueOrThrow({ where: { id }, select: PASS_SELECT });
  }

  private async event(
    tx: Tx,
    auth: TenantContext,
    passId: string,
    type: PassEventType,
    extra: { reason?: string; metadata?: Prisma.InputJsonValue } = {},
  ) {
    await tx.passEvent.create({
      data: {
        organizationId: auth.membership.organizationId,
        passId,
        type,
        actorMembershipId: auth.membership.id,
        reason: extra.reason ?? null,
        metadata: extra.metadata,
      },
    });
    await this.audit.record(
      {
        organizationId: auth.membership.organizationId,
        actorUserId: auth.user.id,
        action: `pass.${type.toLowerCase()}`,
        targetType: 'Pass',
        targetId: passId,
        metadata: { reason: extra.reason ?? null },
      },
      tx,
    );
  }

  // ─── Photo du titulaire ───

  /** Photo réencodée (JPEG sans métadonnées ni position), stockée en privé ; rattachée ensuite au pass. */
  async uploadPhoto(auth: TenantContext, file: UploadedImage | undefined) {
    const jpeg = await normalizePhoto(file);
    const stored = await this.storage.storePrivate({
      organizationId: auth.membership.organizationId,
      establishmentId: null,
      kind: 'PASS_HOLDER_PHOTO',
      body: jpeg,
      mimeType: 'image/jpeg',
      displayName: 'photo-titulaire.jpg',
      createdById: auth.user.id,
      retentionDays: UNLINKED_PHOTO_RETENTION_DAYS,
    });
    return {
      id: stored.id,
      ...this.storage.temporaryUrl(
        { id: stored.id, organizationId: auth.membership.organizationId },
        auth.user.id,
      ),
    };
  }

  private async assertPhoto(tx: Tx, organizationId: string, photoFileId: string) {
    const file = await tx.storedFile.findFirst({
      where: { id: photoFileId, organizationId, kind: 'PASS_HOLDER_PHOTO', deletedAt: null },
      select: { id: true },
    });
    if (!file) {
      throw new BadRequestException({
        code: 'PASS_PHOTO_INVALID',
        message: 'Photo introuvable : reprenez-la.',
      });
    }
  }

  async setPhoto(auth: TenantContext, id: string, photoFileId: string) {
    await this.prisma.$transaction(async (tx) => {
      const pass = await this.lockVisible(tx, auth, id);
      if (pass.status === 'CANCELLED') throw conflict('PASS_CANCELLED', 'Ce pass est annulé.');
      if (pass.customer.anonymizedAt)
        throw conflict('PASS_ANONYMIZED', 'Le titulaire a été anonymisé.');
      await this.assertPhoto(tx, pass.organizationId, photoFileId);
      const inUse = await tx.pass.count({ where: { photoFileId, id: { not: id } } });
      if (inUse > 0) throw conflict('PASS_PHOTO_IN_USE', 'Cette photo appartient à un autre pass.');
      if (pass.photoFileId && pass.photoFileId !== photoFileId) {
        // Ancienne photo : plus utilisée, purgée sous 30 jours (rien n'est conservé sans raison).
        await tx.storedFile.updateMany({
          where: { id: pass.photoFileId, deletedAt: null },
          data: {
            retentionUntil: new Date(Date.now() + UNLINKED_PHOTO_RETENTION_DAYS * 86_400_000),
          },
        });
      }
      await tx.pass.update({ where: { id }, data: { photoFileId } });
      await retainHolderPhoto(tx, photoFileId, dbDay(pass.endDate));
      await this.event(tx, auth, id, 'PHOTO_UPDATED');
    });
    return this.get(auth, id);
  }

  // ─── Vente et renouvellement ───

  /** Vente d'un pass : vente PARK non payée, rattachée au titulaire ; le pass s'active au paiement. */
  async order(auth: TenantContext, dto: CreatePassOrderDto) {
    const organizationId = auth.membership.organizationId;
    const establishment = await findSellingEstablishment(
      this.prisma,
      auth,
      dto.establishmentId,
      'PARK',
    );
    const today = localMoment(new Date(), establishment.timezone).date;
    if (dto.startDate < today || dto.startDate > addDays(today, 365)) {
      throw new BadRequestException({
        code: 'PASS_START_INVALID',
        message: 'Le premier jour doit être aujourd’hui ou dans l’année à venir.',
      });
    }
    let passId: string | null = null;
    const sale = await this.sales.createSale(auth, {
      establishmentId: establishment.id,
      activity: 'PARK',
      clientRequestId: dto.clientRequestId,
      price: async (tx) => {
        const { offer, price } = await this.sellableOffer(
          tx,
          organizationId,
          dto.offerId,
          establishment.id,
          today,
        );
        const totals = computeSaleTotals([{ unitPrice: price, quantity: 1 }]);
        return {
          lines: [
            {
              passOfferId: offer.id,
              productName: offer.name,
              variantName: PASS_KIND_LABELS[offer.kind],
              unitPrice: price,
              quantity: 1,
              lineTotal: totals.lineTotals[0]!,
            },
          ],
          total: totals.total,
        };
      },
      afterCreate: async (tx, saleId) => {
        const { offer, price, siteIds } = await this.sellableOffer(
          tx,
          organizationId,
          dto.offerId,
          establishment.id,
          today,
        );
        const customer = await tx.customer.findFirst({
          where: { id: dto.customerId, organizationId, anonymizedAt: null },
          select: { id: true, firstName: true, lastName: true },
        });
        if (!customer) {
          throw new BadRequestException({
            code: 'PASS_CUSTOMER_REQUIRED',
            message: 'Fiche client du titulaire introuvable.',
          });
        }
        const holderName = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim();
        if (!holderName) {
          throw new BadRequestException({
            code: 'PASS_HOLDER_NAME_REQUIRED',
            message: 'La fiche client doit comporter le nom du titulaire.',
          });
        }
        if (offer.photoRequired && !dto.photoFileId) {
          throw new BadRequestException({
            code: 'PASS_PHOTO_REQUIRED',
            message: 'La photo du titulaire est obligatoire pour cette offre.',
          });
        }
        if (dto.photoFileId) {
          await this.assertPhoto(tx, organizationId, dto.photoFileId);
          if ((await tx.pass.count({ where: { photoFileId: dto.photoFileId } })) > 0) {
            throw conflict('PASS_PHOTO_IN_USE', 'Cette photo appartient à un autre pass.');
          }
        }
        const rules: PassRules = {
          offerName: offer.name,
          totalEntries: offer.totalEntries,
          dailyEntries: offer.dailyEntries,
          allowedWeekdays: offer.allowedWeekdays,
          qrMode: offer.qrMode,
          siteIds,
          durationUnit: offer.durationUnit,
          durationValue: offer.durationValue,
          maxSuspensionDays: offer.maxSuspensionDays,
          suspensionExtends: offer.suspensionExtends,
          renewable: offer.renewable,
          timezone: establishment.timezone,
        };
        const endDate = periodEndDate(dto.startDate, offer.durationUnit, offer.durationValue);
        const line = await tx.saleLine.findFirstOrThrow({
          where: { saleId },
          select: { id: true },
        });
        await tx.sale.update({ where: { id: saleId }, data: { customerId: customer.id } });
        const pass = await tx.pass.create({
          data: {
            organizationId,
            offerId: offer.id,
            customerId: customer.id,
            kind: offer.kind,
            holderName,
            photoFileId: dto.photoFileId ?? null,
            rules: rules as unknown as Prisma.InputJsonValue,
            startDate: toDay(dto.startDate),
            endDate: toDay(endDate),
            publicId: newPublicId(),
            createdById: auth.membership.id,
            periods: {
              create: {
                organizationId,
                saleId,
                saleLineId: line.id,
                price,
                startDate: toDay(dto.startDate),
                endDate: toDay(endDate),
              },
            },
          },
          select: { id: true },
        });
        passId = pass.id;
        await retainHolderPhoto(tx, dto.photoFileId ?? null, endDate);
        await this.event(tx, auth, pass.id, 'SOLD', {
          metadata: { offer: offer.name, price, startDate: dto.startDate, endDate },
        });
      },
    });
    passId ??= await this.passOfSale(sale.id);
    return { sale, pass: passId ? await this.get(auth, passId) : null };
  }

  /** Renouvellement au guichet : vente au tarif actuel de l'offre ; la période est datée au paiement. */
  async renew(auth: TenantContext, id: string, dto: RenewPassDto) {
    const organizationId = auth.membership.organizationId;
    const establishment = await findSellingEstablishment(
      this.prisma,
      auth,
      dto.establishmentId,
      'PARK',
    );
    const before = await this.prisma.pass.findFirst({
      where: { ...this.scope(auth), id },
      select: { id: true, offerId: true },
    });
    if (!before) throw new NotFoundException(NOT_FOUND);
    const sitePrice = async (tx: Tx | PrismaService) => {
      const site = await tx.passOfferSite.findFirst({
        where: { offerId: before.offerId, establishmentId: establishment.id, isActive: true },
        select: { price: true, offer: { select: { name: true, kind: true, price: true } } },
      });
      if (!site) {
        throw new BadRequestException({
          code: 'PASS_OFFER_UNAVAILABLE',
          message: 'Cette offre n’est pas vendue dans ce parc.',
        });
      }
      return { price: site.price ?? site.offer.price, offer: site.offer };
    };
    const sale = await this.sales.createSale(auth, {
      establishmentId: establishment.id,
      activity: 'PARK',
      clientRequestId: dto.clientRequestId,
      price: async (tx) => {
        const { price, offer } = await sitePrice(tx);
        const totals = computeSaleTotals([{ unitPrice: price, quantity: 1 }]);
        return {
          lines: [
            {
              passOfferId: before.offerId,
              productName: offer.name,
              variantName: `Renouvellement — ${PASS_KIND_LABELS[offer.kind]}`,
              unitPrice: price,
              quantity: 1,
              lineTotal: totals.lineTotals[0]!,
            },
          ],
          total: totals.total,
        };
      },
      afterCreate: async (tx, saleId) => {
        const pass = await this.lockVisible(tx, auth, id);
        const rules = pass.rules as unknown as PassRules;
        if (pass.status !== 'ACTIVE') {
          throw conflict(
            'PASS_NOT_RENEWABLE',
            pass.status === 'SUSPENDED'
              ? 'Réactivez le pass avant de le renouveler.'
              : 'Seul un pass actif (ou expiré) peut être renouvelé.',
          );
        }
        if (!rules.renewable)
          throw conflict('PASS_NOT_RENEWABLE', 'Cette offre n’est pas renouvelable.');
        if (!rules.siteIds.includes(establishment.id)) {
          throw conflict('PASS_OTHER_ESTABLISHMENT', 'Ce pass n’est pas valable dans ce parc.');
        }
        if (pass.customer.anonymizedAt)
          throw conflict('PASS_ANONYMIZED', 'Le titulaire a été anonymisé.');
        if (pass.periods.some((p) => p.status === 'PENDING')) {
          throw conflict('PASS_RENEWAL_PENDING', 'Un renouvellement attend déjà son paiement.');
        }
        if (passPhotoRequired(pass.kind, false) && !pass.photoFileId) {
          throw conflict(
            'PASS_PHOTO_REQUIRED',
            'Ajoutez la photo du titulaire avant de renouveler.',
          );
        }
        const { price } = await sitePrice(tx);
        const line = await tx.saleLine.findFirstOrThrow({
          where: { saleId },
          select: { id: true },
        });
        await tx.sale.update({ where: { id: saleId }, data: { customerId: pass.customerId } });
        await tx.passPeriod.create({
          data: { organizationId, passId: id, saleId, saleLineId: line.id, price, isRenewal: true },
        });
        await this.event(tx, auth, id, 'RENEWAL_ORDERED', { metadata: { price } });
      },
    });
    return { sale, pass: await this.get(auth, id) };
  }

  private async passOfSale(saleId: string) {
    const period = await this.prisma.passPeriod.findFirst({
      where: { saleId },
      select: { passId: true },
    });
    return period?.passId ?? null;
  }

  /** Offre vendable aujourd'hui dans ce parc ; prix du parc s'il en a un, sinon prix de l'offre. */
  private async sellableOffer(
    tx: Tx,
    organizationId: string,
    offerId: string,
    establishmentId: string,
    today: string,
  ) {
    const day = toDay(today);
    const offer = await tx.passOffer.findFirst({
      where: {
        id: offerId,
        organizationId,
        isActive: true,
        AND: [
          { OR: [{ saleFrom: null }, { saleFrom: { lte: day } }] },
          { OR: [{ saleUntil: null }, { saleUntil: { gte: day } }] },
        ],
      },
      select: {
        id: true,
        kind: true,
        name: true,
        price: true,
        durationUnit: true,
        durationValue: true,
        totalEntries: true,
        dailyEntries: true,
        allowedWeekdays: true,
        qrMode: true,
        photoRequired: true,
        renewable: true,
        maxSuspensionDays: true,
        suspensionExtends: true,
        sites: { where: { isActive: true }, select: { establishmentId: true, price: true } },
      },
    });
    const site = offer?.sites.find((s) => s.establishmentId === establishmentId);
    if (!offer || !site) {
      throw new BadRequestException({
        code: 'PASS_OFFER_UNAVAILABLE',
        message: 'Cette offre de pass n’est pas en vente dans ce parc aujourd’hui.',
      });
    }
    return {
      offer,
      price: site.price ?? offer.price,
      siteIds: offer.sites.map((s) => s.establishmentId),
    };
  }

  // ─── Suspension, réactivation, annulation (pass.manage) ───

  async suspend(auth: TenantContext, id: string, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const pass = await this.lockVisible(tx, auth, id);
      const rules = pass.rules as unknown as PassRules;
      if (pass.status !== 'ACTIVE')
        throw conflict('PASS_NOT_ACTIVE', 'Seul un pass actif peut être suspendu.');
      if (rules.maxSuspensionDays <= 0) {
        throw conflict('PASS_SUSPENSION_NOT_ALLOWED', 'Cette offre ne permet pas de suspension.');
      }
      const today = localMoment(new Date(), rules.timezone).date;
      if (today > dbDay(pass.endDate)) throw conflict('PASS_EXPIRED', 'Ce pass a expiré.');
      await tx.pass.update({
        where: { id },
        data: { status: 'SUSPENDED', suspendedAt: new Date(), suspensionReason: reason },
      });
      await this.event(tx, auth, id, 'SUSPENDED', { reason });
    });
    return this.get(auth, id);
  }

  /**
   * Réactivation : la validité est prolongée des jours entiers de suspension, plafonnés par l'offre
   * (décision D5). La prolongation porte sur la période en cours (ou la prochaine) et décale d'autant
   * les périodes suivantes déjà payées : jamais de chevauchement.
   */
  async reactivate(auth: TenantContext, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const pass = await this.lockVisible(tx, auth, id);
      const rules = pass.rules as unknown as PassRules;
      if (pass.status !== 'SUSPENDED' || !pass.suspendedAt) {
        throw conflict('PASS_NOT_SUSPENDED', 'Ce pass n’est pas suspendu.');
      }
      const today = localMoment(new Date(), rules.timezone).date;
      const suspendedDay = localMoment(pass.suspendedAt, rules.timezone).date;
      const days = suspensionExtensionDays(suspendedDay, today, rules);
      let endDate = dbDay(pass.endDate);
      if (days > 0) {
        const paid = pass.periods.filter(
          (p) => p.status === 'PAID' && p.endDate && dbDay(p.endDate) >= suspendedDay,
        );
        for (const [i, p] of paid.entries()) {
          await tx.passPeriod.update({
            where: { id: p.id },
            data: {
              ...(i > 0 && { startDate: toDay(addDays(dbDay(p.startDate!), days)) }),
              endDate: toDay(addDays(dbDay(p.endDate!), days)),
              ...(i === 0 && { extendedDays: { increment: days } }),
            },
          });
        }
        endDate = addDays(endDate, days);
      }
      await tx.pass.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          suspendedAt: null,
          suspensionReason: null,
          endDate: toDay(endDate),
        },
      });
      await retainHolderPhoto(tx, pass.photoFileId, endDate);
      await this.event(tx, auth, id, 'REACTIVATED', {
        metadata: { suspendedDay, extendedDays: days, endDate },
      });
    });
    return this.get(auth, id);
  }

  /** Annulation par un superviseur, motif obligatoire, sans remboursement automatique (décision D10). */
  async cancel(auth: TenantContext, id: string, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const pass = await this.lockVisible(tx, auth, id);
      if (pass.status === 'CANCELLED') throw conflict('PASS_CANCELLED', 'Ce pass est déjà annulé.');
      if (pass.status === 'PENDING' || pass.periods.some((p) => p.status === 'PENDING')) {
        throw conflict(
          'PASS_PENDING_SALE',
          'Une vente de ce pass attend son paiement : annulez d’abord cette vente.',
        );
      }
      const now = new Date();
      await tx.pass.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelledById: auth.membership.id,
          cancelReason: reason,
          linkTokenHash: null,
        },
      });
      await tx.passCard.updateMany({
        where: { passId: id, status: 'ACTIVE' },
        data: {
          status: 'REVOKED',
          revokedAt: now,
          revokedById: auth.membership.id,
          revokeReason: 'Pass annulé',
        },
      });
      await this.event(tx, auth, id, 'CANCELLED', { reason });
    });
    return this.get(auth, id);
  }

  // ─── Lien personnel du titulaire (QR dynamique) ───

  /**
   * Nouveau lien personnel : le jeton n'est montré qu'une fois (seule son empreinte est gardée) ; il
   * remplace le précédent, qui cesse aussitôt de fonctionner.
   */
  async issueLink(auth: TenantContext, id: string) {
    const token = newLinkToken();
    await this.prisma.$transaction(async (tx) => {
      const pass = await this.lockVisible(tx, auth, id);
      if (pass.status === 'CANCELLED' || pass.status === 'PENDING') {
        throw conflict(
          'PASS_NOT_ACTIVE',
          'Le lien n’est disponible que pour un pass payé et non annulé.',
        );
      }
      await tx.pass.update({
        where: { id },
        data: { linkTokenHash: hashToken(token), linkIssuedAt: new Date() },
      });
      await this.event(tx, auth, id, 'LINK_ISSUED');
    });
    return { token, path: `/pass/${token}` };
  }

  /** Révocation du lien ; pour un QR dynamique, la version change : tout QR déjà affiché est refusé. */
  async revokeLink(auth: TenantContext, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const pass = await this.lockVisible(tx, auth, id);
      const rules = pass.rules as unknown as PassRules;
      if (!pass.linkTokenHash) throw conflict('PASS_NO_LINK', 'Aucun lien personnel actif.');
      await tx.pass.update({
        where: { id },
        data: {
          linkTokenHash: null,
          ...(rules.qrMode === 'DYNAMIC' && { qrVersion: { increment: 1 } }),
        },
      });
      await this.event(tx, auth, id, 'LINK_REVOKED');
    });
    return this.get(auth, id);
  }

  /**
   * Page publique du titulaire (sans compte) : état du pass et QR calculé par le serveur. Aucune clé
   * de signature n'est envoyée au navigateur ; le QR dynamique change toutes les 30 secondes.
   */
  async publicPass(token: string) {
    const row = /^[A-Za-z0-9_-]{32}$/.test(token)
      ? await this.prisma.pass.findUnique({
          where: { linkTokenHash: hashToken(token) },
          select: {
            kind: true,
            holderName: true,
            status: true,
            rules: true,
            startDate: true,
            endDate: true,
            publicId: true,
            qrVersion: true,
            organization: { select: { name: true } },
          },
        })
      : null;
    if (!row) {
      throw new NotFoundException({
        code: 'PASS_LINK_INVALID',
        message: 'Lien invalide ou révoqué.',
      });
    }
    const rules = row.rules as unknown as PassRules;
    const today = localMoment(new Date(), rules.timezone).date;
    const state = passState(
      row.status as PassStatus,
      dbDay(row.startDate),
      dbDay(row.endDate),
      today,
    );
    const usable = state === 'ACTIVE' || state === 'UPCOMING';
    const firstName = row.holderName.split(' ')[0] ?? '';
    const qr = !usable
      ? null
      : rules.qrMode === 'DYNAMIC'
        ? this.signer.dynamicQr(row.publicId, row.qrVersion)
        : {
            qr: this.signer.staticQr(row.publicId, row.qrVersion),
            window: null,
            expiresAt: null,
            refreshInSeconds: null,
          };
    return {
      organizationName: row.organization.name,
      offerName: rules.offerName,
      kind: row.kind,
      holderFirstName: firstName,
      state,
      startDate: dbDay(row.startDate),
      endDate: dbDay(row.endDate),
      qrMode: rules.qrMode,
      ...(qr ?? { qr: null, window: null, expiresAt: null, refreshInSeconds: null }),
    };
  }

  // ─── Cartes physiques (préparation Ocall Print) ───

  /** Émission d'une carte : une seule carte active par pass (contrainte en base). */
  async issueCard(auth: TenantContext, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const pass = await this.lockVisible(tx, auth, id);
      this.assertCardable(pass);
      const active = await tx.passCard.count({ where: { passId: id, status: 'ACTIVE' } });
      if (active > 0)
        throw conflict('PASS_CARD_ACTIVE', 'Une carte est déjà active : remplacez-la.');
      const card = await tx.passCard.create({
        data: {
          organizationId: pass.organizationId,
          passId: id,
          cardNumber: newPublicId(),
          issuedById: auth.membership.id,
        },
        select: { id: true },
      });
      await this.event(tx, auth, id, 'CARD_ISSUED', { metadata: { cardId: card.id } });
    });
    return this.get(auth, id);
  }

  /**
   * Remplacement (carte perdue, abîmée) : l'ancienne carte est révoquée définitivement, la nouvelle reste
   * liée au même titulaire et au même abonnement ; l'abonnement lui-même n'est pas touché.
   */
  async replaceCard(auth: TenantContext, id: string, cardId: string, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const pass = await this.lockVisible(tx, auth, id);
      this.assertCardable(pass);
      const old = await this.revokeActiveCard(tx, auth, id, cardId, reason);
      const card = await tx.passCard.create({
        data: {
          organizationId: pass.organizationId,
          passId: id,
          cardNumber: newPublicId(),
          replacesCardId: old,
          issuedById: auth.membership.id,
        },
        select: { id: true },
      });
      await this.event(tx, auth, id, 'CARD_ISSUED', {
        reason,
        metadata: { cardId: card.id, replaces: old },
      });
    });
    return this.get(auth, id);
  }

  /** Révocation (perte, vol) sans supprimer l'abonnement ; une carte révoquée ne revient jamais. */
  async revokeCard(auth: TenantContext, id: string, cardId: string, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockVisible(tx, auth, id);
      await this.revokeActiveCard(tx, auth, id, cardId, reason);
    });
    return this.get(auth, id);
  }

  private async revokeActiveCard(
    tx: Tx,
    auth: TenantContext,
    passId: string,
    cardId: string,
    reason: string,
  ) {
    const { count } = await tx.passCard.updateMany({
      where: { id: cardId, passId, status: 'ACTIVE' },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedById: auth.membership.id,
        revokeReason: reason,
      },
    });
    if (count === 0) throw conflict('PASS_CARD_NOT_ACTIVE', 'Cette carte n’est pas active.');
    await this.event(tx, auth, passId, 'CARD_REVOKED', { reason, metadata: { cardId } });
    return cardId;
  }

  private assertCardable(pass: PassRow) {
    if (pass.status === 'CANCELLED' || pass.status === 'PENDING') {
      throw conflict('PASS_NOT_ACTIVE', 'Une carte ne s’émet que pour un pass payé et non annulé.');
    }
    if (pass.customer.anonymizedAt)
      throw conflict('PASS_ANONYMIZED', 'Le titulaire a été anonymisé.');
  }

  /**
   * Données d'impression destinées à Ocall Print (contrat préparé ; aucun moteur d'impression ici) :
   * QR signé de la carte, titulaire, offre, validité, photo (lien temporaire). La demande est datée.
   */
  async cardPrintData(auth: TenantContext, id: string, cardId: string) {
    const data = await this.prisma.$transaction(async (tx) => {
      const pass = await this.lockVisible(tx, auth, id);
      const card = await tx.passCard.findFirst({
        where: { id: cardId, passId: id, status: 'ACTIVE' },
        select: { id: true, cardNumber: true },
      });
      if (!card) throw conflict('PASS_CARD_NOT_ACTIVE', 'Cette carte n’est pas active.');
      await tx.passCard.update({ where: { id: card.id }, data: { printRequestedAt: new Date() } });
      await this.event(tx, auth, id, 'CARD_PRINT_REQUESTED', { metadata: { cardId } });
      const org = await tx.organization.findUniqueOrThrow({
        where: { id: pass.organizationId },
        select: { name: true },
      });
      return { pass, card, organizationName: org.name };
    });
    const rules = data.pass.rules as unknown as PassRules;
    return {
      format: 'ocall-print/pass-card@1',
      organizationName: data.organizationName,
      cardNumber: data.card.cardNumber,
      qr: this.signer.cardQr(data.card.cardNumber),
      holderName: data.pass.holderName,
      offerName: rules.offerName,
      kind: data.pass.kind,
      kindLabel: PASS_KIND_LABELS[data.pass.kind],
      validFrom: dbDay(data.pass.startDate),
      validUntil: dbDay(data.pass.endDate),
      photoUrl: data.pass.photoFileId
        ? this.storage.temporaryUrl(
            { id: data.pass.photoFileId, organizationId: data.pass.organizationId },
            auth.user.id,
          ).url
        : null,
    };
  }
}
