import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import { PASS_KIND_DEFAULTS, coversActivity, passPhotoRequired } from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { toDbDate } from './park-schedule.service';
import type { CreatePassOfferDto, PassOfferSiteDto, UpdatePassOfferDto } from './pass.dto';

type Tx = Prisma.TransactionClient;

export const OFFER_SELECT = {
  id: true,
  kind: true,
  name: true,
  description: true,
  price: true,
  currency: true,
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
  conditions: true,
  saleFrom: true,
  saleUntil: true,
  isActive: true,
  createdAt: true,
  sites: {
    select: {
      establishmentId: true,
      price: true,
      isActive: true,
      establishment: { select: { name: true, timezone: true } },
    },
    orderBy: { establishment: { name: 'asc' } },
  },
} as const satisfies Prisma.PassOfferSelect;

type OfferRow = Prisma.PassOfferGetPayload<{ select: typeof OFFER_SELECT }>;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function toOffer(o: OfferRow) {
  return {
    ...o,
    saleFrom: day(o.saleFrom),
    saleUntil: day(o.saleUntil),
    sites: o.sites.map((s) => ({
      establishmentId: s.establishmentId,
      name: s.establishment.name,
      timezone: s.establishment.timezone,
      price: s.price,
      effectivePrice: s.price ?? o.price,
      isActive: s.isActive,
    })),
  };
}

const NOT_FOUND = { code: 'PASS_OFFER_NOT_FOUND', message: 'Offre de pass introuvable.' };

/**
 * Ocall Parc sprint 8 : catalogue des offres de pass (configuration réservée à `ticketing.manage`).
 * Une offre n'est jamais supprimée (désactivée) ; les pass déjà vendus gardent les règles figées à la
 * vente : modifier une offre n'a aucun effet rétroactif.
 */
@Injectable()
export class PassOffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: TenantContext) {
    const rows = await this.prisma.passOffer.findMany({
      where: { organizationId: auth.membership.organizationId },
      select: OFFER_SELECT,
      orderBy: [{ isActive: 'desc' }, { kind: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toOffer);
  }

  async get(auth: TenantContext, id: string) {
    const row = await this.prisma.passOffer.findFirst({
      where: { id, organizationId: auth.membership.organizationId },
      select: OFFER_SELECT,
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return toOffer(row);
  }

  async create(auth: TenantContext, dto: CreatePassOfferDto) {
    const organizationId = auth.membership.organizationId;
    const defaults = PASS_KIND_DEFAULTS[dto.kind];
    const values = {
      durationUnit: dto.durationUnit ?? defaults.durationUnit,
      durationValue: dto.durationValue ?? defaults.durationValue,
      totalEntries: dto.totalEntries === undefined ? defaults.totalEntries : dto.totalEntries,
      dailyEntries: dto.dailyEntries === undefined ? defaults.dailyEntries : dto.dailyEntries,
      qrMode: dto.qrMode ?? defaults.qrMode,
      photoRequired: passPhotoRequired(dto.kind, dto.photoRequired ?? defaults.photoRequired),
      renewable: dto.renewable ?? defaults.renewable,
    };
    this.assertConsistent({
      ...values,
      saleFrom: dto.saleFrom ?? null,
      saleUntil: dto.saleUntil ?? null,
    });
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        await this.assertSites(tx, organizationId, dto.sites);
        const offer = await tx.passOffer.create({
          data: {
            organizationId,
            kind: dto.kind,
            name: dto.name,
            description: dto.description ?? '',
            price: dto.price,
            ...values,
            allowedWeekdays: dto.allowedWeekdays ?? [],
            maxSuspensionDays: dto.maxSuspensionDays ?? 0,
            suspensionExtends: dto.suspensionExtends ?? true,
            conditions: dto.conditions ?? '',
            saleFrom: dto.saleFrom ? toDbDate(dto.saleFrom) : null,
            saleUntil: dto.saleUntil ? toDbDate(dto.saleUntil) : null,
            createdById: auth.membership.id,
            sites: {
              create: dto.sites.map((s) => ({
                organizationId,
                establishmentId: s.establishmentId,
                price: s.price ?? null,
              })),
            },
          },
          select: { id: true },
        });
        await this.audit.record(
          {
            organizationId,
            actorUserId: auth.user.id,
            action: 'pass_offer.created',
            targetType: 'PassOffer',
            targetId: offer.id,
            metadata: { kind: dto.kind, name: dto.name, price: dto.price, sites: dto.sites.length },
          },
          tx,
        );
        return offer.id;
      });
      return this.get(auth, id);
    } catch (e) {
      throw this.nameTaken(e);
    }
  }

  async update(auth: TenantContext, id: string, dto: UpdatePassOfferDto) {
    const organizationId = auth.membership.organizationId;
    const before = await this.prisma.passOffer.findFirst({
      where: { id, organizationId },
      select: OFFER_SELECT,
    });
    if (!before) throw new NotFoundException(NOT_FOUND);
    const next = {
      durationUnit: dto.durationUnit ?? before.durationUnit,
      durationValue: dto.durationValue ?? before.durationValue,
      totalEntries: dto.totalEntries === undefined ? before.totalEntries : dto.totalEntries,
      dailyEntries: dto.dailyEntries === undefined ? before.dailyEntries : dto.dailyEntries,
      qrMode: dto.qrMode ?? before.qrMode,
      photoRequired: passPhotoRequired(before.kind, dto.photoRequired ?? before.photoRequired),
      renewable: dto.renewable ?? before.renewable,
      saleFrom: dto.saleFrom === undefined ? day(before.saleFrom) : dto.saleFrom,
      saleUntil: dto.saleUntil === undefined ? day(before.saleUntil) : dto.saleUntil,
    };
    this.assertConsistent(next);
    try {
      await this.prisma.$transaction(async (tx) => {
        if (dto.sites) await this.assertSites(tx, organizationId, dto.sites);
        await tx.passOffer.update({
          where: { id },
          data: {
            ...(dto.name !== undefined && { name: dto.name }),
            ...(dto.description !== undefined && { description: dto.description }),
            ...(dto.price !== undefined && { price: dto.price }),
            durationUnit: next.durationUnit,
            durationValue: next.durationValue,
            totalEntries: next.totalEntries,
            dailyEntries: next.dailyEntries,
            qrMode: next.qrMode,
            photoRequired: next.photoRequired,
            renewable: next.renewable,
            ...(dto.allowedWeekdays !== undefined && { allowedWeekdays: dto.allowedWeekdays }),
            ...(dto.maxSuspensionDays !== undefined && {
              maxSuspensionDays: dto.maxSuspensionDays,
            }),
            ...(dto.suspensionExtends !== undefined && {
              suspensionExtends: dto.suspensionExtends,
            }),
            ...(dto.conditions !== undefined && { conditions: dto.conditions }),
            saleFrom: next.saleFrom ? toDbDate(next.saleFrom) : null,
            saleUntil: next.saleUntil ? toDbDate(next.saleUntil) : null,
            ...(dto.isActive !== undefined && { isActive: dto.isActive }),
          },
        });
        if (dto.sites) {
          // Parcs retirés : désactivés (jamais supprimés) ; parcs présents : ajoutés ou mis à jour.
          const keep = new Set(dto.sites.map((s) => s.establishmentId));
          await tx.passOfferSite.updateMany({
            where: { offerId: id, establishmentId: { notIn: [...keep] } },
            data: { isActive: false },
          });
          for (const s of dto.sites) {
            await tx.passOfferSite.upsert({
              where: {
                offerId_establishmentId: { offerId: id, establishmentId: s.establishmentId },
              },
              create: {
                organizationId,
                offerId: id,
                establishmentId: s.establishmentId,
                price: s.price ?? null,
              },
              update: { price: s.price ?? null, isActive: true },
            });
          }
        }
        await this.audit.record(
          {
            organizationId,
            actorUserId: auth.user.id,
            action: 'pass_offer.updated',
            targetType: 'PassOffer',
            targetId: id,
            metadata: { changes: Object.keys(dto) },
          },
          tx,
        );
      });
      return this.get(auth, id);
    } catch (e) {
      throw this.nameTaken(e);
    }
  }

  /** Cohérence d'une offre : durée et unité, fenêtre de vente. */
  private assertConsistent(o: {
    durationUnit: 'DAYS' | 'MONTHS';
    durationValue: number;
    saleFrom: string | null;
    saleUntil: string | null;
  }) {
    if (o.durationUnit === 'MONTHS' && o.durationValue > 24) {
      throw new BadRequestException({
        code: 'PASS_DURATION_INVALID',
        message: 'Durée en mois : 24 mois au plus.',
      });
    }
    if (o.saleFrom && o.saleUntil && o.saleFrom > o.saleUntil) {
      throw new BadRequestException({
        code: 'PASS_SALE_WINDOW_INVALID',
        message: 'La fin de la vente précède son début.',
      });
    }
  }

  /** Parcs autorisés : établissements actifs de l'organisation avec une activité parc, sans doublon. */
  private async assertSites(tx: Tx, organizationId: string, sites: PassOfferSiteDto[]) {
    const ids = sites.map((s) => s.establishmentId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException({
        code: 'PASS_SITE_DUPLICATE',
        message: 'Un parc figure deux fois.',
      });
    }
    const found = await tx.establishment.findMany({
      where: { organizationId, id: { in: ids }, isActive: true },
      select: { id: true, businessType: true },
    });
    if (found.length !== ids.length || found.some((e) => !coversActivity(e.businessType, 'PARK'))) {
      throw new BadRequestException({
        code: 'PASS_SITE_INVALID',
        message: 'Chaque parc autorisé doit être un établissement actif avec une activité parc.',
      });
    }
  }

  private nameTaken(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ConflictException({
        code: 'PASS_OFFER_NAME_TAKEN',
        message: 'Une offre de ce nom existe déjà.',
      });
    }
    return e;
  }
}
