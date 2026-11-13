import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { FactureAccessGuard } from './facture-access';
import { FactureAiPlanningService } from './facture-ai-planning.service';
import { FactureAiUsageStore } from './facture-ai-usage.store';
import { FactureAiController } from './facture-ai.controller';
import { FactureAiService } from './facture-ai.service';
import { FactureBillingController } from './facture-billing.controller';
import { FactureBillingService } from './facture-billing.service';
import { FactureClientsService } from './facture-clients.service';
import { FactureCommercialController } from './facture-commercial.controller';
import { FactureDocumentsService } from './facture-documents.service';
import { FactureInterventionsController } from './facture-interventions.controller';
import { FactureInterventionsService } from './facture-interventions.service';
import { FactureMembersService } from './facture-members.service';
import { FactureNotificationsController } from './facture-notifications.controller';
import { FactureNotificationsService } from './facture-notifications.service';
import { FacturePrismaService } from './facture-prisma.service';
import { FACTURE_DOMAIN_VERIFIER, FactureSiteDomainsService } from './facture-site-domains.service';
import {
  FactureSiteController,
  PlatformFactureSiteDomainsController,
  PublicFactureRequestsController,
  PublicFactureSitesController,
} from './facture-site.controller';
import { FactureSiteService } from './facture-site.service';
import { createDomainVerifier } from '../../common/sites/domain-verifier';
import { FactureSkillsController } from './facture-skills.controller';
import { FactureSkillsService } from './facture-skills.service';
import { FactureStockCatalogService } from './facture-stock-catalog.service';
import { FactureStockController } from './facture-stock.controller';
import { FactureStockService } from './facture-stock.service';
import {
  DisabledWhatsAppProvider,
  FACTURE_WHATSAPP_PROVIDER,
  SimulatedWhatsAppProvider,
} from './facture-whatsapp.provider';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { FactureController } from './facture.controller';
import { FactureService } from './facture.service';

/**
 * Domaine Ocall Facture. N'importe aucun module métier Ocall Park ni Ocall School (règle vérifiée par un
 * test) : seuls le socle commun (identité, organisations, abonnements, stockage, PDF) est partagé.
 */
@Module({
  imports: [OrganizationsModule],
  controllers: [
    FactureController,
    FactureCommercialController,
    FactureBillingController,
    FactureInterventionsController,
    FactureNotificationsController,
    FactureAiController,
    FactureSkillsController,
    FactureSiteController,
    PublicFactureSitesController,
    PublicFactureRequestsController,
    PlatformFactureSiteDomainsController,
    FactureStockController,
  ],
  providers: [
    FacturePrismaService,
    FactureAccessGuard,
    FactureService,
    FactureMembersService,
    FactureClientsService,
    FactureDocumentsService,
    FactureBillingService,
    FactureInterventionsService,
    FactureNotificationsService,
    FactureAiUsageStore,
    FactureAiService,
    FactureAiPlanningService,
    FactureSkillsService,
    FactureSiteService,
    FactureSiteDomainsService,
    FactureStockService,
    FactureStockCatalogService,
    // Vérification des domaines personnalisés : même vérificateur que les sites Park (simulé en test).
    {
      provide: FACTURE_DOMAIN_VERIFIER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createDomainVerifier(process.env, config.nodeEnv),
    },
    // WhatsApp : simulé en test, désactivé sinon, tant qu'aucun fournisseur réel n'est choisi.
    {
      provide: FACTURE_WHATSAPP_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.facture.whatsapp === 'simulated'
          ? new SimulatedWhatsAppProvider()
          : new DisabledWhatsAppProvider(),
    },
  ],
})
export class FactureModule {}
