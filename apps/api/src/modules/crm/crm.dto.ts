import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Fiche client. Toutes les informations sont facultatives, mais il faut au moins un nom ou un
 * téléphone, et le consentement du client à la conservation de sa fiche.
 */
export class CreateCustomerDto {
  @ApiPropertyOptional({ example: 'Awa' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(60)
  firstName?: string | null;

  @ApiPropertyOptional({ example: 'Traoré' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(60)
  lastName?: string | null;

  @ApiPropertyOptional({ example: '+223 70 00 00 01' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(300)
  notes?: string | null;

  @ApiProperty({
    description: 'Le client accepte la conservation de sa fiche (obligatoire pour la créer).',
  })
  @Equals(true, { message: 'Le consentement du client est obligatoire.' })
  consent: boolean;

  @ApiPropertyOptional({ default: false, description: 'Communications commerciales (facultatif).' })
  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;
}

export class UpdateCustomerDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(60)
  firstName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(60)
  lastName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(300)
  notes?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;
}

export class CustomersQueryDto {
  @ApiPropertyOptional({
    description: 'Nom ou téléphone (3 caractères au moins sans accès complet).',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  q?: string;

  @ApiPropertyOptional({ enum: ['all', 'marketing', 'inactive', 'withPoints'] })
  @IsOptional()
  @IsIn(['all', 'marketing', 'inactive', 'withPoints'])
  filter?: 'all' | 'marketing' | 'inactive' | 'withPoints';

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class EraseCustomerDto {
  @ApiProperty({ example: 'Demande du client' })
  @Transform(trim)
  @IsString()
  @Length(3, 200)
  reason: string;
}
