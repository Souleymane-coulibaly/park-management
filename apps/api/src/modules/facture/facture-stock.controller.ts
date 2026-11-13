import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CurrentFacture,
  FactureAccessGuard,
  type FactureContext,
  RequireFacturePermission,
} from './facture-access';
import { FactureStockCatalogService } from './facture-stock-catalog.service';
import {
  FactureStockInvoiceSaleDto,
  FactureStockSearchDto,
  FactureStockSyncQueryDto,
  FactureStockUseItemDto,
} from './facture-stock.dto';
import { FactureStockService } from './facture-stock.service';

const uuid = new ParseUUIDPipe();

/**
 * Ocall Facture ↔ Ocall Stock (S5, cas C) : articles Stock dans Facture, facture d'une vente en caisse,
 * suivi et relance des demandes de mouvement. Sans abonnement Stock, seul l'état est consultable.
 */
@ApiTags('Ocall Facture')
@UseGuards(FactureAccessGuard)
@Controller('facture/stock')
export class FactureStockController {
  constructor(
    private readonly catalog: FactureStockCatalogService,
    private readonly sync: FactureStockService,
  ) {}

  @RequireFacturePermission('facture.access')
  @Get('status')
  status(@CurrentFacture() ctx: FactureContext) {
    return this.catalog.status(ctx);
  }

  @RequireFacturePermission(
    'facture.documents.manage',
    'facture.catalog.manage',
    'facture.interventions.manage',
  )
  @Get('search')
  search(@CurrentFacture() ctx: FactureContext, @Query() query: FactureStockSearchDto) {
    return this.catalog.search(ctx, query.q);
  }

  @RequireFacturePermission(
    'facture.documents.manage',
    'facture.catalog.manage',
    'facture.interventions.manage',
  )
  @Post('items')
  useItem(@CurrentFacture() ctx: FactureContext, @Body() dto: FactureStockUseItemDto) {
    return this.catalog.useItem(ctx, dto);
  }

  @RequireFacturePermission('facture.catalog.manage')
  @HttpCode(200)
  @Post('items/:id/unlink')
  unlink(@CurrentFacture() ctx: FactureContext, @Param('id', uuid) id: string) {
    return this.catalog.unlink(ctx, id);
  }

  @RequireFacturePermission('facture.documents.read')
  @Get('documents/:id/preview')
  preview(@CurrentFacture() ctx: FactureContext, @Param('id', uuid) id: string) {
    return this.catalog.preview(ctx, id);
  }

  @RequireFacturePermission('facture.documents.manage')
  @Post('sales/invoice')
  invoiceSale(@CurrentFacture() ctx: FactureContext, @Body() dto: FactureStockInvoiceSaleDto) {
    return this.catalog.invoiceSale(ctx, dto);
  }

  @RequireFacturePermission('facture.documents.read')
  @Get('sync')
  list(@CurrentFacture() ctx: FactureContext, @Query() query: FactureStockSyncQueryDto) {
    return this.sync.list(ctx, query.status);
  }

  @RequireFacturePermission('facture.settings.manage')
  @HttpCode(200)
  @Post('sync/:id/retry')
  retry(@CurrentFacture() ctx: FactureContext, @Param('id', uuid) id: string) {
    return this.sync.retry(ctx, id);
  }
}
