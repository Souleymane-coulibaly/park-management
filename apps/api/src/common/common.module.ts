import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { MailService } from './mail/mail.service';
import { PasswordService } from './security/password.service';
import { PortalAccounts } from './security/portal-accounts';
import { SessionService } from './security/session.service';

@Global()
@Module({
  providers: [AuditService, PasswordService, SessionService, PortalAccounts, MailService],
  exports: [AuditService, PasswordService, SessionService, PortalAccounts, MailService],
})
export class CommonModule {}
