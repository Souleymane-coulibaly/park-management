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
import {
  CurrentAuth,
  PartnerOnly,
  Public,
  RequirePlatformPermission,
} from '../../common/decorators';
import { PublicLeadRoute, SensitiveRoute } from '../../common/throttling';
import { DeclareSubscriptionPaymentDto } from '../platform/payments.dto';
import { SubscriptionPaymentsService } from '../platform/payments.service';
import {
  AssignAttributionDto,
  AttributionsQueryDto,
  CreateCommissionRuleDto,
  CreatePartnerDto,
  CreateProspectDto,
  DecisionNoteDto,
  ExtendProtectionDto,
  IdsDto,
  PartnerActivationDto,
  PartnerApplicationDto,
  PartnerApplicationsQueryDto,
  PartnerInvitationTokenDto,
  PartnerProfileDto,
  PartnerStatsQueryDto,
  PayoutRequestDecisionDto,
  PayoutRequestDto,
  ProposeAttributionDto,
  ProspectDemoDto,
  ProspectsQueryDto,
  ReasonDto,
  RecordPayoutDto,
  ResellerRequestDto,
  UpdatePartnerDto,
  UpdateProspectDto,
} from './partners.dto';
import { PartnerApplicationsService } from './partner-applications.service';
import { PartnerPortalService } from './partner-portal.service';
import { PartnersAdminService } from './partners-admin.service';

/** Super Admin : partenaires, règles, prospects, attributions, commissions, versements (Sprint 12B). */
@ApiTags('platform')
@Controller('platform')
export class PlatformPartnersController {
  constructor(
    private readonly admin: PartnersAdminService,
    private readonly applications: PartnerApplicationsService,
  ) {}

  // ─── Sprint S3 : candidatures et invitations ───

  @RequirePlatformPermission('platform.partners.manage')
  @Get('partner-applications')
  listApplications(@Query() q: PartnerApplicationsQueryDto) {
    return this.applications.list(q);
  }

  /** Approbation (vaut agrément) : renvoie une seule fois le lien d'invitation à transmettre. */
  @RequirePlatformPermission('platform.partners.manage')
  @HttpCode(200)
  @Post('partner-applications/:id/approve')
  approveApplication(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecisionNoteDto,
  ) {
    return this.applications.approve(auth, id, dto.note ?? null);
  }

  @RequirePlatformPermission('platform.partners.manage')
  @HttpCode(200)
  @Post('partner-applications/:id/reject')
  rejectApplication(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.applications.reject(auth, id, dto.reason);
  }

  @RequirePlatformPermission('platform.partners.manage')
  @HttpCode(200)
  @Post('partner-applications/:id/reinvite')
  reinvite(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.applications.reinvite(auth, id);
  }

  @RequirePlatformPermission('platform.partners.manage')
  @HttpCode(200)
  @Post('partner-applications/purge')
  purgeApplications(@CurrentAuth() auth: AuthContext) {
    return this.applications.purgeExpired(auth);
  }

  @RequirePlatformPermission('platform.partners.manage')
  @Get('partner-stats')
  stats(@Query() q: PartnerStatsQueryDto) {
    return this.admin.stats(q.country);
  }

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
  @Post('partners/:id/terminate')
  terminate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.admin.terminate(auth, id, dto.reason);
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
  prospects(@Query() q: ProspectsQueryDto) {
    return this.admin.prospects(q);
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
  attributions(@Query() q: AttributionsQueryDto) {
    return this.admin.attributions(q);
  }

  /** Attribution directe d'un client (organisation × application) à un partenaire, motivée. */
  @RequirePlatformPermission('platform.partners.manage')
  @Post('attributions/assign')
  assign(@CurrentAuth() auth: AuthContext, @Body() dto: AssignAttributionDto) {
    return this.admin.assign(auth, dto);
  }

  /** Fin d'une attribution confirmée (arbitrage) : plus de nouvelle commission, historique conservé. */
  @RequirePlatformPermission('platform.partners.manage')
  @HttpCode(200)
  @Post('attributions/:id/end')
  endAttribution(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.admin.end(auth, id, dto.reason);
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
  @Get('partner-payout-requests')
  payoutRequests(@Query('status') status?: string) {
    const s = ['PENDING', 'PROCESSED', 'REJECTED', 'CANCELLED'].includes(status ?? '')
      ? (status as 'PENDING')
      : undefined;
    return this.admin.payoutRequests(s);
  }

  @RequirePlatformPermission('platform.payouts.manage')
  @HttpCode(200)
  @Post('partner-payout-requests/:id/decide')
  decidePayoutRequest(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayoutRequestDecisionDto,
  ) {
    return this.admin.decidePayoutRequest(auth, id, dto);
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

  /** Coordonnées modifiables par le partenaire (jamais statut, type ni taux). */
  @Patch('profile')
  updateProfile(@CurrentAuth() auth: AuthContext, @Body() dto: PartnerProfileDto) {
    return this.portal.updateProfile(requirePartner(auth), dto);
  }

  /** Solde de primes (acquises, en attente, payables, réglées) et prochaine date de règlement. */
  @Get('balance')
  balance(@CurrentAuth() auth: AuthContext) {
    return this.portal.balance(requirePartner(auth));
  }

  @Get('prospects')
  prospects(@CurrentAuth() auth: AuthContext, @Query() q: ProspectsQueryDto) {
    const { partnerId: _ignored, ...query } = q;
    return this.portal.prospects(requirePartner(auth), query);
  }

  @Get('prospects/:id/history')
  prospectHistory(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.prospectHistory(requirePartner(auth), id);
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

  @Get('payout-requests')
  payoutRequests(@CurrentAuth() auth: AuthContext) {
    return this.portal.payoutRequests(requirePartner(auth));
  }

  /** Demande de règlement du solde payable (règlement manuel par Ocall, jamais automatique). */
  @Post('payout-requests')
  requestPayout(@CurrentAuth() auth: AuthContext, @Body() dto: PayoutRequestDto) {
    return this.portal.requestPayout(requirePartner(auth), dto.note ?? null);
  }

  @HttpCode(200)
  @Post('payout-requests/:id/cancel')
  cancelPayoutRequest(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.cancelPayoutRequest(requirePartner(auth), id);
  }

  /** Revendeur : activation ou renouvellement préparé pour un client qui lui est attribué. */
  @Post('subscription-requests')
  resellerRequest(@CurrentAuth() auth: AuthContext, @Body() dto: ResellerRequestDto) {
    return this.portal.resellerRequest(requirePartner(auth), dto);
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

/**
 * Ocall Partner public (Sprint S3) : candidature et activation du compte par invitation. Aucune
 * authentification, limitation de débit, réponses identiques (aucune énumération des candidats).
 */
@ApiTags('public')
@Public()
@Controller('public/partners')
export class PublicPartnersController {
  constructor(private readonly applications: PartnerApplicationsService) {}

  @PublicLeadRoute()
  @HttpCode(201)
  @Post('applications')
  apply(@Body() dto: PartnerApplicationDto) {
    return this.applications.submit(dto);
  }

  @SensitiveRoute()
  @HttpCode(200)
  @Post('activation/check')
  check(@Body() dto: PartnerInvitationTokenDto) {
    return this.applications.checkInvitation(dto.token);
  }

  @SensitiveRoute()
  @HttpCode(200)
  @Post('activation')
  activate(@Body() dto: PartnerActivationDto) {
    return this.applications.activate(dto.token, dto.password);
  }
}
