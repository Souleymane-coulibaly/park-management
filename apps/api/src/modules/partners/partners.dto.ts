import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PARTNER_SETTABLE_PROSPECT_STATUSES } from '@ocall/shared';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
const PHONE = /^\+?[0-9 ().-]{6,24}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ─── Super Admin ───

export class CreatePartnerDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  companyName: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 40)
  firstName: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 40)
  lastName: string;

  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(160)
  email: string;

  @ApiProperty()
  @Transform(trim)
  @Matches(PHONE)
  phone: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  country: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Length(2, 60, { each: true })
  territories?: string[];
}

export class UpdatePartnerDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Length(2, 60, { each: true })
  territories?: string[];

  @ApiPropertyOptional({ description: 'Encaissement d’espèces (désactivé par défaut).' })
  @IsOptional()
  @IsBoolean()
  cashCollectionEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Plafond des collectes non remises (FCFA).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50_000_000)
  cashCollectionLimit?: number;

  @ApiPropertyOptional({ nullable: true, description: 'Règle de commission propre au partenaire.' })
  @IsOptional()
  @IsUUID('4')
  commissionRuleId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ReasonDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 500)
  reason: string;
}

export class CreateCommissionRuleDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name: string;

  @ApiProperty({
    description: 'Taux sur la mise en service encaissée, en points de base (1500 = 15 %).',
  })
  @IsInt()
  @Min(0)
  @Max(10_000)
  setupRateBps: number;

  @ApiProperty({ description: 'Taux sur les mensualités encaissées, en points de base.' })
  @IsInt()
  @Min(0)
  @Max(10_000)
  monthlyRateBps: number;

  @ApiProperty({ description: 'Mois de mensualités commissionnés après la première activation.' })
  @IsInt()
  @Min(0)
  @Max(120)
  monthlyWindowMonths: number;

  @ApiPropertyOptional({ description: 'Produit concerné (vide : tous).' })
  @IsOptional()
  @IsUUID('4')
  productId?: string;
}

export class ProposeAttributionDto {
  @ApiProperty()
  @IsUUID('4')
  organizationId: string;

  @ApiProperty()
  @IsUUID('4')
  partnerId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  prospectId?: string;
}

export class ExtendProtectionDto {
  @ApiProperty({ description: 'Jours ajoutés à la réservation du prospect.' })
  @IsInt()
  @Min(1)
  @Max(365)
  days: number;
}

export class IdsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  ids: string[];
}

export class RecordPayoutDto {
  @ApiProperty()
  @IsUUID('4')
  partnerId: string;

  @ApiProperty({
    type: [String],
    description: 'Commissions validées à verser (et régularisations).',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  commissionIds: string[];

  @ApiProperty({ example: 'Virement' })
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  method: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  reference?: string;

  @ApiProperty()
  @Matches(DATE)
  paidAt: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

// ─── Portail partenaire ───

export class CreateProspectDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  companyName: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  contactName: string;

  @ApiProperty()
  @Transform(trim)
  @Matches(PHONE)
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(160)
  email?: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  country: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ description: 'Identifiant public du produit visé.' })
  @IsOptional()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  product?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateProspectDto {
  @ApiPropertyOptional({ enum: PARTNER_SETTABLE_PROSPECT_STATUSES })
  @IsOptional()
  @IsIn(PARTNER_SETTABLE_PROSPECT_STATUSES)
  status?: (typeof PARTNER_SETTABLE_PROSPECT_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ProspectDemoDto {
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(10, 2000)
  message: string;
}
