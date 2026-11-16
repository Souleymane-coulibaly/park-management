import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import {
  ANALYTICS_PERIOD_ERRORS,
  ANALYTICS_PERIODS,
  type AnalyticsPeriod,
  ORG_REPORT_UNASSIGNED,
  type OrganizationReport,
  orgReportDays,
  resolveAnalyticsPeriod,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { TenantContext } from '../../common/auth-context';
import { OrganizationReportingRegistry } from '../../common/integration/organization-reporting';
import { SITE_REGISTRY, type SiteRegistry } from '../../common/integration/site-registry';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_OR_NONE =
  /^(none|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

/** Filtres du tableau de bord de l'organisation ; l'organisation vient toujours de la session. */
export class OrganizationReportQueryDto {
  @ApiPropertyOptional({ enum: ANALYTICS_PERIODS, default: 'this_month' })
  @IsOptional()
  @IsIn(ANALYTICS_PERIODS)
  period?: AnalyticsPeriod;

  @ApiPropertyOptional({ description: 'Période personnalisée : date locale de début (incluse).' })
  @IsOptional()
  @Matches(DATE)
  from?: string;

  @ApiPropertyOptional({ description: 'Période personnalisée : date locale de fin (incluse).' })
  @IsOptional()
  @Matches(DATE)
  to?: string;

  @ApiPropertyOptional({
    description: 'Un établissement du référentiel, « none » (non rattaché) ; absent = tous.',
  })
  @IsOptional()
  @Matches(UUID_OR_NONE)
  establishmentId?: string;
}

/**
 * Tableau de bord de l'organisation (étape 5) : période résolue une fois dans le fuseau de
 * l'organisation, filtre vérifié contre le référentiel commun, puis un bloc par application calculé par
 * son propre connecteur (droits de l'application). Aucun total entre applications.
 */
@Injectable()
export class OrganizationReportService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SITE_REGISTRY) private readonly sites: SiteRegistry,
    private readonly registry: OrganizationReportingRegistry,
  ) {}

  async report(
    auth: TenantContext,
    query: OrganizationReportQueryDto,
    now = new Date(),
  ): Promise<OrganizationReport> {
    const organizationId = auth.membership.organizationId;
    const timezone = auth.membership.timezone;
    const period = resolveAnalyticsPeriod(
      { period: query.period ?? 'this_month', from: query.from, to: query.to },
      now,
      timezone,
    );
    if ('error' in period) {
      throw new BadRequestException({
        code: `PERIOD_${period.error}`,
        message: ANALYTICS_PERIOD_ERRORS[period.error],
      });
    }
    const days = orgReportDays(period.current);
    if (!days)
      throw new BadRequestException({ code: 'PERIOD_INVALID', message: 'Période invalide.' });

    const [organization, establishments] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { currency: true },
      }),
      this.sites.list(organizationId),
    ]);
    const filter = query.establishmentId?.toLowerCase() ?? null;
    if (
      filter &&
      filter !== ORG_REPORT_UNASSIGNED &&
      !establishments.some((e) => e.id === filter)
    ) {
      throw new NotFoundException({
        code: 'ESTABLISHMENT_NOT_FOUND',
        message: 'Établissement introuvable.',
      });
    }

    const blocks = await this.registry.collect({
      auth,
      period,
      days,
      previousDays: orgReportDays(period.previous),
      timezone,
      currency: organization.currency,
      establishmentIds: filter === null ? null : filter === ORG_REPORT_UNASSIGNED ? [] : [filter],
      unassigned: filter === null || filter === ORG_REPORT_UNASSIGNED,
      now,
    });

    return {
      meta: {
        period: { current: period.current, previous: period.previous, days: period.days },
        timezone,
        currency: organization.currency,
        establishment: filter,
        establishments: establishments.map((e) => ({
          id: e.id,
          name: e.name,
          city: e.city,
          isActive: e.isActive,
        })),
        generatedAt: now.toISOString(),
      },
      blocks,
    };
  }
}
