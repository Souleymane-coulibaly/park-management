import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { PasswordService } from './security/password.service';
import { SessionService } from './security/session.service';

@Global()
@Module({
  providers: [AuditService, PasswordService, SessionService],
  exports: [AuditService, PasswordService, SessionService],
})
export class CommonModule {}
