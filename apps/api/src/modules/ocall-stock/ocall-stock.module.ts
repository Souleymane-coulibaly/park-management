import { Global, Module } from '@nestjs/common';
import { STOCK_CATALOG_READER } from '../../common/integration/catalog-integration';
import { STOCK_MOVEMENT_GATEWAY } from '../../common/integration/stock-movements';
import { OrganizationsModule } from '../organizations/organizations.module';
import { OcallStockAccessGuard } from './ocall-stock-access';
import { OcallStockCatalogReader } from './ocall-stock-catalog-reader';
import { OcallStockCatalogController } from './ocall-stock-catalog.controller';
import { OcallStockCatalogService } from './ocall-stock-catalog.service';
import { OcallStockFactureGateway } from './ocall-stock-facture-gateway';
import { OcallStockLabelsService } from './ocall-stock-labels.service';
import { OcallStockMediaService } from './ocall-stock-media.service';
import { OcallStockMembersService } from './ocall-stock-members.service';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';
import { OcallStockSearchService } from './ocall-stock-search.service';
import { OcallStockSuppliersService } from './ocall-stock-suppliers.service';
import { OcallStockController } from './ocall-stock.controller';
import { OcallStockCountsService } from './ocall-stock-counts.service';
import { OcallStockLedgerService } from './ocall-stock-ledger.service';
import { OcallStockMovementsService } from './ocall-stock-movements.service';
import { OcallStockSitesService } from './ocall-stock-sites.service';
import { OcallStockTransfersService } from './ocall-stock-transfers.service';
import { OcallStockWarehouseController } from './ocall-stock-warehouse.controller';
import { OcallStockDocumentsService } from './ocall-stock-documents.service';
import { OcallStockAiUsageStore } from './ocall-stock-ai-usage.store';
import { OcallStockAiController } from './ocall-stock-ai.controller';
import { OcallStockAiService } from './ocall-stock-ai.service';
import { OcallStockReportsController } from './ocall-stock-reports.controller';
import {
  OcallStockShowcaseDomainsService,
  STOCK_DOMAIN_VERIFIER,
} from './ocall-stock-showcase-domains.service';
import {
  OcallStockShowcaseController,
  PlatformStockShowcaseDomainsController,
  PublicStockShowcaseController,
  PublicStockShowcaseRequestsController,
} from './ocall-stock-showcase.controller';
import { OcallStockShowcaseService } from './ocall-stock-showcase.service';
import { createDomainVerifier } from '../../common/sites/domain-verifier';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { OcallStockReportsService } from './ocall-stock-reports.service';
import { OcallStockPurchasesController } from './ocall-stock-purchases.controller';
import { OcallStockPurchasesService } from './ocall-stock-purchases.service';
import { OcallStockReturnsService } from './ocall-stock-returns.service';
import { OcallStockCustomersService } from './ocall-stock-customers.service';
import { OcallStockPosController } from './ocall-stock-pos.controller';
import { OcallStockRegistersService } from './ocall-stock-registers.service';
import { OcallStockSalesService } from './ocall-stock-sales.service';
import { OcallStockService } from './ocall-stock.service';

/**
 * Domaine Ocall Stock. N'importe aucun module métier d'une autre application (règle vérifiée par un
 * test) : seul le socle commun (identité, organisations, abonnements, stockage, PDF) est partagé. Le seul
 * élément exposé aux autres modules : les contrats communs de lecture du catalogue (`STOCK_CATALOG_READER`)
 * et de demandes de mouvement (`STOCK_MOVEMENT_GATEWAY`, S5).
 */
@Global()
@Module({
  imports: [OrganizationsModule],
  controllers: [
    OcallStockController,
    OcallStockCatalogController,
    OcallStockWarehouseController,
    OcallStockPurchasesController,
    OcallStockPosController,
    OcallStockReportsController,
    OcallStockShowcaseController,
    PublicStockShowcaseController,
    PublicStockShowcaseRequestsController,
    PlatformStockShowcaseDomainsController,
    OcallStockAiController,
  ],
  providers: [
    OcallStockPrismaService,
    OcallStockAccessGuard,
    OcallStockService,
    OcallStockMembersService,
    OcallStockCatalogService,
    OcallStockMediaService,
    OcallStockSuppliersService,
    OcallStockSearchService,
    OcallStockLabelsService,
    OcallStockCatalogReader,
    OcallStockLedgerService,
    OcallStockSitesService,
    OcallStockMovementsService,
    OcallStockTransfersService,
    OcallStockCountsService,
    OcallStockPurchasesService,
    OcallStockReturnsService,
    OcallStockDocumentsService,
    OcallStockRegistersService,
    OcallStockSalesService,
    OcallStockCustomersService,
    OcallStockFactureGateway,
    OcallStockReportsService,
    OcallStockShowcaseService,
    OcallStockShowcaseDomainsService,
    OcallStockAiUsageStore,
    OcallStockAiService,
    // Vérification des domaines personnalisés : même vérificateur que les sites Park (simulé en test).
    {
      provide: STOCK_DOMAIN_VERIFIER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createDomainVerifier(process.env, config.nodeEnv),
    },
    { provide: STOCK_CATALOG_READER, useExisting: OcallStockCatalogReader },
    { provide: STOCK_MOVEMENT_GATEWAY, useExisting: OcallStockFactureGateway },
  ],
  exports: [STOCK_CATALOG_READER, STOCK_MOVEMENT_GATEWAY],
})
export class OcallStockModule {}
