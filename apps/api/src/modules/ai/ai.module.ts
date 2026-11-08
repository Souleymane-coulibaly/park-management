import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CatalogModule } from '../catalog/catalog.module';
import { RestaurantModule } from '../restaurant/restaurant.module';
import { TicketingModule } from '../ticketing/ticketing.module';
import { AiSettingsController } from './ai-settings.controller';
import { AiUsageService } from './ai-usage.service';
import { CopilotController } from './copilot/copilot.controller';
import { CopilotService } from './copilot/copilot.service';
import { AiImportController } from './imports/ai-import.controller';
import { AiImportService } from './imports/ai-import.service';
import { ParkAiUsageStore } from './park-ai-usage.store';
import { VoiceOrderController } from './voice/voice-order.controller';
import { VoiceOrderService } from './voice/voice-order.service';

/**
 * Intelligence artificielle d'Ocall Park (Sprint 8) : import de carte et de tarifs, copilote analytique
 * en lecture seule, commande vocale. Les appels passent par Ocall AI Core (module global) : Park y
 * inscrit son stockage de consommation et ses scénarios de simulation. Sans fournisseur, les
 * fonctionnalités IA répondent « non activée » et le reste de l'application est inchangé.
 */
@Module({
  imports: [AnalyticsModule, CatalogModule, TicketingModule, RestaurantModule],
  controllers: [AiSettingsController, AiImportController, CopilotController, VoiceOrderController],
  providers: [ParkAiUsageStore, AiUsageService, AiImportService, CopilotService, VoiceOrderService],
})
export class AiModule {}
