import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SCHOOL_TEACHING_REASON_MAX } from '@ocall/shared';
import { trim, trimOrNull } from './school.dto';

// ─── Matières ───

export class ActivateCatalogSubjectDto {
  @ApiProperty()
  @IsUUID('4')
  schoolId: string;
}

export class UpdateSubjectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(120)
  nameAr?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  defaultCoefficient?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SubjectLevelDto {
  @ApiProperty()
  @IsUUID('4')
  levelId: string;

  @ApiPropertyOptional({
    description: 'Coefficient propre à ce niveau ; sinon celui de la matière.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  coefficient?: number | null;

  @ApiPropertyOptional({ description: 'Heures hebdomadaires.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(60)
  weeklyHours?: number | null;
}

export class SubjectLevelsDto {
  @ApiProperty({ type: [SubjectLevelDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SubjectLevelDto)
  levels: SubjectLevelDto[];
}

// ─── Classes et groupes ───

export class UpdateClassDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(120)
  nameAr?: string | null;

  @ApiPropertyOptional({
    description: 'Jamais inférieure à l’effectif inscrit ; vide = sans limite.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity?: number | null;

  @ApiPropertyOptional({ description: 'Archivage : la classe n’est jamais supprimée.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateGroupDto {
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
}

export class UpdateGroupDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class GroupStudentsDto {
  @ApiProperty({
    type: [String],
    description: 'Élèves inscrits (inscription validée) dans la classe.',
  })
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  studentIds: string[];
}

// ─── Enseignants et affectations ───

export class TeacherQueryDto {
  @ApiProperty()
  @IsUUID('4')
  schoolId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  subjectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  classId?: string;

  @ApiPropertyOptional({ description: 'Nom, prénom ou identifiant.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ description: 'true : actifs seulement ; false : inactifs seulement.' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  active?: boolean;
}

export class TeacherSubjectsDto {
  @ApiProperty({ type: [String], description: 'Matières que l’enseignant peut enseigner.' })
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  subjectIds: string[];
}

export class AssignmentQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  classId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  memberId?: string;

  @ApiPropertyOptional({ description: 'true : historique compris (affectations terminées).' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  history?: boolean;
}

export class CreateAssignmentDto {
  @ApiProperty()
  @IsUUID('4')
  classId: string;

  @ApiPropertyOptional({ description: 'Groupe de la classe ; sinon la classe entière.' })
  @IsOptional()
  @IsUUID('4')
  groupId?: string;

  @ApiProperty()
  @IsUUID('4')
  subjectId: string;

  @ApiProperty()
  @IsUUID('4')
  memberId: string;

  @ApiPropertyOptional({ description: 'Professeur principal : un seul actif par classe.' })
  @IsOptional()
  @IsBoolean()
  isHomeroom?: boolean;
}

export class EndAssignmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(SCHOOL_TEACHING_REASON_MAX)
  reason?: string | null;
}

export class ReplaceAssignmentDto extends EndAssignmentDto {
  @ApiProperty({ description: 'Enseignant remplaçant.' })
  @IsUUID('4')
  memberId: string;
}
