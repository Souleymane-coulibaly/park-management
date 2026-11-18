import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { LegalIdentityService } from './legal-identity.service';
import { OcallBillingDocumentsService } from './ocall-billing-documents.service';
import {
  ClientBillingDocumentsController,
  OcallLegalController,
  PublicLegalIdentityController,
} from './ocall-legal.controller';
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
    OcallLegalController,
    ClientBillingDocumentsController,
    PublicLegalIdentityController,
  ],
  providers: [
    PlatformService,
    SaasService,
    SuiteService,
    OperationsService,
    SubscriptionPaymentsService,
    SubscriptionAdminService,
    LegalIdentityService,
    OcallBillingDocumentsService,
  ],
  exports: [SubscriptionPaymentsService],
})
export class PlatformModule {}
