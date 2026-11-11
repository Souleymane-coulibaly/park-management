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
import { OcallStockService } from './ocall-stock.service';

/**
 * Domaine Ocall Stock. N'importe aucun module métier d'une autre application (règle vérifiée par un
 * test) : seul le socle commun (identité, organisations, abonnements, stockage, PDF) est partagé. Le seul
 * élément exposé aux autres modules est la lecture du catalogue (`STOCK_CATALOG_READER`, contrat commun).
 */
@Global()
@Module({
  imports: [OrganizationsModule],
  controllers: [OcallStockController, OcallStockCatalogController],
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
    { provide: STOCK_CATALOG_READER, useExisting: OcallStockCatalogReader },
  ],
  exports: [STOCK_CATALOG_READER],
})
export class OcallStockModule {}
