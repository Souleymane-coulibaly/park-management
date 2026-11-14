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
  AttachStockMemberDto,
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

  /** S5 — demandes reçues d'Ocall Facture (factures, pièces d'interventions, avoirs), les plus récentes. */
  @RequireStockPermission('stock.movements.read')
  @Get('facture-events')
  factureEvents(@CurrentStock() ctx: StockContext) {
    return this.stock.factureEvents(ctx);
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

  /** Membres de l'organisation (Park, autres applications) à ajouter sans nouveau compte. */
  @RequireStockPermission('stock.members.manage')
  @Get('members/candidates')
  memberCandidates(@CurrentStock() ctx: StockContext) {
    return this.members.candidates(ctx);
  }

  @RequireStockPermission('stock.members.manage')
  @Post('members/existing')
  attachMember(@CurrentStock() ctx: StockContext, @Body() dto: AttachStockMemberDto) {
    return this.members.attach(ctx, dto);
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
