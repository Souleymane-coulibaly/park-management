import { Module } from '@nestjs/common';
import { LoyaltyEarningModule } from '../loyalty-earning/loyalty-earning.module';
import { PaymentsModule } from '../payments/payments.module';
import { StockConsumptionModule } from '../stock-consumption/stock-consumption.module';
import { TicketIssuanceModule } from '../ticket-issuance/ticket-issuance.module';
import { CashSessionsService } from './cash-sessions.service';
import { CashSessionsController, PosController, SalesController } from './pos.controllers';
import { SalePricingService } from './sale-pricing.service';
import { SalesService } from './sales.service';

@Module({
  imports: [PaymentsModule, TicketIssuanceModule, StockConsumptionModule, LoyaltyEarningModule],
  controllers: [PosController, CashSessionsController, SalesController],
  providers: [SalePricingService, CashSessionsService, SalesService],
  // Le moteur de vente est réutilisé par la billetterie (Parc) et par les commandes du restaurant.
  exports: [SalesService, SalePricingService, StockConsumptionModule, LoyaltyEarningModule],
})
export class PosModule {}
