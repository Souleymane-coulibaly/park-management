import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

/** Compétence de l'entreprise (liste libre, F6B). */
export class FactureSkillDto {
  @ApiProperty({ description: 'Ex. « Climatisation », « Électricité », « Groupe électrogène »' })
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name: string;
}

export class UpdateFactureSkillDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

export class FactureMemberSkillsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  skillIds: string[];
}

export class FactureUnavailabilityDto {
  @ApiProperty()
  @IsUUID()
  memberId: string;

  @ApiProperty({ description: 'Début (ISO 8601, avec fuseau)' })
  @IsISO8601({ strict: true })
  startsAt: string;

  @ApiProperty({ description: 'Fin (ISO 8601, avec fuseau)' })
  @IsISO8601({ strict: true })
  endsAt: string;

  @ApiPropertyOptional({ description: 'Congé, formation, absence…' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(160)
  reason?: string | null;
}

export class FactureUnavailabilityQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  memberId?: string;
}
