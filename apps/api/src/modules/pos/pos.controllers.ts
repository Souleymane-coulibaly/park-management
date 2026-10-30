import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { coversActivity } from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, RequireActivity, RequirePermission } from '../../common/decorators';
import { establishmentScope } from '../../common/tenant-scope';
import { CashSessionsService } from './cash-sessions.service';
import {
  CancelSaleDto,
  CashSessionsQueryDto,
  CloseCashSessionDto,
  CreateSaleDto,
  EstablishmentQueryDto,
  OpenCashSessionDto,
  PaySaleDto,
  QuoteDto,
  SalesQueryDto,
} from './pos.dto';
import { findSellingEstablishment } from './pos-scope';
import { loadSellableCatalog } from './sellable-catalog';
import { SalesService } from './sales.service';

@ApiTags('Caisse POS')
@RequireActivity('RESTAURANT')
@Controller('pos')
export class PosController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
  ) {}

  /** Établissements restaurant où le membre peut encaisser. */
  @RequirePermission('pos.sell')
  @Get('establishments')
  async establishments(@CurrentAuth() auth: AuthContext) {
    const tenant = requireTenant(auth);
    const rows = await this.prisma.establishment.findMany({
      where: { ...establishmentScope(tenant), isActive: true },
      select: { id: true, name: true, businessType: true },
      orderBy: { name: 'asc' },
    });
    return rows
      .filter((e) => coversActivity(e.businessType, 'RESTAURANT'))
      .map(({ id, name }) => ({ id, name }));
  }

  /** Catalogue vendable dans l'établissement : seuls les articles actifs avec un tarif disponible. */
  @RequirePermission('pos.sell')
  @Get('catalog')
  async catalog(@CurrentAuth() auth: AuthContext, @Query() query: EstablishmentQueryDto) {
    const tenant = requireTenant(auth);
    await findSellingEstablishment(this.prisma, tenant, query.establishmentId, 'RESTAURANT');
    return loadSellableCatalog(
      this.prisma,
      tenant.membership.organizationId,
      query.establishmentId,
    );
  }

  /** Montants d'un panier calculés par le serveur (aucun enregistrement). */
  @RequirePermission('pos.sell')
  @HttpCode(200)
  @Post('quote')
  quote(@CurrentAuth() auth: AuthContext, @Body() dto: QuoteDto) {
    return this.sales.quote(requireTenant(auth), dto);
  }
}

@ApiTags('Caisse POS')
@RequireActivity('RESTAURANT', 'PARK')
@Controller('cash-sessions')
export class CashSessionsController {
  constructor(private readonly sessions: CashSessionsService) {}

  @RequirePermission('pos.sell')
  @Get('current')
  current(@CurrentAuth() auth: AuthContext, @Query() query: EstablishmentQueryDto) {
    return this.sessions.current(requireTenant(auth), query.establishmentId);
  }

  @RequirePermission('pos.sell')
  @Get()
  list(@CurrentAuth() auth: AuthContext, @Query() query: CashSessionsQueryDto) {
    return this.sessions.list(requireTenant(auth), query);
  }

  @RequirePermission('pos.sell')
  @Get(':id')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.get(requireTenant(auth), id);
  }

  @RequirePermission('pos.sell')
  @Post()
  open(@CurrentAuth() auth: AuthContext, @Body() dto: OpenCashSessionDto) {
    return this.sessions.open(requireTenant(auth), dto);
  }

  @RequirePermission('pos.sell')
  @HttpCode(200)
  @Post(':id/close')
  close(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseCashSessionDto,
  ) {
    return this.sessions.close(requireTenant(auth), id, dto);
  }
}

@ApiTags('Caisse POS')
@RequireActivity('RESTAURANT', 'PARK')
@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  /** Vente de restaurant (la billetterie passe par POST /ticketing/orders). */
  @RequirePermission('pos.sell')
  @RequireActivity('RESTAURANT')
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateSaleDto) {
    return this.sales.create(requireTenant(auth), dto);
  }

  @RequirePermission('pos.sell')
  @Get()
  list(@CurrentAuth() auth: AuthContext, @Query() query: SalesQueryDto) {
    return this.sales.list(requireTenant(auth), query);
  }

  @RequirePermission('pos.sell')
  @Get(':id')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.get(requireTenant(auth), id);
  }

  @RequirePermission('pos.sell')
  @HttpCode(200)
  @Post(':id/payments')
  pay(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PaySaleDto,
  ) {
    return this.sales.pay(requireTenant(auth), id, dto);
  }

  @RequirePermission('sale.cancel')
  @HttpCode(200)
  @Post(':id/cancel')
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelSaleDto,
  ) {
    return this.sales.cancel(requireTenant(auth), id, dto);
  }
}
