import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { download } from '../../common/download';
import {
  CurrentStock,
  OcallStockAccessGuard,
  RequireStockPermission,
  type StockContext,
} from './ocall-stock-access';
import { OcallStockCountsService } from './ocall-stock-counts.service';
import { OcallStockMovementsService } from './ocall-stock-movements.service';
import { OcallStockSitesService } from './ocall-stock-sites.service';
import { OcallStockTransfersService } from './ocall-stock-transfers.service';
import {
  CreateStockCountDto,
  CreateStockTransferDto,
  DeclareStockTransferLossDto,
  PrepareStockTransferDto,
  ReceiveStockTransferDto,
  StockCountLineDto,
  StockLevelsQueryDto,
  StockLocationDto,
  StockLocationLabelsDto,
  StockLookupQueryDto,
  StockMemberSitesDto,
  StockMoveDto,
  StockMovementDto,
  StockMovementsQueryDto,
  StockOperationsQueryDto,
  StockSiteDto,
  StockSiteQueryDto,
  UpdateStockLocationDto,
  UpdateStockSiteDto,
} from './ocall-stock.dto';

/**
 * Ocall Stock — S2 : sites, emplacements, stocks, mouvements, transferts, inventaires. Les droits fins
 * (site du membre, ajustement, côté départ ou arrivée d'un transfert) sont contrôlés dans les services.
 */
@ApiTags('Ocall Stock')
@UseGuards(OcallStockAccessGuard)
@Controller('ocall-stock')
export class OcallStockWarehouseController {
  constructor(
    private readonly sites: OcallStockSitesService,
    private readonly movements: OcallStockMovementsService,
    private readonly transfers: OcallStockTransfersService,
    private readonly counts: OcallStockCountsService,
  ) {}

  // ─── Sites et emplacements ───

  @RequireStockPermission('stock.access')
  @Get('sites')
  listSites(@CurrentStock() ctx: StockContext, @Query() q: StockSiteQueryDto) {
    return this.sites.listSites(ctx, q.archived);
  }

  @RequireStockPermission('stock.sites.manage')
  @Post('sites')
  createSite(@CurrentStock() ctx: StockContext, @Body() dto: StockSiteDto) {
    return this.sites.createSite(ctx, dto);
  }

  @RequireStockPermission('stock.access')
  @Get('sites/:id')
  site(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.sites.site(ctx, id);
  }

  @RequireStockPermission('stock.sites.manage')
  @Patch('sites/:id')
  updateSite(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockSiteDto,
  ) {
    return this.sites.updateSite(ctx, id, dto);
  }

  @RequireStockPermission('stock.locations.manage')
  @Post('sites/:id/locations')
  createLocation(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StockLocationDto,
  ) {
    return this.sites.createLocation(ctx, id, dto);
  }

  @RequireStockPermission('stock.locations.manage')
  @Patch('locations/:id')
  updateLocation(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockLocationDto,
  ) {
    return this.sites.updateLocation(ctx, id, dto);
  }

  @RequireStockPermission('stock.access')
  @Get('locations/lookup')
  lookupLocation(@CurrentStock() ctx: StockContext, @Query() q: StockLookupQueryDto) {
    return this.sites.lookupLocation(ctx, q.code);
  }

  @RequireStockPermission('stock.locations.manage')
  @HttpCode(200)
  @Post('sites/:id/location-labels.pdf')
  async locationLabels(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StockLocationLabelsDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(
      res,
      await this.sites.locationLabels(ctx, id, dto),
      'application/pdf',
      'emplacements.pdf',
    );
  }

  @RequireStockPermission('stock.members.manage')
  @Put('members/:id/sites')
  memberSites(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StockMemberSitesDto,
  ) {
    return this.sites.setMemberSites(ctx, id, dto.siteIds, dto.siteRoles);
  }

  // ─── Stocks et mouvements ───

  @RequireStockPermission('stock.levels.read')
  @Get('levels')
  levels(@CurrentStock() ctx: StockContext, @Query() q: StockLevelsQueryDto) {
    return this.movements.levels(ctx, q);
  }

  @RequireStockPermission('stock.levels.read')
  @Get('products/:id/levels')
  productLevels(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.movements.productLevels(ctx, id);
  }

  /** Entrée et sortie : saisie de stock ; ajustement : droit d'ajuster (vérifié par le service). */
  @RequireStockPermission('stock.movements.create', 'stock.adjust')
  @Post('movements')
  record(@CurrentStock() ctx: StockContext, @Body() dto: StockMovementDto) {
    return this.movements.record(ctx, dto);
  }

  @RequireStockPermission('stock.movements.create')
  @Post('moves')
  move(@CurrentStock() ctx: StockContext, @Body() dto: StockMoveDto) {
    return this.movements.move(ctx, dto);
  }

  @RequireStockPermission('stock.movements.read')
  @Get('movements')
  listMovements(@CurrentStock() ctx: StockContext, @Query() q: StockMovementsQueryDto) {
    return this.movements.movements(ctx, q);
  }

  // ─── Transferts ───

  @RequireStockPermission(
    'stock.movements.read',
    'stock.transfers.manage',
    'stock.transfers.receive',
  )
  @Get('transfers')
  listTransfers(@CurrentStock() ctx: StockContext, @Query() q: StockOperationsQueryDto) {
    return this.transfers.list(ctx, q);
  }

  @RequireStockPermission(
    'stock.movements.read',
    'stock.transfers.manage',
    'stock.transfers.receive',
  )
  @Get('transfers/:id')
  transfer(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.transfers.get(ctx, id);
  }

  @RequireStockPermission('stock.transfers.manage')
  @Post('transfers')
  createTransfer(@CurrentStock() ctx: StockContext, @Body() dto: CreateStockTransferDto) {
    return this.transfers.create(ctx, dto);
  }

  @RequireStockPermission('stock.transfers.manage')
  @HttpCode(200)
  @Post('transfers/:id/prepare')
  prepare(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PrepareStockTransferDto,
  ) {
    return this.transfers.prepare(ctx, id, dto);
  }

  @RequireStockPermission('stock.transfers.manage')
  @HttpCode(200)
  @Post('transfers/:id/ship')
  ship(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.transfers.ship(ctx, id);
  }

  @RequireStockPermission('stock.transfers.receive')
  @HttpCode(200)
  @Post('transfers/:id/receive')
  receive(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveStockTransferDto,
  ) {
    return this.transfers.receive(ctx, id, dto);
  }

  @RequireStockPermission('stock.transfers.receive')
  @HttpCode(200)
  @Post('transfers/:id/loss')
  declareLoss(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclareStockTransferLossDto,
  ) {
    return this.transfers.declareLoss(ctx, id, dto);
  }

  @RequireStockPermission('stock.transfers.manage')
  @HttpCode(200)
  @Post('transfers/:id/cancel')
  cancelTransfer(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.transfers.cancel(ctx, id);
  }

  // ─── Inventaires ───

  @RequireStockPermission('stock.movements.read', 'stock.counts.count', 'stock.counts.validate')
  @Get('counts')
  listCounts(@CurrentStock() ctx: StockContext, @Query() q: StockOperationsQueryDto) {
    return this.counts.list(ctx, q);
  }

  @RequireStockPermission('stock.movements.read', 'stock.counts.count', 'stock.counts.validate')
  @Get('counts/:id')
  count(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.counts.get(ctx, id);
  }

  @RequireStockPermission('stock.counts.count')
  @Post('counts')
  createCount(@CurrentStock() ctx: StockContext, @Body() dto: CreateStockCountDto) {
    return this.counts.create(ctx, dto);
  }

  @RequireStockPermission('stock.counts.count')
  @Put('counts/:id/lines')
  countLine(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StockCountLineDto,
  ) {
    return this.counts.setLine(ctx, id, dto);
  }

  @RequireStockPermission('stock.counts.count')
  @Delete('counts/:id/lines/:lineId')
  removeCountLine(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ) {
    return this.counts.removeLine(ctx, id, lineId);
  }

  @RequireStockPermission('stock.counts.validate')
  @HttpCode(200)
  @Post('counts/:id/validate')
  validateCount(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.counts.validate(ctx, id);
  }

  @RequireStockPermission('stock.counts.validate')
  @HttpCode(200)
  @Post('counts/:id/cancel')
  cancelCount(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.counts.cancel(ctx, id);
  }

  @RequireStockPermission('stock.movements.read', 'stock.counts.count', 'stock.counts.validate')
  @Get('counts/:id/report.csv')
  async countCsv(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(
      res,
      await this.counts.reportCsv(ctx, id),
      'text/csv; charset=utf-8',
      'inventaire.csv',
    );
  }

  @RequireStockPermission('stock.movements.read', 'stock.counts.count', 'stock.counts.validate')
  @Get('counts/:id/report.pdf')
  async countPdf(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(res, await this.counts.reportPdf(ctx, id), 'application/pdf', 'inventaire.pdf');
  }
}
