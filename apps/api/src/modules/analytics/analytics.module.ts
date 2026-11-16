import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsReportConnector } from './analytics-report.connector';

/** Analyses (Sprint 9) : tableaux de bord, statistiques, marges estimées et exports CSV. */
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsReportConnector],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
