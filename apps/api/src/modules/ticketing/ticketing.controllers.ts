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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, RequireActivity, RequirePermission } from '../../common/decorators';
import { AccessControlService } from './access-control.service';
import { ParkScheduleService } from './park-schedule.service';
import { TicketCategoriesService } from './ticket-categories.service';
import { TicketSalesService } from './ticket-sales.service';
import { TicketingDashboardService } from './ticketing-dashboard.service';
import {
  CancelTicketDto,
  CreateCalendarExceptionDto,
  CreateTicketCategoryDto,
  CreateTicketOrderDto,
  EstablishmentQueryDto,
  PutWeeklyScheduleDto,
  ScansQueryDto,
  ScanTicketDto,
  TicketQuoteDto,
  TicketsQueryDto,
  UpdateTicketCategoryDto,
} from './ticketing.dto';
import { TicketsService } from './tickets.service';

@ApiTags('Billetterie')
@RequireActivity('PARK')
@Controller('ticketing')
export class TicketingController {
  constructor(
    private readonly sales: TicketSalesService,
    private readonly categories: TicketCategoriesService,
    private readonly schedule: ParkScheduleService,
    private readonly dashboard: TicketingDashboardService,
  ) {}

  /** Établissements parc où le membre peut vendre des billets. */
  @RequirePermission('pos.sell')
  @Get('establishments')
  establishments(@CurrentAuth() auth: AuthContext) {
    return this.sales.establishments(requireTenant(auth));
  }

  /** Catégories en vente aujourd'hui et état d'ouverture du parc. */
  @RequirePermission('pos.sell')
  @Get('catalog')
  catalog(@CurrentAuth() auth: AuthContext, @Query() query: EstablishmentQueryDto) {
    return this.sales.catalog(requireTenant(auth), query.establishmentId);
  }

  /** Montants calculés par le serveur (aucun enregistrement). */
  @RequirePermission('pos.sell')
  @HttpCode(200)
  @Post('quote')
  quote(@CurrentAuth() auth: AuthContext, @Body() dto: TicketQuoteDto) {
    return this.sales.quote(requireTenant(auth), dto);
  }

  /** Commande de billets (vente non payée) ; l'encaissement passe par POST /sales/:id/pay. */
  @RequirePermission('pos.sell')
  @Post('orders')
  order(@CurrentAuth() auth: AuthContext, @Body() dto: CreateTicketOrderDto) {
    return this.sales.order(requireTenant(auth), dto);
  }

  @RequirePermission('ticketing.manage')
  @Get('categories')
  listCategories(@CurrentAuth() auth: AuthContext, @Query() query: EstablishmentQueryDto) {
    return this.categories.list(requireTenant(auth), query.establishmentId);
  }

  @RequirePermission('ticketing.manage')
  @Post('categories')
  createCategory(@CurrentAuth() auth: AuthContext, @Body() dto: CreateTicketCategoryDto) {
    return this.categories.create(requireTenant(auth), dto);
  }

  @RequirePermission('ticketing.manage')
  @Patch('categories/:id')
  updateCategory(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketCategoryDto,
  ) {
    return this.categories.update(requireTenant(auth), id, dto);
  }

  @RequirePermission('ticketing.manage')
  @Get('schedule')
  getSchedule(@CurrentAuth() auth: AuthContext, @Query() query: EstablishmentQueryDto) {
    return this.schedule.get(requireTenant(auth), query.establishmentId);
  }

  @RequirePermission('ticketing.manage')
  @Put('schedule/weekly')
  putWeekly(@CurrentAuth() auth: AuthContext, @Body() dto: PutWeeklyScheduleDto) {
    return this.schedule.putWeekly(requireTenant(auth), dto);
  }

  @RequirePermission('ticketing.manage')
  @Post('schedule/exceptions')
  saveException(@CurrentAuth() auth: AuthContext, @Body() dto: CreateCalendarExceptionDto) {
    return this.schedule.upsertException(requireTenant(auth), dto);
  }

  @RequirePermission('ticketing.manage')
  @Delete('schedule/exceptions/:id')
  removeException(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.schedule.removeException(requireTenant(auth), id);
  }

  @RequirePermission('sale.read_all')
  @Get('dashboard')
  getDashboard(@CurrentAuth() auth: AuthContext, @Query() query: EstablishmentQueryDto) {
    return this.dashboard.get(requireTenant(auth), query.establishmentId);
  }
}

@ApiTags('Billetterie')
@RequireActivity('PARK')
@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  /** Billets (avec contenu du QR) d'une vente visible du membre. */
  @RequirePermission('pos.sell')
  @Get()
  list(@CurrentAuth() auth: AuthContext, @Query() query: TicketsQueryDto) {
    return this.tickets.forSale(requireTenant(auth), query.saleId);
  }

  @RequirePermission('ticket.cancel')
  @HttpCode(200)
  @Post(':id/cancel')
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelTicketDto,
  ) {
    return this.tickets.cancel(requireTenant(auth), id, dto.reason);
  }
}

@ApiTags('Contrôle d’accès')
@RequireActivity('PARK')
@Controller('access')
export class AccessController {
  constructor(
    private readonly access: AccessControlService,
    private readonly sales: TicketSalesService,
  ) {}

  /** Établissements parc où le membre peut contrôler les entrées. */
  @RequirePermission('access.scan')
  @Get('establishments')
  establishments(@CurrentAuth() auth: AuthContext) {
    return this.sales.establishments(requireTenant(auth));
  }

  /** Scan d'un billet : toujours 200, le résultat (accepté / refusé + motif) est dans la réponse. */
  @RequirePermission('access.scan')
  @HttpCode(200)
  @Post('scans')
  scan(@CurrentAuth() auth: AuthContext, @Body() dto: ScanTicketDto) {
    return this.access.scan(requireTenant(auth), dto);
  }

  @RequirePermission('access.scan')
  @Get('scans')
  scans(@CurrentAuth() auth: AuthContext, @Query() query: ScansQueryDto) {
    return this.access.list(requireTenant(auth), query);
  }
}
