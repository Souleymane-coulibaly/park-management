import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { OrganizationReportService } from './organization-report.service';

@Module({ controllers: [DashboardController], providers: [OrganizationReportService] })
export class DashboardModule {}
