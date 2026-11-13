import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { STOCK_DOCUMENT_MAX_BYTES } from '@ocall/shared';
import { download } from '../../common/download';
import {
  CurrentStock,
  OcallStockAccessGuard,
  RequireStockPermission,
  type StockContext,
} from './ocall-stock-access';
import {
  OcallStockDocumentsService,
  type StockDocumentOwner,
  type StockDocumentUpload,
} from './ocall-stock-documents.service';
import { OcallStockPurchasesService } from './ocall-stock-purchases.service';
import { OcallStockReturnsService } from './ocall-stock-returns.service';
import {
  CancelStockReceiptDto,
  CreateStockPurchaseOrderDto,
  CreateStockSupplierReturnDto,
  ReceiveStockPurchaseDto,
  StockPurchaseQueryDto,
  UpdateStockPurchaseOrderDto,
} from './ocall-stock.dto';

const OWNERS = ['PURCHASE_ORDER', 'RECEIPT', 'SUPPLIER_RETURN'] as const;
const documentFile = FileInterceptor('file', {
  // Marge au-delà de la limite métier : le service renvoie un refus explicite plutôt qu'une erreur 413.
  limits: { fileSize: STOCK_DOCUMENT_MAX_BYTES + 1, files: 1 },
});

/** Ocall Stock — S3 : commandes fournisseurs, réceptions, retours, prix d'achat, documents joints. */
@ApiTags('Ocall Stock')
@UseGuards(OcallStockAccessGuard)
@Controller('ocall-stock')
export class OcallStockPurchasesController {
  constructor(
    private readonly purchases: OcallStockPurchasesService,
    private readonly returns: OcallStockReturnsService,
    private readonly documents: OcallStockDocumentsService,
  ) {}

  // ─── Commandes ───

  @RequireStockPermission('stock.purchases.read')
  @Get('purchase-orders')
  list(@CurrentStock() ctx: StockContext, @Query() q: StockPurchaseQueryDto) {
    return this.purchases.list(ctx, q);
  }

  @RequireStockPermission('stock.purchases.read')
  @Get('purchase-orders/:id')
  get(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.get(ctx, id);
  }

  @RequireStockPermission('stock.purchases.manage')
  @Post('purchase-orders')
  create(@CurrentStock() ctx: StockContext, @Body() dto: CreateStockPurchaseOrderDto) {
    return this.purchases.create(ctx, dto);
  }

  @RequireStockPermission('stock.purchases.manage')
  @Patch('purchase-orders/:id')
  update(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockPurchaseOrderDto,
  ) {
    return this.purchases.update(ctx, id, dto);
  }

  @RequireStockPermission('stock.purchases.manage')
  @HttpCode(200)
  @Post('purchase-orders/:id/order')
  order(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.order(ctx, id);
  }

  @RequireStockPermission('stock.purchases.manage')
  @HttpCode(200)
  @Post('purchase-orders/:id/close')
  close(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.close(ctx, id);
  }

  @RequireStockPermission('stock.purchases.manage')
  @HttpCode(200)
  @Post('purchase-orders/:id/cancel')
  cancel(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.cancel(ctx, id);
  }

  @RequireStockPermission('stock.purchases.read')
  @Get('purchase-orders/:id/pdf')
  async pdf(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(
      res,
      await this.purchases.pdf(ctx, id),
      'application/pdf',
      'bon-de-commande.pdf',
    );
  }

  // ─── Réceptions ───

  @RequireStockPermission('stock.purchases.receive')
  @HttpCode(200)
  @Post('purchase-orders/:id/receive')
  receive(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveStockPurchaseDto,
  ) {
    return this.purchases.receive(ctx, id, dto);
  }

  @RequireStockPermission('stock.purchases.manage')
  @HttpCode(200)
  @Post('receipts/:id/cancel')
  cancelReceipt(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelStockReceiptDto,
  ) {
    return this.purchases.cancelReceipt(ctx, id, dto);
  }

  @RequireStockPermission('stock.prices.purchase.read')
  @Get('variants/:id/purchase-prices')
  prices(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.purchasePrices(ctx, id);
  }

  // ─── Retours fournisseurs ───

  @RequireStockPermission('stock.purchases.read', 'stock.returns.manage')
  @Get('supplier-returns')
  listReturns(@CurrentStock() ctx: StockContext, @Query() q: StockPurchaseQueryDto) {
    return this.returns.list(ctx, q.supplierId);
  }

  @RequireStockPermission('stock.returns.manage')
  @Post('supplier-returns')
  createReturn(@CurrentStock() ctx: StockContext, @Body() dto: CreateStockSupplierReturnDto) {
    return this.returns.create(ctx, dto);
  }

  // ─── Documents joints ───

  @RequireStockPermission('stock.purchases.read')
  @Get('documents/:ownerType/:ownerId')
  documentsOf(
    @CurrentStock() ctx: StockContext,
    @Param('ownerType', new ParseEnumPipe(OWNERS)) ownerType: StockDocumentOwner,
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
  ) {
    return this.documents.list(ctx, ownerType, ownerId);
  }

  @RequireStockPermission(
    'stock.purchases.manage',
    'stock.purchases.receive',
    'stock.returns.manage',
  )
  @UseInterceptors(documentFile)
  @Post('documents/:ownerType/:ownerId')
  addDocument(
    @CurrentStock() ctx: StockContext,
    @Param('ownerType', new ParseEnumPipe(OWNERS)) ownerType: StockDocumentOwner,
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @UploadedFile() file: StockDocumentUpload | undefined,
  ) {
    return this.documents.add(ctx, ownerType, ownerId, file);
  }

  @RequireStockPermission('stock.purchases.read')
  @Get('documents/:id')
  async document(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const doc = await this.documents.body(ctx, id);
    return download(res, doc.body, doc.mimeType, doc.fileName);
  }

  @RequireStockPermission('stock.purchases.manage')
  @HttpCode(204)
  @Delete('documents/:id')
  async removeDocument(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.documents.remove(ctx, id);
  }
}
