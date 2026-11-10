import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CurrentFacture,
  FactureAccessGuard,
  type FactureContext,
  RequireFacturePermission,
} from './facture-access';
import { FactureNotificationSettingsDto } from './facture-notifications.dto';
import { FactureNotificationsService } from './facture-notifications.service';

/** Ocall Facture — réglages des notifications de rendez-vous (F4). */
@ApiTags('Ocall Facture')
@UseGuards(FactureAccessGuard)
@Controller('facture')
export class FactureNotificationsController {
  constructor(private readonly notifications: FactureNotificationsService) {}

  @RequireFacturePermission('facture.access')
  @Get('notification-settings')
  settings(@CurrentFacture() ctx: FactureContext) {
    return this.notifications.settings(ctx);
  }

  @RequireFacturePermission('facture.settings.manage')
  @Put('notification-settings')
  update(@CurrentFacture() ctx: FactureContext, @Body() dto: FactureNotificationSettingsDto) {
    return this.notifications.updateSettings(ctx, dto);
  }
}
