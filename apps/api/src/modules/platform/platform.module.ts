import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { SubscriptionPaymentsController } from './payments.controller';
import { SubscriptionPaymentsService } from './payments.service';
import { SaasService } from './saas.service';
import { SubscriptionAdminController } from './subscription-admin.controller';
import { SubscriptionAdminService } from './subscription-admin.service';
import { SuiteController } from './suite.controller';
import { SuiteService } from './suite.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [
    PlatformController,
    SuiteController,
    OperationsController,
    SubscriptionPaymentsController,
    SubscriptionAdminController,
  ],
  providers: [
    PlatformService,
    SaasService,
    SuiteService,
    OperationsService,
    SubscriptionPaymentsService,
    SubscriptionAdminService,
  ],
  exports: [SubscriptionPaymentsService],
})
export class PlatformModule {}
