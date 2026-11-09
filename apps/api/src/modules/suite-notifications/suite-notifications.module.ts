import { Module } from '@nestjs/common';
import {
  SuiteNotificationsAdminController,
  SuiteNotificationsController,
} from './suite-notifications.controller';
import { SuiteNotificationsService } from './suite-notifications.service';
import { SuiteRemindersService } from './suite-reminders.service';

/**
 * Sprint S2 : notifications du portail Ocall Suite et rappels d'échéance. Les autres modules créent leurs
 * notifications avec `notifyOrganization` (common/suite-notify), dans la transaction du fait notifié.
 */
@Module({
  controllers: [SuiteNotificationsController, SuiteNotificationsAdminController],
  providers: [SuiteNotificationsService, SuiteRemindersService],
  exports: [SuiteRemindersService],
})
export class SuiteNotificationsModule {}
