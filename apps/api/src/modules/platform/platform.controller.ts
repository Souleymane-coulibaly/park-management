import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth-context';
import { CurrentAuth, RequirePlatformPermission, SuperAdminOnly } from '../../common/decorators';
import {
  CreateOrganizationByAdminDto,
  RecordSubscriptionPaymentDto,
  RejectSubscriptionPaymentDto,
  SetOrganizationStatusDto,
  SubscriptionPaymentsQueryDto,
  UpdatePlanDto,
  ValidateSubscriptionPaymentDto,
} from './platform.dto';
import { PlatformService } from './platform.service';
import { SaasService } from './saas.service';

@ApiTags('Plateforme (Super Admin)')
@SuperAdminOnly()
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly saas: SaasService,
  ) {}

  @RequirePlatformPermission('platform.dashboard')
  @Get('overview')
  overview() {
    return this.platform.overview();
  }

  @RequirePlatformPermission('platform.orgs.read')
  @Get('organizations')
  organizations() {
    return this.platform.organizations();
  }

  @RequirePlatformPermission('platform.orgs.manage')
  @Post('organizations')
  createOrganization(@CurrentAuth() auth: AuthContext, @Body() dto: CreateOrganizationByAdminDto) {
    return this.platform.createOrganization(auth, dto);
  }

  @RequirePlatformPermission('platform.orgs.manage')
  @Patch('organizations/:id/status')
  setStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOrganizationStatusDto,
  ) {
    return this.platform.setStatus(auth, id, dto);
  }

  @RequirePlatformPermission('platform.billing.read')
  @Get('subscriptions')
  subscriptions() {
    return this.platform.subscriptions();
  }

  @RequirePlatformPermission('platform.orgs.read')
  @Get('plans')
  plans() {
    return this.platform.plans();
  }

  @RequirePlatformPermission('platform.plans.manage')
  @Patch('plans/:id')
  updatePlan(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
  ) {
    return this.platform.updatePlan(auth, id, dto);
  }

  // ─── Sprint 9B : statistiques SaaS et règlements d'abonnement (hors plateforme) ───

  @RequirePlatformPermission('platform.dashboard')
  @Get('saas-stats')
  saasStats() {
    return this.saas.stats();
  }

  @RequirePlatformPermission('platform.billing.read')
  @Get('subscription-payments')
  subscriptionPayments(@Query() query: SubscriptionPaymentsQueryDto) {
    return this.saas.listPayments(query);
  }

  @RequirePlatformPermission('platform.billing.manage')
  @Post('subscription-payments')
  recordSubscriptionPayment(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: RecordSubscriptionPaymentDto,
  ) {
    return this.saas.recordPayment(auth, dto);
  }

  @RequirePlatformPermission('platform.billing.validate')
  @Post('subscription-payments/:id/validate')
  validateSubscriptionPayment(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ValidateSubscriptionPaymentDto,
  ) {
    return this.saas.validatePayment(auth, id, dto);
  }

  @RequirePlatformPermission('platform.billing.validate')
  @Post('subscription-payments/:id/reject')
  rejectSubscriptionPayment(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectSubscriptionPaymentDto,
  ) {
    return this.saas.rejectPayment(auth, id, dto);
  }
}
