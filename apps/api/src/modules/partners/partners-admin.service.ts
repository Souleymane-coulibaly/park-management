import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { Prisma } from '@ocall/database';
import { effectivePlatformRole, formatPayoutNumber } from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth-context';
import { reverseCommissions } from '../../common/commissions';
import { nextPlatformSequence } from '../../common/platform-counter';
import { PasswordService } from '../../common/security/password.service';
import { SessionService } from '../../common/security/session.service';
import { generateTemporaryPassword } from '../../common/security/tokens';
import type {
  CreateCommissionRuleDto,
  CreatePartnerDto,
  ProposeAttributionDto,
  RecordPayoutDto,
  UpdatePartnerDto,
} from './partners.dto';

type Tx = Prisma.TransactionClient;
const DAY_MS = 86_400_000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = () =>
  Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

const PARTNER_SELECT = {
  id: true,
  code: true,
  companyName: true,
  contactName: true,
  phone: true,
  country: true,
  territories: true,
  status: true,
  cashCollectionEnabled: true,
  cashCollectionLimit: true,
  commissionRuleId: true,
  notes: true,
  verifiedAt: true,
  suspendedAt: true,
  suspensionReason: true,
  createdAt: true,
  user: { select: { id: true, email: true, firstName: true, lastName: true } },
  _count: { select: { prospects: true, attributions: true } },
} satisfies Prisma.PartnerSelect;

/**
 * Gestion des partenaires commerciaux par le Super Admin (Sprint 12B) : comptes, vérification,
 * suspension, règles de commission (validées par le propriétaire), prospects, attributions
 * (toujours confirmées par Ocall), validation des commissions, versements à quatre yeux, rapports.
 * Aucun versement automatique.
 */
@Injectable()
export class PartnersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  // ─── Partenaires ───

  list() {
    return this.prisma.partner.findMany({ orderBy: { createdAt: 'desc' }, select: PARTNER_SELECT });
  }

  /**
   * Création et invitation : compte nominatif avec mot de passe temporaire (changé à la première
   * connexion), double authentification obligatoire, profil « à vérifier ».
   */
  async create(auth: AuthContext, dto: CreatePartnerDto) {
    if (await this.prisma.user.findUnique({ where: { email: dto.email }, select: { id: true } })) {
      throw new ConflictException({
        code: 'EMAIL_TAKEN',
        message: 'Un compte existe déjà avec cette adresse.',
      });
    }
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const partner = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          loginId: dto.email.toUpperCase(),
          passwordHash,
          mustChangePassword: true,
        },
        select: { id: true },
      });
      let code = randomCode();
      for (let i = 0; i < 5 && (await tx.partner.count({ where: { code } })) > 0; i++) {
        code = randomCode();
      }
      const created = await tx.partner.create({
        data: {
          userId: user.id,
          code,
          companyName: dto.companyName,
          contactName: `${dto.firstName} ${dto.lastName}`,
          phone: dto.phone,
          country: dto.country,
          territories: dto.territories ?? [],
          createdById: auth.user.id,
        },
        select: PARTNER_SELECT,
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.partner_created',
          targetType: 'Partner',
          targetId: created.id,
          metadata: { code, companyName: dto.companyName },
        },
        tx,
      );
      return created;
    });
    return { partner, temporaryPassword };
  }

  async update(auth: AuthContext, id: string, dto: UpdatePartnerDto) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findPartner(tx, id);
      if (dto.commissionRuleId) {
        const rule = await tx.commissionRule.findUnique({ where: { id: dto.commissionRuleId } });
        if (!rule) {
          throw new BadRequestException({ code: 'RULE_NOT_FOUND', message: 'Règle introuvable.' });
        }
      }
      const updated = await tx.partner.update({
        where: { id },
        data: {
          ...(dto.territories !== undefined ? { territories: dto.territories } : {}),
          ...(dto.cashCollectionEnabled !== undefined
            ? { cashCollectionEnabled: dto.cashCollectionEnabled }
            : {}),
          ...(dto.cashCollectionLimit !== undefined
            ? { cashCollectionLimit: dto.cashCollectionLimit }
            : {}),
          ...(dto.commissionRuleId !== undefined ? { commissionRuleId: dto.commissionRuleId } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
        select: PARTNER_SELECT,
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.partner_updated',
          targetType: 'Partner',
          targetId: id,
          metadata: {
            before: {
              cashCollectionEnabled: before.cashCollectionEnabled,
              cashCollectionLimit: before.cashCollectionLimit,
              commissionRuleId: before.commissionRuleId,
            },
            after: { ...dto },
          },
        },
        tx,
      );
      return updated;
    });
  }

  /** Vérification du profil : le partenaire peut alors travailler. */
  verify(auth: AuthContext, id: string) {
    return this.setStatus(
      auth,
      id,
      ['PENDING_VERIFICATION'],
      'ACTIVE',
      null,
      'platform.partner_verified',
    );
  }

  /** Suspension : sessions fermées, plus aucune nouvelle commission. */
  suspend(auth: AuthContext, id: string, reason: string) {
    return this.setStatus(
      auth,
      id,
      ['PENDING_VERIFICATION', 'ACTIVE'],
      'SUSPENDED',
      reason,
      'platform.partner_suspended',
    );
  }

  reactivate(auth: AuthContext, id: string, reason: string) {
    return this.setStatus(
      auth,
      id,
      ['SUSPENDED'],
      'ACTIVE',
      reason,
      'platform.partner_reactivated',
    );
  }

  private async setStatus(
    auth: AuthContext,
    id: string,
    from: ('PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED')[],
    to: 'ACTIVE' | 'SUSPENDED',
    reason: string | null,
    action: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const partner = await this.findPartner(tx, id);
      const claimed = await tx.partner.updateMany({
        where: { id, status: { in: from } },
        data: {
          status: to,
          ...(to === 'SUSPENDED'
            ? { suspendedAt: new Date(), suspensionReason: reason }
            : { suspendedAt: null, suspensionReason: null }),
          ...(action === 'platform.partner_verified'
            ? { verifiedAt: new Date(), verifiedById: auth.user.id }
            : {}),
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          code: 'PARTNER_STATUS_CONFLICT',
          message: `Action impossible depuis le statut ${partner.status}.`,
        });
      }
      if (to === 'SUSPENDED') await this.sessions.revokeAllForUser(partner.userId, undefined, tx);
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action,
          targetType: 'Partner',
          targetId: id,
          metadata: { from: partner.status, to, reason },
        },
        tx,
      );
      return tx.partner.findUniqueOrThrow({ where: { id }, select: PARTNER_SELECT });
    });
  }

  // ─── Règles de commission ───

  rules() {
    return this.prisma.commissionRule.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /** Règle créée INACTIVE : elle ne s'applique qu'après validation par le propriétaire. */
  async createRule(auth: AuthContext, dto: CreateCommissionRuleDto) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.productId && !(await tx.saasProduct.findUnique({ where: { id: dto.productId } }))) {
        throw new BadRequestException({
          code: 'PRODUCT_NOT_FOUND',
          message: 'Produit introuvable.',
        });
      }
      const rule = await tx.commissionRule.create({
        data: { ...dto, productId: dto.productId ?? null, createdById: auth.user.id },
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.commission_rule_created',
          targetType: 'CommissionRule',
          targetId: rule.id,
          metadata: { ...dto },
        },
        tx,
      );
      return rule;
    });
  }

  /** Activation ou désactivation d'une règle : réservée au propriétaire de la plateforme. */
  async setRuleActive(auth: AuthContext, id: string, active: boolean) {
    if (effectivePlatformRole(auth.user.platformRole) !== 'PLATFORM_OWNER') {
      throw new ForbiddenException({
        code: 'OWNER_ONLY',
        message: 'Seul le propriétaire de la plateforme valide les règles de commission.',
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.commissionRule.findUnique({ where: { id } });
      if (!rule)
        throw new NotFoundException({ code: 'RULE_NOT_FOUND', message: 'Règle introuvable.' });
      const updated = await tx.commissionRule.update({
        where: { id },
        data: active
          ? { isActive: true, validatedById: auth.user.id, validatedAt: new Date() }
          : { isActive: false },
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: active
            ? 'platform.commission_rule_validated'
            : 'platform.commission_rule_disabled',
          targetType: 'CommissionRule',
          targetId: id,
          metadata: {
            setupRateBps: rule.setupRateBps,
            monthlyRateBps: rule.monthlyRateBps,
            monthlyWindowMonths: rule.monthlyWindowMonths,
          },
        },
        tx,
      );
      return updated;
    });
  }

  // ─── Prospects ───

  prospects(query: { partnerId?: string }) {
    return this.prisma.prospect.findMany({
      where: query.partnerId ? { partnerId: query.partnerId } : {},
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        partner: { select: { id: true, code: true, companyName: true } },
        product: { select: { code: true, name: true } },
        organization: { select: { id: true, name: true } },
      },
    });
  }

  /** Prolongation de la réservation d'un prospect (journalisée). */
  async extendProtection(auth: AuthContext, id: string, days: number) {
    const prospect = await this.prisma.prospect.findUnique({ where: { id } });
    if (!prospect) {
      throw new NotFoundException({ code: 'PROSPECT_NOT_FOUND', message: 'Prospect introuvable.' });
    }
    const base = Math.max(prospect.protectedUntil.getTime(), Date.now());
    const updated = await this.prisma.prospect.update({
      where: { id },
      data: { protectedUntil: new Date(base + days * DAY_MS) },
    });
    await this.audit.record({
      organizationId: null,
      actorUserId: auth.user.id,
      action: 'platform.prospect_protection_extended',
      targetType: 'Prospect',
      targetId: id,
      metadata: { days, protectedUntil: updated.protectedUntil.toISOString() },
    });
    return updated;
  }

  // ─── Attributions ───

  attributions(query: { status?: string }) {
    return this.prisma.attribution.findMany({
      where: query.status ? { status: query.status as 'PENDING' } : {},
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        organization: { select: { id: true, name: true } },
        partner: { select: { id: true, code: true, companyName: true } },
        prospect: { select: { id: true, companyName: true } },
      },
    });
  }

  /** Proposition d'attribution par Ocall (source ADMIN), à confirmer comme toute attribution. */
  async propose(auth: AuthContext, dto: ProposeAttributionDto) {
    return this.prisma.$transaction(async (tx) => {
      const [org, partner] = await Promise.all([
        tx.organization.findUnique({ where: { id: dto.organizationId }, select: { id: true } }),
        tx.partner.findUnique({ where: { id: dto.partnerId }, select: { id: true, status: true } }),
      ]);
      if (!org) {
        throw new NotFoundException({
          code: 'ORGANIZATION_NOT_FOUND',
          message: 'Organisation introuvable.',
        });
      }
      if (!partner)
        throw new NotFoundException({
          code: 'PARTNER_NOT_FOUND',
          message: 'Partenaire introuvable.',
        });
      if (dto.prospectId) {
        const prospect = await tx.prospect.findFirst({
          where: { id: dto.prospectId, partnerId: dto.partnerId },
          select: { id: true },
        });
        if (!prospect) {
          throw new BadRequestException({
            code: 'PROSPECT_INVALID',
            message: 'Ce prospect n’appartient pas à ce partenaire.',
          });
        }
      }
      const existing = await tx.attribution.findFirst({
        where: { organizationId: dto.organizationId, partnerId: dto.partnerId, status: 'PENDING' },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException({
          code: 'ATTRIBUTION_PENDING',
          message: 'Une proposition est déjà en attente pour ce partenaire.',
        });
      }
      const attribution = await tx.attribution.create({
        data: {
          organizationId: dto.organizationId,
          partnerId: dto.partnerId,
          prospectId: dto.prospectId ?? null,
          source: dto.prospectId ? 'PROSPECT' : 'ADMIN',
          createdById: auth.user.id,
        },
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.attribution_proposed',
          targetType: 'Attribution',
          targetId: attribution.id,
          metadata: { ...dto },
        },
        tx,
      );
      return attribution;
    });
  }

  /**
   * Confirmation : au plus une attribution confirmée par organisation (verrou de l'organisation) ;
   * les autres propositions en attente sont rejetées (conflit tranché). La règle applicable
   * (partenaire ou générale active) est figée.
   */
  async confirm(auth: AuthContext, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const attribution = await tx.attribution.findUnique({
        where: { id },
        include: { partner: { select: { status: true, commissionRule: true } } },
      });
      if (!attribution) {
        throw new NotFoundException({
          code: 'ATTRIBUTION_NOT_FOUND',
          message: 'Attribution introuvable.',
        });
      }
      await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${attribution.organizationId}::uuid FOR UPDATE`;
      if (attribution.status !== 'PENDING') {
        throw new ConflictException({
          code: 'ATTRIBUTION_NOT_PENDING',
          message: 'Cette attribution n’est plus en attente.',
        });
      }
      if (attribution.partner.status !== 'ACTIVE') {
        throw new ConflictException({
          code: 'PARTNER_NOT_ACTIVE',
          message: 'Le partenaire n’est pas actif.',
        });
      }
      const confirmed = await tx.attribution.count({
        where: { organizationId: attribution.organizationId, status: 'CONFIRMED' },
      });
      if (confirmed > 0) {
        throw new ConflictException({
          code: 'ORGANIZATION_ALREADY_ATTRIBUTED',
          message: 'Cette organisation est déjà attribuée à un partenaire.',
        });
      }
      const rule =
        (attribution.partner.commissionRule?.isActive
          ? attribution.partner.commissionRule
          : null) ??
        (await tx.commissionRule.findFirst({
          where: { isActive: true, productId: null },
          orderBy: { validatedAt: 'desc' },
        }));
      await tx.attribution.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          confirmedById: auth.user.id,
          confirmedAt: new Date(),
          ruleId: rule?.id ?? null,
        },
      });
      const others = await tx.attribution.updateMany({
        where: { organizationId: attribution.organizationId, status: 'PENDING', id: { not: id } },
        data: {
          status: 'REJECTED',
          rejectionReason: 'Conflit tranché : attribuée à un autre partenaire.',
        },
      });
      if (attribution.prospectId) {
        await tx.prospect.update({
          where: { id: attribution.prospectId },
          data: { status: 'WON', organizationId: attribution.organizationId },
        });
      }
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.attribution_confirmed',
          targetType: 'Attribution',
          targetId: id,
          metadata: {
            organizationId: attribution.organizationId,
            partnerId: attribution.partnerId,
            ruleId: rule?.id ?? null,
            conflictsRejected: others.count,
          },
        },
        tx,
      );
      return {
        id,
        status: 'CONFIRMED' as const,
        ruleId: rule?.id ?? null,
        conflictsRejected: others.count,
      };
    });
  }

  async reject(auth: AuthContext, id: string, reason: string) {
    const claimed = await this.prisma.attribution.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', rejectionReason: reason },
    });
    if (claimed.count === 0) {
      throw new ConflictException({
        code: 'ATTRIBUTION_NOT_PENDING',
        message: 'Cette attribution n’est plus en attente.',
      });
    }
    await this.audit.record({
      organizationId: null,
      actorUserId: auth.user.id,
      action: 'platform.attribution_rejected',
      targetType: 'Attribution',
      targetId: id,
      metadata: { reason },
    });
    return { id, status: 'REJECTED' as const };
  }

  // ─── Commissions ───

  commissions(query: { partnerId?: string; status?: string }) {
    return this.prisma.commission.findMany({
      where: {
        ...(query.partnerId ? { partnerId: query.partnerId } : {}),
        ...(query.status ? { status: query.status as 'ACCRUED' } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        partner: { select: { code: true, companyName: true } },
        organization: { select: { name: true } },
        product: { select: { name: true } },
        subscriptionPayment: { select: { paidAt: true, receiptNumber: true, reference: true } },
        payout: { select: { number: true } },
      },
    });
  }

  /** Validation des commissions acquises (et des régularisations), avant tout versement. */
  async validateCommissions(auth: AuthContext, ids: string[]) {
    const result = await this.prisma.commission.updateMany({
      where: { id: { in: ids }, status: 'ACCRUED' },
      data: { status: 'VALIDATED', validatedById: auth.user.id, validatedAt: new Date() },
    });
    await this.audit.record({
      organizationId: null,
      actorUserId: auth.user.id,
      action: 'platform.commissions_validated',
      targetType: 'Commission',
      targetId: null,
      metadata: { requested: ids.length, validated: result.count },
    });
    return { validated: result.count };
  }

  /** Litige : annulation motivée des commissions d'un règlement (régularisation si déjà versée). */
  async disputePayment(auth: AuthContext, paymentId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const result = await reverseCommissions(tx, paymentId, `Litige : ${reason}`);
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.commissions_disputed',
          targetType: 'SubscriptionPayment',
          targetId: paymentId,
          metadata: { reason, ...result },
        },
        tx,
      );
      return result;
    });
  }

  // ─── Versements (saisie manuelle, confirmation par une autre personne) ───

  payouts(query: { partnerId?: string }) {
    return this.prisma.commissionPayout.findMany({
      where: query.partnerId ? { partnerId: query.partnerId } : {},
      orderBy: { paidAt: 'desc' },
      take: 300,
      include: {
        partner: { select: { code: true, companyName: true } },
        _count: { select: { commissions: true } },
      },
    });
  }

  async recordPayout(auth: AuthContext, dto: RecordPayoutDto) {
    const ids = [...new Set(dto.commissionIds)];
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Commission" WHERE "id" = ANY(${ids}::uuid[]) FOR UPDATE`;
      const rows = await tx.commission.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          partnerId: true,
          status: true,
          payoutId: true,
          amount: true,
          currency: true,
        },
      });
      const invalid = ids.filter((id) => {
        const c = rows.find((r) => r.id === id);
        return (
          !c || c.partnerId !== dto.partnerId || c.status !== 'VALIDATED' || c.payoutId !== null
        );
      });
      if (invalid.length > 0) {
        throw new ConflictException({
          code: 'PAYOUT_COMMISSIONS_INVALID',
          message:
            'Seules les commissions validées de ce partenaire, non versées, peuvent être versées.',
          invalid,
        });
      }
      const total = rows.reduce((t, c) => t + c.amount, 0);
      if (total <= 0) {
        throw new BadRequestException({
          code: 'PAYOUT_TOTAL_INVALID',
          message: 'Le total à verser doit être positif.',
        });
      }
      const { year, sequence } = await nextPlatformSequence(tx, 'payout');
      const payout = await tx.commissionPayout.create({
        data: {
          number: formatPayoutNumber(year, sequence),
          partnerId: dto.partnerId,
          total,
          currency: rows[0]!.currency,
          method: dto.method,
          reference: dto.reference ?? null,
          paidAt: new Date(`${dto.paidAt}T12:00:00Z`),
          note: dto.note ?? null,
          recordedById: auth.user.id,
        },
      });
      await tx.commission.updateMany({ where: { id: { in: ids } }, data: { payoutId: payout.id } });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.payout_recorded',
          targetType: 'CommissionPayout',
          targetId: payout.id,
          metadata: { number: payout.number, total, commissions: ids.length },
        },
        tx,
      );
      return payout;
    });
  }

  async confirmPayout(auth: AuthContext, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const payout = await tx.commissionPayout.findUnique({ where: { id } });
      if (!payout)
        throw new NotFoundException({
          code: 'PAYOUT_NOT_FOUND',
          message: 'Versement introuvable.',
        });
      if (payout.recordedById === auth.user.id) {
        throw new ForbiddenException({
          code: 'SELF_CONFIRMATION_FORBIDDEN',
          message: 'Un versement est confirmé par une autre personne que celle qui l’a saisi.',
        });
      }
      const claimed = await tx.commissionPayout.updateMany({
        where: { id, status: 'RECORDED' },
        data: { status: 'CONFIRMED', confirmedById: auth.user.id, confirmedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          code: 'PAYOUT_NOT_RECORDED',
          message: 'Versement déjà traité.',
        });
      }
      await tx.commission.updateMany({ where: { payoutId: id }, data: { status: 'PAID' } });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.payout_confirmed',
          targetType: 'CommissionPayout',
          targetId: id,
          metadata: { number: payout.number, total: payout.total },
        },
        tx,
      );
      return { id, status: 'CONFIRMED' as const };
    });
  }

  async rejectPayout(auth: AuthContext, id: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.commissionPayout.updateMany({
        where: { id, status: 'RECORDED' },
        data: {
          status: 'REJECTED',
          rejectionReason: reason,
          confirmedById: auth.user.id,
          confirmedAt: new Date(),
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          code: 'PAYOUT_NOT_RECORDED',
          message: 'Versement déjà traité.',
        });
      }
      await tx.commission.updateMany({ where: { payoutId: id }, data: { payoutId: null } });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.payout_rejected',
          targetType: 'CommissionPayout',
          targetId: id,
          metadata: { reason },
        },
        tx,
      );
      return { id, status: 'REJECTED' as const };
    });
  }

  // ─── Rapports ───

  /** Rapport par partenaire et par produit : clients, prospects, commissions par statut. */
  async report() {
    const [partners, byStatus] = await Promise.all([
      this.prisma.partner.findMany({
        select: {
          id: true,
          code: true,
          companyName: true,
          status: true,
          _count: { select: { prospects: true } },
          attributions: { where: { status: 'CONFIRMED' }, select: { id: true } },
        },
      }),
      this.prisma.commission.groupBy({
        by: ['partnerId', 'productId', 'status'],
        _sum: { amount: true },
      }),
    ]);
    const products = await this.prisma.saasProduct.findMany({ select: { id: true, name: true } });
    const productName = new Map(products.map((p) => [p.id, p.name]));
    return partners.map((p) => {
      const rows = byStatus.filter((r) => r.partnerId === p.id);
      const sum = (status: string) =>
        rows.filter((r) => r.status === status).reduce((t, r) => t + (r._sum.amount ?? 0), 0);
      const perProduct = [...new Set(rows.map((r) => r.productId))].map((productId) => ({
        product: productName.get(productId) ?? productId,
        total: rows
          .filter((r) => r.productId === productId && r.status !== 'REVERSED')
          .reduce((t, r) => t + (r._sum.amount ?? 0), 0),
      }));
      return {
        id: p.id,
        code: p.code,
        companyName: p.companyName,
        status: p.status,
        prospects: p._count.prospects,
        clients: p.attributions.length,
        commissions: {
          accrued: sum('ACCRUED'),
          validated: sum('VALIDATED'),
          paid: sum('PAID'),
          reversed: sum('REVERSED'),
        },
        perProduct,
      };
    });
  }

  private async findPartner(tx: Tx, id: string) {
    const partner = await tx.partner.findUnique({ where: { id } });
    if (!partner)
      throw new NotFoundException({
        code: 'PARTNER_NOT_FOUND',
        message: 'Partenaire introuvable.',
      });
    return partner;
  }
}
