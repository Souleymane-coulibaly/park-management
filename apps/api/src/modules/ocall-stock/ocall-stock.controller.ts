import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CurrentStock,
  OcallStockAccessGuard,
  RequireStockPermission,
  type StockContext,
} from './ocall-stock-access';
import { OcallStockMembersService } from './ocall-stock-members.service';
import { OcallStockService } from './ocall-stock.service';
import {
  CreateStockMemberDto,
  StockMemberPermissionsDto,
  StockSettingsDto,
  UpdateStockMemberDto,
} from './ocall-stock.dto';

/**
 * Ocall Stock — socle (S1) : contexte, réglages, équipe. Préfixe `/ocall-stock` : `/stock` appartient au
 * stock d'ingrédients d'Ocall Park (restaurant).
 */
@ApiTags('Ocall Stock')
@UseGuards(OcallStockAccessGuard)
@Controller('ocall-stock')
export class OcallStockController {
  constructor(
    private readonly stock: OcallStockService,
    private readonly members: OcallStockMembersService,
  ) {}

  @RequireStockPermission('stock.access')
  @Get('context')
  context(@CurrentStock() ctx: StockContext) {
    return this.stock.context(ctx);
  }

  @RequireStockPermission('stock.access')
  @Get('settings')
  settings(@CurrentStock() ctx: StockContext) {
    return this.stock.settings(ctx);
  }

  @RequireStockPermission('stock.settings.manage')
  @Put('settings')
  updateSettings(@CurrentStock() ctx: StockContext, @Body() dto: StockSettingsDto) {
    return this.stock.updateSettings(ctx, dto);
  }

  @RequireStockPermission('stock.members.read')
  @Get('members')
  listMembers(@CurrentStock() ctx: StockContext) {
    return this.members.list(ctx);
  }

  @RequireStockPermission('stock.members.manage')
  @Post('members')
  createMember(@CurrentStock() ctx: StockContext, @Body() dto: CreateStockMemberDto) {
    return this.members.create(ctx, dto);
  }

  @RequireStockPermission('stock.members.manage')
  @Patch('members/:id')
  updateMember(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockMemberDto,
  ) {
    return this.members.update(ctx, id, dto);
  }

  @RequireStockPermission('stock.members.manage')
  @Put('members/:id/permissions')
  setPermissions(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StockMemberPermissionsDto,
  ) {
    return this.members.setPermissions(ctx, id, dto);
  }
}
