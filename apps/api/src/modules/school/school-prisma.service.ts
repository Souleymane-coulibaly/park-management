import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { SchoolPrismaClient } from '@ocall/school-database';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';

/**
 * Client de la base Ocall School. Connexion à la demande, jamais au démarrage : une panne de la base
 * School n'empêche ni l'API de démarrer ni Ocall Park de fonctionner.
 */
@Injectable()
export class SchoolPrismaService extends SchoolPrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      ...(config.school.databaseUrl ? { datasourceUrl: config.school.databaseUrl } : {}),
      transactionOptions: { maxWait: 10_000, timeout: 15_000 },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
