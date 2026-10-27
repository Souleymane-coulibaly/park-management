import { Module } from '@nestjs/common';
import { OrganizationProvisioningService } from './organization-provisioning.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OrganizationProvisioningService],
  exports: [OrganizationProvisioningService],
})
export class OrganizationsModule {}
