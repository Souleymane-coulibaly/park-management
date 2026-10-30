import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  ANALYTICS_EXPORT_MAX_ROWS,
  type AnalyticsScopeInfo,
  HEATMAP_METRIC_ACTIVITY,
  activitiesOf,
  hasPermission,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { type AuthContext, type TenantContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, RequireActivity, RequirePermission } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { AnalyticsRoute, ExportRoute } from '../../common/throttling';
import {
  AnalyticsQueryDto,
  ExportQueryDto,
  HeatmapQueryDto,
  HourlyQueryDto,
} from './analytics.dto';
import { buildExportTable, type ExportSource, exportRows, selectColumns } from './analytics-export';
import {
  type AnalyticsScope,
  resolveAnalyticsScope,
  visibleEstablishments,
} from './analytics-scope';
import { AnalyticsService } from './analytics.service';
import { toCsv } from './csv';

/**
 * Analyses (Sprint 9), en lecture seule. Les permissions sont vérifiées côté serveur (lecture,
 * marges, export), l'organisation vient de la session et les établissements sont restreints à ceux
 * du membre. Les exports reprennent exactement les mêmes calculs que les écrans.
 */
@ApiTags('Analyses')
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly audit: AuditService,
  ) {}

  /** Établissements, activités et droits de l'utilisateur pour construire les filtres. */
  @RequirePermission('analytics.read')
  @Get('scope')
  async scope(@CurrentAuth() auth: AuthContext): Promise<AnalyticsScopeInfo> {
    const tenant = requireTenant(auth);
    return {
      establishments: await visibleEstablishments(this.prisma, tenant),
      activities: activitiesOf(tenant.membership.businessType),
      timezone: tenant.membership.timezone,
      canSeeMargins: hasPermission(tenant.membership.role, 'analytics.margins'),
      canExport: hasPermission(tenant.membership.role, 'analytics.export'),
    };
  }

  @RequirePermission('analytics.read')
  @AnalyticsRoute()
  @Get('overview')
  async overview(@CurrentAuth() auth: AuthContext, @Query() q: AnalyticsQueryDto) {
    return this.analytics.overview(await this.scopeOf(auth, q));
  }

  @RequirePermission('analytics.read')
  @RequireActivity('RESTAURANT')
  @AnalyticsRoute()
  @Get('restaurant')
  async restaurant(@CurrentAuth() auth: AuthContext, @Query() q: AnalyticsQueryDto) {
    return this.analytics.restaurant(await this.scopeOf(auth, q, 'RESTAURANT'));
  }

  @RequirePermission('analytics.read')
  @RequireActivity('RESTAURANT')
  @AnalyticsRoute()
  @Get('restaurant/hourly')
  async restaurantHourly(@CurrentAuth() auth: AuthContext, @Query() q: HourlyQueryDto) {
    return this.analytics.restaurantHourly(
      await this.scopeOf(auth, q, 'RESTAURANT'),
      hourlyFilters(q),
    );
  }

  @RequirePermission('analytics.read')
  @RequireActivity('PARK')
  @AnalyticsRoute()
  @Get('park')
  async park(@CurrentAuth() auth: AuthContext, @Query() q: AnalyticsQueryDto) {
    return this.analytics.park(await this.scopeOf(auth, q, 'PARK'));
  }

  @RequirePermission('analytics.read')
  @AnalyticsRoute()
  @Get('heatmap')
  async heatmap(@CurrentAuth() auth: AuthContext, @Query() q: HeatmapQueryDto) {
    const metric = q.metric ?? 'orders';
    return this.analytics.heatmap(
      await this.scopeOf(auth, q, HEATMAP_METRIC_ACTIVITY[metric]),
      metric,
    );
  }

  @RequirePermission('analytics.margins')
  @RequireActivity('RESTAURANT')
  @AnalyticsRoute()
  @Get('margins')
  async margins(@CurrentAuth() auth: AuthContext, @Query() q: AnalyticsQueryDto) {
    return this.analytics.margins(await this.scopeOf(auth, q, 'RESTAURANT'));
  }

  @RequirePermission('analytics.read')
  @AnalyticsRoute()
  @Get('establishments')
  async establishments(@CurrentAuth() auth: AuthContext, @Query() q: AnalyticsQueryDto) {
    return this.analytics.establishments(await this.scopeOf(auth, q));
  }

  /**
   * Export CSV d'un rapport : mêmes calculs et mêmes droits que l'écran (les marges exigent en plus
   * la permission des marges), formules neutralisées, volume borné, export journalisé.
   */
  @RequirePermission('analytics.export')
  @ExportRoute()
  @Get('export')
  async export(
    @CurrentAuth() auth: AuthContext,
    @Query() q: ExportQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const tenant = requireTenant(auth);
    const source = await this.exportSource(tenant, q);
    const table = selectColumns(
      buildExportTable(source),
      q.columns ? [...new Set(q.columns.split(','))] : null,
    );
    if (!table) {
      throw new BadRequestException({
        code: 'EXPORT_UNKNOWN_COLUMN',
        message: 'Indicateur inconnu pour ce rapport.',
      });
    }
    if (table.rows.length > ANALYTICS_EXPORT_MAX_ROWS) {
      throw new UnprocessableEntityException({
        code: 'EXPORT_TOO_LARGE',
        message: `Export limité à ${ANALYTICS_EXPORT_MAX_ROWS} lignes : réduisez la période ou le périmètre.`,
      });
    }
    const meta = source.data.meta;
    await this.audit.record({
      organizationId: tenant.membership.organizationId,
      actorUserId: tenant.user.id,
      action: 'analytics.exported',
      targetType: 'AnalyticsReport',
      targetId: null,
      metadata: {
        report: q.report,
        format: 'csv',
        period: meta.period.current.label,
        establishmentIds: meta.establishments.map((e) => e.id),
        activity: meta.activity,
        columns: table.columns.map((c) => c.key),
        rows: table.rows.length,
      },
      ipAddress: requestMeta(req).ipAddress,
    });
    const day = meta.generatedAt.slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ocall-${q.report}-${day}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    return toCsv(exportRows(table, meta, q.report));
  }

  private async exportSource(tenant: TenantContext, q: ExportQueryDto): Promise<ExportSource> {
    const can = (p: 'analytics.read' | 'analytics.margins') =>
      hasPermission(tenant.membership.role, p);
    const requireActivity = (activity: 'RESTAURANT' | 'PARK') => {
      if (!activitiesOf(tenant.membership.businessType).includes(activity)) {
        throw new ForbiddenException({
          code: 'ACTIVITY_NOT_AVAILABLE',
          message: 'Ce rapport n’est pas disponible pour votre métier.',
        });
      }
      return activity;
    };
    if (!can('analytics.read')) throw new ForbiddenException({ code: 'FORBIDDEN' });
    switch (q.report) {
      case 'overview':
        return {
          report: q.report,
          data: await this.analytics.overview(await this.scopeOf(tenant, q)),
        };
      case 'restaurant-products':
        return {
          report: q.report,
          data: await this.analytics.restaurant(
            await this.scopeOf(tenant, q, requireActivity('RESTAURANT')),
          ),
        };
      case 'restaurant-hourly':
        return {
          report: q.report,
          data: await this.analytics.restaurantHourly(
            await this.scopeOf(tenant, q, requireActivity('RESTAURANT')),
            hourlyFilters(q),
          ),
        };
      case 'park':
        return {
          report: q.report,
          data: await this.analytics.park(await this.scopeOf(tenant, q, requireActivity('PARK'))),
        };
      case 'heatmap': {
        const metric = q.metric ?? 'orders';
        return {
          report: q.report,
          data: await this.analytics.heatmap(
            await this.scopeOf(tenant, q, requireActivity(HEATMAP_METRIC_ACTIVITY[metric])),
            metric,
          ),
        };
      }
      case 'margins':
        if (!can('analytics.margins')) {
          throw new ForbiddenException({
            code: 'FORBIDDEN',
            message: "Vous n'avez pas les droits nécessaires.",
          });
        }
        return {
          report: q.report,
          data: await this.analytics.margins(
            await this.scopeOf(tenant, q, requireActivity('RESTAURANT')),
          ),
        };
      case 'establishments':
        return {
          report: q.report,
          data: await this.analytics.establishments(await this.scopeOf(tenant, q)),
        };
    }
  }

  private scopeOf(
    auth: AuthContext,
    q: AnalyticsQueryDto,
    activity?: 'RESTAURANT' | 'PARK',
  ): Promise<AnalyticsScope> {
    return resolveAnalyticsScope(this.prisma, requireTenant(auth), q, { activity });
  }
}

function hourlyFilters(q: HourlyQueryDto) {
  const hourFrom = q.hourFrom ?? 0;
  const hourTo = q.hourTo ?? 24;
  if (hourTo <= hourFrom) {
    throw new BadRequestException({
      code: 'HOURS_INVERTED',
      message: 'L’heure de fin doit suivre l’heure de début.',
    });
  }
  return { hourFrom, hourTo, weekday: q.weekday ?? null, productId: q.productId ?? null };
}
