import type { Prisma } from '@ocall/database';
import {
  DEFAULT_AI_MONTHLY_QUOTA,
  DEFAULT_STORAGE_QUOTA_MB,
  PARK_APP_PRODUCT_CODES,
  effectiveQuota,
} from '@ocall/shared';
import type { PrismaService } from '../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

export interface OrganizationQuotas {
  /** Plafond mensuel d'appels IA fixé par Ocall (l'organisation peut se limiter en dessous). */
  aiMonthlyCalls: number;
  storageMb: number;
  /** Origine : dérogation du Super Admin, offre, ou valeur par défaut. */
  aiSource: 'override' | 'plan' | 'default';
  storageSource: 'override' | 'plan' | 'default';
}

/** Données lues en une requête : dérogations et quotas de l'offre Ocall Park. */
const QUOTA_SELECT = {
  id: true,
  aiMonthlyQuotaOverride: true,
  storageQuotaMbOverride: true,
  subscriptions: {
    where: { product: { code: { in: [...PARK_APP_PRODUCT_CODES] } } },
    select: { plan: { select: { aiMonthlyCallQuota: true, storageQuotaMb: true } } },
    take: 1,
  },
} satisfies Prisma.OrganizationSelect;

type QuotaRow = Prisma.OrganizationGetPayload<{ select: typeof QUOTA_SELECT }>;

function toQuotas(org: QuotaRow): OrganizationQuotas {
  const plan = org.subscriptions[0]?.plan;
  const source = (override: number | null, planValue: number | undefined) =>
    override !== null ? 'override' : planValue !== undefined ? 'plan' : 'default';
  return {
    aiMonthlyCalls: effectiveQuota(
      org.aiMonthlyQuotaOverride,
      plan?.aiMonthlyCallQuota,
      DEFAULT_AI_MONTHLY_QUOTA,
    ),
    storageMb: effectiveQuota(
      org.storageQuotaMbOverride,
      plan?.storageQuotaMb,
      DEFAULT_STORAGE_QUOTA_MB,
    ),
    aiSource: source(org.aiMonthlyQuotaOverride, plan?.aiMonthlyCallQuota),
    storageSource: source(org.storageQuotaMbOverride, plan?.storageQuotaMb),
  };
}

/**
 * Quotas effectifs d'une organisation (Sprint 11B) : dérogation du Super Admin, sinon quota de
 * l'offre de son abonnement Ocall Park (l'application où s'exercent IA et stockage), sinon défaut.
 */
export async function organizationQuotas(
  db: Db,
  organizationId: string,
): Promise<OrganizationQuotas> {
  return toQuotas(
    await db.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: QUOTA_SELECT,
    }),
  );
}

/** Quotas de plusieurs organisations en une seule requête (rapports de la plateforme). */
export async function organizationsQuotas(
  db: Db,
  organizationIds: string[],
): Promise<Map<string, OrganizationQuotas>> {
  const rows = await db.organization.findMany({
    where: { id: { in: organizationIds } },
    select: QUOTA_SELECT,
  });
  return new Map(rows.map((r) => [r.id, toQuotas(r)]));
}
