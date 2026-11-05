import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SchoolPermission } from '@ocall/shared';
import {
  CurrentSchool,
  RequireSchoolPermission,
  SchoolAccessGuard,
  type SchoolContext,
} from './school-access';
import { SchoolAnnouncementsService } from './school-announcements.service';
import { SchoolAttendanceService } from './school-attendance.service';
import { SchoolPortalAccountsService } from './school-portal-accounts.service';
import {
  AnnouncementDto,
  AnnouncementQueryDto,
  AttendanceQueryDto,
  ClassStatsQueryDto,
  DateRangeQueryDto,
  InvitationDto,
  JustificationCreateDto,
  JustificationQueryDto,
  JustificationReviewDto,
  PublicationDto,
  PublicationQueryDto,
  RevokeAccessDto,
  SaveAttendanceDto,
  SchoolIdQueryDto,
  SmsHistoryQueryDto,
  SmsSettingsDto,
} from './school-portal.dto';
import { SchoolPublicationsService } from './school-publications.service';
import { SchoolSmsService } from './school-sms.service';

const SP = SchoolPermission;

/** Portail parents côté établissement : invitations, accès, publication des résultats (Sprint 6). */
@ApiTags('Ocall School — portail parents (établissement)')
@UseGuards(SchoolAccessGuard)
@Controller('school')
export class SchoolPortalAdminController {
  constructor(
    private readonly accounts: SchoolPortalAccountsService,
    private readonly publications: SchoolPublicationsService,
  ) {}

  @RequireSchoolPermission(SP.PORTAL_MANAGE)
  @Get('guardians/:id/portal')
  status(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.status(ctx, id);
  }

  @RequireSchoolPermission(SP.PORTAL_MANAGE)
  @Post('guardians/:id/portal/invitations')
  invite(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InvitationDto,
  ) {
    return this.accounts.invite(ctx, id, dto.sendSms ?? false);
  }

  @RequireSchoolPermission(SP.PORTAL_MANAGE)
  @HttpCode(200)
  @Post('guardians/:id/portal/invitations/:invitationId/revoke')
  revokeInvitation(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.accounts.revokeInvitation(ctx, id, invitationId);
  }

  @RequireSchoolPermission(SP.PORTAL_MANAGE)
  @HttpCode(200)
  @Post('guardians/:id/portal/revoke')
  revokeAccess(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevokeAccessDto,
  ) {
    return this.accounts.revokeAccess(ctx, id, dto.reason);
  }

  @RequireSchoolPermission(SP.REPORT_CARDS)
  @Get('results/publications')
  publicationList(@CurrentSchool() ctx: SchoolContext, @Query() q: PublicationQueryDto) {
    return this.publications.list(ctx, q.classId);
  }

  @RequireSchoolPermission(SP.RESULTS_PUBLISH)
  @Post('results/publications')
  publish(@CurrentSchool() ctx: SchoolContext, @Body() dto: PublicationDto) {
    return this.publications.publish(ctx, dto);
  }

  @RequireSchoolPermission(SP.RESULTS_PUBLISH)
  @HttpCode(200)
  @Post('results/publications/:id/withdraw')
  withdraw(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.publications.withdraw(ctx, id);
  }
}

/** Présences : appel, corrections motivées, historique, statistiques, justificatifs (Sprint 6). */
@ApiTags('Ocall School — présences')
@UseGuards(SchoolAccessGuard)
@Controller('school/attendance')
export class SchoolAttendanceController {
  constructor(private readonly attendance: SchoolAttendanceService) {}

  @RequireSchoolPermission(SP.ATTENDANCE_READ)
  @Get('sheet')
  sheet(@CurrentSchool() ctx: SchoolContext, @Query() q: AttendanceQueryDto) {
    return this.attendance.sheet(ctx, q);
  }

  @RequireSchoolPermission(SP.ATTENDANCE_TAKE)
  @Put('sheet')
  save(@CurrentSchool() ctx: SchoolContext, @Body() dto: SaveAttendanceDto) {
    return this.attendance.save(ctx, dto);
  }

  @RequireSchoolPermission(SP.ATTENDANCE_READ)
  @Get('records/:id/history')
  history(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.attendance.recordHistory(ctx, id);
  }

  @RequireSchoolPermission(SP.ATTENDANCE_READ)
  @Get('students/:id')
  student(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: DateRangeQueryDto,
  ) {
    return this.attendance.student(ctx, id, q.from, q.to);
  }

  @RequireSchoolPermission(SP.ATTENDANCE_READ)
  @Get('stats')
  stats(@CurrentSchool() ctx: SchoolContext, @Query() q: ClassStatsQueryDto) {
    return this.attendance.classStats(ctx, q.classId, q.from, q.to);
  }

  @RequireSchoolPermission(SP.ATTENDANCE_JUSTIFY)
  @Get('justifications')
  justifications(@CurrentSchool() ctx: SchoolContext, @Query() q: JustificationQueryDto) {
    return this.attendance.justifications(ctx, q.schoolId, q.status);
  }

  @RequireSchoolPermission(SP.ATTENDANCE_JUSTIFY)
  @Post('justifications')
  createJustification(@CurrentSchool() ctx: SchoolContext, @Body() dto: JustificationCreateDto) {
    return this.attendance.createByStaff(ctx, dto);
  }

  @RequireSchoolPermission(SP.ATTENDANCE_JUSTIFY)
  @HttpCode(200)
  @Post('justifications/:id/review')
  review(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: JustificationReviewDto,
  ) {
    return this.attendance.review(ctx, id, dto);
  }
}

/** Annonces aux familles et SMS de l'établissement (Sprint 6). */
@ApiTags('Ocall School — communication')
@UseGuards(SchoolAccessGuard)
@Controller('school')
export class SchoolCommunicationController {
  constructor(
    private readonly announcements: SchoolAnnouncementsService,
    private readonly sms: SchoolSmsService,
  ) {}

  @RequireSchoolPermission(SP.ANNOUNCEMENTS_CLASS)
  @Get('announcements')
  list(@CurrentSchool() ctx: SchoolContext, @Query() q: AnnouncementQueryDto) {
    return this.announcements.list(ctx, q);
  }

  @RequireSchoolPermission(SP.ANNOUNCEMENTS_CLASS)
  @Get('announcements/:id')
  get(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.get(ctx, id);
  }

  @RequireSchoolPermission(SP.ANNOUNCEMENTS_CLASS)
  @Post('announcements')
  create(@CurrentSchool() ctx: SchoolContext, @Body() dto: AnnouncementDto) {
    return this.announcements.create(ctx, dto);
  }

  @RequireSchoolPermission(SP.ANNOUNCEMENTS_CLASS)
  @Put('announcements/:id')
  update(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnnouncementDto,
  ) {
    return this.announcements.update(ctx, id, dto);
  }

  @RequireSchoolPermission(SP.ANNOUNCEMENTS_CLASS)
  @HttpCode(200)
  @Post('announcements/:id/publish')
  publish(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.publish(ctx, id);
  }

  @RequireSchoolPermission(SP.ANNOUNCEMENTS_CLASS)
  @HttpCode(200)
  @Post('announcements/:id/archive')
  archive(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.archive(ctx, id);
  }

  @RequireSchoolPermission(SP.SMS_MANAGE)
  @Get('sms/settings')
  smsSettings(@CurrentSchool() ctx: SchoolContext, @Query() q: SchoolIdQueryDto) {
    return this.sms.settings(ctx, q.schoolId);
  }

  @RequireSchoolPermission(SP.SMS_MANAGE)
  @Put('sms/settings')
  updateSmsSettings(@CurrentSchool() ctx: SchoolContext, @Body() dto: SmsSettingsDto) {
    return this.sms.updateSettings(ctx, dto.schoolId, dto.enabled);
  }

  @RequireSchoolPermission(SP.SMS_MANAGE)
  @Get('sms/messages')
  smsHistory(@CurrentSchool() ctx: SchoolContext, @Query() q: SmsHistoryQueryDto) {
    return this.sms.history(ctx, q.schoolId, q.status, q.cursor);
  }
}
