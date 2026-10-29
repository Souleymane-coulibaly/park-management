import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import { computeCashVariance, computeExpectedCash, hasPermission } from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import type { CashSessionsQueryDto, CloseCashSessionDto, OpenCashSessionDto } from './pos.dto';
import { findSellingEstablishment, lockRow, visibleCashSessionsWhere } from './pos-scope';

const SESSION_SELECT = {
  id: true,
  status: true,
  openingFloat: true,
  openedAt: true,
  closedAt: true,
  expectedCash: true,
  countedCash: true,
  variance: true,
  closingNote: true,
  establishment: { select: { id: true, name: true } },
  openedBy: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
  closedBy: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
} as const;

type SessionRow = Prisma.CashSessionGetPayload<{ select: typeof SESSION_SELECT }>;

const NOT_FOUND = { code: 'CASH_SESSION_NOT_FOUND', message: 'Session de caisse introuvable.' };

const fullName = (m: { user: { firstName: string; lastName: string } } | null) =>
  m ? `${m.user.firstName} ${m.user.lastName}` : null;

/**
 * Sessions de caisse : un employé ouvre sa caisse avec un fond, encaisse, puis la ferme en
 * déclarant les espèces comptées ; l'écart avec les espèces attendues est calculé et historisé.
 */
@Injectable()
export class CashSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Session ouverte du membre dans l'établissement (null si aucune), avec ses totaux en cours. */
  async current(auth: TenantContext, establishmentId: string) {
    await findSellingEstablishment(this.prisma, auth, establishmentId);
    const session = await this.prisma.cashSession.findFirst({
      where: {
        organizationId: auth.membership.organizationId,
        establishmentId,
        openedById: auth.membership.id,
        status: 'OPEN',
      },
      select: SESSION_SELECT,
    });
    return session ? this.withTotals(this.prisma, session) : null;
  }

  async list(auth: TenantContext, query: CashSessionsQueryDto) {
    const sessions = await this.prisma.cashSession.findMany({
      where: {
        ...visibleCashSessionsWhere(auth),
        establishmentId: query.establishmentId,
        status: query.status,
      },
      orderBy: { openedAt: 'desc' },
      take: 100,
      select: SESSION_SELECT,
    });
    return Promise.all(sessions.map((s) => this.withTotals(this.prisma, s)));
  }

  async get(auth: TenantContext, id: string) {
    const session = await this.prisma.cashSession.findFirst({
      where: { ...visibleCashSessionsWhere(auth), id },
      select: SESSION_SELECT,
    });
    if (!session) throw new NotFoundException(NOT_FOUND);
    return this.withTotals(this.prisma, session);
  }

  async open(auth: TenantContext, dto: OpenCashSessionDto) {
    const organizationId = auth.membership.organizationId;
    const establishment = await findSellingEstablishment(this.prisma, auth, dto.establishmentId);
    const id = await this.prisma.$transaction(async (tx) => {
      // Verrou par employé : deux ouvertures simultanées ne créent pas deux sessions.
      await lockRow(tx, 'OrganizationMembership', auth.membership.id);
      const alreadyOpen = await tx.cashSession.findFirst({
        where: { openedById: auth.membership.id, status: 'OPEN' },
        select: { establishment: { select: { name: true } } },
      });
      if (alreadyOpen) {
        throw new ConflictException({
          code: 'CASH_SESSION_ALREADY_OPEN',
          message: `Vous avez déjà une session de caisse ouverte (${alreadyOpen.establishment.name}).`,
        });
      }
      const session = await tx.cashSession.create({
        data: {
          organizationId,
          establishmentId: establishment.id,
          openedById: auth.membership.id,
          openingFloat: dto.openingFloat,
        },
      });
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'cash_session.opened',
          targetType: 'CashSession',
          targetId: session.id,
          metadata: { establishmentId: establishment.id, openingFloat: dto.openingFloat },
        },
        tx,
      );
      return session.id;
    });
    return this.get(auth, id);
  }

  /**
   * Fermeture : par l'employé qui a ouvert la session, ou par un superviseur de l'établissement.
   * Les espèces attendues sont recalculées à partir des paiements enregistrés, jamais saisies.
   */
  async close(auth: TenantContext, id: string, dto: CloseCashSessionDto) {
    const organizationId = auth.membership.organizationId;
    await this.prisma.$transaction(async (tx) => {
      const visible = await tx.cashSession.findFirst({
        where: { ...visibleCashSessionsWhere(auth), id },
        select: { id: true, openedById: true },
      });
      if (!visible) throw new NotFoundException(NOT_FOUND);
      if (
        visible.openedById !== auth.membership.id &&
        !hasPermission(auth.membership.role, 'cash.supervise')
      ) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Seul le titulaire ou un superviseur peut fermer cette caisse.',
        });
      }
      await lockRow(tx, 'CashSession', id);
      const session = await tx.cashSession.findUniqueOrThrow({
        where: { id },
        select: { status: true, openingFloat: true },
      });
      if (session.status !== 'OPEN') {
        throw new ConflictException({
          code: 'CASH_SESSION_CLOSED',
          message: 'Cette session de caisse est déjà fermée.',
        });
      }
      const expectedCash = computeExpectedCash(
        session.openingFloat,
        await this.cashAmounts(tx, id),
      );
      const variance = computeCashVariance(expectedCash, dto.countedCash);
      await tx.cashSession.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedById: auth.membership.id,
          expectedCash,
          countedCash: dto.countedCash,
          variance,
          closingNote: dto.note,
        },
      });
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'cash_session.closed',
          targetType: 'CashSession',
          targetId: id,
          metadata: { expectedCash, countedCash: dto.countedCash, variance },
        },
        tx,
      );
    });
    return this.get(auth, id);
  }

  private async cashAmounts(
    db: Pick<Prisma.TransactionClient, 'payment'>,
    cashSessionId: string,
  ): Promise<number[]> {
    const payments = await db.payment.findMany({
      where: { cashSessionId, method: 'CASH', status: 'SUCCEEDED' },
      select: { amount: true },
    });
    return payments.map((p) => p.amount);
  }

  /** Ajoute les totaux : ventes, encaissements en espèces et espèces attendues (en cours ou à la fermeture). */
  private async withTotals(db: PrismaService, s: SessionRow) {
    const [cashAmounts, salesCount, unpaidCount] = await Promise.all([
      this.cashAmounts(db, s.id),
      db.sale.count({ where: { cashSessionId: s.id, status: 'OPEN' } }),
      db.sale.count({ where: { cashSessionId: s.id, status: 'OPEN', paymentStatus: 'UNPAID' } }),
    ]);
    const { openedBy, closedBy, ...rest } = s;
    return {
      ...rest,
      openedBy: { id: openedBy.id, name: fullName(openedBy) },
      closedBy: closedBy ? { id: closedBy.id, name: fullName(closedBy) } : null,
      cashSalesTotal: cashAmounts.reduce((sum, a) => sum + a, 0),
      salesCount,
      unpaidCount,
      expectedCash: s.expectedCash ?? computeExpectedCash(s.openingFloat, cashAmounts),
    };
  }
}
