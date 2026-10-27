import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuthGuard } from './common/guards/auth.guard';
import { OriginGuard } from './common/guards/origin.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { throttlerOptions } from './common/throttling';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BusinessModulesModule } from './modules/business-modules/business-modules.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { EstablishmentsModule } from './modules/establishments/establishments.module';
import { HealthController } from './modules/health/health.controller';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { PlatformModule } from './modules/platform/platform.module';
import { RolesModule } from './modules/roles/roles.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';

@Module({
  imports: [
    ConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => throttlerOptions(config),
    }),
    PrismaModule,
    CommonModule,
    AuthModule,
    OrganizationsModule,
    EstablishmentsModule,
    EmployeesModule,
    RolesModule,
    SubscriptionsModule,
    AuditModule,
    BusinessModulesModule,
    DashboardModule,
    PlatformModule,
  ],
  controllers: [HealthController],
  providers: [
    // Ordre d'exécution : anti-rejeu, origine (CSRF), authentification, puis RBAC.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
