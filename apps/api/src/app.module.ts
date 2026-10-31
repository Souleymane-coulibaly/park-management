import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './common/storage/storage.module';
import { SupportModule } from './modules/support/support.module';
import { OnlinePaymentsModule } from './modules/online-payments/online-payments.module';
import { CommercialModule } from './modules/commercial/commercial.module';
import { PartnersModule } from './modules/partners/partners.module';
import { CommonModule } from './common/common.module';
import { AuthGuard } from './common/guards/auth.guard';
import { OriginGuard } from './common/guards/origin.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { throttlerOptions } from './common/throttling';
import { AiModule } from './modules/ai/ai.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { PublicSitesModule } from './modules/public-sites/public-sites.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CrmModule } from './modules/crm/crm.module';
import { BusinessModulesModule } from './modules/business-modules/business-modules.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { EstablishmentsModule } from './modules/establishments/establishments.module';
import { HardwareModule } from './modules/hardware/hardware.module';
import { HealthController } from './modules/health/health.controller';
import { KioskModule } from './modules/kiosk/kiosk.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PlatformModule } from './modules/platform/platform.module';
import { PlanningModule } from './modules/planning/planning.module';
import { PosModule } from './modules/pos/pos.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { ReservationsModule } from './modules/reservations/reservations.module';
import { RestaurantModule } from './modules/restaurant/restaurant.module';
import { RolesModule } from './modules/roles/roles.module';
import { StockModule } from './modules/stock/stock.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { TicketingModule } from './modules/ticketing/ticketing.module';

@Module({
  imports: [
    ConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => throttlerOptions(config),
    }),
    PrismaModule,
    CommonModule,
    StorageModule,
    RealtimeModule,
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
    PaymentsModule,
    CatalogModule,
    PosModule,
    HardwareModule,
    TicketingModule,
    RestaurantModule,
    StockModule,
    ReservationsModule,
    KioskModule,
    CrmModule,
    LoyaltyModule,
    PlanningModule,
    AiModule,
    AnalyticsModule,
    PublicSitesModule,
    SupportModule,
    OnlinePaymentsModule,
    CommercialModule,
    PartnersModule,
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
