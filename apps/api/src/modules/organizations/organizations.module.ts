import { Module } from '@nestjs/common';
import { OrganizationProvisioningService } from './organization-provisioning.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { ProductUserAccountsService } from './product-user-accounts.service';

@Module({
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OrganizationProvisioningService, ProductUserAccountsService],
  exports: [OrganizationProvisioningService, ProductUserAccountsService],
})
export class OrganizationsModule {}
