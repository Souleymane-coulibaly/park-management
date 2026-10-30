import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@ocall/database';

/** Client Prisma unique de l'application, connecté au démarrage du module. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // Délais explicites des transactions interactives (défaut Prisma : 5 s). Un encaissement de billetterie
    // enchaîne une douzaine d'allers-retours : sur un réseau lent, 5 s faisaient échouer un paiement valide.
    // Les verrous de ligne restent bornés : au-delà de 15 s, la transaction est annulée.
    super({ transactionOptions: { maxWait: 10_000, timeout: 15_000 } });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
