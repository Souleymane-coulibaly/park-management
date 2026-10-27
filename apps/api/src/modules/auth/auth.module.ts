import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoggingPasswordResetNotifier, PASSWORD_RESET_NOTIFIER } from './password-reset-notifier';

@Module({
  imports: [OrganizationsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: PASSWORD_RESET_NOTIFIER, useClass: LoggingPasswordResetNotifier },
  ],
})
export class AuthModule {}
