import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AiGatewayService } from './ai-gateway.service';
import { AI_PROVIDER, type AiProvider } from './ai-provider';
import { OpenAiProvider } from './providers/openai.provider';
import { SimulatedAiProvider } from './providers/simulated.provider';

/**
 * Ocall AI Core : moteur IA commun à toutes les applications métier d'Ocall Suite (Park, School et
 * les suivantes), dans le monolithe modulaire (aucun service séparé). Il fournit le fournisseur
 * configuré et l'orchestrateur ; chaque application y inscrit son stockage de consommation et ses
 * scénarios de simulation, et garde ses propres données, prompts et outils.
 */
@Global()
@Module({
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
    AiGatewayService,
  ],
  exports: [AI_PROVIDER, AiGatewayService],
})
export class AiCoreModule {}
