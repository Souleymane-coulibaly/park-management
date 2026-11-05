import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  QURAN_STATUSES,
  type QuranStatus,
  SCHOOL_COEFFICIENT_LIMIT,
  SCHOOL_EVALUATION_KINDS,
  SCHOOL_GRADE_STATUSES,
  SCHOOL_MAX_SCORE_LIMIT,
  type SchoolEvaluationKind,
  type SchoolGradeStatus,
} from '@ocall/shared';
import { trim, trimOrNull } from './school.dto';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Nombre d'élèves d'une saisie en tableau : une classe, avec marge. */
const SHEET_MAX = 200;
const TEXT_MAX = 600;

// ─── Périodes ───

export class UpdatePeriodDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(60)
  labelAr?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  startsOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  endsOn?: string;
}

// ─── Évaluations ───

export class ClassPeriodQueryDto {
  @ApiProperty()
  @IsUUID('4')
  classId: string;

  @ApiProperty()
  @IsUUID('4')
  periodId: string;
}

export class EvaluationQueryDto extends ClassPeriodQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  subjectId?: string;
}

/** Modification : chaque attribut est facultatif ; classe, matière, groupe et période ne changent pas. */
export class UpdateEvaluationDto {
  @ApiPropertyOptional({ enum: SCHOOL_EVALUATION_KINDS })
  @IsOptional()
  @IsIn(SCHOOL_EVALUATION_KINDS)
  kind?: SchoolEvaluationKind;

  @ApiPropertyOptional({ example: 'Devoir n° 1' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(120)
  titleAr?: string | null;

  @ApiPropertyOptional({ example: '2026-10-15' })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  heldOn?: string;

  @ApiPropertyOptional({ description: 'Note maximale de l’évaluation (barème).' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(SCHOOL_MAX_SCORE_LIMIT)
  maxScore?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(SCHOOL_COEFFICIENT_LIMIT)
  coefficient?: number;
}

/**
 * Création : champs obligatoires déclarés ici, sans héritage du DTO de modification, dont les
 * `@IsOptional()` rendraient facultatifs barème, intitulé, type et date.
 */
export class CreateEvaluationDto {
  @ApiProperty()
  @IsUUID('4')
  classId: string;

  @ApiProperty()
  @IsUUID('4')
  periodId: string;

  @ApiProperty()
  @IsUUID('4')
  subjectId: string;

  @ApiPropertyOptional({ description: 'Évaluation d’un groupe de la classe.' })
  @IsOptional()
  @IsUUID('4')
  groupId?: string | null;

  @ApiProperty({ enum: SCHOOL_EVALUATION_KINDS })
  @IsIn(SCHOOL_EVALUATION_KINDS)
  kind: SchoolEvaluationKind;

  @ApiProperty({ example: 'Devoir n° 1' })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(120)
  titleAr?: string | null;

  @ApiProperty({ example: '2026-10-15' })
  @IsISO8601({ strict: true })
  @Matches(DAY)
  heldOn: string;

  @ApiProperty({ description: 'Note maximale de l’évaluation (barème).' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(SCHOOL_MAX_SCORE_LIMIT)
  maxScore: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(SCHOOL_COEFFICIENT_LIMIT)
  coefficient?: number;
}

// ─── Notes ───

export class GradeEntryDto {
  @ApiProperty()
  @IsUUID('4')
  studentId: string;

  @ApiProperty({
    enum: [...SCHOOL_GRADE_STATUSES, null],
    description: 'null efface la saisie (la trace reste au journal).',
  })
  @ValidateIf((o: GradeEntryDto) => o.status !== null)
  @IsIn(SCHOOL_GRADE_STATUSES)
  status: SchoolGradeStatus | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  score?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(200)
  comment?: string | null;
}

export class SaveGradesDto {
  @ApiProperty({ type: [GradeEntryDto] })
  @IsArray()
  @ArrayMaxSize(SHEET_MAX)
  @ValidateNested({ each: true })
  @Type(() => GradeEntryDto)
  grades: GradeEntryDto[];

  @ApiPropertyOptional({ description: 'Motif de la modification, conservé au journal.' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(200)
  reason?: string | null;
}

// ─── Appréciations, validation ───

export class AppreciationEntryDto {
  @ApiProperty()
  @IsUUID('4')
  studentId: string;

  @ApiProperty({ description: 'Vide : l’appréciation est retirée.' })
  @Transform(trim)
  @IsString()
  @MaxLength(TEXT_MAX)
  text: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(TEXT_MAX)
  textAr?: string | null;
}

export class SaveCommentsDto extends ClassPeriodQueryDto {
  @ApiProperty({ type: [AppreciationEntryDto] })
  @IsArray()
  @ArrayMaxSize(SHEET_MAX)
  @ValidateNested({ each: true })
  @Type(() => AppreciationEntryDto)
  items: AppreciationEntryDto[];
}

export class SaveAppreciationsDto extends SaveCommentsDto {
  @ApiProperty()
  @IsUUID('4')
  subjectId: string;
}

export class UnlockResultsDto extends ClassPeriodQueryDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 200)
  reason: string;
}

export class ReportCardQueryDto extends ClassPeriodQueryDto {
  @ApiPropertyOptional({ description: 'Un seul élève ; sinon toute la classe.' })
  @IsOptional()
  @IsUUID('4')
  studentId?: string;
}

// ─── Mémorisation du Coran ───

export class QuranSettingsDto {
  @ApiProperty()
  @IsUUID('4')
  schoolId: string;

  @ApiProperty()
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({ description: 'Matière dont les enseignants saisissent la mémorisation.' })
  @IsOptional()
  @IsUUID('4')
  subjectId?: string | null;
}

export class QuranEvaluationDto {
  @ApiProperty({ minimum: 1, maximum: 114 })
  @IsInt()
  @Min(1)
  @Max(114)
  surah: number;

  @ApiProperty({ enum: QURAN_STATUSES })
  @IsIn(QURAN_STATUSES)
  status: QuranStatus;

  @ApiProperty({ example: '2026-11-04' })
  @IsISO8601({ strict: true })
  @Matches(DAY)
  evaluatedOn: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(300)
  remark?: string | null;

  @ApiPropertyOptional({ description: 'Observation visible des familles sur le portail parents.' })
  @IsOptional()
  @IsBoolean()
  remarkShared?: boolean;
}
