import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { SchoolCalendarService } from './school-calendar.service';
import { SchoolExamsService } from './school-exams.service';
import {
  CalendarEventDto,
  CalendarQueryDto,
  ClassWeekQueryDto,
  ExamDto,
  ExamQueryDto,
  LessonCancellationDto,
  RoomDto,
  RoomQueryDto,
  RoomUpdateDto,
  SlotDto,
  TeacherWeekQueryDto,
  TimetableDto,
  TimetableQueryDto,
  TimetableUpdateDto,
  UnavailabilityDto,
  UnavailabilityQueryDto,
  WeekQueryDto,
} from './school-planning.dto';
import { DAY } from './school-portal.dto';
import { SchoolRoomsService } from './school-rooms.service';
import { SchoolTimetablesService } from './school-timetables.service';

const SP = SchoolPermission;

/** Salles, emplois du temps, indisponibilités et vues de semaine (Sprint 7). */
@ApiTags('Ocall School — emplois du temps')
@UseGuards(SchoolAccessGuard)
@Controller('school')
export class SchoolPlanningController {
  constructor(
    private readonly rooms: SchoolRoomsService,
    private readonly timetables: SchoolTimetablesService,
  ) {}

  // ─── Salles ───

  @RequireSchoolPermission(SP.PLANNING_READ)
  @Get('rooms')
  listRooms(@CurrentSchool() ctx: SchoolContext, @Query() q: RoomQueryDto) {
    return this.rooms.list(ctx, q);
  }

  @RequireSchoolPermission(SP.PLANNING_MANAGE)
  @Post('rooms')
  createRoom(@CurrentSchool() ctx: SchoolContext, @Body() dto: RoomDto) {
    return this.rooms.create(ctx, dto);
  }

  @RequireSchoolPermission(SP.PLANNING_MANAGE)
  @Patch('rooms/:id')
  updateRoom(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RoomUpdateDto,
  ) {
    return this.rooms.update(ctx, id, dto);
  }

  @RequireSchoolPermission(SP.PLANNING_READ)
  @Get('rooms/:id/week')
  roomWeek(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: WeekQueryDto,
  ) {
    return this.timetables.roomWeek(ctx, id, q.date);
  }

  // ─── Emplois du temps ───

  @RequireSchoolPermission(SP.PLANNING_READ)
  @Get('timetables')
  list(@CurrentSchool() ctx: SchoolContext, @Query() q: TimetableQueryDto) {
    return this.timetables.list(ctx, q.classId);
  }

  @RequireSchoolPermission(SP.PLANNING_MANAGE)
  @Post('timetables')
  create(@CurrentSchool() ctx: SchoolContext, @Body() dto: TimetableDto): Promise<unknown> {
    return this.timetables.create(ctx, dto);
  }

  @RequireSchoolPermission(SP.PLANNING_READ)
  @Get('timetables/:id')
  get(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.timetables.get(ctx, id);
  }

  @RequireSchoolPermission(SP.PLANNING_MANAGE)
  @Patch('timetables/:id')
  update(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TimetableUpdateDto,
  ): Promise<unknown> {
    return this.timetables.update(ctx, id, dto);
  }

  @RequireSchoolPermission(SP.PLANNING_MANAGE)
  @Delete('timetables/:id')
  remove(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.timetables.remove(ctx, id);
  }

  @RequireSchoolPermission(SP.PLANNING_MANAGE)
  @Post('timetables/:id/slots')
  addSlot(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SlotDto,
  ): Promise<unknown> {
    return this.timetables.addSlot(ctx, id, dto);
  }

  @RequireSchoolPermission(SP.PLANNING_MANAGE)
  @Put('timetables/:id/slots/:slotId')
  updateSlot(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() dto: SlotDto,
  ): Promise<unknown> {
    return this.timetables.updateSlot(ctx, id, slotId, dto);
  }

  @RequireSchoolPermission(SP.PLANNING_MANAGE)
  @Delete('timetables/:id/slots/:slotId')
  removeSlot(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
  ): Promise<unknown> {
    return this.timetables.removeSlot(ctx, id, slotId);
  }

  @RequireSchoolPermission(SP.PLANNING_MANAGE)
  @HttpCode(200)
  @Post('timetables/:id/check')
  check(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.timetables.check(ctx, id);
  }

  @RequireSchoolPermission(SP.PLANNING_PUBLISH)
  @HttpCode(200)
  @Post('timetables/:id/publish')
  publish(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.timetables.publish(ctx, id);
  }

  @RequireSchoolPermission(SP.PLANNING_PUBLISH)
  @HttpCode(200)
  @Post('timetables/:id/archive')
  archive(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.timetables.archive(ctx, id);
  }

  @RequireSchoolPermission(SP.PLANNING_MANAGE)
  @Post('timetable-slots/:slotId/cancellations')
  cancelLesson(
    @CurrentSchool() ctx: SchoolContext,
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() dto: LessonCancellationDto,
  ) {
    return this.timetables.cancelLesson(ctx, slotId, dto);
  }

  @RequireSchoolPermission(SP.PLANNING_MANAGE)
  @Delete('timetable-slots/:slotId/cancellations/:date')
  restoreLesson(
    @CurrentSchool() ctx: SchoolContext,
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Param('date') date: string,
  ) {
    if (!DAY.test(date)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Date invalide.' });
    }
    return this.timetables.restoreLesson(ctx, slotId, date);
  }

  // ─── Vues de semaine ───

  @RequireSchoolPermission(SP.PLANNING_READ)
  @Get('planning/class-week')
  classWeek(@CurrentSchool() ctx: SchoolContext, @Query() q: ClassWeekQueryDto) {
    return this.timetables.classWeek(ctx, q.classId, q.date);
  }

  @RequireSchoolPermission(SP.PLANNING_READ)
  @Get('planning/teacher-week')
  teacherWeek(
    @CurrentSchool() ctx: SchoolContext,
    @Query() q: TeacherWeekQueryDto,
  ): Promise<unknown> {
    return this.timetables.teacherWeek(ctx, q.memberId, q.date);
  }

  // ─── Indisponibilités ───

  @RequireSchoolPermission(SP.PLANNING_MANAGE)
  @Get('teacher-unavailability')
  unavailability(@CurrentSchool() ctx: SchoolContext, @Query() q: UnavailabilityQueryDto) {
    return this.timetables.unavailability(ctx, q);
  }

  @RequireSchoolPermission(SP.PLANNING_MANAGE)
  @Post('teacher-unavailability')
  addUnavailability(@CurrentSchool() ctx: SchoolContext, @Body() dto: UnavailabilityDto) {
    return this.timetables.addUnavailability(ctx, dto);
  }

  @RequireSchoolPermission(SP.PLANNING_MANAGE)
  @Delete('teacher-unavailability/:id')
  removeUnavailability(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.timetables.removeUnavailability(ctx, id);
  }
}

/** Calendrier scolaire et programmation des examens (Sprint 7). */
@ApiTags('Ocall School — calendrier et examens')
@UseGuards(SchoolAccessGuard)
@Controller('school')
export class SchoolCalendarController {
  constructor(
    private readonly calendar: SchoolCalendarService,
    private readonly exams: SchoolExamsService,
  ) {}

  @RequireSchoolPermission(SP.PLANNING_READ)
  @Get('calendar')
  list(@CurrentSchool() ctx: SchoolContext, @Query() q: CalendarQueryDto) {
    return this.calendar.list(ctx, q);
  }

  @RequireSchoolPermission(SP.PLANNING_READ)
  @Get('calendar/events/:id')
  get(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.calendar.get(ctx, id);
  }

  @RequireSchoolPermission(SP.CALENDAR_MANAGE)
  @Post('calendar/events')
  create(@CurrentSchool() ctx: SchoolContext, @Body() dto: CalendarEventDto) {
    return this.calendar.create(ctx, dto);
  }

  @RequireSchoolPermission(SP.CALENDAR_MANAGE)
  @Put('calendar/events/:id')
  update(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CalendarEventDto,
  ) {
    return this.calendar.update(ctx, id, dto);
  }

  @RequireSchoolPermission(SP.CALENDAR_MANAGE)
  @HttpCode(200)
  @Post('calendar/events/:id/publish')
  publish(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.calendar.publish(ctx, id);
  }

  @RequireSchoolPermission(SP.CALENDAR_MANAGE)
  @HttpCode(200)
  @Post('calendar/events/:id/cancel')
  cancel(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.calendar.cancel(ctx, id);
  }

  @RequireSchoolPermission(SP.PLANNING_READ)
  @Get('exams')
  listExams(@CurrentSchool() ctx: SchoolContext, @Query() q: ExamQueryDto) {
    return this.exams.list(ctx, q);
  }

  @RequireSchoolPermission(SP.EXAMS_MANAGE)
  @Post('exams')
  createExam(@CurrentSchool() ctx: SchoolContext, @Body() dto: ExamDto) {
    return this.exams.create(ctx, dto);
  }

  @RequireSchoolPermission(SP.EXAMS_MANAGE)
  @Put('exams/:id')
  updateExam(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExamDto,
  ) {
    return this.exams.update(ctx, id, dto);
  }

  @RequireSchoolPermission(SP.EXAMS_MANAGE)
  @HttpCode(200)
  @Post('exams/:id/publish')
  publishExam(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.exams.publish(ctx, id);
  }

  @RequireSchoolPermission(SP.EXAMS_MANAGE)
  @HttpCode(200)
  @Post('exams/:id/cancel')
  cancelExam(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.exams.cancel(ctx, id);
  }
}
