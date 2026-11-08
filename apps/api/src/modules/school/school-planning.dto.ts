import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  SCHOOL_EVENT_AUDIENCES,
  SCHOOL_EVENT_CATEGORIES,
  SCHOOL_EVENT_VISIBILITIES,
  SCHOOL_EXAM_MAX_MINUTES,
  SCHOOL_EXAM_MIN_MINUTES,
  SCHOOL_SLOT_KINDS,
  SCHOOL_TIME_PATTERN,
  type SchoolEventAudience,
  type SchoolEventCategory,
  type SchoolEventVisibility,
  type SchoolSlotKind,
} from '@ocall/shared';
import { DAY, SchoolIdQueryDto, lowerUuid, lowerUuids } from './school-portal.dto';
import { trim, trimOrNull } from './school.dto';

// ─── Salles ───

export class RoomQueryDto extends SchoolIdQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}

export class RoomDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  schoolId: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(80)
  nameAr?: string | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 5000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  capacity?: number | null;
}

export class RoomUpdateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(80)
  nameAr?: string | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 5000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  capacity?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class WeekQueryDto {
  @ApiProperty({ description: 'Un jour de la semaine voulue (AAAA-MM-JJ).' })
  @IsISO8601({ strict: true })
  @Matches(DAY)
  date: string;
}

export class ClassWeekQueryDto extends WeekQueryDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  classId: string;
}

export class TeacherWeekQueryDto extends WeekQueryDto {
  @ApiPropertyOptional({ description: 'Enseignant (absent : soi-même).' })
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  memberId?: string;
}

// ─── Emplois du temps ───

export class TimetableQueryDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  classId: string;
}

export class TimetableDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  classId: string;

  @ApiProperty()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  validFrom: string;

  @ApiProperty()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  validTo: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(80)
  label?: string | null;

  @ApiPropertyOptional({ description: 'Version de la même classe à copier (semaine type).' })
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  sourceId?: string;
}

export class TimetableUpdateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  validFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  validTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(80)
  label?: string | null;
}

export class SlotDto {
  @ApiProperty({ enum: SCHOOL_SLOT_KINDS })
  @IsIn(SCHOOL_SLOT_KINDS)
  kind: SchoolSlotKind;

  @ApiProperty({ minimum: 1, maximum: 7, description: 'Jour ISO : 1 = lundi.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  weekday: number;

  @ApiProperty({ example: '08:00' })
  @Matches(SCHOOL_TIME_PATTERN)
  start: string;

  @ApiProperty({ example: '09:00', description: '« 24:00 » accepté pour minuit.' })
  @Matches(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/)
  end: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  subjectId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  memberId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  groupId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  roomId?: string | null;

  @ApiPropertyOptional({ description: 'Libellé d’une pause (« Récréation »).' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(60)
  label?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(60)
  labelAr?: string | null;
}

export class LessonCancellationDto {
  @ApiProperty()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  date: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason: string;
}

export class UnavailabilityQueryDto extends SchoolIdQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  memberId?: string;
}

export class UnavailabilityDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  schoolId: string;

  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  memberId: string;

  @ApiProperty({ minimum: 1, maximum: 7 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  weekday: number;

  @ApiProperty({ example: '14:00' })
  @Matches(SCHOOL_TIME_PATTERN)
  start: string;

  @ApiProperty({ example: '18:00' })
  @Matches(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/)
  end: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(200)
  reason?: string | null;
}

// ─── Calendrier ───

/** Période de consultation du calendrier (portail parents). */
export class PeriodQueryDto {
  @ApiProperty()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  from: string;

  @ApiProperty()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  to: string;
}

export class CalendarQueryDto extends SchoolIdQueryDto {
  @ApiProperty()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  from: string;

  @ApiProperty()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  to: string;
}

export class CalendarEventDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  schoolId: string;

  @ApiProperty({ enum: SCHOOL_EVENT_CATEGORIES })
  @IsIn(SCHOOL_EVENT_CATEGORIES)
  category: SchoolEventCategory;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 160)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(160)
  titleAr?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(2000)
  descriptionAr?: string | null;

  @ApiProperty()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  startsOn: string;

  @ApiProperty()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  endsOn: string;

  @ApiPropertyOptional({ example: '17:00' })
  @IsOptional()
  @Matches(SCHOOL_TIME_PATTERN)
  start?: string | null;

  @ApiPropertyOptional({ example: '19:00' })
  @IsOptional()
  @Matches(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/)
  end?: string | null;

  @ApiProperty({ enum: SCHOOL_EVENT_AUDIENCES })
  @IsIn(SCHOOL_EVENT_AUDIENCES)
  audience: SchoolEventAudience;

  @ApiPropertyOptional({ type: [String], description: 'Classes ou groupes visés.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @Transform(lowerUuids)
  @IsUUID('4', { each: true })
  targetIds?: string[];

  @ApiProperty({ enum: SCHOOL_EVENT_VISIBILITIES })
  @IsIn(SCHOOL_EVENT_VISIBILITIES)
  visibility: SchoolEventVisibility;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  important?: boolean;
}

// ─── Examens ───

export class ExamQueryDto extends CalendarQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  classId?: string;
}

export class ExamDto {
  @ApiProperty({ description: 'Évaluation du Sprint 4 à programmer.' })
  @Transform(lowerUuid)
  @IsUUID('4')
  evaluationId: string;

  @ApiProperty()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  date: string;

  @ApiProperty({ example: '08:00' })
  @Matches(SCHOOL_TIME_PATTERN)
  start: string;

  @ApiProperty({ minimum: SCHOOL_EXAM_MIN_MINUTES, maximum: SCHOOL_EXAM_MAX_MINUTES })
  @Type(() => Number)
  @IsInt()
  @Min(SCHOOL_EXAM_MIN_MINUTES)
  @Max(SCHOOL_EXAM_MAX_MINUTES)
  durationMinutes: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  roomId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  supervisorMemberId?: string | null;
}
