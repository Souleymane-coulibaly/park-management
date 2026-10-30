import { Module } from '@nestjs/common';
import { PosModule } from '../pos/pos.module';
import { AccessControlService } from './access-control.service';
import { ParkScheduleService } from './park-schedule.service';
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
  controllers: [TicketingController, TicketsController, AccessController],
  providers: [
    ParkScheduleService,
    TicketCategoriesService,
    TicketSalesService,
    TicketsService,
    AccessControlService,
    TicketingDashboardService,
  ],
})
export class TicketingModule {}
