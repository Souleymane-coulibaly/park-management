import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsTimeZone,
  IsUUID,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  BUSINESS_TYPES,
  type BusinessType,
  ESTABLISHMENT_KINDS,
  type EstablishmentKind,
} from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateEstablishmentDto {
  @ApiProperty({ example: 'Aqua Splash — Kalaban Coro' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiProperty({
    enum: [...BUSINESS_TYPES, 'NONE'],
    description:
      "Doit être compatible avec le métier de l'organisation. Sprint Suite 2B : NONE = lieu sans activité Park (boutique, école, agence…), utilisé par d'autres applications.",
  })
  @IsIn([...BUSINESS_TYPES, 'NONE'])
  businessType: BusinessType;

  @ApiPropertyOptional({ example: 'Bamako' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  address?: string;

  @ApiPropertyOptional({ example: '+223 70 00 00 00' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({
    example: 'Africa/Bamako',
    description: "Par défaut : fuseau de l'organisation.",
  })
  @IsOptional()
  @IsTimeZone()
  timezone?: string;

  @ApiPropertyOptional({
    enum: ESTABLISHMENT_KINDS,
    nullable: true,
    description: 'Sprint Suite 2B : nature du lieu (boutique, dépôt, école…).',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(ESTABLISHMENT_KINDS)
  kind?: EstablishmentKind | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Sprint Suite 2B : enseigne active de la même organisation ; null pour la retirer.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  brandId?: string | null;
}

export class UpdateEstablishmentDto extends PartialType(CreateEstablishmentDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Sprint Suite 2B : enseigne (marque ou activité commerciale) de l'organisation. */
export class CreateBrandDto {
  @ApiProperty({ example: 'Quincaillerie du Sahel' })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name: string;
}

export class UpdateBrandDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
