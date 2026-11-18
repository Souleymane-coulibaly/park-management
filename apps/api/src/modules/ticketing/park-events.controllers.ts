import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, RequireActivity, RequirePermission } from '../../common/decorators';
import {
  CancelEventSessionDto,
  CreateEventSessionDto,
  CreateEventTariffDto,
  CreateParkEventDto,
  ParkEventsQueryDto,
  UpdateEventSessionDto,
  UpdateEventTariffDto,
  UpdateParkEventDto,
} from './park-events.dto';
import { ParkEventsService } from './park-events.service';
import { TicketSalesService } from './ticket-sales.service';
import { EstablishmentQueryDto } from './ticketing.dto';

/**
 * Événements du parc. Gestion : `ticketing.manage` ; consultation, suivi et acheteurs :
 * `sale.read_all` ; vente au guichet : `pos.sell` (commande et encaissement par les routes de la
 * billetterie, avec `eventSessionId` sur la ligne).
 */
@ApiTags('Billetterie — événements')
@RequireActivity('PARK')
@Controller('ticketing')
export class ParkEventsController {
  constructor(
    private readonly events: ParkEventsService,
    private readonly sales: TicketSalesService,
  ) {}

  /** Événements en vente au guichet : séances ouvertes, places restantes. */
  @RequirePermission('pos.sell')
  @Get('event-catalog')
  catalog(@CurrentAuth() auth: AuthContext, @Query() query: EstablishmentQueryDto) {
    return this.sales.eventCatalog(requireTenant(auth), query.establishmentId);
  }

  @RequirePermission('sale.read_all')
  @Get('events')
  list(@CurrentAuth() auth: AuthContext, @Query() query: ParkEventsQueryDto) {
    return this.events.list(requireTenant(auth), query);
  }

  @RequirePermission('sale.read_all')
  @Get('events/:id')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.events.get(requireTenant(auth), id);
  }

  @RequirePermission('sale.read_all')
  @Get('events/:id/dashboard')
  dashboard(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.events.dashboard(requireTenant(auth), id);
  }

  @RequirePermission('ticketing.manage')
  @Post('events')
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateParkEventDto) {
    return this.events.create(requireTenant(auth), dto);
  }

  @RequirePermission('ticketing.manage')
  @Patch('events/:id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateParkEventDto,
  ) {
    return this.events.update(requireTenant(auth), id, dto);
  }

  @RequirePermission('ticketing.manage')
  @Post('events/:id/sessions')
  createSession(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateEventSessionDto,
  ) {
    return this.events.createSession(requireTenant(auth), id, dto);
  }

  @RequirePermission('ticketing.manage')
  @Patch('events/:id/sessions/:sessionId')
  updateSession(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: UpdateEventSessionDto,
  ) {
    return this.events.updateSession(requireTenant(auth), id, sessionId, dto);
  }

  /** Annulation motivée : billets valides annulés, liste des acheteurs renvoyée. */
  @RequirePermission('ticketing.manage')
  @HttpCode(200)
  @Post('events/:id/sessions/:sessionId/cancel')
  cancelSession(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: CancelEventSessionDto,
  ) {
    return this.events.cancelSession(requireTenant(auth), id, sessionId, dto);
  }

  @RequirePermission('sale.read_all')
  @Get('events/:id/sessions/:sessionId/buyers')
  buyers(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    return this.events.buyers(requireTenant(auth), id, sessionId);
  }

  @RequirePermission('ticketing.manage')
  @Post('events/:id/tariffs')
  createTariff(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateEventTariffDto,
  ) {
    return this.events.createTariff(requireTenant(auth), id, dto);
  }

  @RequirePermission('ticketing.manage')
  @Patch('events/:id/tariffs/:tariffId')
  updateTariff(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tariffId', ParseUUIDPipe) tariffId: string,
    @Body() dto: UpdateEventTariffDto,
  ) {
    return this.events.updateTariff(requireTenant(auth), id, tariffId, dto);
  }
}
