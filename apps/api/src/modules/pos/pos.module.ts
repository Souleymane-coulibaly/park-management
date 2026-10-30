import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { TicketIssuanceModule } from '../ticket-issuance/ticket-issuance.module';
import { CashSessionsService } from './cash-sessions.service';
import { CashSessionsController, PosController, SalesController } from './pos.controllers';
import { SalePricingService } from './sale-pricing.service';
import { SalesService } from './sales.service';

@Module({
  imports: [PaymentsModule, TicketIssuanceModule],
  controllers: [PosController, CashSessionsController, SalesController],
  providers: [SalePricingService, CashSessionsService, SalesService],
  // Le moteur de vente est réutilisé par la billetterie (module Parc).
  exports: [SalesService],
})
export class PosModule {}
