import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ANALYTICS_PERIOD_ERRORS,
  type Activity,
  type AnalyticsActivity,
  type AnalyticsEstablishmentRef,
  type AnalyticsMeta,
  type ResolvedAnalyticsPeriod,
  activitiesOf,
  resolveAnalyticsPeriod,
} from '@ocall/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import type { TenantContext } from '../../common/auth-context';
import { establishmentScope } from '../../common/tenant-scope';
import type { AnalyticsQueryDto } from './analytics.dto';

/**
 * Périmètre d'une analyse, entièrement résolu par le serveur :
 * - organisation = celle de la session, jamais un paramètre ;
 * - établissements = ceux que le membre voit (tous pour OWNER/ADMIN, ses affectations sinon),
 *   éventuellement réduits à l'établissement demandé — un établissement inaccessible ou d'une autre
 *   organisation est « introuvable » ;
 * - activités = celles du métier, réduites au filtre demandé ;
 * - période = résolue dans le fuseau de l'organisation, appliquée à l'heure locale de chaque
 *   établissement.
 */
export interface AnalyticsScope {
  organizationId: string;
  establishments: AnalyticsEstablishmentRef[];
  establishmentIds: string[];
  activity: AnalyticsActivity;
  activities: Activity[];
  period: ResolvedAnalyticsPeriod;
  timezone: string;
}

/** Établissements visibles par le membre, avec leurs activités (y compris désactivés : historique). */
export async function visibleEstablishments(
  prisma: PrismaService,
  tenant: TenantContext,
): Promise<AnalyticsEstablishmentRef[]> {
  const rows = await prisma.establishment.findMany({
    where: establishmentScope(tenant),
    select: { id: true, name: true, timezone: true, businessType: true },
    orderBy: { name: 'asc' },
  });
  const orgActivities = activitiesOf(tenant.membership.businessType);
  return rows.map((e) => ({
    id: e.id,
    name: e.name,
    timezone: e.timezone,
    activities: activitiesOf(e.businessType).filter((a) => orgActivities.includes(a)),
  }));
}

export async function resolveAnalyticsScope(
  prisma: PrismaService,
  tenant: TenantContext,
  query: AnalyticsQueryDto,
  options: { activity?: Activity; now?: Date } = {},
): Promise<AnalyticsScope> {
  const orgActivities = activitiesOf(tenant.membership.businessType);
  const activity: AnalyticsActivity = options.activity ?? query.activity ?? 'ALL';
  if (activity !== 'ALL' && !orgActivities.includes(activity)) {
    throw new BadRequestException({
      code: 'ACTIVITY_NOT_COVERED',
      message: 'Cette activité n’est pas couverte par votre métier.',
    });
  }

  const period = resolveAnalyticsPeriod(
    { period: query.period ?? 'last_7_days', from: query.from, to: query.to },
    options.now ?? new Date(),
    tenant.membership.timezone,
  );
  if ('error' in period) {
    throw new BadRequestException({
      code: `PERIOD_${period.error}`,
      message: ANALYTICS_PERIOD_ERRORS[period.error],
    });
  }

  let establishments = await visibleEstablishments(prisma, tenant);
  if (query.establishmentId) {
    establishments = establishments.filter((e) => e.id === query.establishmentId);
    if (establishments.length === 0) {
      throw new NotFoundException({
        code: 'ESTABLISHMENT_NOT_FOUND',
        message: 'Établissement introuvable.',
      });
    }
  }
  if (activity !== 'ALL') {
    establishments = establishments.filter((e) => e.activities.includes(activity));
  }
  const activities =
    activity === 'ALL'
      ? orgActivities.filter((a) => establishments.some((e) => e.activities.includes(a)))
      : [activity];

  return {
    organizationId: tenant.membership.organizationId,
    establishments,
    establishmentIds: establishments.map((e) => e.id),
    activity,
    activities,
    period,
    timezone: tenant.membership.timezone,
  };
}

/** En-tête commun des réponses et des exports : période, périmètre, fuseau, devise. */
export function metaOf(scope: AnalyticsScope, now = new Date()): AnalyticsMeta {
  return {
    period: {
      current: scope.period.current,
      previous: scope.period.previous,
      days: scope.period.days,
    },
    establishments: scope.establishments.map((e) => ({ id: e.id, name: e.name })),
    activity: scope.activity,
    timezone: scope.timezone,
    currency: 'XOF',
    generatedAt: now.toISOString(),
  };
}
