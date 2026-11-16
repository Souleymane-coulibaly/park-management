import { Global, Module } from '@nestjs/common';
import { SITE_REGISTRY } from '../../common/integration/site-registry';
import { EstablishmentRegistryService } from './establishment-registry.service';
import { EstablishmentsController } from './establishments.controller';
import { EstablishmentsService } from './establishments.service';
import { SiteActivationService } from './site-activation.service';

/**
 * Établissements de l'organisation. Sprint Suite 2B : référentiel commun des sites, exposé aux
 * applications à base séparée sous le jeton `SITE_REGISTRY` (module global). Étape 6 : activations des
 * applications sur les sites (décompte facturé), `SiteActivationService`.
 */
@Global()
@Module({
  controllers: [EstablishmentsController],
  providers: [
    EstablishmentsService,
    EstablishmentRegistryService,
    { provide: SITE_REGISTRY, useExisting: EstablishmentRegistryService },
    SiteActivationService,
  ],
  exports: [SITE_REGISTRY, SiteActivationService],
})
export class EstablishmentsModule {}
