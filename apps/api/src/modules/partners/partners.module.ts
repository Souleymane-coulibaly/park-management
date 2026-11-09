import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { SuiteCommercialModule } from '../suite-commercial/suite-commercial.module';
import {
  PartnerPortalController,
  PlatformPartnersController,
  PublicPartnersController,
} from './partners.controller';
import { PartnerApplicationsService } from './partner-applications.service';
import { PartnerPortalService } from './partner-portal.service';
import { PartnersAdminService } from './partners-admin.service';

/**
 * Partenaires commerciaux : portail et gestion par le Super Admin (Sprint 12B), Ocall Partner
 * (Sprint S3 : candidatures publiques, invitations, revendeurs, CRM, demandes de règlement).
 */
@Module({
  imports: [PlatformModule, SuiteCommercialModule],
  controllers: [PlatformPartnersController, PartnerPortalController, PublicPartnersController],
  providers: [PartnersAdminService, PartnerPortalService, PartnerApplicationsService],
})
export class PartnersModule {}
