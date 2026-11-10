import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  FACTURE_REGISTRATION_PATTERN,
  FACTURE_ROLES,
  FACTURE_VAT_RATES,
  type FactureRole,
} from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Champ facultatif : une chaîne vide vaut « non renseigné ». */
const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

/** Identité légale et réglages de facturation (mentions imprimées sur les documents). */
export class FactureSettingsDto {
  @ApiProperty({ description: 'Raison sociale' })
  @Transform(trim)
  @IsString()
  @Length(2, 160)
  legalName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(120)
  tradeName?: string | null;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 240)
  address: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  city: string;

  @ApiPropertyOptional({ description: 'Téléphone au format international (+223 …)' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\+[0-9][0-9 ().-]{6,22}$/, { message: 'Téléphone au format international (+223 …).' })
  phone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v !== null)
  @IsEmail()
  @MaxLength(160)
  email?: string | null;

  @ApiPropertyOptional({ description: 'Numéro d’identification fiscale (NIF)' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v !== null)
  @Matches(FACTURE_REGISTRATION_PATTERN, { message: 'NIF invalide.' })
  nif?: string | null;

  @ApiPropertyOptional({ description: 'Registre du commerce et du crédit mobilier (RCCM)' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v !== null)
  @Matches(FACTURE_REGISTRATION_PATTERN, { message: 'RCCM invalide.' })
  rccm?: string | null;

  @ApiPropertyOptional({ description: 'Régime d’imposition, imprimé sur les factures' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(120)
  taxRegime?: string | null;

  @ApiPropertyOptional({ description: 'Coordonnées bancaires imprimées en pied de document' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(400)
  bankDetails?: string | null;

  @ApiPropertyOptional({ description: 'Mentions complémentaires imprimées en pied de document' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(600)
  legalFooter?: string | null;

  @ApiProperty({ enum: FACTURE_VAT_RATES, description: 'Taux de TVA par défaut (0 à 20 %)' })
  @IsInt()
  @IsIn(FACTURE_VAT_RATES)
  defaultVatRate: number;

  @ApiProperty({ minimum: 0, maximum: 365 })
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays: number;
}

export class CreateFactureMemberDto {
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
  @ValidateIf((_, v) => v !== null)
  @IsEmail()
  email?: string | null;

  @ApiProperty({ enum: FACTURE_ROLES })
  @IsIn(FACTURE_ROLES)
  role: FactureRole;
}

export class UpdateFactureMemberDto {
  @ApiPropertyOptional({ enum: FACTURE_ROLES })
  @IsOptional()
  @IsIn(FACTURE_ROLES)
  role?: FactureRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
