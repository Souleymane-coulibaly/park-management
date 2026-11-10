import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { FacturePrismaClient } from '@ocall/facture-database';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';

/**
 * Client de la base Ocall Facture. Connexion à la demande, jamais au démarrage : une panne de la base
 * Facture n'empêche ni l'API de démarrer ni Ocall Park et Ocall School de fonctionner.
 */
@Injectable()
export class FacturePrismaService extends FacturePrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      ...(config.facture.databaseUrl ? { datasourceUrl: config.facture.databaseUrl } : {}),
      transactionOptions: { maxWait: 10_000, timeout: 15_000 },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
