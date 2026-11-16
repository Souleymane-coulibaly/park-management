import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth } from '../../common/decorators';
import {
  CurrentStock,
  OcallStockAccessGuard,
  RequireStockPermission,
  type StockContext,
} from './ocall-stock-access';
import { StockReportQueryDto, StockReportSiteQueryDto } from './ocall-stock.dto';
import { OcallStockReportsService } from './ocall-stock-reports.service';

/**
 * Ocall Stock — S6 : tableau de bord et alertes. Chaque bloc du tableau de bord exige son propre droit
 * (ventes, stocks, prix d'achat, achats, mouvements), contrôlé dans le service.
 */
@ApiTags('Ocall Stock')
@UseGuards(OcallStockAccessGuard)
@Controller('ocall-stock/reports')
export class OcallStockReportsController {
  constructor(private readonly reports: OcallStockReportsService) {}

  @RequireStockPermission(
    'stock.sales.read',
    'stock.levels.read',
    'stock.purchases.read',
    'stock.movements.read',
  )
  @Get('dashboard')
  dashboard(
    @CurrentStock() ctx: StockContext,
    @CurrentAuth() auth: AuthContext,
    @Query() query: StockReportQueryDto,
  ) {
    return this.reports.dashboard(ctx, query, {
      timezone: requireTenant(auth).membership.timezone,
    });
  }

  @RequireStockPermission('stock.levels.read')
  @Get('alerts')
  alerts(@CurrentStock() ctx: StockContext, @Query() query: StockReportSiteQueryDto) {
    return this.reports.alerts(ctx, query.siteId);
  }

  @RequireStockPermission('stock.levels.read')
  @Get('alerts/count')
  alertCount(@CurrentStock() ctx: StockContext) {
    return this.reports.alertCount(ctx);
  }
}
