import { Module } from '@nestjs/common';
import { LoyaltyEarningService } from './loyalty-earning.service';

/** Crédit et annulation des points de fidélité, appelés par le moteur de vente. */
@Module({
  providers: [LoyaltyEarningService],
  exports: [LoyaltyEarningService],
})
export class LoyaltyEarningModule {}
