import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { MailService } from './mail/mail.service';
import { PasswordService } from './security/password.service';
import { PortalAccounts } from './security/portal-accounts';
import { SessionService } from './security/session.service';
import { SiteDomainRegistry } from './sites/site-domain-registry';
import { OrganizationReportingRegistry } from './integration/organization-reporting';

@Global()
@Module({
  providers: [
    AuditService,
    PasswordService,
    SessionService,
    PortalAccounts,
    MailService,
    SiteDomainRegistry,
    OrganizationReportingRegistry,
  ],
  exports: [
    AuditService,
    PasswordService,
    SessionService,
    PortalAccounts,
    MailService,
    SiteDomainRegistry,
    OrganizationReportingRegistry,
  ],
})
export class CommonModule {}
