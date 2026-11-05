import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  ValidateNested,
} from 'class-validator';
import {
  SCHOOL_ANNOUNCEMENT_AUDIENCES,
  SCHOOL_ATTENDANCE_BATCH,
  SCHOOL_ATTENDANCE_STATUSES,
  SCHOOL_JUSTIFICATION_STATUSES,
  SCHOOL_SLOT_PATTERN,
  SCHOOL_SMS_STATUSES,
  type SchoolAnnouncementAudience,
  type SchoolAttendanceStatus,
  type SchoolJustificationStatus,
  type SchoolSmsStatus,
} from '@ocall/shared';
import { trim, trimOrNull } from './school.dto';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Identifiants comparés en minuscules partout : un même UUID n'a qu'une écriture. */
const lowerUuid = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase() : value;
const lowerUuids = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.toLowerCase() : v)) : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const bool = ({ value }: { value: unknown }) => value === true || value === 'true';

export class SchoolIdQueryDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  schoolId: string;
}

// ─── Portail : invitations et accès ───

export class InvitationDto {
  @ApiPropertyOptional({ description: 'Envoyer aussi le lien par SMS (si activés).' })
  @IsOptional()
  @IsBoolean()
  sendSms?: boolean;
}

export class RevokeAccessDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason: string;
}

export class ActivationCheckDto {
  @ApiProperty()
  @IsString()
  @Length(20, 200)
  token: string;
}

export class ActivationDto extends ActivationCheckDto {
  @ApiProperty()
  @IsString()
  @Length(8, 128)
  password: string;
}

// ─── Présences ───

export class AttendanceQueryDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  classId: string;

  @ApiProperty()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  date: string;

  @ApiPropertyOptional({ description: 'Séance : JOURNEE par défaut.' })
  @IsOptional()
  @Transform(upper)
  @Matches(SCHOOL_SLOT_PATTERN)
  slot?: string;
}

export class AttendanceRecordDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  studentId: string;

  @ApiProperty({ enum: SCHOOL_ATTENDANCE_STATUSES })
  @IsIn(SCHOOL_ATTENDANCE_STATUSES)
  status: SchoolAttendanceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  minutesLate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class SaveAttendanceDto extends AttendanceQueryDto {
  @ApiProperty({ type: [AttendanceRecordDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SCHOOL_ATTENDANCE_BATCH)
  @ValidateNested({ each: true })
  @Type(() => AttendanceRecordDto)
  records: AttendanceRecordDto[];

  @ApiPropertyOptional({ description: 'Motif, obligatoire pour corriger un relevé existant.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason?: string;
}

export class DateRangeQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  to?: string;
}

export class ClassStatsQueryDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  classId: string;

  @ApiProperty()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  from: string;

  @ApiProperty()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  to: string;
}

export class GuardianJustificationDto {
  @ApiProperty()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  fromDate: string;

  @ApiProperty()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  toDate: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 500)
  reason: string;
}

export class JustificationCreateDto extends GuardianJustificationDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  studentId: string;
}

export class JustificationQueryDto extends SchoolIdQueryDto {
  @ApiPropertyOptional({ enum: SCHOOL_JUSTIFICATION_STATUSES })
  @IsOptional()
  @IsIn(SCHOOL_JUSTIFICATION_STATUSES)
  status?: SchoolJustificationStatus;
}

export class JustificationReviewDto {
  @ApiProperty({ enum: ['ACCEPTED', 'REJECTED'] })
  @IsIn(['ACCEPTED', 'REJECTED'])
  decision: 'ACCEPTED' | 'REJECTED';

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

// ─── Résultats publiés ───

export class PublicationDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  classId: string;

  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  periodId: string;
}

export class PublicationQueryDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  classId: string;
}

// ─── Annonces ───

export class AnnouncementDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  schoolId: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 160)
  title: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 4000)
  body: string;

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
  @MaxLength(4000)
  bodyAr?: string | null;

  @ApiProperty({ enum: SCHOOL_ANNOUNCEMENT_AUDIENCES })
  @IsIn(SCHOOL_ANNOUNCEMENT_AUDIENCES)
  audience: SchoolAnnouncementAudience;

  @ApiPropertyOptional({ type: [String], description: 'Classes, élèves ou responsables visés.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @Transform(lowerUuids)
  @IsUUID('4', { each: true })
  targetIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  expiresOn?: string | null;
}

export class AnnouncementQueryDto extends SchoolIdQueryDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Page de 200 annonces, les plus récentes d’abord.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  page?: number;
}

// ─── SMS ───

export class SmsSettingsDto extends SchoolIdQueryDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}

export class SmsHistoryQueryDto extends SchoolIdQueryDto {
  @ApiPropertyOptional({ enum: SCHOOL_SMS_STATUSES })
  @IsOptional()
  @IsIn(SCHOOL_SMS_STATUSES)
  status?: SchoolSmsStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  cursor?: string;
}

// ─── Portail : notifications ───

export class NotificationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  unread?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  cursor?: string;
}

/** Page des annonces visibles (50 par page, les plus récentes d'abord). */
export class PortalAnnouncementsQueryDto {
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  page?: number;
}

export class PortalYearQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  schoolYearId?: string;
}
