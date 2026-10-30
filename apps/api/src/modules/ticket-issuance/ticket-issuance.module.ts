import { Module } from '@nestjs/common';
import { TicketIssuanceService } from './ticket-issuance.service';

/** Émission des billets à la confirmation du paiement (utilisée par le moteur de vente). */
@Module({
  providers: [TicketIssuanceService],
  exports: [TicketIssuanceService],
})
export class TicketIssuanceModule {}
