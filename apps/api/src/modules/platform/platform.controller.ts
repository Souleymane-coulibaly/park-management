import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth-context';
import { CurrentAuth, SuperAdminOnly } from '../../common/decorators';
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

  @Get('overview')
  overview() {
    return this.platform.overview();
  }

  @Get('organizations')
  organizations() {
    return this.platform.organizations();
  }

  @Post('organizations')
  createOrganization(@CurrentAuth() auth: AuthContext, @Body() dto: CreateOrganizationByAdminDto) {
    return this.platform.createOrganization(auth, dto);
  }

  @Patch('organizations/:id/status')
  setStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOrganizationStatusDto,
  ) {
    return this.platform.setStatus(auth, id, dto);
  }

  @Get('subscriptions')
  subscriptions() {
    return this.platform.subscriptions();
  }

  @Get('plans')
  plans() {
    return this.platform.plans();
  }

  @Patch('plans/:id')
  updatePlan(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
  ) {
    return this.platform.updatePlan(auth, id, dto);
  }

  // ─── Sprint 9B : statistiques SaaS et règlements d'abonnement (hors plateforme) ───

  @Get('saas-stats')
  saasStats() {
    return this.saas.stats();
  }

  @Get('subscription-payments')
  subscriptionPayments(@Query() query: SubscriptionPaymentsQueryDto) {
    return this.saas.listPayments(query);
  }

  @Post('subscription-payments')
  recordSubscriptionPayment(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: RecordSubscriptionPaymentDto,
  ) {
    return this.saas.recordPayment(auth, dto);
  }

  @Post('subscription-payments/:id/validate')
  validateSubscriptionPayment(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ValidateSubscriptionPaymentDto,
  ) {
    return this.saas.validatePayment(auth, id, dto);
  }

  @Post('subscription-payments/:id/reject')
  rejectSubscriptionPayment(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectSubscriptionPaymentDto,
  ) {
    return this.saas.rejectPayment(auth, id, dto);
  }
}
