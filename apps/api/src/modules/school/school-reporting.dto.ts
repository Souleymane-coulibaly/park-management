import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  SCHOOL_REPORT_FORMATS,
  SCHOOL_REPORT_KINDS,
  type SchoolReportFormat,
  type SchoolReportKind,
} from '@ocall/shared';
import { DAY, lowerUuid } from './school-portal.dto';

/** Filtres communs des rapports du Sprint 8 : année obligatoire, classe, période et dates facultatives. */
export class ReportFiltersDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  schoolYearId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  classId?: string;

  @ApiPropertyOptional({ description: 'Période scolaire (rapport pédagogique)' })
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  periodId?: string;

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

export class ReportExportQueryDto extends ReportFiltersDto {
  @ApiProperty({ enum: SCHOOL_REPORT_KINDS })
  @IsIn(SCHOOL_REPORT_KINDS)
  kind: SchoolReportKind;

  @ApiProperty({ enum: SCHOOL_REPORT_FORMATS })
  @IsIn(SCHOOL_REPORT_FORMATS)
  format: SchoolReportFormat;
}

/** Vue de reporting enregistrée : un rapport et ses filtres, propre à l'utilisateur. */
export class CreateReportViewDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @ApiProperty({ enum: SCHOOL_REPORT_KINDS })
  @IsIn(SCHOOL_REPORT_KINDS)
  kind: SchoolReportKind;

  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  schoolId: string;

  @ApiProperty({
    description: 'Filtres (classe, période, dates) ; l’année est reprise à l’ouverture.',
  })
  @IsObject()
  filters: Record<string, unknown>;
}

export class ReportViewsQueryDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  schoolId: string;
}

export class AuditQueryDto {
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

  @ApiPropertyOptional({ description: 'Préfixe d’action, ex. school.finance' })
  @IsOptional()
  @IsString()
  @Matches(/^school\.[a-z_.]{0,60}$/)
  action?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;
}
