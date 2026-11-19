import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrintPrismaClient } from '@ocall/print-database';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';

/**
 * Client de la base Ocall Print. Connexion à la demande, jamais au démarrage : une panne de la base Print
 * n'empêche ni l'API de démarrer ni les autres applications de fonctionner.
 */
@Injectable()
export class PrintPrismaService extends PrintPrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      ...(config.print.databaseUrl ? { datasourceUrl: config.print.databaseUrl } : {}),
      transactionOptions: { maxWait: 10_000, timeout: 20_000 },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
