import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import {
  CurrentAuth,
  Public,
  RequirePermission,
  RequirePlatformPermission,
} from '../../common/decorators';
import { PaymentNotifyRoute } from '../../common/throttling';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { OnlinePaymentsService } from './online-payments.service';
import { PAYMENT_PROVIDER, type OnlinePaymentProvider } from './providers/payment-provider';
import { SimulatedPaymentProvider } from './providers/simulated.provider';

const CHANNELS = ['ALL', 'MOBILE_MONEY', 'CREDIT_CARD'] as const;

export class InitiateOnlinePaymentDto {
  @ApiProperty()
  @IsUUID('4')
  invoiceId: string;

  @ApiProperty({ enum: CHANNELS })
  @IsIn(CHANNELS)
  channels: (typeof CHANNELS)[number];
}

export class SimulatedCompleteDto {
  @ApiProperty({ enum: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'PENDING'] })
  @IsIn(['SUCCEEDED', 'FAILED', 'CANCELLED', 'PENDING'])
  outcome: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'PENDING';

  @ApiPropertyOptional({ enum: ['CARD', 'MOBILE_MONEY'] })
  @IsOptional()
  @IsIn(['CARD', 'MOBILE_MONEY'])
  method?: 'CARD' | 'MOBILE_MONEY';

  @ApiPropertyOptional({ description: 'Montant annoncé par le prestataire simulé (tests).' })
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;
}

/** Espace client : factures Ocall et paiement en ligne (Sprint 12A). */
@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly online: OnlinePaymentsService) {}

  @RequirePermission('subscription.read')
  @Get('invoices')
  invoices(@CurrentAuth() auth: AuthContext) {
    return this.online.invoices(requireTenant(auth));
  }

  @RequirePermission('subscription.pay')
  @Post('online-payments')
  initiate(@CurrentAuth() auth: AuthContext, @Body() dto: InitiateOnlinePaymentDto) {
    return this.online.initiate(requireTenant(auth), dto.invoiceId, dto.channels);
  }

  @RequirePermission('subscription.read')
  @Get('online-payments/:reference')
  status(@CurrentAuth() auth: AuthContext, @Param('reference') reference: string) {
    OnlinePaymentsService.assertReference(reference);
    return this.online.status(requireTenant(auth), reference);
  }
}

/**
 * Notifications du prestataire (serveur à serveur) et page de paiement simulée. La notification
 * est publique mais authentifiée par le prestataire, puis revérifiée ; elle ne confirme jamais
 * un paiement à elle seule.
 */
@ApiTags('billing')
@Controller('online-payments')
export class OnlinePaymentsNotifyController {
  constructor(
    private readonly online: OnlinePaymentsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PAYMENT_PROVIDER) private readonly provider: OnlinePaymentProvider | null,
  ) {}

  @Public()
  @PaymentNotifyRoute()
  @HttpCode(200)
  @Post('notify')
  notify(@Headers() headers: Record<string, string>, @Body() body: unknown) {
    return this.online.notify(headers, body);
  }

  /**
   * Page de paiement simulée (hors production) : le client choisit l'issue, puis le simulateur
   * envoie sa notification signée, comme le ferait le prestataire.
   */
  @RequirePermission('subscription.pay')
  @HttpCode(200)
  @Post('simulated/:reference/complete')
  async simulatedComplete(
    @CurrentAuth() auth: AuthContext,
    @Param('reference') reference: string,
    @Body() dto: SimulatedCompleteDto,
  ) {
    if (
      this.config.nodeEnv === 'production' ||
      !(this.provider instanceof SimulatedPaymentProvider)
    ) {
      throw new NotFoundException();
    }
    OnlinePaymentsService.assertReference(reference);
    const tenant = requireTenant(auth);
    const view = await this.online.view(reference).catch(() => null);
    const owned = await this.online.ownedBy(reference, tenant.membership.organizationId);
    if (!view || !owned) throw new NotFoundException();
    if (
      !this.provider.complete(reference, dto.outcome, { method: dto.method, amount: dto.amount })
    ) {
      throw new ForbiddenException({
        code: 'SIMULATION_UNKNOWN',
        message: 'Transaction simulée inconnue.',
      });
    }
    await this.online.notify({ 'x-simulated-token': this.provider.sign(reference) }, { reference });
    return this.online.view(reference);
  }
}

/** Super Admin : suivi des paiements en ligne et revérification manuelle. */
@ApiTags('platform')
@Controller('platform/online-payments')
export class PlatformOnlinePaymentsController {
  constructor(private readonly online: OnlinePaymentsService) {}

  @RequirePlatformPermission('platform.billing.read')
  @Get()
  list(@Query('status') status?: string, @Query('organizationId') organizationId?: string) {
    return this.online.list({ status, organizationId });
  }

  @RequirePlatformPermission('platform.billing.read')
  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.online.detail(id);
  }

  @RequirePlatformPermission('platform.billing.validate')
  @HttpCode(200)
  @Post(':id/recheck')
  recheck(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.online.recheck(id);
  }
}
