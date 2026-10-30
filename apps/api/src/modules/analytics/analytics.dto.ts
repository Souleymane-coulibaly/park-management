import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import {
  ANALYTICS_ACTIVITIES,
  ANALYTICS_EXPORT_REPORTS,
  ANALYTICS_PERIODS,
  type AnalyticsActivity,
  type AnalyticsExportReport,
  type AnalyticsPeriod,
  HEATMAP_METRICS,
  type HeatmapMetric,
} from '@ocall/shared';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Filtres communs des analyses. L'organisation ne figure jamais ici : elle vient de la session.
 * L'établissement demandé est vérifié contre ceux auxquels le membre a accès.
 */
export class AnalyticsQueryDto {
  @ApiPropertyOptional({ enum: ANALYTICS_PERIODS, default: 'last_7_days' })
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

  @ApiPropertyOptional({ description: 'Un établissement ; absent = tous ceux accessibles.' })
  @IsOptional()
  @IsUUID('4')
  establishmentId?: string;

  @ApiPropertyOptional({ enum: ANALYTICS_ACTIVITIES, default: 'ALL' })
  @IsOptional()
  @IsIn(ANALYTICS_ACTIVITIES)
  activity?: AnalyticsActivity;
}

export class HourlyQueryDto extends AnalyticsQueryDto {
  @ApiPropertyOptional({ description: 'Un produit ; absent = tous.' })
  @IsOptional()
  @IsUUID('4')
  productId?: string;

  @ApiPropertyOptional({ description: 'Heure locale de début (incluse).', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  hourFrom?: number;

  @ApiPropertyOptional({ description: 'Heure locale de fin (exclue).', default: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  hourTo?: number;

  @ApiPropertyOptional({ description: 'Jour de la semaine ISO (1 = lundi … 7 = dimanche).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  weekday?: number;
}

export class HeatmapQueryDto extends AnalyticsQueryDto {
  @ApiPropertyOptional({ enum: HEATMAP_METRICS, default: 'orders' })
  @IsOptional()
  @IsIn(HEATMAP_METRICS)
  metric?: HeatmapMetric;
}

export class ExportQueryDto extends HourlyQueryDto {
  @ApiPropertyOptional({ enum: ANALYTICS_EXPORT_REPORTS })
  @IsIn(ANALYTICS_EXPORT_REPORTS)
  report: AnalyticsExportReport;

  @ApiPropertyOptional({ enum: HEATMAP_METRICS })
  @IsOptional()
  @IsIn(HEATMAP_METRICS)
  metric?: HeatmapMetric;

  @ApiPropertyOptional({
    description: 'Indicateurs (colonnes) retenus, séparés par des virgules ; absent = tous.',
  })
  @IsOptional()
  @Matches(/^[a-zA-Z0-9]+(,[a-zA-Z0-9]+){0,40}$/)
  columns?: string;
}
