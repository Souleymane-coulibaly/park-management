import { Global, Module } from '@nestjs/common';
import { PRINT_GATEWAY } from '../../common/integration/print-gateway';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrintAccessGuard } from './print-access';
import { PrintCardsService } from './print-cards.service';
import { PrintGatewayService } from './print-gateway.service';
import { PrintOrdersService } from './print-orders.service';
import { PrintPersonsService } from './print-persons.service';
import { PrintPlatformController, PrintEnabledGuard } from './print-platform.controller';
import { PrintPrismaService } from './print-prisma.service';
import { PrintProductionService } from './print-production.service';
import { PrintQrSigner } from './print-qr';
import { PrintRetentionService } from './print-retention.service';
import { PrintTemplatesService } from './print-templates.service';
import { PrintController } from './print.controller';

/**
 * Domaine Ocall Print : moteur COMMUN des cartes (School, Parc, Sabatii, accès autonome). N'importe aucun
 * module métier d'une autre application (règle vérifiée par un test) ; le seul élément exposé aux autres
 * modules est le contrat `PRINT_GATEWAY` (common/integration/print-gateway.ts).
 */
@Global()
@Module({
  controllers: [PrintController, PrintPlatformController],
  providers: [
    PrintPrismaService,
    PrintAccessGuard,
    PrintEnabledGuard,
    {
      provide: PrintQrSigner,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new PrintQrSigner(config.storageSigningKey),
    },
    PrintTemplatesService,
    PrintCardsService,
    PrintOrdersService,
    PrintPersonsService,
    PrintProductionService,
    PrintRetentionService,
    PrintGatewayService,
    { provide: PRINT_GATEWAY, useExisting: PrintGatewayService },
  ],
  exports: [PRINT_GATEWAY],
})
export class OcallPrintModule {}
