import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { SaasService } from './saas.service';
import { SuiteController } from './suite.controller';
import { SuiteService } from './suite.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [PlatformController, SuiteController, OperationsController],
  providers: [PlatformService, SaasService, SuiteService, OperationsService],
})
export class PlatformModule {}
