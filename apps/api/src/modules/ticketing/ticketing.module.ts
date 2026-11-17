import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PosModule } from '../pos/pos.module';
import { AccessControlService } from './access-control.service';
import { ParkScheduleService } from './park-schedule.service';
import { PassOffersController, PassesController, PublicPassController } from './pass.controllers';
import { PassOffersService } from './pass-offers.service';
import { PassQrSigner } from './pass-qr';
import { PassesService } from './passes.service';
import { TicketCategoriesService } from './ticket-categories.service';
import { TicketSalesService } from './ticket-sales.service';
import { AccessController, TicketingController, TicketsController } from './ticketing.controllers';
import { TicketingDashboardService } from './ticketing-dashboard.service';
import { TicketsService } from './tickets.service';

/**
 * Billetterie du parc et contrôle d'accès. La vente et le paiement réutilisent le moteur de la caisse
 * (PosModule) ; l'émission des billets au paiement vit dans TicketIssuanceModule (sans dépendance circulaire).
 */
@Module({
  imports: [PosModule],
  controllers: [
    TicketingController,
    TicketsController,
    AccessController,
    PassOffersController,
    PassesController,
    PublicPassController,
  ],
  providers: [
    ParkScheduleService,
    TicketCategoriesService,
    TicketSalesService,
    TicketsService,
    AccessControlService,
    TicketingDashboardService,
    PassOffersService,
    PassesService,
    // Sprint 8 : signature des QR de pass, clé dérivée de la clé du serveur (jamais exposée).
    {
      provide: PassQrSigner,
      useFactory: (config: AppConfig) => new PassQrSigner(config.storageSigningKey),
      inject: [APP_CONFIG],
    },
  ],
  exports: [TicketCategoriesService],
})
export class TicketingModule {}
