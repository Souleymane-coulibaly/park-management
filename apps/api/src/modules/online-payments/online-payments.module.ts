import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PlatformModule } from '../platform/platform.module';
import {
  BillingController,
  OnlinePaymentsNotifyController,
  PlatformOnlinePaymentsController,
} from './online-payments.controller';
import { OnlinePaymentsService } from './online-payments.service';
import { PAYMENT_PROVIDER } from './providers/payment-provider';
import { SimulatedPaymentProvider } from './providers/simulated.provider';

/**
 * Paiement en ligne des factures SaaS (Sprint 12A). Le prestataire est choisi par configuration ;
 * `none` (défaut) laisse le paiement en ligne indisponible sans rien casser.
 */
@Module({
  imports: [PlatformModule],
  controllers: [
    BillingController,
    OnlinePaymentsNotifyController,
    PlatformOnlinePaymentsController,
  ],
  providers: [
    OnlinePaymentsService,
    {
      provide: PAYMENT_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.onlinePayments.provider === 'simulated'
          ? new SimulatedPaymentProvider(config.storageSigningKey, config.onlinePayments.webAppUrl)
          : null,
    },
  ],
})
export class OnlinePaymentsModule {}
