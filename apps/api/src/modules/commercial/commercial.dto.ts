import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export const DEMO_REQUEST_STATUSES = [
  'NEW',
  'CONTACTED',
  'DEMO_SCHEDULED',
  'WON',
  'LOST',
  'SPAM',
] as const;

/**
 * Demande de démonstration du site public (Sprint 12A). Anti-spam : champ piège invisible
 * (`website`, doit rester vide), délai minimal de remplissage (`startedAt`), limite par IP.
 */
export class CreateDemoRequestDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  company: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  country: string;

  @ApiProperty({ description: 'Téléphone avec indicatif, ex. +223 70 00 00 00.' })
  @Transform(trim)
  @Matches(/^\+?[0-9 ().-]{6,24}$/)
  phone: string;

  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(160)
  email: string;

  @ApiPropertyOptional({ description: 'Identifiant public du produit souhaité.' })
  @IsOptional()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  @MaxLength(60)
  product?: string;

  @ApiProperty()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(10, 2000)
  message: string;

  @ApiProperty({ description: 'Accord sur la politique de confidentialité.' })
  @IsBoolean()
  @Equals(true)
  consent: boolean;

  @ApiPropertyOptional({ description: 'Champ piège : doit rester vide.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;

  @ApiProperty({ description: 'Horodatage (ms) de l’affichage du formulaire.' })
  @IsInt()
  startedAt: number;
}

export class UpdateDemoRequestDto {
  @ApiPropertyOptional({ enum: DEMO_REQUEST_STATUSES })
  @IsOptional()
  @IsIn(DEMO_REQUEST_STATUSES)
  status?: (typeof DEMO_REQUEST_STATUSES)[number];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID('4')
  assignedToId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class DemoRequestsQueryDto {
  @ApiPropertyOptional({ enum: DEMO_REQUEST_STATUSES })
  @IsOptional()
  @IsIn(DEMO_REQUEST_STATUSES)
  status?: (typeof DEMO_REQUEST_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[A-Z][A-Z0-9_]{2,39}$/)
  productCode?: string;
}
