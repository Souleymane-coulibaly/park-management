import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlatformPermission, hasPlatformPermission } from '@ocall/shared';
import type { AuthContext } from '../../common/auth-context';
import { CurrentAuth, RequirePlatformPermission } from '../../common/decorators';
import {
  DeclareRemittanceDto,
  DeclareSubscriptionPaymentDto,
  PaymentsQueryDto,
  ReasonDto,
  ReconciliationQueryDto,
} from './payments.dto';
import { SubscriptionPaymentsService } from './payments.service';

/**
 * Règlements des abonnements SaaS (Sprint 12A) : déclaration (virement ou espèces), confirmation à
 * quatre yeux, rejet, annulation, remboursement, décisions d'activation, remises d'espèces.
 */
@ApiTags('platform')
@Controller('platform')
export class SubscriptionPaymentsController {
  constructor(private readonly payments: SubscriptionPaymentsService) {}

  @RequirePlatformPermission('platform.billing.read')
  @Get('subscription-payments')
  list(@Query() query: PaymentsQueryDto) {
    return this.payments.list(query);
  }

  @RequirePlatformPermission('platform.billing.read')
  @Get('subscription-payments/pending-activations')
  async pendingActivations() {
    return { count: await this.payments.pendingActivations() };
  }

  @RequirePlatformPermission('platform.billing.manage')
  @Post('subscription-payments')
  declareTransfer(@CurrentAuth() auth: AuthContext, @Body() dto: DeclareSubscriptionPaymentDto) {
    if (dto.method !== 'MANUAL_TRANSFER') {
      throw new BadRequestException({
        code: 'METHOD_ROUTE_MISMATCH',
        message: 'Espèces : utilisez la déclaration de collecte.',
      });
    }
    return this.payments.declare(auth, dto);
  }

  @RequirePlatformPermission('platform.billing.cash.declare')
  @Post('subscription-payments/cash')
  declareCash(@CurrentAuth() auth: AuthContext, @Body() dto: DeclareSubscriptionPaymentDto) {
    if (dto.method !== 'CASH') {
      throw new BadRequestException({
        code: 'METHOD_ROUTE_MISMATCH',
        message: 'Cette route enregistre uniquement des espèces.',
      });
    }
    return this.payments.declare(auth, dto);
  }

  @RequirePlatformPermission('platform.billing.validate')
  @HttpCode(200)
  @Post('subscription-payments/:id/confirm')
  confirm(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.confirm(auth, id);
  }

  @RequirePlatformPermission('platform.billing.validate')
  @HttpCode(200)
  @Post('subscription-payments/:id/reject')
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.payments.reject(auth, id, dto.reason);
  }

  /** Le déclarant annule sa propre déclaration ; un validateur peut annuler toute déclaration. */
  @RequirePlatformPermission('platform.billing.read')
  @HttpCode(200)
  @Post('subscription-payments/:id/cancel')
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    const canValidate = hasPlatformPermission(
      auth.user.platformRole,
      PlatformPermission.BILLING_VALIDATE,
    );
    const canDeclare =
      canValidate ||
      hasPlatformPermission(auth.user.platformRole, PlatformPermission.BILLING_MANAGE) ||
      hasPlatformPermission(auth.user.platformRole, PlatformPermission.CASH_DECLARE);
    if (!canDeclare) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Action réservée aux déclarants et validateurs.',
      });
    }
    return this.payments.cancel(auth, id, dto.reason, canValidate);
  }

  @RequirePlatformPermission('platform.billing.validate')
  @HttpCode(200)
  @Post('subscription-payments/:id/refund')
  refund(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.payments.refund(auth, id, dto.reason);
  }

  @RequirePlatformPermission('platform.activations.approve')
  @HttpCode(200)
  @Post('subscription-payments/:id/approve-activation')
  approveActivation(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.approveActivation(auth, id);
  }

  @RequirePlatformPermission('platform.activations.approve')
  @HttpCode(200)
  @Post('subscription-payments/:id/refuse-activation')
  refuseActivation(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.payments.refuseActivation(auth, id, dto.reason);
  }

  // ─── Remises d'espèces ───

  @RequirePlatformPermission('platform.billing.read')
  @Get('cash-remittances')
  remittances() {
    return this.payments.listRemittances();
  }

  @RequirePlatformPermission('platform.billing.read')
  @Get('cash-remittances/reconciliation')
  reconciliation(@Query() query: ReconciliationQueryDto) {
    return this.payments.reconciliation(query);
  }

  @RequirePlatformPermission('platform.billing.cash.declare')
  @Post('cash-remittances')
  declareRemittance(@CurrentAuth() auth: AuthContext, @Body() dto: DeclareRemittanceDto) {
    return this.payments.declareRemittance(auth, dto);
  }

  @RequirePlatformPermission('platform.billing.validate')
  @HttpCode(200)
  @Post('cash-remittances/:id/confirm')
  confirmRemittance(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.confirmRemittance(auth, id);
  }

  @RequirePlatformPermission('platform.billing.validate')
  @HttpCode(200)
  @Post('cash-remittances/:id/reject')
  rejectRemittance(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.payments.rejectRemittance(auth, id, dto.reason);
  }
}
