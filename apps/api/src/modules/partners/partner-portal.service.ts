import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import {
  DEMO_REQUEST_RETENTION_MONTHS,
  PARK_APP_PRODUCT_CODES,
  PARK_PRODUCT_CODE,
  PROSPECT_PROTECTION_DAYS,
  commercialState,
  isCommissionPayable,
  partnerCan,
  formatDemoRequestNumber,
  invoiceRemaining,
  normalizeCompanyName,
  normalizeEmail,
  phoneMatchKey,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { PartnerContext } from '../../common/auth-context';
import { nextPlatformSequence } from '../../common/platform-counter';
import { SuiteCommercialService } from '../suite-commercial/suite-commercial.service';
import type {
  CreateProspectDto,
  PartnerProfileDto,
  ProspectsQueryDto,
  ResellerRequestDto,
  UpdateProspectDto,
} from './partners.dto';

const DAY_MS = 86_400_000;
const PAGE = 50;

/**
 * Portail des partenaires commerciaux (Sprint 12B). Toutes les requêtes sont filtrées sur le
 * partenaire DE LA SESSION (jamais sur un identifiant envoyé par le navigateur). Un partenaire ne
 * voit de ses clients apportés que le nom et les montants encaissés ; aucune donnée métier.
 */
/**
 * Une attribution couvre-t-elle cette application ? Attribution antérieure « toutes applications »,
 * même application, ou famille Ocall Park (une seule application commerciale).
 */
export const attributionCovers = (
  attributionProductId: string | null,
  productId: string,
  parkIds: string[],
) =>
  attributionProductId === null ||
  productId === attributionProductId ||
  (parkIds.includes(attributionProductId) && parkIds.includes(productId));

@Injectable()
export class PartnerPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly commercial: SuiteCommercialService,
  ) {}

  async profile(auth: PartnerContext) {
    const p = await this.prisma.partner.findUniqueOrThrow({
      where: { id: auth.partner.id },
      select: {
        code: true,
        type: true,
        companyName: true,
        contactName: true,
        phone: true,
        country: true,
        city: true,
        territories: true,
        status: true,
        cashCollectionEnabled: true,
        cashCollectionLimit: true,
        verifiedAt: true,
        user: { select: { email: true } },
      },
    });
    const { user, ...rest } = p;
    return {
      ...rest,
      email: user.email,
      // Liens de recommandation : la présence du code ne donne aucun droit sur un client ;
      // l'attribution reste confirmée par Ocall.
      links: {
        demo: `/demo?ref=${p.code}`,
        signup: `/inscription?ref=${p.code}`,
      },
    };
  }

  /** Coordonnées modifiables par le partenaire (jamais son statut, son type ni ses taux). */
  async updateProfile(auth: PartnerContext, dto: PartnerProfileDto) {
    await this.prisma.$transaction(async (tx) => {
      await tx.partner.update({
        where: { id: auth.partner.id },
        data: {
          ...(dto.companyName !== undefined ? { companyName: dto.companyName } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.city !== undefined ? { city: dto.city } : {}),
        },
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'partner.profile_updated',
          targetType: 'Partner',
          targetId: auth.partner.id,
          metadata: { fields: Object.keys(dto) },
        },
        tx,
      );
    });
    return this.profile(auth);
  }

  /**
   * Solde de primes : acquises (à valider par Ocall), validées en attente de leur date de règlement
   * (fin du mois suivant l'encaissement), payables maintenant, réglées. Montants enregistrés
   * uniquement, aucune estimation.
   */
  async balance(auth: PartnerContext, now: Date = new Date()) {
    const rows = await this.prisma.commission.findMany({
      where: { partnerId: auth.partner.id, status: { not: 'REVERSED' } },
      select: { amount: true, status: true, payableFrom: true, payoutId: true },
    });
    const sum = (f: (c: (typeof rows)[number]) => boolean) =>
      rows.filter(f).reduce((t, c) => t + c.amount, 0);
    const due = (c: (typeof rows)[number]) => isCommissionPayable(c.payableFrom, now);
    const upcoming = rows
      .filter((c) => c.status !== 'PAID' && c.payoutId === null && !due(c) && c.payableFrom)
      .map((c) => c.payableFrom!.getTime());
    return {
      accrued: sum((c) => c.status === 'ACCRUED'),
      pending: sum((c) => c.status === 'VALIDATED' && c.payoutId === null && !due(c)),
      payable: sum((c) => c.status === 'VALIDATED' && c.payoutId === null && due(c)),
      inPayment: sum((c) => c.status === 'VALIDATED' && c.payoutId !== null),
      paid: sum((c) => c.status === 'PAID'),
      nextPayableAt: upcoming.length ? new Date(Math.min(...upcoming)) : null,
      currency: 'XOF',
    };
  }

  async dashboard(auth: PartnerContext) {
    const partnerId = auth.partner.id;
    const [prospects, payouts, balance, clients] = await Promise.all([
      this.prisma.prospect.groupBy({
        by: ['status'],
        where: { partnerId },
        _count: { _all: true },
      }),
      this.prisma.commissionPayout.findMany({
        where: { partnerId, status: 'CONFIRMED' },
        orderBy: { paidAt: 'desc' },
        take: 5,
        select: { number: true, total: true, paidAt: true },
      }),
      this.balance(auth),
      this.clients(auth),
    ]);
    const count = (statuses: string[]) =>
      prospects.filter((p) => statuses.includes(p.status)).reduce((t, p) => t + p._count._all, 0);
    const commissions =
      balance.accrued + balance.pending + balance.payable + balance.inPayment + balance.paid;
    return {
      prospects: Object.fromEntries(prospects.map((p) => [p.status, p._count._all])),
      kpis: {
        activeProspects: count(['NEW', 'CONTACTED', 'QUALIFIED', 'DEMO_REQUESTED', 'PROPOSAL']),
        convertedProspects: count(['WON']),
        clients: new Set(clients.map((c) => c.organizationId)).size,
        activeContracts: clients.reduce(
          (t, c) => t + c.applications.filter((a) => a.state === 'ACTIVE').length,
          0,
        ),
        collected: clients.reduce((t, c) => t + c.collected, 0),
        commissionsEarned: commissions,
        commissionsPaid: balance.paid,
        payable: balance.payable,
      },
      clients: clients.length,
      commissions: {
        accrued: balance.accrued,
        validated: balance.pending + balance.payable + balance.inPayment,
        paid: balance.paid,
      },
      balance,
      recentPayouts: payouts,
    };
  }

  /**
   * Produits commercialisables et leurs offres publiques : mêmes statuts que les demandes d'activation
   * (actif ou préproduction, ex. Ocall School).
   */
  products() {
    return this.prisma.saasProduct.findMany({
      where: { status: { in: ['ACTIVE', 'PREPRODUCTION'] }, listed: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        code: true,
        slug: true,
        name: true,
        tagline: true,
        plans: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            monthlyPrice: true,
            setupFee: true,
            currency: true,
            includesShowcase: true,
          },
        },
      },
    });
  }

  /** Prospects du partenaire : recherche, filtres, tri et pagination côté serveur. */
  async prospects(auth: PartnerContext, q: ProspectsQueryDto = {}) {
    const where: Prisma.ProspectWhereInput = {
      partnerId: auth.partner.id,
      ...(q.status ? { status: q.status } : {}),
      ...(q.product ? { product: { slug: q.product } } : {}),
      ...(q.followUpDue
        ? { nextFollowUpAt: { lte: new Date() }, status: { notIn: ['WON', 'LOST'] } }
        : {}),
      ...(q.q
        ? {
            OR: [
              { companyName: { contains: q.q, mode: 'insensitive' } },
              { contactName: { contains: q.q, mode: 'insensitive' } },
              { city: { contains: q.q, mode: 'insensitive' } },
              { sector: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const page = q.page ?? 0;
    const [items, total] = await Promise.all([
      this.prisma.prospect.findMany({
        where,
        orderBy: [
          // Relance facultative : les prospects sans relance en dernier.
          q.sort === 'nextFollowUpAt'
            ? { nextFollowUpAt: { sort: q.order ?? 'asc', nulls: 'last' } }
            : { [q.sort ?? 'createdAt']: q.order ?? 'desc' },
          { id: 'asc' },
        ],
        skip: page * PAGE,
        take: PAGE,
        select: {
          id: true,
          companyName: true,
          contactName: true,
          phone: true,
          email: true,
          country: true,
          city: true,
          sector: true,
          status: true,
          notes: true,
          nextFollowUpAt: true,
          protectedUntil: true,
          createdAt: true,
          updatedAt: true,
          product: { select: { slug: true, name: true } },
        },
      }),
      this.prisma.prospect.count({ where }),
    ]);
    return { items, total, page, pageSize: PAGE };
  }

  /** Historique d'un de ses prospects (étapes, notes, conversion). */
  async prospectHistory(auth: PartnerContext, id: string) {
    const prospect = await this.prisma.prospect.findFirst({
      where: { id, partnerId: auth.partner.id },
      select: { id: true },
    });
    if (!prospect) {
      throw new NotFoundException({ code: 'PROSPECT_NOT_FOUND', message: 'Prospect introuvable.' });
    }
    return this.prisma.prospectEvent.findMany({
      where: { prospectId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { type: true, fromStatus: true, toStatus: true, note: true, createdAt: true },
    });
  }

  /**
   * Enregistrement d'un prospect. Doublons détectés côté serveur (téléphone, e-mail, nom
   * d'entreprise normalisés) : un prospect encore réservé par un autre partenaire est refusé sans
   * révéler lequel ; un client déjà attribué aussi.
   */
  async createProspect(auth: PartnerContext, dto: CreateProspectDto) {
    const partnerId = auth.partner.id;
    const keys = {
      normalizedName: normalizeCompanyName(dto.companyName),
      phoneNormalized: phoneMatchKey(dto.phone),
      emailNormalized: normalizeEmail(dto.email),
    };
    return this.prisma.$transaction(async (tx) => {
      // Verrou global léger : deux partenaires enregistrant le même prospect sont sérialisés.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`prospect:${keys.phoneNormalized}`}))`;
      const now = new Date();
      const matches = await tx.prospect.findMany({
        where: {
          OR: [
            { phoneNormalized: keys.phoneNormalized },
            ...(keys.emailNormalized ? [{ emailNormalized: keys.emailNormalized }] : []),
            ...(keys.normalizedName ? [{ normalizedName: keys.normalizedName }] : []),
          ],
        },
        select: { partnerId: true, protectedUntil: true, organizationId: true, status: true },
      });
      if (matches.some((m) => m.partnerId === partnerId && m.status !== 'LOST')) {
        throw new ConflictException({
          code: 'PROSPECT_DUPLICATE',
          message: 'Vous avez déjà enregistré ce prospect.',
        });
      }
      if (
        matches.some(
          (m) =>
            m.partnerId !== partnerId &&
            (m.organizationId !== null || (m.protectedUntil > now && m.status !== 'LOST')),
        )
      ) {
        throw new ConflictException({
          code: 'PROSPECT_ALREADY_ATTRIBUTED',
          message: 'Ce prospect est déjà suivi par un autre partenaire.',
        });
      }
      const product = dto.product
        ? await tx.saasProduct.findFirst({
            where: { slug: dto.product, status: 'ACTIVE' },
            select: { id: true },
          })
        : null;
      const prospect = await tx.prospect.create({
        data: {
          partnerId,
          companyName: dto.companyName,
          contactName: dto.contactName,
          phone: dto.phone,
          email: dto.email ?? null,
          country: dto.country,
          city: dto.city ?? null,
          sector: dto.sector ?? null,
          nextFollowUpAt: dto.nextFollowUpAt ? new Date(`${dto.nextFollowUpAt}T00:00:00Z`) : null,
          productId: product?.id ?? null,
          notes: dto.notes ?? null,
          protectedUntil: new Date(now.getTime() + PROSPECT_PROTECTION_DAYS * DAY_MS),
          ...keys,
        },
        select: { id: true, companyName: true, status: true, protectedUntil: true },
      });
      await tx.prospectEvent.create({
        data: {
          prospectId: prospect.id,
          partnerId,
          type: 'CREATED',
          toStatus: 'NEW',
          actorUserId: auth.user.id,
        },
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'partner.prospect_created',
          targetType: 'Prospect',
          targetId: prospect.id,
          metadata: { partnerId },
        },
        tx,
      );
      return prospect;
    });
  }

  /** Étape, notes, secteur, relance : historisés ; un prospect gagné n'est plus modifiable. */
  async updateProspect(auth: PartnerContext, id: string, dto: UpdateProspectDto) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.prospect.findFirst({
        where: { id, partnerId: auth.partner.id, status: { not: 'WON' } },
        select: { status: true },
      });
      if (!before) {
        throw new NotFoundException({
          code: 'PROSPECT_NOT_FOUND',
          message: 'Prospect introuvable.',
        });
      }
      const updated = await tx.prospect.updateMany({
        where: { id, partnerId: auth.partner.id, status: before.status },
        data: {
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.sector !== undefined ? { sector: dto.sector } : {}),
          ...(dto.nextFollowUpAt !== undefined
            ? {
                nextFollowUpAt: dto.nextFollowUpAt
                  ? new Date(`${dto.nextFollowUpAt}T00:00:00Z`)
                  : null,
              }
            : {}),
        },
      });
      if (updated.count === 0) {
        throw new ConflictException({
          code: 'PROSPECT_CHANGED',
          message: 'Le prospect a été modifié entre-temps : rechargez la page.',
        });
      }
      const stageChanged = dto.status && dto.status !== before.status;
      await tx.prospectEvent.create({
        data: {
          prospectId: id,
          partnerId: auth.partner.id,
          type: stageChanged ? 'STAGE_CHANGED' : 'UPDATED',
          fromStatus: stageChanged ? before.status : null,
          toStatus: stageChanged ? dto.status : null,
          note: dto.notes ?? null,
          actorUserId: auth.user.id,
        },
      });
      return { id, ...dto };
    });
  }

  /** Demande de démonstration pour un de ses prospects (suivie par Ocall). */
  async requestDemo(auth: PartnerContext, prospectId: string, message: string) {
    const prospect = await this.prisma.prospect.findFirst({
      where: { id: prospectId, partnerId: auth.partner.id },
    });
    if (!prospect) {
      throw new NotFoundException({ code: 'PROSPECT_NOT_FOUND', message: 'Prospect introuvable.' });
    }
    const retentionUntil = new Date();
    retentionUntil.setUTCMonth(retentionUntil.getUTCMonth() + DEMO_REQUEST_RETENTION_MONTHS);
    return this.prisma.$transaction(async (tx) => {
      const { year, sequence } = await nextPlatformSequence(tx, 'demo');
      const demo = await tx.demoRequest.create({
        data: {
          number: formatDemoRequestNumber(year, sequence),
          name: prospect.contactName,
          company: prospect.companyName,
          country: prospect.country,
          phone: prospect.phone,
          email: prospect.email ?? 'non-renseigne@invalid',
          productId: prospect.productId,
          message,
          partnerId: auth.partner.id,
          prospectId: prospect.id,
          retentionUntil,
        },
        select: { id: true, number: true },
      });
      await tx.prospect.update({ where: { id: prospect.id }, data: { status: 'DEMO_REQUESTED' } });
      await tx.prospectEvent.create({
        data: {
          prospectId: prospect.id,
          partnerId: auth.partner.id,
          type: 'DEMO_REQUESTED',
          fromStatus: prospect.status,
          toStatus: 'DEMO_REQUESTED',
          actorUserId: auth.user.id,
        },
      });
      return demo;
    });
  }

  demoRequests(auth: PartnerContext) {
    return this.prisma.demoRequest.findMany({
      where: { partnerId: auth.partner.id, anonymizedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, number: true, company: true, status: true, createdAt: true },
    });
  }

  /**
   * Clients attribués (attributions confirmées), par application : état et échéance des abonnements,
   * montants encaissés DEPUIS l'attribution sur les applications attribuées, commissions générées. Le
   * revendeur voit en plus l'offre et le tarif contractuel. Aucune donnée métier du client.
   */
  async clients(auth: PartnerContext, now: Date = new Date()) {
    const reseller = auth.partner.type === 'RESELLER';
    const [attributions, parkIds] = await Promise.all([
      this.prisma.attribution.findMany({
        where: { partnerId: auth.partner.id, status: 'CONFIRMED' },
        orderBy: { confirmedAt: 'desc' },
        select: {
          id: true,
          confirmedAt: true,
          productId: true,
          product: { select: { code: true, name: true } },
          organization: { select: { id: true, name: true } },
        },
      }),
      this.parkFamilyIds(),
    ]);
    const orgIds = [...new Set(attributions.map((a) => a.organization.id))];
    const [subs, payments, commissions, trials] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { organizationId: { in: orgIds } },
        select: {
          organizationId: true,
          productId: true,
          status: true,
          startedAt: true,
          expiresAt: true,
          agreedMonthlyPrice: true,
          planId: true,
          product: { select: { code: true, name: true } },
          plan: { select: { name: true, monthlyPrice: true, includesShowcase: true } },
        },
      }),
      this.prisma.subscriptionPayment.findMany({
        where: { organizationId: { in: orgIds }, status: 'CONFIRMED' },
        select: {
          organizationId: true,
          amount: true,
          paidAt: true,
          subscription: { select: { productId: true } },
        },
      }),
      this.prisma.commission.groupBy({
        by: ['attributionId'],
        where: { partnerId: auth.partner.id, status: { not: 'REVERSED' } },
        _sum: { amount: true },
      }),
      this.prisma.productTrial.findMany({
        where: { organizationId: { in: orgIds } },
        select: { organizationId: true, productId: true, endsAt: true },
      }),
    ]);
    return attributions.map((a) => {
      const covers = (productId: string) => attributionCovers(a.productId, productId, parkIds);
      const since = a.confirmedAt ?? new Date(0);
      const applications = subs
        .filter((s) => s.organizationId === a.organization.id && covers(s.productId))
        .map((s) => ({
          code: s.product.code,
          name: s.product.name,
          state: commercialState(
            {
              status: s.status,
              expiresAt: s.expiresAt,
              trialEndsAt:
                trials.find(
                  (t) => t.organizationId === s.organizationId && t.productId === s.productId,
                )?.endsAt ?? null,
            },
            now,
          ),
          expiresAt: s.expiresAt,
          ...(reseller
            ? {
                plan: s.plan.name,
                // Offre contractuelle (même retirée du catalogue) : base du renouvellement.
                planId: s.planId,
                includesShowcase: s.plan.includesShowcase,
                monthlyPrice: s.agreedMonthlyPrice ?? s.plan.monthlyPrice,
                startedAt: s.startedAt,
              }
            : {}),
        }));
      return {
        attributionId: a.id,
        organizationId: a.organization.id,
        name: a.organization.name,
        product: a.product ? { code: a.product.code, name: a.product.name } : null,
        attributedAt: a.confirmedAt,
        applications,
        collected: payments
          .filter(
            (p) =>
              p.organizationId === a.organization.id &&
              p.paidAt >= since &&
              covers(p.subscription.productId),
          )
          .reduce((t, p) => t + p.amount, 0),
        commissions: commissions.find((c) => c.attributionId === a.id)?._sum.amount ?? 0,
      };
    });
  }

  commissions(auth: PartnerContext) {
    return this.prisma.commission.findMany({
      where: { partnerId: auth.partner.id },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true,
        kind: true,
        baseAmount: true,
        rateBps: true,
        amount: true,
        currency: true,
        status: true,
        payableFrom: true,
        createdAt: true,
        reversalReason: true,
        organization: { select: { name: true } },
        product: { select: { name: true } },
        payout: { select: { number: true } },
      },
    });
  }

  payouts(auth: PartnerContext) {
    return this.prisma.commissionPayout.findMany({
      where: { partnerId: auth.partner.id, status: 'CONFIRMED' },
      orderBy: { paidAt: 'desc' },
      select: {
        number: true,
        total: true,
        currency: true,
        method: true,
        reference: true,
        paidAt: true,
      },
    });
  }

  // ─── Demandes de règlement (Sprint S3) ───

  payoutRequests(auth: PartnerContext) {
    return this.prisma.partnerPayoutRequest.findMany({
      where: { partnerId: auth.partner.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        note: true,
        decisionNote: true,
        createdAt: true,
        decidedAt: true,
        payout: { select: { number: true, paidAt: true } },
      },
    });
  }

  /**
   * Demande de règlement du solde payable (commissions validées arrivées à leur date de règlement).
   * Aucun transfert automatique : Ocall règle hors plateforme puis confirme. Une seule demande en
   * attente (index unique partiel).
   */
  async requestPayout(auth: PartnerContext, note: string | null) {
    const { payable } = await this.balance(auth);
    if (payable <= 0) {
      throw new ConflictException({
        code: 'NOTHING_PAYABLE',
        message:
          'Aucune prime payable pour le moment (règlement à la fin du mois suivant l’encaissement).',
      });
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.partnerPayoutRequest.create({
          data: { partnerId: auth.partner.id, amount: payable, note },
          select: { id: true, amount: true, status: true, createdAt: true },
        });
        await this.audit.record(
          {
            organizationId: null,
            actorUserId: auth.user.id,
            action: 'partner.payout_requested',
            targetType: 'PartnerPayoutRequest',
            targetId: created.id,
            metadata: { amount: payable },
          },
          tx,
        );
        return created;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          code: 'PAYOUT_REQUEST_PENDING',
          message: 'Une demande de règlement est déjà en attente.',
        });
      }
      throw e;
    }
  }

  async cancelPayoutRequest(auth: PartnerContext, id: string) {
    const moved = await this.prisma.partnerPayoutRequest.updateMany({
      where: { id, partnerId: auth.partner.id, status: 'PENDING' },
      data: { status: 'CANCELLED', decidedAt: new Date() },
    });
    if (moved.count === 0) {
      throw new NotFoundException({
        code: 'PAYOUT_REQUEST_NOT_FOUND',
        message: 'Aucune demande en attente à annuler.',
      });
    }
    return { id, status: 'CANCELLED' as const };
  }

  // ─── Revendeur agréé (Sprint S3) ───

  /**
   * Demande d'activation ou de renouvellement préparée par le revendeur pour un client qui lui est
   * attribué pour cette application. Le revendeur ne confirme ni paiement ni activation : Ocall vérifie
   * le règlement puis traite la demande.
   */
  async resellerRequest(auth: PartnerContext, dto: ResellerRequestDto) {
    if (!partnerCan(auth.partner.type, 'subscription.requests')) {
      throw new ForbiddenException({
        code: 'RESELLER_ONLY',
        message: 'Action réservée aux revendeurs agréés.',
      });
    }
    const code = PARK_APP_PRODUCT_CODES.includes(dto.productCode)
      ? PARK_PRODUCT_CODE
      : dto.productCode;
    const product = await this.prisma.saasProduct.findUnique({
      where: { code },
      select: { id: true },
    });
    const parkIds = PARK_APP_PRODUCT_CODES.includes(code)
      ? (
          await this.prisma.saasProduct.findMany({
            where: { code: { in: [...PARK_APP_PRODUCT_CODES] } },
            select: { id: true },
          })
        ).map((p) => p.id)
      : [];
    const attributed = product
      ? await this.prisma.attribution.findFirst({
          where: {
            partnerId: auth.partner.id,
            organizationId: dto.organizationId,
            status: 'CONFIRMED',
            OR: [{ productId: { in: [product.id, ...parkIds] } }, { productId: null }],
          },
          select: { id: true },
        })
      : null;
    // Client non attribué à ce revendeur pour cette application : introuvable (aucune fuite).
    if (!attributed) {
      throw new NotFoundException({ code: 'CLIENT_NOT_FOUND', message: 'Client introuvable.' });
    }
    return this.commercial.createRequest({
      organizationId: dto.organizationId,
      actorUserId: auth.user.id,
      productCode: code,
      planId: dto.planId,
      kind: dto.kind,
      partnerId: auth.partner.id,
    });
  }

  /**
   * Factures à payer de ses clients apportés (pour une collecte d'espèces, si le partenaire y est
   * habilité) : numéro, client, reste dû. Rien d'autre.
   */
  async collectibleInvoices(auth: PartnerContext) {
    const [attributions, parkIds] = await Promise.all([
      this.prisma.attribution.findMany({
        where: { partnerId: auth.partner.id, status: 'CONFIRMED' },
        select: { organizationId: true, productId: true },
      }),
      this.parkFamilyIds(),
    ]);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId: { in: [...new Set(attributions.map((a) => a.organizationId))] },
        status: 'ISSUED',
      },
      select: {
        id: true,
        number: true,
        total: true,
        currency: true,
        organization: { select: { id: true, name: true } },
        subscription: { select: { productId: true } },
        payments: { select: { amount: true, status: true } },
      },
    });
    // Seulement les factures des applications attribuées à ce partenaire (attribution par application).
    return invoices
      .filter((i) =>
        attributions.some(
          (a) =>
            a.organizationId === i.organization.id &&
            attributionCovers(a.productId, i.subscription.productId, parkIds),
        ),
      )
      .map(({ payments, subscription: _subscription, ...i }) => ({
        ...i,
        remaining: invoiceRemaining(i.total, payments),
      }));
  }

  private parkFamilyIds() {
    return this.prisma.saasProduct
      .findMany({ where: { code: { in: [...PARK_APP_PRODUCT_CODES] } }, select: { id: true } })
      .then((r) => r.map((p) => p.id));
  }

  /** Collectes d'espèces déclarées par le partenaire. */
  cashCollections(auth: PartnerContext) {
    return this.prisma.subscriptionPayment.findMany({
      where: { collectedByPartnerId: auth.partner.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        paidAt: true,
        receiptNumber: true,
        receiptReference: true,
        organization: { select: { name: true } },
        invoice: { select: { number: true } },
      },
    });
  }
}
