import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Sse,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig, SESSION_COOKIE } from '../../config/app-config';
import { PrismaService } from '../../prisma/prisma.service';
import { type AuthContext, type TenantContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, Public, RequireActivity, RequirePermission } from '../../common/decorators';
import { SessionService } from '../../common/security/session.service';
import { PublicOrderRoute } from '../../common/throttling';
import { findSellingEstablishment } from '../pos/pos-scope';
import {
  RestaurantEventsService,
  type RestaurantTopic,
} from '../realtime/restaurant-events.service';
import { DiningService } from './dining.service';
import { RestaurantOrdersService } from './orders.service';
import { QrOrdersService } from './qr-orders.service';
import { restaurantStream } from './realtime-stream';
import { RestaurantDashboardService } from './restaurant-dashboard.service';
import {
  CreateOrderDto,
  CreateTableDto,
  CreateZoneDto,
  EstablishmentQuery,
  OrdersQueryDto,
  PublicOrderDto,
  QrRequestsQueryDto,
  QrTokenParam,
  RejectQrRequestDto,
  UpdateOrderDto,
  UpdateTableDto,
  UpdateZoneDto,
} from './restaurant.dto';

/** Ouvre un flux temps réel après contrôle de l'établissement (même périmètre que l'API REST). */
abstract class StreamingController {
  constructor(
    protected readonly prisma: PrismaService,
    protected readonly events: RestaurantEventsService,
    protected readonly sessions: SessionService,
    protected readonly config: AppConfig,
  ) {}

  protected async open(
    auth: TenantContext,
    req: Request,
    establishmentId: string,
    topic: RestaurantTopic,
  ) {
    await findSellingEstablishment(this.prisma, auth, establishmentId, 'RESTAURANT');
    return restaurantStream({
      prisma: this.prisma,
      events: this.events,
      sessions: this.sessions,
      heartbeatMs: this.config.realtimeHeartbeatMs,
      auth,
      token: String(req.cookies?.[SESSION_COOKIE] ?? ''),
      establishmentId,
      topic,
      permission: topic === 'kitchen' ? 'kitchen.view' : 'pos.sell',
    });
  }
}

@ApiTags('Restaurant — commandes')
@RequireActivity('RESTAURANT')
@Controller('orders')
export class OrdersController extends StreamingController {
  constructor(
    prisma: PrismaService,
    events: RestaurantEventsService,
    sessions: SessionService,
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly orders: RestaurantOrdersService,
    private readonly qr: QrOrdersService,
  ) {
    super(prisma, events, sessions, config);
  }

  @RequirePermission('pos.sell')
  @Get()
  list(@CurrentAuth() auth: AuthContext, @Query() query: OrdersQueryDto) {
    return this.orders.list(requireTenant(auth), query);
  }

  /** Commande sur place, à emporter ou au comptoir : non payée, non envoyée en cuisine. */
  @RequirePermission('pos.sell')
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateOrderDto) {
    return this.orders.create(requireTenant(auth), dto);
  }

  /** Flux temps réel (SSE) des commandes et des demandes QR de l'établissement. */
  @RequirePermission('pos.sell')
  @Sse('stream')
  stream(@CurrentAuth() auth: AuthContext, @Query() q: EstablishmentQuery, @Req() req: Request) {
    return this.open(requireTenant(auth), req, q.establishmentId, 'orders');
  }

  @RequirePermission('pos.sell')
  @Get('qr-requests')
  qrRequests(@CurrentAuth() auth: AuthContext, @Query() q: QrRequestsQueryDto) {
    return this.qr.list(requireTenant(auth), q.establishmentId, q.status);
  }

  /** Validation d'une demande QR : devient une commande non payée, non envoyée en cuisine. */
  @RequirePermission('pos.sell')
  @HttpCode(200)
  @Post('qr-requests/:id/accept')
  acceptQr(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.qr.accept(requireTenant(auth), id);
  }

  @RequirePermission('pos.sell')
  @HttpCode(200)
  @Post('qr-requests/:id/reject')
  rejectQr(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectQrRequestDto,
  ) {
    return this.qr.reject(requireTenant(auth), id, dto.reason);
  }

  @RequirePermission('pos.sell')
  @Get(':id')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(requireTenant(auth), id);
  }

  /** Modification avant paiement (articles et instructions : avant l'envoi en cuisine). */
  @RequirePermission('pos.sell')
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderDto,
  ) {
    return this.orders.update(requireTenant(auth), id, dto);
  }

  /** Action explicite « Envoyer en cuisine » ; indépendante du paiement. */
  @RequirePermission('order.send_kitchen')
  @HttpCode(200)
  @Post(':id/send-to-kitchen')
  send(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.transition(requireTenant(auth), id, 'send');
  }

  @RequirePermission('order.send_kitchen')
  @HttpCode(200)
  @Post(':id/serve')
  serve(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.transition(requireTenant(auth), id, 'serve');
  }
}

@ApiTags('Restaurant — cuisine (KDS)')
@RequireActivity('RESTAURANT')
@Controller('kitchen')
export class KitchenController extends StreamingController {
  constructor(
    prisma: PrismaService,
    events: RestaurantEventsService,
    sessions: SessionService,
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly orders: RestaurantOrdersService,
  ) {
    super(prisma, events, sessions, config);
  }

  /** Commandes envoyées, en préparation ou prêtes (jamais une commande non envoyée). */
  @RequirePermission('kitchen.view')
  @Get('orders')
  queue(@CurrentAuth() auth: AuthContext, @Query() q: EstablishmentQuery) {
    return this.orders.kitchenQueue(requireTenant(auth), q.establishmentId);
  }

  /** Flux temps réel (SSE) de la cuisine d'un établissement. */
  @RequirePermission('kitchen.view')
  @Sse('stream')
  stream(@CurrentAuth() auth: AuthContext, @Query() q: EstablishmentQuery, @Req() req: Request) {
    return this.open(requireTenant(auth), req, q.establishmentId, 'kitchen');
  }

  @RequirePermission('kitchen.update')
  @HttpCode(200)
  @Post('orders/:id/start')
  start(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.transition(requireTenant(auth), id, 'start');
  }

  @RequirePermission('kitchen.update')
  @HttpCode(200)
  @Post('orders/:id/ready')
  ready(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.transition(requireTenant(auth), id, 'ready');
  }
}

@ApiTags('Restaurant — salles, tables et tableau de bord')
@RequireActivity('RESTAURANT')
@Controller('restaurant')
export class DiningController {
  constructor(
    private readonly dining: DiningService,
    private readonly dashboard: RestaurantDashboardService,
  ) {}

  /** Établissements restaurant du membre (écrans cuisine, stocks, réservations, commandes). */
  @RequirePermission('dashboard.read')
  @Get('establishments')
  establishments(@CurrentAuth() auth: AuthContext) {
    return this.dining.establishments(requireTenant(auth));
  }

  /** Zones et tables avec leur statut (libre, occupée, réservée, hors service) et leur QR code. */
  @RequirePermission('pos.sell')
  @Get('dining')
  overview(@CurrentAuth() auth: AuthContext, @Query() q: EstablishmentQuery) {
    return this.dining.overview(requireTenant(auth), q.establishmentId);
  }

  @RequirePermission('tables.manage')
  @Post('zones')
  createZone(@CurrentAuth() auth: AuthContext, @Body() dto: CreateZoneDto) {
    return this.dining.createZone(requireTenant(auth), dto);
  }

  @RequirePermission('tables.manage')
  @Patch('zones/:id')
  updateZone(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateZoneDto,
  ) {
    return this.dining.updateZone(requireTenant(auth), id, dto);
  }

  @RequirePermission('tables.manage')
  @HttpCode(200)
  @Post('zones/:id/regenerate-qr')
  regenerateZoneQr(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.dining.regenerateQr(requireTenant(auth), 'zone', id);
  }

  @RequirePermission('tables.manage')
  @Post('tables')
  createTable(@CurrentAuth() auth: AuthContext, @Body() dto: CreateTableDto) {
    return this.dining.createTable(requireTenant(auth), dto);
  }

  @RequirePermission('tables.manage')
  @Patch('tables/:id')
  updateTable(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTableDto,
  ) {
    return this.dining.updateTable(requireTenant(auth), id, dto);
  }

  @RequirePermission('tables.manage')
  @HttpCode(200)
  @Post('tables/:id/regenerate-qr')
  regenerateTableQr(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.dining.regenerateQr(requireTenant(auth), 'table', id);
  }

  @RequirePermission('sale.read_all')
  @Get('dashboard')
  getDashboard(@CurrentAuth() auth: AuthContext, @Query() q: EstablishmentQuery) {
    return this.dashboard.get(requireTenant(auth), q.establishmentId);
  }
}

/**
 * Menu public et demandes de commande par QR code : sans compte. Aucune donnée interne n'est exposée
 * (ni identifiant d'organisation, ni employé) ; les prix sont toujours calculés par le serveur.
 */
@ApiTags('Commande par QR code (public)')
@Public()
@Controller('public')
export class PublicOrderingController {
  constructor(private readonly qr: QrOrdersService) {}

  @Get('menu/:token')
  menu(@Param() p: QrTokenParam) {
    return this.qr.menu(p.token);
  }

  @PublicOrderRoute()
  @Post('menu/:token/orders')
  submit(@Param() p: QrTokenParam, @Body() dto: PublicOrderDto) {
    return this.qr.submit(p.token, dto);
  }

  @Get('order-requests/:token')
  status(@Param() p: QrTokenParam) {
    return this.qr.status(p.token);
  }
}
