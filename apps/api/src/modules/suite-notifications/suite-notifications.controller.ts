import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { SUITE_NOTIFICATION_KINDS, type SuiteNotificationKind } from '@ocall/shared';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, RequirePlatformPermission } from '../../common/decorators';
import { SuiteNotificationsService } from './suite-notifications.service';
import { SuiteRemindersService } from './suite-reminders.service';

const bool = ({ value }: { value: unknown }) => value === true || value === 'true';
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase() : value;

export class NotificationsQueryDto {
  @ApiPropertyOptional({ description: 'Seulement les non lues.' })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  unread?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lower)
  @IsUUID('4')
  cursor?: string;
}

export class AdminNotificationsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  organizationId?: string;

  @ApiPropertyOptional({ enum: SUITE_NOTIFICATION_KINDS })
  @IsOptional()
  @IsIn(SUITE_NOTIFICATION_KINDS)
  kind?: SuiteNotificationKind;
}

export class DueSoonQueryDto {
  @ApiPropertyOptional({ example: 'OCALL_SCHOOL' })
  @IsOptional()
  @Matches(/^[A-Z][A-Z0-9_]{2,39}$/)
  productCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  organizationId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 90, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;
}

/** Centre de notifications du portail Ocall Suite : les notifications du compte connecté uniquement. */
@ApiTags('suite')
@Controller('suite/notifications')
export class SuiteNotificationsController {
  constructor(private readonly notifications: SuiteNotificationsService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext, @Query() q: NotificationsQueryDto) {
    return this.notifications.list(requireTenant(auth), q.unread ?? false, q.cursor);
  }

  @Get('unread-count')
  unread(@CurrentAuth() auth: AuthContext) {
    return this.notifications.unreadCount(requireTenant(auth));
  }

  @Post('read-all')
  @HttpCode(204)
  readAll(@CurrentAuth() auth: AuthContext) {
    return this.notifications.markAllRead(requireTenant(auth));
  }

  @Post(':id/read')
  @HttpCode(204)
  read(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(requireTenant(auth), id);
  }
}

/** Super Admin : échéances, notifications émises et historique des traitements planifiés. */
@ApiTags('platform')
@Controller('platform/suite-notifications')
export class SuiteNotificationsAdminController {
  constructor(
    private readonly notifications: SuiteNotificationsService,
    private readonly reminders: SuiteRemindersService,
  ) {}

  @RequirePlatformPermission('platform.billing.read')
  @Get()
  list(@Query() q: AdminNotificationsQueryDto) {
    return this.notifications.adminList(q);
  }

  @RequirePlatformPermission('platform.billing.read')
  @Get('job-runs')
  jobRuns() {
    return this.notifications.jobRuns();
  }

  @RequirePlatformPermission('platform.billing.read')
  @Get('due-soon')
  dueSoon(@Query() q: DueSoonQueryDto) {
    return this.reminders.dueSoon(q);
  }

  /** Lancement manuel (rattrapage) : idempotent, refusé si une autre instance l'exécute déjà. */
  @RequirePlatformPermission('platform.subscriptions.manage')
  @Post('run-reminders')
  run() {
    return this.reminders.run(new Date(), 'manual');
  }
}
