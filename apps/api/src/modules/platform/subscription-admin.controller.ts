import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import type { AuthContext } from '../../common/auth-context';
import { CurrentAuth, RequirePlatformPermission } from '../../common/decorators';
import { ReasonDto } from './payments.dto';
import { SubscriptionAdminService } from './subscription-admin.service';

export class ChangePlanDto extends ReasonDto {
  @ApiProperty()
  @IsUUID('4')
  planId: string;
}

/** Actions d'administration des abonnements (Sprint 12A), toutes motivées et journalisées. */
@ApiTags('platform')
@Controller('platform/subscriptions')
export class SubscriptionAdminController {
  constructor(private readonly subscriptions: SubscriptionAdminService) {}

  /** Étape 6 : aperçu de la séparation Parc / Restaurant des contrats en cours (aucune écriture). */
  @RequirePlatformPermission('platform.billing.read')
  @Get('park-restaurant-split')
  parkRestaurantSplit() {
    return this.subscriptions.parkRestaurantSplit();
  }

  /** Étape 6 : sites facturés d'un abonnement par site. */
  @RequirePlatformPermission('platform.billing.read')
  @Get(':id/sites')
  sites(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptions.sites(id);
  }

  @RequirePlatformPermission('platform.billing.read')
  @Get(':id/history')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptions.history(id);
  }

  @RequirePlatformPermission('platform.subscriptions.manage')
  @HttpCode(200)
  @Post('expire-due')
  expireDue() {
    return this.subscriptions.expireDue();
  }

  @RequirePlatformPermission('platform.subscriptions.manage')
  @HttpCode(200)
  @Post(':id/suspend')
  suspend(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.subscriptions.suspend(auth, id, dto.reason);
  }

  @RequirePlatformPermission('platform.subscriptions.manage')
  @HttpCode(200)
  @Post(':id/reactivate')
  reactivate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.subscriptions.reactivate(auth, id, dto.reason);
  }

  @RequirePlatformPermission('platform.subscriptions.manage')
  @HttpCode(200)
  @Post(':id/cancel')
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.subscriptions.cancel(auth, id, dto.reason);
  }

  @RequirePlatformPermission('platform.subscriptions.manage')
  @HttpCode(200)
  @Post(':id/change-plan')
  changePlan(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangePlanDto,
  ) {
    return this.subscriptions.changePlan(auth, id, dto.planId, dto.reason);
  }
}
