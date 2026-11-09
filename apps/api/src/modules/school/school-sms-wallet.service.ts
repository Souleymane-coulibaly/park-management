import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/school-database';
import { maskPhone, smsTopUpQuote } from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth-context';
import { notifyOrganization } from '../../common/suite-notify';
import { PrismaService } from '../../prisma/prisma.service';
import type { SchoolContext } from './school-access';
import { SchoolPrismaService } from './school-prisma.service';
import { applySmsLedger } from './school-sms-ledger';
import { SchoolService } from './school.service';
import { SuiteContractsService } from '../suite-contracts/suite-contracts.service';

const PAGE = 50;

const NOT_INCLUDED = {
  code: 'SCHOOL_FREE_SMS_NOT_INCLUDED',
  message:
    'Les SMS ne sont pas inclus dans l’offre gratuite Ocall School. Passez à l’offre payante pour les utiliser.',
};

function isUnique(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/**
 * Portefeuille SMS prépayé des établissements (Sprint S2). Le solde est un registre en ajout seul :
 * recharges validées par Ocall, réservations avant envoi, consommations, crédits rendus et corrections
 * motivées. Le paiement d'une recharge reste hors plateforme : une demande n'est jamais créditée sans
 * validation d'Ocall, et jamais deux fois.
 */
@Injectable()
export class SchoolSmsWalletService {
  private readonly logger = new Logger('SchoolSmsWallet');

  constructor(
    private readonly db: SchoolPrismaService,
    private readonly core: PrismaService,
    private readonly school: SchoolService,
    private readonly audit: AuditService,
    private readonly contracts: SuiteContractsService,
  ) {}

  /**
   * SMS inclus pour CET établissement : droit calculé à partir des seuls contrats qui le couvrent (le
   * contrat payant d'un autre établissement du client ne compte pas).
   */
  private async included(organizationId: string, schoolId: string): Promise<boolean> {
    return (await this.contracts.smsAllowedSchools(organizationId, [schoolId])).has(schoolId);
  }

  private latestTariff() {
    return this.db.schoolSmsTariff.findFirst({ orderBy: { version: 'desc' } });
  }

  // ─── Établissement (direction) ───

  async wallet(ctx: SchoolContext, schoolId: string) {
    await this.school.assertSchool(ctx, schoolId);
    const [wallet, tariff, pending, consumed, included] = await Promise.all([
      this.db.schoolSmsWallet.findFirst({
        where: { organizationId: ctx.organizationId, schoolId },
        select: { balance: true, reserved: true, updatedAt: true },
      }),
      this.latestTariff(),
      this.db.schoolSmsTopUpRequest.findFirst({
        where: { organizationId: ctx.organizationId, schoolId, status: 'PENDING' },
        select: { id: true, creditsRequested: true, quotedAmountXof: true, createdAt: true },
      }),
      this.db.schoolSmsLedgerEntry.aggregate({
        where: { organizationId: ctx.organizationId, schoolId, kind: 'CAPTURE' },
        _sum: { reservedDelta: true },
      }),
      this.included(ctx.organizationId, schoolId),
    ]);
    return {
      balance: wallet?.balance ?? 0,
      reserved: wallet?.reserved ?? 0,
      consumed: -(consumed._sum.reservedDelta ?? 0),
      updatedAt: wallet?.updatedAt ?? null,
      /** Les SMS exigent une offre qui les inclut (essai ou payant), puis un solde suffisant. */
      included,
      tariff: tariff
        ? {
            version: tariff.version,
            creditPriceXof: tariff.creditPriceXof,
            internationalAllowed: tariff.internationalCreditsPerSegment !== null,
            internationalCreditsPerSegment: tariff.internationalCreditsPerSegment,
          }
        : null,
      pendingRequest: pending,
    };
  }

  /** Registre des opérations de l'établissement, du plus récent au plus ancien. */
  async ledger(ctx: SchoolContext, schoolId: string, cursor?: string) {
    await this.school.assertSchool(ctx, schoolId);
    const page = await this.ledgerPage({ organizationId: ctx.organizationId, schoolId }, cursor);
    // Projection client : le motif (référence de règlement, justification d'une correction) reste
    // interne à Ocall.
    return { ...page, items: page.items.map(({ reason: _reason, ...e }) => e) };
  }

  private async ledgerPage(where: { organizationId: string; schoolId: string }, cursor?: string) {
    const rows = await this.db.schoolSmsLedgerEntry.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: PAGE + 1,
      select: {
        id: true,
        kind: true,
        availableDelta: true,
        reservedDelta: true,
        balanceAfter: true,
        reservedAfter: true,
        messageId: true,
        topUpRequestId: true,
        reason: true,
        createdAt: true,
      },
    });
    const items = rows.slice(0, PAGE);
    return { items, nextCursor: rows.length > PAGE ? items[items.length - 1]!.id : null };
  }

  /** Demandes de recharge de l'établissement, paginées ; la note d'Ocall n'apparaît qu'en cas de refus. */
  async topUps(ctx: SchoolContext, schoolId: string, cursor?: string) {
    await this.school.assertSchool(ctx, schoolId);
    const rows = await this.db.schoolSmsTopUpRequest.findMany({
      where: { organizationId: ctx.organizationId, schoolId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: PAGE + 1,
      select: {
        id: true,
        creditsRequested: true,
        creditsGranted: true,
        quotedAmountXof: true,
        tariffVersion: true,
        status: true,
        requestNote: true,
        handlingNote: true,
        createdAt: true,
        handledAt: true,
      },
    });
    const items = rows
      .slice(0, PAGE)
      .map((r) => ({ ...r, handlingNote: r.status === 'REJECTED' ? r.handlingNote : null }));
    return { items, nextCursor: rows.length > PAGE ? items[items.length - 1]!.id : null };
  }

  /**
   * Demande de recharge : montant indicatif selon le tarif publié (aucun s'il n'y en a pas). Une seule
   * demande en attente par établissement ; aucun crédit avant la validation d'Ocall.
   */
  async requestTopUp(ctx: SchoolContext, schoolId: string, credits: number, note?: string | null) {
    await this.school.assertSchool(ctx, schoolId);
    if (!(await this.included(ctx.organizationId, schoolId))) {
      throw new ForbiddenException(NOT_INCLUDED);
    }
    const tariff = await this.latestTariff();
    try {
      const request = await this.db.$transaction(async (tx) => {
        const created = await tx.schoolSmsTopUpRequest.create({
          data: {
            organizationId: ctx.organizationId,
            schoolId,
            creditsRequested: credits,
            tariffVersion: tariff?.version ?? null,
            quotedAmountXof: smsTopUpQuote(credits, tariff?.creditPriceXof ?? null),
            requestNote: note ?? null,
            requestedByUserId: ctx.userId,
          },
          select: {
            id: true,
            creditsRequested: true,
            quotedAmountXof: true,
            status: true,
            createdAt: true,
          },
        });
        await this.school.recordDecision(
          tx,
          ctx,
          'school.sms_topup_requested',
          'SchoolSmsTopUpRequest',
          created.id,
          { schoolId, credits },
        );
        return created;
      });
      await this.school.publishDecisions(ctx.organizationId);
      return request;
    } catch (e) {
      if (isUnique(e)) {
        throw new ConflictException({
          code: 'SMS_TOPUP_ALREADY_PENDING',
          message: 'Une demande de recharge est déjà en attente pour cet établissement.',
        });
      }
      throw e;
    }
  }

  /** Annulation par l'établissement d'une demande encore en attente. */
  async cancelTopUp(ctx: SchoolContext, schoolId: string, id: string) {
    await this.school.assertSchool(ctx, schoolId);
    const cancelled = await this.db.$transaction(async (tx) => {
      const moved = await tx.schoolSmsTopUpRequest.updateMany({
        where: { id, organizationId: ctx.organizationId, schoolId, status: 'PENDING' },
        data: { status: 'CANCELLED', handledAt: new Date() },
      });
      if (moved.count === 1) {
        await this.school.recordDecision(
          tx,
          ctx,
          'school.sms_topup_cancelled',
          'SchoolSmsTopUpRequest',
          id,
          { schoolId },
        );
      }
      return moved.count;
    });
    if (cancelled === 0) {
      throw new NotFoundException({
        code: 'SMS_TOPUP_NOT_PENDING',
        message: 'Aucune demande en attente à annuler.',
      });
    }
    await this.school.publishDecisions(ctx.organizationId);
    return { id, status: 'CANCELLED' as const };
  }

  // ─── Super Admin Ocall ───

  private async orgNames(ids: string[]) {
    const orgs = await this.core.organization.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true, code: true },
    });
    return new Map(orgs.map((o) => [o.id, o]));
  }

  private async schoolNames(ids: string[]) {
    const schools = await this.db.school.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true, organizationId: true },
    });
    return new Map(schools.map((s) => [s.id, s]));
  }

  /** Portefeuilles des établissements : solde, réservations, consommation (aucune donnée scolaire). */
  async adminWallets(organizationId?: string) {
    const wallets = await this.db.schoolSmsWallet.findMany({
      where: organizationId ? { organizationId } : {},
      orderBy: { updatedAt: 'desc' },
      take: 300,
      select: {
        organizationId: true,
        schoolId: true,
        balance: true,
        reserved: true,
        updatedAt: true,
      },
    });
    const consumed = await this.db.schoolSmsLedgerEntry.groupBy({
      by: ['schoolId'],
      where: { kind: 'CAPTURE', schoolId: { in: wallets.map((w) => w.schoolId) } },
      _sum: { reservedDelta: true },
    });
    const [orgs, schools] = await Promise.all([
      this.orgNames(wallets.map((w) => w.organizationId)),
      this.schoolNames(wallets.map((w) => w.schoolId)),
    ]);
    return wallets.map((w) => ({
      ...w,
      consumed: -(consumed.find((c) => c.schoolId === w.schoolId)?._sum.reservedDelta ?? 0),
      organization: orgs.get(w.organizationId) ?? null,
      schoolName: schools.get(w.schoolId)?.name ?? '—',
    }));
  }

  async adminTopUps(status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' = 'PENDING') {
    const rows = await this.db.schoolSmsTopUpRequest.findMany({
      where: { status },
      orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' },
      take: 200,
    });
    const [orgs, schools] = await Promise.all([
      this.orgNames(rows.map((r) => r.organizationId)),
      this.schoolNames(rows.map((r) => r.schoolId)),
    ]);
    return rows.map((r) => ({
      ...r,
      organization: orgs.get(r.organizationId) ?? null,
      schoolName: schools.get(r.schoolId)?.name ?? '—',
    }));
  }

  /**
   * Validation d'une recharge après vérification du paiement hors plateforme : passage conditionnel
   * PENDING → APPROVED et crédit du portefeuille dans la même transaction (jamais deux fois, même
   * sous double clic ou requêtes simultanées). Le client est ensuite prévenu.
   */
  async approveTopUp(
    auth: AuthContext,
    id: string,
    input: { credits?: number; paymentReference: string; note?: string | null },
  ) {
    const target = await this.db.schoolSmsTopUpRequest.findUnique({
      where: { id },
      select: { organizationId: true, schoolId: true, status: true },
    });
    // Offre changée entre la demande et la décision : plus de SMS inclus → validation refusée.
    if (
      target?.status === 'PENDING' &&
      !(await this.included(target.organizationId, target.schoolId))
    ) {
      throw new ConflictException(NOT_INCLUDED);
    }
    const result = await this.db.$transaction(async (tx) => {
      const request = await tx.schoolSmsTopUpRequest.findUnique({ where: { id } });
      if (!request)
        throw new NotFoundException({
          code: 'SMS_TOPUP_NOT_FOUND',
          message: 'Demande introuvable.',
        });
      const credits = input.credits ?? request.creditsRequested;
      const moved = await tx.schoolSmsTopUpRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          creditsGranted: credits,
          paymentReference: input.paymentReference,
          handlingNote: input.note ?? null,
          handledByUserId: auth.user.id,
          handledAt: new Date(),
        },
      });
      if (moved.count !== 1) {
        throw new ConflictException({
          code: 'SMS_TOPUP_ALREADY_HANDLED',
          message: 'Cette demande a déjà été traitée.',
          status: request.status,
        });
      }
      const applied = await applySmsLedger(tx, {
        organizationId: request.organizationId,
        schoolId: request.schoolId,
        kind: 'TOPUP',
        availableDelta: credits,
        reservedDelta: 0,
        idempotencyKey: `topup:${id}`,
        topUpRequestId: id,
        actorUserId: auth.user.id,
        reason: `Recharge validée (réf. ${input.paymentReference})`,
      });
      if (applied.status !== 'APPLIED') {
        throw new ConflictException({
          code: 'SMS_TOPUP_ALREADY_HANDLED',
          message: 'Cette recharge a déjà été créditée.',
        });
      }
      return { request, credits, balance: applied.balance };
    });
    await this.afterDecision(auth, result.request, 'APPROVED', {
      credits: result.credits,
      paymentReference: input.paymentReference,
    });
    return {
      id,
      status: 'APPROVED' as const,
      creditsGranted: result.credits,
      balance: result.balance,
    };
  }

  async rejectTopUp(auth: AuthContext, id: string, note: string) {
    const request = await this.db.$transaction(async (tx) => {
      const found = await tx.schoolSmsTopUpRequest.findUnique({ where: { id } });
      if (!found)
        throw new NotFoundException({
          code: 'SMS_TOPUP_NOT_FOUND',
          message: 'Demande introuvable.',
        });
      const moved = await tx.schoolSmsTopUpRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          handlingNote: note,
          handledByUserId: auth.user.id,
          handledAt: new Date(),
        },
      });
      if (moved.count !== 1) {
        throw new ConflictException({
          code: 'SMS_TOPUP_ALREADY_HANDLED',
          message: 'Cette demande a déjà été traitée.',
          status: found.status,
        });
      }
      return found;
    });
    await this.afterDecision(auth, request, 'REJECTED', { note });
    return { id, status: 'REJECTED' as const };
  }

  /**
   * Journal Ocall et notification du client après une décision (base Suite). La décision elle-même est
   * déjà enregistrée dans le registre School (auteur, motif) : un échec ici est journalisé, sans annuler
   * le crédit.
   */
  private async afterDecision(
    auth: AuthContext,
    request: { id: string; organizationId: string; schoolId: string },
    outcome: 'APPROVED' | 'REJECTED',
    meta: { credits?: number; paymentReference?: string; note?: string },
  ) {
    try {
      const school = await this.db.school.findUnique({
        where: { id: request.schoolId },
        select: { name: true },
      });
      await this.core.$transaction(async (tx) => {
        await this.audit.record(
          {
            organizationId: null,
            actorUserId: auth.user.id,
            action:
              outcome === 'APPROVED'
                ? 'platform.sms_topup_approved'
                : 'platform.sms_topup_rejected',
            targetType: 'SchoolSmsTopUpRequest',
            targetId: request.id,
            metadata: {
              organizationId: request.organizationId,
              schoolId: request.schoolId,
              ...(meta.credits !== undefined ? { credits: meta.credits } : {}),
              ...(meta.paymentReference ? { paymentReference: meta.paymentReference } : {}),
            },
          },
          tx,
        );
        await notifyOrganization(tx, {
          organizationId: request.organizationId,
          kind: outcome === 'APPROVED' ? 'SMS_TOPUP_APPROVED' : 'SMS_TOPUP_REJECTED',
          productCode: 'OCALL_SCHOOL',
          params: {
            schoolName: school?.name ?? 'l’établissement',
            ...(meta.credits !== undefined ? { credits: meta.credits } : {}),
            ...(meta.note ? { note: meta.note } : {}),
          },
          href: '/school/communication',
          dedupeKey: `sms-topup:${request.id}:${outcome}`,
        });
      });
    } catch (error) {
      this.logger.warn(
        `Journal ou notification de recharge SMS non écrit : ${(error as Error).name}`,
      );
    }
  }

  /**
   * Correction administrative motivée (positive ou négative) : jamais une modification silencieuse du
   * solde, jamais un solde négatif ; idempotente (clé fournie par l'écran : un double clic n'applique
   * qu'une correction).
   */
  async adjust(
    auth: AuthContext,
    schoolId: string,
    input: { credits: number; reason: string; idempotencyKey: string },
  ) {
    if (input.credits === 0) {
      throw new BadRequestException({ code: 'SMS_ADJUSTMENT_EMPTY', message: 'Correction nulle.' });
    }
    const school = await this.db.school.findUnique({
      where: { id: schoolId },
      select: { id: true, organizationId: true },
    });
    if (!school)
      throw new NotFoundException({
        code: 'SCHOOL_NOT_FOUND',
        message: 'Établissement introuvable.',
      });
    let applied;
    try {
      applied = await this.db.$transaction((tx) =>
        applySmsLedger(tx, {
          organizationId: school.organizationId,
          schoolId,
          kind: 'ADJUSTMENT',
          availableDelta: input.credits,
          reservedDelta: 0,
          idempotencyKey: `adjust:${input.idempotencyKey}`,
          actorUserId: auth.user.id,
          reason: input.reason,
        }),
      );
    } catch (e) {
      if (isUnique(e)) applied = { status: 'DUPLICATE' as const };
      else throw e;
    }
    if (applied.status === 'INSUFFICIENT') {
      throw new ConflictException({
        code: 'SMS_BALANCE_INSUFFICIENT',
        message: 'Correction refusée : le solde disponible deviendrait négatif.',
      });
    }
    if (applied.status === 'APPLIED') {
      await this.audit.record({
        organizationId: null,
        actorUserId: auth.user.id,
        action: 'platform.sms_wallet_adjusted',
        targetType: 'SchoolSmsWallet',
        targetId: schoolId,
        metadata: {
          organizationId: school.organizationId,
          credits: input.credits,
          reason: input.reason,
        },
      });
    }
    const wallet = await this.db.schoolSmsWallet.findUnique({
      where: { schoolId },
      select: { balance: true, reserved: true },
    });
    return {
      status: applied.status,
      balance: wallet?.balance ?? 0,
      reserved: wallet?.reserved ?? 0,
    };
  }

  async adminLedger(schoolId: string, cursor?: string) {
    const school = await this.db.school.findUnique({
      where: { id: schoolId },
      select: { organizationId: true },
    });
    if (!school)
      throw new NotFoundException({
        code: 'SCHOOL_NOT_FOUND',
        message: 'Établissement introuvable.',
      });
    return this.ledgerPage({ organizationId: school.organizationId, schoolId }, cursor);
  }

  /** Erreurs d'envoi récentes : motif, numéro masqué, jamais le texte du message. */
  async adminFailures() {
    const rows = await this.db.schoolSmsMessage.findMany({
      where: { status: { in: ['FAILED', 'CANCELLED'] } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        organizationId: true,
        schoolId: true,
        phone: true,
        kind: true,
        status: true,
        attempts: true,
        lastError: true,
        segments: true,
        creditState: true,
        createdAt: true,
      },
    });
    const [orgs, schools] = await Promise.all([
      this.orgNames(rows.map((r) => r.organizationId)),
      this.schoolNames(rows.map((r) => r.schoolId)),
    ]);
    return rows.map(({ phone, ...r }) => ({
      ...r,
      phone: maskPhone(phone),
      organization: orgs.get(r.organizationId) ?? null,
      schoolName: schools.get(r.schoolId)?.name ?? '—',
    }));
  }

  async tariffs() {
    const rows = await this.db.schoolSmsTariff.findMany({ orderBy: { version: 'desc' }, take: 50 });
    return rows.map((t) => ({
      ...t,
      providerCostPerSegmentXof: t.providerCostPerSegmentXof?.toString() ?? null,
    }));
  }

  /** Nouvelle version du tarif (l'historique n'est jamais modifié). */
  async createTariff(
    auth: AuthContext,
    input: {
      creditPriceXof: number | null;
      providerCostPerSegmentXof: string | null;
      internationalCreditsPerSegment: number | null;
      note?: string | null;
    },
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const last = await this.db.schoolSmsTariff.findFirst({
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      try {
        const created = await this.db.schoolSmsTariff.create({
          data: {
            version: (last?.version ?? 0) + 1,
            creditPriceXof: input.creditPriceXof,
            providerCostPerSegmentXof: input.providerCostPerSegmentXof,
            internationalCreditsPerSegment: input.internationalCreditsPerSegment,
            note: input.note ?? null,
            createdByUserId: auth.user.id,
          },
        });
        await this.audit.record({
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.sms_tariff_created',
          targetType: 'SchoolSmsTariff',
          targetId: created.id,
          metadata: {
            version: created.version,
            creditPriceXof: input.creditPriceXof,
            internationalCreditsPerSegment: input.internationalCreditsPerSegment,
          },
        });
        return { ...created, providerCostPerSegmentXof: input.providerCostPerSegmentXof };
      } catch (e) {
        // Deux créations simultanées : la version suivante est recalculée.
        if (!isUnique(e)) throw e;
      }
    }
    throw new ConflictException({ code: 'SMS_TARIFF_CONFLICT', message: 'Réessayez.' });
  }
}
