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
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  SCHOOL_DOCUMENT_CATEGORIES,
  SCHOOL_ENROLLMENT_STATUSES,
  SCHOOL_EXIT_REASONS,
  SCHOOL_GUARDIAN_RELATIONS,
  SCHOOL_MATRICULE_SCOPES,
  SCHOOL_PHONE,
  SCHOOL_SEXES,
  SCHOOL_STUDENT_STATUSES,
  type SchoolCustomField,
  type SchoolDocumentCategory,
  type SchoolEnrollmentStatus,
  type SchoolExitReason,
  type SchoolGuardianRelation,
  type SchoolMatriculeScope,
  type SchoolSex,
  type SchoolStudentStatus,
} from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Champ facultatif : une chaîne vide vaut « non renseigné ». */
const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Champ facultatif sans valeur nulle : absent, ou valide. */
const notUndefined = (_: unknown, value: unknown) => value !== undefined;

export class StudentInputDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  lastName: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  firstName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(120)
  lastNameAr?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(120)
  firstNameAr?: string | null;

  @ApiProperty({ example: '2015-03-14' })
  @Matches(DAY)
  @IsISO8601({ strict: true })
  birthDate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(120)
  birthPlace?: string | null;

  @ApiPropertyOptional({ enum: SCHOOL_SEXES })
  @IsOptional()
  @Transform(trimOrNull)
  @IsIn([...SCHOOL_SEXES, null])
  sex?: SchoolSex | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(80)
  nationality?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @ApiPropertyOptional({ description: 'Limité aux informations administratives nécessaires.' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(1000)
  adminNotes?: string | null;

  @ApiPropertyOptional({ description: 'Valeurs des champs définis par l’établissement.' })
  @IsOptional()
  @IsObject()
  customFields?: Record<string, string>;
}

export class CreateStudentDto extends StudentInputDto {
  @ApiProperty()
  @IsUUID('4')
  schoolId: string;

  @ApiPropertyOptional({ description: 'Matricule existant ; sinon généré.' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(40)
  matricule?: string | null;

  @ApiPropertyOptional({ description: 'Année utilisée dans le matricule généré.' })
  @IsOptional()
  @IsUUID('4')
  schoolYearId?: string;

  @ApiPropertyOptional({ description: 'Homonyme réel confirmé : mêmes nom, prénom et naissance.' })
  @IsOptional()
  @IsBoolean()
  confirmHomonym?: boolean;
}

export class UpdateStudentDto extends PartialType(StudentInputDto) {}

export class CorrectMatriculeDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  matricule: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason: string;
}

export class SensitiveDto {
  @ApiProperty({ nullable: true })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  specialNeeds: string | null;
}

export class StudentsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  schoolId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  schoolYearId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  levelId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  classId?: string;

  @ApiPropertyOptional({ enum: SCHOOL_STUDENT_STATUSES })
  @IsOptional()
  @IsIn(SCHOOL_STUDENT_STATUSES)
  status?: SchoolStudentStatus;

  @ApiPropertyOptional({ description: 'Nom français ou arabe, ou matricule.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class OptionalSchoolQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  schoolId?: string;
}

export class StudentSettingsDto {
  @ApiProperty({ enum: SCHOOL_MATRICULE_SCOPES })
  @IsIn(SCHOOL_MATRICULE_SCOPES)
  matriculeScope: SchoolMatriculeScope;

  @ApiProperty({ description: 'Lettres et chiffres, vide si aucun.' })
  @Transform(trim)
  @IsString()
  @Matches(/^[A-Za-z0-9]{0,10}$/)
  matriculePrefix: string;

  @ApiProperty()
  @IsBoolean()
  matriculeYear: boolean;

  @ApiProperty()
  @IsInt()
  @Min(3)
  @Max(8)
  matriculePadding: number;

  @ApiProperty({ enum: SCHOOL_DOCUMENT_CATEGORIES, isArray: true })
  @IsArray()
  @IsIn(SCHOOL_DOCUMENT_CATEGORIES, { each: true })
  requiredDocuments: SchoolDocumentCategory[];

  @ApiProperty({ type: Object, isArray: true })
  @IsArray()
  @ArrayMaxSize(20)
  @IsObject({ each: true })
  customFields: SchoolCustomField[];
}

// ─── Inscriptions ───

export class CreateEnrollmentDto {
  @ApiProperty()
  @IsUUID('4')
  studentId: string;

  @ApiProperty()
  @IsUUID('4')
  schoolYearId: string;

  @ApiProperty()
  @IsUUID('4')
  levelId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  classId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  trackId?: string;

  @ApiPropertyOptional({ description: 'Soumet directement à la validation.' })
  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}

export class EnrollmentStatusDto {
  @ApiProperty({ enum: SCHOOL_ENROLLMENT_STATUSES })
  @IsIn(SCHOOL_ENROLLMENT_STATUSES)
  status: SchoolEnrollmentStatus;

  @ApiPropertyOptional({ description: 'Obligatoire pour annuler une inscription validée.' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class EnrollmentsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  schoolId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  schoolYearId?: string;

  @ApiPropertyOptional({ enum: SCHOOL_ENROLLMENT_STATUSES })
  @IsOptional()
  @IsIn(SCHOOL_ENROLLMENT_STATUSES)
  status?: SchoolEnrollmentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

export class ChangeClassDto {
  @ApiProperty()
  @IsUUID('4')
  classId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(300)
  reason?: string | null;
}

export class ExitDto {
  @ApiProperty({ enum: SCHOOL_EXIT_REASONS })
  @IsIn(SCHOOL_EXIT_REASONS)
  reason: SchoolExitReason;

  @ApiProperty()
  @Matches(DAY)
  @IsISO8601({ strict: true })
  exitedOn: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class TransferDto {
  @ApiProperty()
  @IsUUID('4')
  targetSchoolId: string;

  @ApiProperty()
  @IsUUID('4')
  targetSchoolYearId: string;

  @ApiProperty()
  @IsUUID('4')
  targetLevelId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  targetClassId?: string;

  @ApiProperty()
  @Matches(DAY)
  @IsISO8601({ strict: true })
  effectiveOn: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason: string;
}

export class ClassTeacherDto {
  @ApiProperty()
  @IsUUID('4')
  memberId: string;
}

// ─── Responsables ───

export class CreateGuardianDto {
  @ApiProperty()
  @IsUUID('4')
  schoolId: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  lastName: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  firstName: string;

  @ApiProperty()
  @Transform(trim)
  @Matches(SCHOOL_PHONE, { message: 'Numéro de téléphone invalide.' })
  phone: string;

  @ApiPropertyOptional({ description: 'Facultatif : tous les parents n’ont pas d’e-mail.' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsEmail()
  email?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(300)
  address?: string | null;
}

class GuardianContactDto {
  @ApiPropertyOptional()
  @ValidateIf(notUndefined)
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  lastName?: string;

  @ApiPropertyOptional()
  @ValidateIf(notUndefined)
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  firstName?: string;

  @ApiPropertyOptional()
  @ValidateIf(notUndefined)
  @Transform(trim)
  @Matches(SCHOOL_PHONE, { message: 'Numéro de téléphone invalide.' })
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsEmail()
  email?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(300)
  address?: string | null;
}

export class UpdateGuardianDto extends GuardianContactDto {}

export class GuardiansQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  schoolId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class GuardianLinkRightsDto {
  @ApiPropertyOptional({ enum: SCHOOL_GUARDIAN_RELATIONS })
  @ValidateIf(notUndefined)
  @IsIn(SCHOOL_GUARDIAN_RELATIONS)
  relation?: SchoolGuardianRelation;

  @ApiPropertyOptional()
  @ValidateIf(notUndefined)
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional()
  @ValidateIf(notUndefined)
  @IsBoolean()
  isEmergency?: boolean;

  @ApiPropertyOptional()
  @ValidateIf(notUndefined)
  @IsBoolean()
  canReceiveSms?: boolean;

  @ApiPropertyOptional()
  @ValidateIf(notUndefined)
  @IsBoolean()
  canViewSchoolInfo?: boolean;

  @ApiPropertyOptional()
  @ValidateIf(notUndefined)
  @IsBoolean()
  canPickUp?: boolean;
}

export class LinkGuardianDto extends GuardianLinkRightsDto {
  @ApiProperty()
  @IsUUID('4')
  guardianId: string;

  @ApiProperty({ enum: SCHOOL_GUARDIAN_RELATIONS })
  @IsIn(SCHOOL_GUARDIAN_RELATIONS)
  declare relation: SchoolGuardianRelation;
}

// ─── Documents, imports, exports ───

export class UploadDocumentDto {
  @ApiProperty({ enum: SCHOOL_DOCUMENT_CATEGORIES })
  @IsIn(SCHOOL_DOCUMENT_CATEGORIES)
  category: SchoolDocumentCategory;
}

export class ImportDto {
  @ApiProperty()
  @IsUUID('4')
  schoolId: string;

  @ApiPropertyOptional({ description: 'Année des inscriptions créées si le niveau est renseigné.' })
  @IsOptional()
  @IsUUID('4')
  schoolYearId?: string;

  @ApiPropertyOptional({ description: 'Correspondance des colonnes, en JSON.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  mapping?: string;

  @ApiPropertyOptional({
    description: '« true » : importe les lignes valides et rapporte les autres.',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  skipInvalid?: 'true' | 'false';
}

export class ExportQueryDto {
  @ApiProperty()
  @IsUUID('4')
  schoolId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  classId?: string;

  @ApiPropertyOptional({ enum: ['csv', 'xlsx'] })
  @IsOptional()
  @IsIn(['csv', 'xlsx'])
  format?: 'csv' | 'xlsx';
}
