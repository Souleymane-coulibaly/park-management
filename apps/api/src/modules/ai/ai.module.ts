import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { CatalogModule } from '../catalog/catalog.module';
import { RestaurantModule } from '../restaurant/restaurant.module';
import { TicketingModule } from '../ticketing/ticketing.module';
import { AiSettingsController } from './ai-settings.controller';
import { AiUsageService } from './ai-usage.service';
import { CopilotController } from './copilot/copilot.controller';
import { CopilotService } from './copilot/copilot.service';
import { AiImportController } from './imports/ai-import.controller';
import { AiImportService } from './imports/ai-import.service';
import { AI_PROVIDER, type AiProvider } from './providers/ai-provider';
import { OpenAiProvider } from './providers/openai.provider';
import { SimulatedAiProvider } from './providers/simulated.provider';
import { VoiceOrderController } from './voice/voice-order.controller';
import { VoiceOrderService } from './voice/voice-order.service';

/**
 * Intelligence artificielle (Sprint 8) : import de carte et de tarifs, copilote analytique en
 * lecture seule, commande vocale. Le fournisseur est choisi par la configuration ; sans fournisseur,
 * les fonctionnalités IA répondent « non activée » et le reste de l'application est inchangé.
 */
@Module({
  imports: [CatalogModule, TicketingModule, RestaurantModule],
  controllers: [AiSettingsController, AiImportController, CopilotController, VoiceOrderController],
  providers: [
    {
      provide: AI_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): AiProvider | null => {
        if (config.ai.provider === 'simulated') return new SimulatedAiProvider();
        if (config.ai.provider === 'openai' && config.ai.openaiApiKey) {
          return new OpenAiProvider(config.ai.openaiApiKey, config.ai.timeoutMs);
        }
        return null;
      },
    },
    AiUsageService,
    AiImportService,
    CopilotService,
    VoiceOrderService,
  ],
})
export class AiModule {}
