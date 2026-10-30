import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import {
  CUSTOMER_RETENTION_MONTHS,
  CUSTOMER_SEARCH_LIMIT_RESTRICTED,
  CUSTOMER_SEARCH_MIN_LENGTH,
  LOYALTY_ACTIVITIES,
  coversActivity,
  hasPermission,
  normalizePhone,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { establishmentScope } from '../../common/tenant-scope';
import type { CreateCustomerDto, CustomersQueryDto, UpdateCustomerDto } from './crm.dto';

const NOT_FOUND = { code: 'CUSTOMER_NOT_FOUND', message: 'Client introuvable.' };

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const BASIC_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  marketingConsent: true,
  lastVisitAt: true,
  anonymizedAt: true,
  wallets: { select: { activity: true, balance: true } },
} as const satisfies Prisma.CustomerSelect;

/**
 * CRM : fiches clients de l'organisation (partagées par ses établissements).
 *
 * Protection des données :
 * - toutes les informations sont facultatives ; consentement obligatoire pour créer une fiche ;
 * - un employé sans `customer.history` (caissier) ne peut que RECHERCHER (3 caractères au moins,
 *   10 résultats), sans notes ni historique ni dépenses ;
 * - demande de suppression : anonymisation (les ventes restent, sans personne identifiable) ;
 * - règle de conservation : anonymisation après 36 mois sans visite, appliquée par un administrateur ;
 * - aucune donnée personnelle dans le journal d'audit (identifiants seulement).
 */
@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: TenantContext, query: CustomersQueryDto) {
    const organizationId = auth.membership.organizationId;
    const full = hasPermission(auth.membership.role, 'customer.history');
    const q = query.q?.trim() ?? '';
    if (!full && q.length < CUSTOMER_SEARCH_MIN_LENGTH) {
      throw new BadRequestException({
        code: 'SEARCH_TOO_SHORT',
        message: `Saisissez au moins ${CUSTOMER_SEARCH_MIN_LENGTH} caractères (nom ou téléphone).`,
      });
    }
    const where: Prisma.CustomerWhereInput = { organizationId, anonymizedAt: null };
    if (q) {
      const digits = q.replace(/[^0-9]/g, '');
      where.OR = [
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        ...(digits.length >= CUSTOMER_SEARCH_MIN_LENGTH ? [{ phone: { contains: digits } }] : []),
      ];
    }
    if (full && query.filter === 'marketing') where.marketingConsent = true;
    if (full && query.filter === 'withPoints') where.wallets = { some: { balance: { gt: 0 } } };
    if (full && query.filter === 'inactive') {
      where.OR = undefined;
      where.lastVisitAt = { lt: new Date(Date.now() - 90 * 86_400_000) };
    }
    const rows = await this.prisma.customer.findMany({
      where,
      orderBy: [{ lastVisitAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: full ? (query.limit ?? 50) : CUSTOMER_SEARCH_LIMIT_RESTRICTED,
      select: BASIC_SELECT,
    });
    if (!full) return rows.map((r) => this.withWallets(auth, r));
    const stats = await this.stats(
      auth,
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({ ...this.withWallets(auth, r), ...stats.get(r.id) }));
  }

  async get(auth: TenantContext, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, organizationId: auth.membership.organizationId },
      select: {
        ...BASIC_SELECT,
        notes: true,
        consentAt: true,
        marketingConsentAt: true,
        createdAt: true,
      },
    });
    if (!customer) throw new NotFoundException(NOT_FOUND);
    const base = this.withWallets(auth, customer);
    if (!hasPermission(auth.membership.role, 'customer.history')) {
      // Accès limité : ni notes, ni historique, ni dépenses.
      const { notes: _notes, ...limited } = base as typeof base & { notes?: string | null };
      return limited;
    }
    const [stats, purchases, movements] = await Promise.all([
      this.stats(auth, [id]),
      this.prisma.sale.findMany({
        where: {
          organizationId: auth.membership.organizationId,
          customerId: id,
          paymentStatus: 'PAID',
          status: 'OPEN',
          establishment: establishmentScope(auth),
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          number: true,
          activity: true,
          total: true,
          loyaltyDiscount: true,
          createdAt: true,
          establishment: { select: { name: true } },
        },
      }),
      this.prisma.loyaltyTransaction.findMany({
        where: { organizationId: auth.membership.organizationId, wallet: { customerId: id } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          kind: true,
          points: true,
          balanceAfter: true,
          reason: true,
          createdAt: true,
          wallet: { select: { activity: true } },
        },
      }),
    ]);
    return {
      ...base,
      ...stats.get(id),
      purchases,
      loyaltyMovements: movements.map(({ wallet, ...m }) => ({ ...m, activity: wallet.activity })),
    };
  }

  async create(auth: TenantContext, dto: CreateCustomerDto) {
    const phone = this.phone(dto.phone);
    if (!dto.firstName && !dto.lastName && !phone) {
      throw new BadRequestException({
        code: 'IDENTIFIER_REQUIRED',
        message: 'Indiquez au moins un nom ou un numéro de téléphone.',
      });
    }
    const now = new Date();
    try {
      const customer = await this.prisma.customer.create({
        data: {
          organizationId: auth.membership.organizationId,
          firstName: dto.firstName ?? null,
          lastName: dto.lastName ?? null,
          phone,
          notes: dto.notes ?? null,
          consentAt: now,
          marketingConsent: dto.marketingConsent ?? false,
          marketingConsentAt: dto.marketingConsent ? now : null,
          createdById: auth.membership.id,
        },
        select: { id: true },
      });
      await this.record(auth, 'customer.created', customer.id, {
        marketingConsent: dto.marketingConsent ?? false,
      });
      return this.get(auth, customer.id);
    } catch (error) {
      if (isUniqueViolation(error)) throw await this.phoneTaken(auth, phone);
      throw error;
    }
  }

  async update(auth: TenantContext, id: string, dto: UpdateCustomerDto) {
    const current = await this.find(auth, id);
    if (current.anonymizedAt) {
      throw new ConflictException({
        code: 'CUSTOMER_ANONYMIZED',
        message: 'Cette fiche a été anonymisée.',
      });
    }
    const phone = dto.phone === undefined ? undefined : this.phone(dto.phone);
    const next = {
      firstName: dto.firstName === undefined ? current.firstName : dto.firstName,
      lastName: dto.lastName === undefined ? current.lastName : dto.lastName,
      phone: phone === undefined ? current.phone : phone,
    };
    if (!next.firstName && !next.lastName && !next.phone) {
      throw new BadRequestException({
        code: 'IDENTIFIER_REQUIRED',
        message: 'Indiquez au moins un nom ou un numéro de téléphone.',
      });
    }
    try {
      await this.prisma.customer.update({
        where: { id },
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone,
          notes: dto.notes,
          ...(dto.marketingConsent !== undefined
            ? {
                marketingConsent: dto.marketingConsent,
                marketingConsentAt: dto.marketingConsent ? new Date() : null,
              }
            : {}),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw await this.phoneTaken(auth, phone ?? null);
      throw error;
    }
    await this.record(auth, 'customer.updated', id, {
      fields: Object.keys(dto).filter((k) => dto[k as keyof UpdateCustomerDto] !== undefined),
    });
    return this.get(auth, id);
  }

  /**
   * Demande de suppression : les données personnelles sont effacées et la fiche marquée anonymisée.
   * Les ventes restent (comptabilité) mais ne désignent plus personne ; les points sont annulés.
   */
  async erase(auth: TenantContext, id: string, reason: string) {
    await this.find(auth, id);
    await this.prisma.$transaction(async (tx) => this.anonymize(tx, auth, id, reason));
    return { id, anonymized: true };
  }

  /** Règle de conservation : anonymise les fiches sans visite depuis 36 mois. */
  async applyRetention(auth: TenantContext) {
    const limit = new Date();
    limit.setMonth(limit.getMonth() - CUSTOMER_RETENTION_MONTHS);
    const stale = await this.prisma.customer.findMany({
      where: {
        organizationId: auth.membership.organizationId,
        anonymizedAt: null,
        OR: [{ lastVisitAt: { lt: limit } }, { lastVisitAt: null, createdAt: { lt: limit } }],
      },
      select: { id: true },
      take: 500,
    });
    for (const { id } of stale) {
      await this.prisma.$transaction((tx) =>
        this.anonymize(
          tx,
          auth,
          id,
          `Règle de conservation (${CUSTOMER_RETENTION_MONTHS} mois sans visite)`,
        ),
      );
    }
    await this.record(auth, 'customer.retention_applied', null, {
      anonymized: stale.length,
      months: CUSTOMER_RETENTION_MONTHS,
    });
    return { anonymized: stale.length, months: CUSTOMER_RETENTION_MONTHS };
  }

  private async anonymize(
    tx: Prisma.TransactionClient,
    auth: TenantContext,
    id: string,
    reason: string,
  ) {
    const updated = await tx.customer.updateMany({
      where: { id, organizationId: auth.membership.organizationId, anonymizedAt: null },
      data: {
        firstName: null,
        lastName: null,
        phone: null,
        notes: null,
        marketingConsent: false,
        marketingConsentAt: null,
        anonymizedAt: new Date(),
      },
    });
    if (updated.count === 0) return;
    const wallets = await tx.loyaltyWallet.findMany({
      where: { customerId: id, balance: { gt: 0 } },
      select: { id: true, balance: true },
    });
    for (const w of wallets) {
      await tx.loyaltyWallet.update({ where: { id: w.id }, data: { balance: 0 } });
      await tx.loyaltyTransaction.create({
        data: {
          organizationId: auth.membership.organizationId,
          walletId: w.id,
          kind: 'ADJUST',
          points: -w.balance,
          balanceAfter: 0,
          reason: 'Anonymisation du client',
          actorMembershipId: auth.membership.id,
          idempotencyKey: `erase:${w.id}`,
        },
      });
    }
    await this.audit.record(
      {
        organizationId: auth.membership.organizationId,
        actorUserId: auth.user.id,
        action: 'customer.anonymized',
        targetType: 'Customer',
        targetId: id,
        metadata: { reason },
      },
      tx,
    );
  }

  /** Visites (ventes payées), dépenses cumulées et dernière visite, dans le périmètre du membre. */
  private async stats(auth: TenantContext, ids: string[]) {
    if (ids.length === 0) return new Map<string, { visits: number; totalSpent: number }>();
    const rows = await this.prisma.sale.groupBy({
      by: ['customerId'],
      where: {
        organizationId: auth.membership.organizationId,
        customerId: { in: ids },
        paymentStatus: 'PAID',
        status: 'OPEN',
        establishment: establishmentScope(auth),
      },
      _count: { _all: true },
      _sum: { total: true },
    });
    return new Map(
      rows.map((r) => [r.customerId!, { visits: r._count._all, totalSpent: r._sum.total ?? 0 }]),
    );
  }

  /** Soldes des portefeuilles des activités du métier (0 si le client n'a encore rien gagné). */
  private withWallets<
    T extends { wallets: { activity: 'PARK' | 'RESTAURANT'; balance: number }[] },
  >(auth: TenantContext, row: T) {
    const { wallets, ...rest } = row;
    return {
      ...rest,
      wallets: LOYALTY_ACTIVITIES.filter((a) =>
        coversActivity(auth.membership.businessType, a),
      ).map((activity) => ({
        activity,
        balance: wallets.find((w) => w.activity === activity)?.balance ?? 0,
      })),
    };
  }

  private phone(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const phone = normalizePhone(raw);
    if (!phone) {
      throw new BadRequestException({
        code: 'INVALID_PHONE',
        message: 'Numéro de téléphone invalide.',
      });
    }
    return phone;
  }

  private async phoneTaken(auth: TenantContext, phone: string | null) {
    const existing = phone
      ? await this.prisma.customer.findFirst({
          where: { organizationId: auth.membership.organizationId, phone },
          select: { id: true },
        })
      : null;
    return new ConflictException({
      code: 'PHONE_TAKEN',
      message: 'Un client existe déjà avec ce numéro.',
      details: existing ? { customerId: existing.id } : undefined,
    });
  }

  private async find(auth: TenantContext, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, organizationId: auth.membership.organizationId },
      select: { id: true, firstName: true, lastName: true, phone: true, anonymizedAt: true },
    });
    if (!customer) throw new NotFoundException(NOT_FOUND);
    return customer;
  }

  private record(
    auth: TenantContext,
    action: string,
    targetId: string | null,
    metadata: Prisma.InputJsonObject,
  ) {
    return this.audit.record({
      organizationId: auth.membership.organizationId,
      actorUserId: auth.user.id,
      action,
      targetType: 'Customer',
      targetId,
      metadata,
    });
  }
}
