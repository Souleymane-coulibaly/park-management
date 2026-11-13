import { Global, Module } from '@nestjs/common';
import { STOCK_CATALOG_READER } from '../../common/integration/catalog-integration';
import { OrganizationsModule } from '../organizations/organizations.module';
import { OcallStockAccessGuard } from './ocall-stock-access';
import { OcallStockCatalogReader } from './ocall-stock-catalog-reader';
import { OcallStockCatalogController } from './ocall-stock-catalog.controller';
import { OcallStockCatalogService } from './ocall-stock-catalog.service';
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
 * élément exposé aux autres modules est la lecture du catalogue (`STOCK_CATALOG_READER`, contrat commun).
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
    { provide: STOCK_CATALOG_READER, useExisting: OcallStockCatalogReader },
  ],
  exports: [STOCK_CATALOG_READER],
})
export class OcallStockModule {}
