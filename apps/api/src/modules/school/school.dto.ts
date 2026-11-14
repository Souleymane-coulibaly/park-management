import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
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
  SCHOOL_LOCALES,
  SCHOOL_PERIOD_KINDS,
  SCHOOL_ROLES,
  SCHOOL_TYPES,
  SUPPORTED_COUNTRIES,
  type SchoolGradingRules,
  type SchoolLocale,
  type SchoolPeriodKind,
  type SchoolRole,
  type SchoolType,
} from '@ocall/shared';

export const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** Champ facultatif : une chaîne vide vaut « non renseigné ». */
export const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Nom bilingue : le français est obligatoire, l'arabe facultatif (Unicode, affiché de droite à gauche). */
class BilingualNameDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(120)
  nameAr?: string | null;
}

export class SchoolQueryDto {
  @ApiProperty()
  @IsUUID('4')
  schoolId: string;
}

export class YearQueryDto {
  @ApiProperty()
  @IsUUID('4')
  schoolYearId: string;
}

export class CycleQueryDto {
  @ApiProperty()
  @IsUUID('4')
  cycleId: string;
}

export class CreateSchoolDto extends BilingualNameDto {
  @ApiProperty({ enum: SCHOOL_TYPES })
  @IsIn(SCHOOL_TYPES)
  type: SchoolType;

  @ApiProperty({ enum: SUPPORTED_COUNTRIES.map((c) => c.code) })
  @IsIn(SUPPORTED_COUNTRIES.map((c) => c.code))
  countryCode: string;

  @ApiPropertyOptional({ enum: SCHOOL_LOCALES })
  @IsOptional()
  @IsIn(SCHOOL_LOCALES)
  defaultLocale?: SchoolLocale;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(200)
  address?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsEmail()
  email?: string | null;
}

export class UpdateSchoolDto extends PartialType(CreateSchoolDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateYearDto extends SchoolQueryDto {
  @ApiProperty({ example: '2026-2027' })
  @Transform(trim)
  @IsString()
  @Length(4, 30)
  label: string;

  @ApiProperty({ example: '2026-10-01' })
  @IsISO8601({ strict: true })
  @Matches(DAY)
  startsOn: string;

  @ApiProperty({ example: '2027-06-30' })
  @IsISO8601({ strict: true })
  @Matches(DAY)
  endsOn: string;
}

export class YearStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'CLOSED'] })
  @IsIn(['ACTIVE', 'CLOSED'])
  status: 'ACTIVE' | 'CLOSED';
}

export class CreatePeriodDto extends YearQueryDto {
  @ApiProperty({ enum: SCHOOL_PERIOD_KINDS })
  @IsIn(SCHOOL_PERIOD_KINDS)
  kind: SchoolPeriodKind;

  @ApiProperty({ example: 'Premier trimestre' })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  label: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(60)
  labelAr?: string | null;

  @ApiProperty()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  startsOn: string;

  @ApiProperty()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  endsOn: string;
}

export class CreateTrackDto extends BilingualNameDto {
  @ApiProperty()
  @IsUUID('4')
  schoolId: string;

  @ApiPropertyOptional({ enum: SCHOOL_LOCALES })
  @IsOptional()
  @IsIn(SCHOOL_LOCALES)
  locale?: SchoolLocale;
}

export class CreateCycleDto extends BilingualNameDto {
  @ApiProperty()
  @IsUUID('4')
  schoolId: string;
}

export class CreateLevelDto extends BilingualNameDto {
  @ApiProperty()
  @IsUUID('4')
  cycleId: string;
}

export class CreateClassDto extends BilingualNameDto {
  @ApiProperty()
  @IsUUID('4')
  schoolYearId: string;

  @ApiProperty()
  @IsUUID('4')
  levelId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  trackId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity?: number;
}

export class CreateSubjectDto extends BilingualNameDto {
  @ApiProperty()
  @IsUUID('4')
  schoolId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  trackId?: string;

  @ApiPropertyOptional({ description: 'Coran, tajwid, éducation islamique : au choix de l’école.' })
  @IsOptional()
  @IsBoolean()
  isReligious?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  defaultCoefficient?: number;
}

export class CreateMemberDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  firstName: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  lastName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || null : value,
  )
  @IsEmail()
  email?: string | null;

  @ApiProperty({ enum: SCHOOL_ROLES })
  @IsIn(SCHOOL_ROLES)
  role: SchoolRole;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  schoolIds: string[];
}

/** Sprint Suite 2A : membre existant de l'organisation ajouté à l'équipe School, sans nouveau compte. */
export class AttachMemberDto {
  @ApiProperty({ description: 'Compte Suite d’un membre actif de l’organisation' })
  @IsUUID('4')
  userId: string;

  @ApiProperty({ enum: SCHOOL_ROLES })
  @IsIn(SCHOOL_ROLES)
  role: SchoolRole;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  schoolIds: string[];
}

export class UpdateMemberDto {
  @ApiPropertyOptional({ enum: SCHOOL_ROLES })
  @IsOptional()
  @IsIn(SCHOOL_ROLES)
  role?: SchoolRole;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  schoolIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Prénom en arabe, facultatif (Sprint 3B).' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(80)
  firstNameAr?: string | null;

  @ApiPropertyOptional({ description: 'Nom en arabe, facultatif (Sprint 3B).' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(80)
  lastNameAr?: string | null;
}

export class CreateGradingPolicyDto {
  @ApiProperty()
  @IsUUID('4')
  schoolId: string;

  @ApiProperty({ example: '2026-10-01' })
  @IsISO8601({ strict: true })
  @Matches(DAY)
  effectiveFrom: string;

  @ApiProperty({ type: Object })
  @IsObject()
  rules: SchoolGradingRules;
}
