import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { OcallStockCustomersService } from './ocall-stock-customers.service';
import { OcallStockRegistersService } from './ocall-stock-registers.service';
import { OcallStockSalesService } from './ocall-stock-sales.service';
import {
  CloseStockCashSessionDto,
  StockCashSessionQueryDto,
  CreateStockSaleDto,
  CreateStockSaleReturnDto,
  HoldStockCartDto,
  OpenStockCashSessionDto,
  StockCustomerDto,
  StockListQueryDto,
  StockLookupQueryDto,
  StockSearchQueryDto,
  StockReceiptQueryDto,
  StockRegisterDto,
  StockSaleQueryDto,
  UpdateStockCustomerDto,
  UpdateStockRegisterDto,
} from './ocall-stock.dto';

/** Ocall Stock — S4 : caisses, sessions, ventes, tickets, retours, paniers en attente, clients. */
@ApiTags('Ocall Stock')
@UseGuards(OcallStockAccessGuard)
@Controller('ocall-stock')
export class OcallStockPosController {
  constructor(
    private readonly registers: OcallStockRegistersService,
    private readonly sales: OcallStockSalesService,
    private readonly customers: OcallStockCustomersService,
  ) {}

  // ─── Caisses ───

  @RequireStockPermission('stock.sales.create', 'stock.sales.read', 'stock.registers.manage')
  @Get('registers')
  listRegisters(@CurrentStock() ctx: StockContext, @Query() q: StockListQueryDto) {
    return this.registers.list(ctx, { archived: q.archived });
  }

  @RequireStockPermission('stock.registers.manage')
  @Post('registers')
  createRegister(@CurrentStock() ctx: StockContext, @Body() dto: StockRegisterDto) {
    return this.registers.create(ctx, dto);
  }

  @RequireStockPermission('stock.registers.manage')
  @Patch('registers/:id')
  updateRegister(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockRegisterDto,
  ) {
    return this.registers.update(ctx, id, dto);
  }

  // ─── Sessions ───

  @RequireStockPermission('stock.cash.session')
  @Post('registers/:id/sessions')
  openSession(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OpenStockCashSessionDto,
  ) {
    return this.registers.open(ctx, id, dto);
  }

  @RequireStockPermission('stock.cash.session', 'stock.sales.read')
  @Get('cash-sessions')
  listSessions(@CurrentStock() ctx: StockContext, @Query() q: StockCashSessionQueryDto) {
    return this.registers.sessions(ctx, q.registerId);
  }

  @RequireStockPermission('stock.cash.session', 'stock.sales.read')
  @Get('cash-sessions/:id')
  session(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.registers.session(ctx, id);
  }

  @RequireStockPermission('stock.cash.session')
  @Post('cash-sessions/:id/close')
  closeSession(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseStockCashSessionDto,
  ) {
    return this.registers.close(ctx, id, dto);
  }

  // ─── Articles en caisse ───

  @RequireStockPermission('stock.sales.create')
  @Get('registers/:id/items')
  posSearch(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: StockSearchQueryDto,
  ) {
    return this.sales.posSearch(ctx, id, q.q);
  }

  @RequireStockPermission('stock.sales.create')
  @Get('registers/:id/scan')
  posScan(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: StockLookupQueryDto,
  ) {
    return this.sales.posScan(ctx, id, q.code);
  }

  // ─── Paniers en attente ───

  @RequireStockPermission('stock.sales.create')
  @Get('registers/:id/held-carts')
  heldCarts(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.registers.heldCarts(ctx, id);
  }

  @RequireStockPermission('stock.sales.create')
  @Post('registers/:id/held-carts')
  hold(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HoldStockCartDto,
  ) {
    return this.registers.hold(ctx, id, dto);
  }

  @RequireStockPermission('stock.sales.create')
  @Delete('held-carts/:id')
  async resume(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    const cart = await this.registers.resume(ctx, id);
    // Articles relus maintenant (prix, disponibilité) ; un article archivé entre-temps n'est plus proposé.
    const items = await this.sales.posItemsFor(
      ctx,
      cart.registerId,
      cart.payload.lines.map((l) => l.variantId),
    );
    return { ...cart, items };
  }

  // ─── Ventes ───

  @RequireStockPermission('stock.sales.create')
  @Post('sales')
  createSale(@CurrentStock() ctx: StockContext, @Body() dto: CreateStockSaleDto) {
    return this.sales.create(ctx, dto);
  }

  @RequireStockPermission('stock.sales.read')
  @Get('sales')
  listSales(@CurrentStock() ctx: StockContext, @Query() q: StockSaleQueryDto) {
    return this.sales.list(ctx, q);
  }

  @RequireStockPermission('stock.sales.read', 'stock.sales.create')
  @Get('sales/:id')
  sale(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.get(ctx, id);
  }

  /** Ticket original (juste après l'encaissement) : aperçu et flux ESC/POS. */
  @RequireStockPermission('stock.sales.read', 'stock.sales.create')
  @Get('sales/:id/receipt')
  receipt(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: StockReceiptQueryDto,
  ) {
    return this.sales.receipt(ctx, id, { width: q.width });
  }

  /** Réimpression : DUPLICATA, comptée et tracée. */
  @RequireStockPermission('stock.sales.read')
  @Post('sales/:id/reprint')
  reprint(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: StockReceiptQueryDto,
  ) {
    return this.sales.receipt(ctx, id, { width: q.width, duplicate: true });
  }

  @RequireStockPermission('stock.sales.read', 'stock.sales.create')
  @Get('sales/:id/receipt.pdf')
  async receiptPdf(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: StockReceiptQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const pdf = await this.sales.receiptPdf(ctx, id, q.width);
    return download(res, pdf.body, 'application/pdf', pdf.fileName);
  }

  @RequireStockPermission('stock.sales.refund')
  @Post('sales/:id/returns')
  createReturn(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateStockSaleReturnDto,
  ) {
    return this.sales.createReturn(ctx, id, dto);
  }

  // ─── Clients ───

  @RequireStockPermission('stock.customers.read')
  @Get('customers')
  listCustomers(@CurrentStock() ctx: StockContext, @Query() q: StockListQueryDto) {
    return this.customers.list(ctx, q);
  }

  @RequireStockPermission('stock.customers.read')
  @Get('customers/:id')
  customer(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(ctx, id);
  }

  @RequireStockPermission('stock.customers.manage')
  @Post('customers')
  createCustomer(@CurrentStock() ctx: StockContext, @Body() dto: StockCustomerDto) {
    return this.customers.create(ctx, dto);
  }

  @RequireStockPermission('stock.customers.manage')
  @Patch('customers/:id')
  updateCustomer(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockCustomerDto,
  ) {
    return this.customers.update(ctx, id, dto);
  }
}
