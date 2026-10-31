import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { LoggingPasswordResetNotifier, PASSWORD_RESET_NOTIFIER } from './password-reset-notifier';

@Module({
  imports: [OrganizationsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    MfaService,
    {
      provide: PASSWORD_RESET_NOTIFIER,
      useFactory: () => new LoggingPasswordResetNotifier(process.env.NODE_ENV),
    },
  ],
})
export class AuthModule {}
