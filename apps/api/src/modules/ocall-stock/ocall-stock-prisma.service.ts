import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { StockPrismaClient } from '@ocall/stock-database';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';

/**
 * Client de la base Ocall Stock. Connexion à la demande, jamais au démarrage : une panne de la base Stock
 * n'empêche ni l'API de démarrer ni les autres applications de fonctionner.
 */
@Injectable()
export class OcallStockPrismaService extends StockPrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      ...(config.stock.databaseUrl ? { datasourceUrl: config.stock.databaseUrl } : {}),
      transactionOptions: { maxWait: 10_000, timeout: 15_000 },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
