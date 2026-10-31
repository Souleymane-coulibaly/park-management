import {
  BadRequestException,
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
import { type AuthContext, requirePartner } from '../../common/auth-context';
import { CurrentAuth, PartnerOnly, RequirePlatformPermission } from '../../common/decorators';
import { DeclareSubscriptionPaymentDto } from '../platform/payments.dto';
import { SubscriptionPaymentsService } from '../platform/payments.service';
import {
  CreateCommissionRuleDto,
  CreatePartnerDto,
  CreateProspectDto,
  ExtendProtectionDto,
  IdsDto,
  ProposeAttributionDto,
  ProspectDemoDto,
  ReasonDto,
  RecordPayoutDto,
  UpdatePartnerDto,
  UpdateProspectDto,
} from './partners.dto';
import { PartnerPortalService } from './partner-portal.service';
import { PartnersAdminService } from './partners-admin.service';

/** Super Admin : partenaires, règles, prospects, attributions, commissions, versements (Sprint 12B). */
@ApiTags('platform')
@Controller('platform')
export class PlatformPartnersController {
  constructor(private readonly admin: PartnersAdminService) {}

  @RequirePlatformPermission('platform.partners.manage')
  @Get('partners')
  list() {
    return this.admin.list();
  }

  @RequirePlatformPermission('platform.partners.manage')
  @Post('partners')
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreatePartnerDto) {
    return this.admin.create(auth, dto);
  }

  @RequirePlatformPermission('platform.partners.manage')
  @Patch('partners/:id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePartnerDto,
  ) {
    return this.admin.update(auth, id, dto);
  }

  @RequirePlatformPermission('platform.partners.manage')
  @HttpCode(200)
  @Post('partners/:id/verify')
  verify(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.verify(auth, id);
  }

  @RequirePlatformPermission('platform.partners.manage')
  @HttpCode(200)
  @Post('partners/:id/suspend')
  suspend(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.admin.suspend(auth, id, dto.reason);
  }

  @RequirePlatformPermission('platform.partners.manage')
  @HttpCode(200)
  @Post('partners/:id/reactivate')
  reactivate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.admin.reactivate(auth, id, dto.reason);
  }

  @RequirePlatformPermission('platform.partners.manage')
  @Get('partner-reports')
  report() {
    return this.admin.report();
  }

  // ─── Règles ───

  @RequirePlatformPermission('platform.partners.manage')
  @Get('commission-rules')
  rules() {
    return this.admin.rules();
  }

  @RequirePlatformPermission('platform.partners.manage')
  @Post('commission-rules')
  createRule(@CurrentAuth() auth: AuthContext, @Body() dto: CreateCommissionRuleDto) {
    return this.admin.createRule(auth, dto);
  }

  /** Validation (activation) par le propriétaire uniquement, contrôlé dans le service. */
  @RequirePlatformPermission('platform.partners.manage')
  @HttpCode(200)
  @Post('commission-rules/:id/activate')
  activateRule(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.setRuleActive(auth, id, true);
  }

  @RequirePlatformPermission('platform.partners.manage')
  @HttpCode(200)
  @Post('commission-rules/:id/deactivate')
  deactivateRule(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.setRuleActive(auth, id, false);
  }

  // ─── Prospects et attributions ───

  @RequirePlatformPermission('platform.partners.manage')
  @Get('prospects')
  prospects(@Query('partnerId') partnerId?: string) {
    return this.admin.prospects({ partnerId });
  }

  @RequirePlatformPermission('platform.partners.manage')
  @HttpCode(200)
  @Post('prospects/:id/extend')
  extend(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExtendProtectionDto,
  ) {
    return this.admin.extendProtection(auth, id, dto.days);
  }

  @RequirePlatformPermission('platform.partners.manage')
  @Get('attributions')
  attributions(@Query('status') status?: string) {
    return this.admin.attributions({ status });
  }

  @RequirePlatformPermission('platform.partners.manage')
  @Post('attributions')
  propose(@CurrentAuth() auth: AuthContext, @Body() dto: ProposeAttributionDto) {
    return this.admin.propose(auth, dto);
  }

  @RequirePlatformPermission('platform.partners.manage')
  @HttpCode(200)
  @Post('attributions/:id/confirm')
  confirm(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.confirm(auth, id);
  }

  @RequirePlatformPermission('platform.partners.manage')
  @HttpCode(200)
  @Post('attributions/:id/reject')
  rejectAttribution(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.admin.reject(auth, id, dto.reason);
  }

  // ─── Commissions et versements ───

  @RequirePlatformPermission('platform.commissions.validate')
  @Get('commissions')
  commissions(@Query('partnerId') partnerId?: string, @Query('status') status?: string) {
    return this.admin.commissions({ partnerId, status });
  }

  @RequirePlatformPermission('platform.commissions.validate')
  @HttpCode(200)
  @Post('commissions/validate')
  validate(@CurrentAuth() auth: AuthContext, @Body() dto: IdsDto) {
    return this.admin.validateCommissions(auth, dto.ids);
  }

  @RequirePlatformPermission('platform.commissions.validate')
  @HttpCode(200)
  @Post('commissions/dispute/:paymentId')
  dispute(
    @CurrentAuth() auth: AuthContext,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.admin.disputePayment(auth, paymentId, dto.reason);
  }

  @RequirePlatformPermission('platform.payouts.manage')
  @Get('commission-payouts')
  payouts(@Query('partnerId') partnerId?: string) {
    return this.admin.payouts({ partnerId });
  }

  @RequirePlatformPermission('platform.payouts.manage')
  @Post('commission-payouts')
  recordPayout(@CurrentAuth() auth: AuthContext, @Body() dto: RecordPayoutDto) {
    return this.admin.recordPayout(auth, dto);
  }

  @RequirePlatformPermission('platform.payouts.manage')
  @HttpCode(200)
  @Post('commission-payouts/:id/confirm')
  confirmPayout(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.confirmPayout(auth, id);
  }

  @RequirePlatformPermission('platform.payouts.manage')
  @HttpCode(200)
  @Post('commission-payouts/:id/reject')
  rejectPayout(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.admin.rejectPayout(auth, id, dto.reason);
  }
}

/** Portail partenaire : uniquement les données du partenaire de la session (Sprint 12B). */
@ApiTags('partner')
@PartnerOnly()
@Controller('partner')
export class PartnerPortalController {
  constructor(
    private readonly portal: PartnerPortalService,
    private readonly payments: SubscriptionPaymentsService,
  ) {}

  @Get('profile')
  profile(@CurrentAuth() auth: AuthContext) {
    return this.portal.profile(requirePartner(auth, { allowPending: true }));
  }

  @Get('dashboard')
  dashboard(@CurrentAuth() auth: AuthContext) {
    return this.portal.dashboard(requirePartner(auth));
  }

  @Get('products')
  products(@CurrentAuth() auth: AuthContext) {
    requirePartner(auth);
    return this.portal.products();
  }

  @Get('prospects')
  prospects(@CurrentAuth() auth: AuthContext) {
    return this.portal.prospects(requirePartner(auth));
  }

  @Post('prospects')
  createProspect(@CurrentAuth() auth: AuthContext, @Body() dto: CreateProspectDto) {
    return this.portal.createProspect(requirePartner(auth), dto);
  }

  @Patch('prospects/:id')
  updateProspect(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProspectDto,
  ) {
    return this.portal.updateProspect(requirePartner(auth), id, dto);
  }

  @Post('prospects/:id/demo')
  requestDemo(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProspectDemoDto,
  ) {
    return this.portal.requestDemo(requirePartner(auth), id, dto.message);
  }

  @Get('demo-requests')
  demoRequests(@CurrentAuth() auth: AuthContext) {
    return this.portal.demoRequests(requirePartner(auth));
  }

  @Get('clients')
  clients(@CurrentAuth() auth: AuthContext) {
    return this.portal.clients(requirePartner(auth));
  }

  @Get('commissions')
  commissions(@CurrentAuth() auth: AuthContext) {
    return this.portal.commissions(requirePartner(auth));
  }

  @Get('payouts')
  payouts(@CurrentAuth() auth: AuthContext) {
    return this.portal.payouts(requirePartner(auth));
  }

  @Get('cash/invoices')
  collectibleInvoices(@CurrentAuth() auth: AuthContext) {
    return this.portal.collectibleInvoices(requirePartner(auth));
  }

  @Get('cash/collections')
  cashCollections(@CurrentAuth() auth: AuthContext) {
    return this.portal.cashCollections(requirePartner(auth));
  }

  /**
   * Collecte d'espèces (si habilité) : déclarée seulement ; jamais confirmée par le partenaire,
   * aucune activation d'abonnement.
   */
  @Post('cash/collections')
  declareCash(@CurrentAuth() auth: AuthContext, @Body() dto: DeclareSubscriptionPaymentDto) {
    const partner = requirePartner(auth);
    if (dto.method !== 'CASH') {
      throw new BadRequestException({
        code: 'METHOD_ROUTE_MISMATCH',
        message: 'Le portail partenaire n’enregistre que des collectes d’espèces.',
      });
    }
    return this.payments.declare(
      partner,
      { ...dto, collectedById: undefined },
      { partnerId: partner.partner.id },
    );
  }
}
