import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import {
  type Activity,
  coversActivity,
  hasOrganizationWideScope,
  hasPermission,
} from '@ocall/shared';
import type { TenantContext } from '../../common/auth-context';
import { establishmentScope } from '../../common/tenant-scope';

type Db = Pick<Prisma.TransactionClient, 'establishment' | 'cashSession'>;

/**
 * Établissement dans lequel le membre peut encaisser : de son organisation, dans son périmètre
 * d'affectation, actif, et exerçant l'activité demandée (restaurant pour la caisse, parc pour la billetterie).
 */
export async function findSellingEstablishment(
  db: Db,
  auth: TenantContext,
  establishmentId: string,
  /** Activité exigée (restaurant pour la caisse, parc pour la billetterie) ; absente = l'une ou l'autre. */
  activity?: Activity,
) {
  const establishment = await db.establishment.findFirst({
    where: { ...establishmentScope(auth), id: establishmentId },
    select: { id: true, name: true, businessType: true, isActive: true, timezone: true },
  });
  if (!establishment) {
    throw new NotFoundException({
      code: 'ESTABLISHMENT_NOT_FOUND',
      message: 'Établissement introuvable.',
    });
  }
  if (!establishment.isActive) {
    throw new ConflictException({
      code: 'ESTABLISHMENT_INACTIVE',
      message: 'Cet établissement est désactivé.',
    });
  }
  if (activity === 'RESTAURANT' && !coversActivity(establishment.businessType, 'RESTAURANT')) {
    throw new BadRequestException({
      code: 'ESTABLISHMENT_NOT_RESTAURANT',
      message: "La caisse n'est disponible que dans un établissement avec une activité restaurant.",
    });
  }
  if (activity === 'PARK' && !coversActivity(establishment.businessType, 'PARK')) {
    throw new BadRequestException({
      code: 'ESTABLISHMENT_NOT_PARK',
      message: "La billetterie n'est disponible que dans un établissement avec une activité parc.",
    });
  }
  return establishment;
}

/** Session de caisse ouverte du membre dans l'établissement, ou erreur explicite. */
export async function requireOpenCashSession(db: Db, auth: TenantContext, establishmentId: string) {
  const session = await db.cashSession.findFirst({
    where: {
      organizationId: auth.membership.organizationId,
      establishmentId,
      openedById: auth.membership.id,
      status: 'OPEN',
    },
    select: { id: true },
  });
  if (!session) {
    throw new ConflictException({
      code: 'CASH_SESSION_REQUIRED',
      message: 'Ouvrez votre session de caisse dans cet établissement avant d’encaisser.',
    });
  }
  return session;
}

/** Restreint aux établissements affectés pour les rôles qui n'ont pas une vision globale. */
function establishmentFilter(auth: TenantContext): Prisma.EstablishmentWhereInput | undefined {
  return hasOrganizationWideScope(auth.membership.role)
    ? undefined
    : { assignments: { some: { membershipId: auth.membership.id } } };
}

/** Ventes visibles : celles de l'organisation ; un caissier ne voit que les siennes. */
export function visibleSalesWhere(auth: TenantContext): Prisma.SaleWhereInput {
  const where: Prisma.SaleWhereInput = { organizationId: auth.membership.organizationId };
  if (!hasPermission(auth.membership.role, 'sale.read_all')) where.cashierId = auth.membership.id;
  const establishment = establishmentFilter(auth);
  if (establishment) where.establishment = establishment;
  return where;
}

/** Sessions visibles : les siennes, ou celles du périmètre pour un rôle de supervision. */
export function visibleCashSessionsWhere(auth: TenantContext): Prisma.CashSessionWhereInput {
  const where: Prisma.CashSessionWhereInput = { organizationId: auth.membership.organizationId };
  if (!hasPermission(auth.membership.role, 'cash.supervise')) where.openedById = auth.membership.id;
  const establishment = establishmentFilter(auth);
  if (establishment) where.establishment = establishment;
  return where;
}

/**
 * Verrou de ligne pour sérialiser les opérations concurrentes sur une même vente ou session
 * (double encaissement, double fermeture) — utile avec les réseaux mobiles qui rejouent les requêtes.
 */
export async function lockRow(
  tx: Prisma.TransactionClient,
  table:
    | 'Sale'
    | 'CashSession'
    | 'OrganizationMembership'
    | 'DiningTable'
    | 'DiningZone'
    | 'QrOrderRequest'
    | 'StockItem',
  id: string,
): Promise<void> {
  // Nom de table issu d'une liste fermée : aucune donnée utilisateur n'est interpolée.
  await tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1::uuid FOR UPDATE`, id);
}
