import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { PartnerPortalController, PlatformPartnersController } from './partners.controller';
import { PartnerPortalService } from './partner-portal.service';
import { PartnersAdminService } from './partners-admin.service';

/** Partenaires commerciaux : portail et gestion par le Super Admin (Sprint 12B). */
@Module({
  imports: [PlatformModule],
  controllers: [PlatformPartnersController, PartnerPortalController],
  providers: [PartnersAdminService, PartnerPortalService],
})
export class PartnersModule {}
