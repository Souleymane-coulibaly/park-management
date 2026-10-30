import { Module } from '@nestjs/common';
import { StockConsumptionService } from './stock-consumption.service';

/** Déduction des ingrédients (utilisée par le moteur de vente et par l'envoi en cuisine). */
@Module({
  providers: [StockConsumptionService],
  exports: [StockConsumptionService],
})
export class StockConsumptionModule {}
