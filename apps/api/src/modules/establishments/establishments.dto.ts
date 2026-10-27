import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsTimeZone,
  Length,
  MaxLength,
} from 'class-validator';
import { BUSINESS_TYPES, type BusinessType } from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateEstablishmentDto {
  @ApiProperty({ example: 'Aqua Splash — Kalaban Coro' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiProperty({
    enum: BUSINESS_TYPES,
    description: "Doit être compatible avec le métier de l'organisation.",
  })
  @IsIn(BUSINESS_TYPES)
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
}

export class UpdateEstablishmentDto extends PartialType(CreateEstablishmentDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
