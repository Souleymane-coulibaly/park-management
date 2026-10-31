import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { DOMAIN_VERIFIER, createDomainVerifier } from './domain-verifier';
import {
  PlatformSiteDomainsController,
  PublicSitesController,
  SitesController,
} from './sites.controllers';
import { SiteDomainsService } from './site-domains.service';
import { SiteMediaService } from './site-media.service';
import { SitesService } from './sites.service';

/**
 * Sites vitrines publics (Sprint 10) : éditeur, publication, médias, domaines, API publique.
 * Le stockage vient du StorageModule commun ; la vérification des domaines est injectée.
 */
@Module({
  controllers: [SitesController, PublicSitesController, PlatformSiteDomainsController],
  providers: [
    {
      provide: DOMAIN_VERIFIER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createDomainVerifier(process.env, config.nodeEnv),
    },
    SitesService,
    SiteMediaService,
    SiteDomainsService,
  ],
  exports: [SitesService],
})
export class PublicSitesModule {}
