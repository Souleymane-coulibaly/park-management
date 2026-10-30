import { Global, Module } from '@nestjs/common';
import { RestaurantEventsService } from './restaurant-events.service';

/** Bus temps réel partagé par le moteur de vente (paiement, annulation) et le module restaurant. */
@Global()
@Module({
  providers: [RestaurantEventsService],
  exports: [RestaurantEventsService],
})
export class RealtimeModule {}
