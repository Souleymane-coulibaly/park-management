import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SuiteContractsModule } from '../suite-contracts/suite-contracts.module';
import {
  SuiteCommercialAdminController,
  SuiteCommercialController,
} from './suite-commercial.controller';
import { SuiteCommercialService } from './suite-commercial.service';

/** Socle commercial Ocall Suite (Sprint S1). */
@Module({
  imports: [SuiteContractsModule, OrganizationsModule],
  controllers: [SuiteCommercialController, SuiteCommercialAdminController],
  providers: [SuiteCommercialService],
  exports: [SuiteCommercialService],
})
export class SuiteCommercialModule {}
