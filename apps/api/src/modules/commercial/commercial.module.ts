import { Module } from '@nestjs/common';
import {
  PlatformDemoRequestsController,
  PublicCommercialController,
} from './commercial.controller';
import { CommercialService } from './commercial.service';

/** Site commercial Ocall Suite : catalogue public, demandes de démonstration (Sprint 12A). */
@Module({
  controllers: [PublicCommercialController, PlatformDemoRequestsController],
  providers: [CommercialService],
  exports: [CommercialService],
})
export class CommercialModule {}
