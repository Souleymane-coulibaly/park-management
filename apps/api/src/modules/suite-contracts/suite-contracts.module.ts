import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SuiteContractsController, SuitePortalController } from './suite-contracts.controller';
import { SuiteContractsService } from './suite-contracts.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [SuiteContractsController, SuitePortalController],
  providers: [SuiteContractsService],
  exports: [SuiteContractsService],
})
export class SuiteContractsModule {}
