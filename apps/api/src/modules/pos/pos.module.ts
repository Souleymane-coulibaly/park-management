import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { CashSessionsService } from './cash-sessions.service';
import { CashSessionsController, PosController, SalesController } from './pos.controllers';
import { SalePricingService } from './sale-pricing.service';
import { SalesService } from './sales.service';

@Module({
  imports: [PaymentsModule],
  controllers: [PosController, CashSessionsController, SalesController],
  providers: [SalePricingService, CashSessionsService, SalesService],
})
export class PosModule {}
