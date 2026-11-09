import type { Prisma } from '@ocall/database';
import {
  MEMBER_ROLES,
  type SuiteNotificationKind,
  type SuiteNotificationParams,
  hasPermission,
} from '@ocall/shared';

/** Rôles destinataires des notifications commerciales : ceux qui voient l'abonnement. */
export const SUITE_NOTIFICATION_ROLES = MEMBER_ROLES.filter((r) =>
  hasPermission(r, 'subscription.read'),
);

export interface SuiteNotice {
  organizationId: string;
  kind: SuiteNotificationKind;
  productCode?: string | null;
  params: SuiteNotificationParams;
  href?: string | null;
  /** Un même fait n'est jamais notifié deux fois au même compte. */
  dedupeKey: string;
}

type Db = Pick<Prisma.TransactionClient, 'organizationMembership' | 'suiteNotification'>;

/**
 * Notifie les membres actifs de l'organisation autorisés à voir l'abonnement (portail Ocall Suite).
 * À appeler dans la transaction du fait notifié : la notification existe si, et seulement si, le fait
 * est enregistré. Idempotente (clé unique compte + dedupeKey). Retourne le nombre de notifications
 * créées.
 */
export async function notifyOrganization(db: Db, notice: SuiteNotice): Promise<number> {
  const members = await db.organizationMembership.findMany({
    where: {
      organizationId: notice.organizationId,
      isActive: true,
      role: { in: [...SUITE_NOTIFICATION_ROLES] },
    },
    select: { userId: true },
  });
  if (members.length === 0) return 0;
  const { count } = await db.suiteNotification.createMany({
    data: members.map((m) => ({
      organizationId: notice.organizationId,
      userId: m.userId,
      kind: notice.kind,
      productCode: notice.productCode ?? null,
      params: notice.params as Prisma.InputJsonValue,
      href: notice.href ?? '/suite',
      dedupeKey: notice.dedupeKey,
    })),
    skipDuplicates: true,
  });
  return count;
}
