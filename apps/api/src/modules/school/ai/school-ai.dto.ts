import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  SCHOOL_AI_CONTENT_KINDS,
  SCHOOL_AI_DIFFICULTIES,
  SCHOOL_AI_LANGUAGES,
  SCHOOL_AI_LIMITS as LIMITS,
  type SchoolAiContentKind,
  type SchoolAiDifficulty,
  type SchoolAiLanguage,
} from '@ocall/shared';
import { lowerUuid } from '../school-portal.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class SchoolAiScopeDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  schoolId: string;
}

export class SchoolAiSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  copilotEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  teachingEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  analysisEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  monthlyCallLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  alertPercent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  conversationRetentionDays?: number;
}

export class CopilotQuestionDto extends SchoolAiScopeDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(LIMITS.questionMaxLength)
  question: string;

  @ApiPropertyOptional({
    description: 'Conversation à poursuivre ; absente = nouvelle conversation.',
  })
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  conversationId?: string;
}

export class GenerateContentDto extends SchoolAiScopeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  classId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  levelId?: string;

  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  subjectId: string;

  @ApiProperty({ enum: SCHOOL_AI_CONTENT_KINDS })
  @IsIn(SCHOOL_AI_CONTENT_KINDS)
  kind: SchoolAiContentKind;

  @ApiProperty({ enum: SCHOOL_AI_LANGUAGES })
  @IsIn(SCHOOL_AI_LANGUAGES)
  language: SchoolAiLanguage;

  @ApiProperty({ enum: SCHOOL_AI_DIFFICULTIES })
  @IsIn(SCHOOL_AI_DIFFICULTIES)
  difficulty: SchoolAiDifficulty;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(LIMITS.topicMaxLength)
  topic: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MaxLength(LIMITS.objectivesMaxLength)
  objectives: string;
}

export class ContentSectionDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{0,39}$/)
  key: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  heading: string;

  @ApiProperty()
  @IsString()
  @MaxLength(LIMITS.sectionMaxLength)
  body: string;
}

export class UpdateContentDto {
  @ApiProperty({ description: 'Version relue (date de mise à jour du contenu, ISO 8601).' })
  @IsString()
  @MaxLength(40)
  version: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(LIMITS.titleMaxLength)
  title: string;

  @ApiProperty({ type: [ContentSectionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(LIMITS.sectionsMax)
  @ValidateNested({ each: true })
  @Type(() => ContentSectionDto)
  sections: ContentSectionDto[];
}

export class RegenerateSectionDto {
  @ApiProperty({ description: 'Version relue (date de mise à jour du contenu, ISO 8601).' })
  @IsString()
  @MaxLength(40)
  version: string;

  @ApiPropertyOptional({ description: 'Consigne de l’enseignant pour cette section.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  instruction?: string;
}

/** Validation : version (date de mise à jour) relue par l'auteur ; refus si elle a changé depuis. */
export class ValidateContentDto {
  @ApiProperty({ description: 'Version relue (date de mise à jour du contenu, ISO 8601).' })
  @IsString()
  @MaxLength(40)
  version: string;
}

export class ContentListDto extends SchoolAiScopeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['DRAFT', 'VALIDATED', 'ARCHIVED'])
  status?: 'DRAFT' | 'VALIDATED' | 'ARCHIVED';
}

export class AnalysisQueryDto extends SchoolAiScopeDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  schoolYearId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  classId?: string;
}
