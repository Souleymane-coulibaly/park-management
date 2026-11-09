import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
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
  Equals,
  ValidateIf,
} from 'class-validator';
import {
  PARTNER_SETTABLE_PROSPECT_STATUSES,
  PARTNER_TYPES,
  PROSPECT_PIPELINE,
  type PartnerType,
} from '@ocall/shared';

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

  @ApiPropertyOptional({ enum: PARTNER_TYPES, description: 'Apporteur (défaut) ou revendeur.' })
  @IsOptional()
  @IsIn(PARTNER_TYPES)
  type?: PartnerType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  city?: string;
}

export class UpdatePartnerDto {
  @ApiPropertyOptional({ enum: PARTNER_TYPES, description: 'Modèle commercial (journalisé).' })
  @IsOptional()
  @IsIn(PARTNER_TYPES)
  type?: PartnerType;

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

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Mois de mensualités commissionnés après la première activation ; vide = tant que l’attribution est active.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(120)
  monthlyWindowMonths?: number | null;

  @ApiPropertyOptional({ description: 'Produit concerné (vide : tous).' })
  @IsOptional()
  @IsUUID('4')
  productId?: string;

  @ApiPropertyOptional({ enum: PARTNER_TYPES, description: 'Type de partenaire (vide : tous).' })
  @IsOptional()
  @IsIn(PARTNER_TYPES)
  partnerType?: PartnerType;
}

export class ProposeAttributionDto {
  @ApiProperty()
  @IsUUID('4')
  organizationId: string;

  @ApiProperty()
  @IsUUID('4')
  partnerId: string;

  @ApiProperty({ description: 'Application attribuée (Sprint S3 : attribution par application).' })
  @Matches(/^[A-Z][A-Z0-9_]{2,39}$/)
  productCode: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  prospectId?: string;
}

/** Attribution directe par le Super Admin (confirmée immédiatement, journalisée). */
export class AssignAttributionDto extends ProposeAttributionDto {
  @ApiProperty({ description: 'Motif de l’attribution directe.' })
  @Transform(trim)
  @IsString()
  @Length(3, 500)
  reason: string;
}

export class AttributionsQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'CONFIRMED', 'REJECTED', 'ENDED'] })
  @IsOptional()
  @IsIn(['PENDING', 'CONFIRMED', 'REJECTED', 'ENDED'])
  status?: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'ENDED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  partnerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  organizationId?: string;
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

  @ApiPropertyOptional({ description: 'Secteur d’activité du prospect.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  sector?: string;

  @ApiPropertyOptional({ description: 'Prochaine relance (AAAA-MM-JJ).' })
  @IsOptional()
  @Matches(DATE)
  nextFollowUpAt?: string;
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

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  sector?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Prochaine relance (AAAA-MM-JJ) ; null efface.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DATE)
  nextFollowUpAt?: string | null;
}

export class ProspectDemoDto {
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(10, 2000)
  message: string;
}

// ─── Sprint S3 : Ocall Partner ───

const email = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const multiline = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Candidature publique (page /devenir-partenaire). */
export class PartnerApplicationDto {
  @ApiProperty({ enum: PARTNER_TYPES })
  @IsIn(PARTNER_TYPES)
  type: PartnerType;

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

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  company?: string;

  @ApiProperty()
  @Transform(email)
  @IsEmail()
  @MaxLength(160)
  email: string;

  @ApiProperty({ description: 'Téléphone avec indicatif international (+223…).' })
  @Transform(trim)
  @Matches(/^\+[0-9][0-9 ().-]{6,22}$/, { message: 'Téléphone avec indicatif requis (+223…).' })
  phone: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  country: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  city: string;

  @ApiProperty()
  @Transform(multiline)
  @IsString()
  @Length(10, 1500)
  experience: string;

  @ApiProperty()
  @Transform(multiline)
  @IsString()
  @Length(3, 500)
  targetSectors: string;

  @ApiProperty()
  @Transform(multiline)
  @IsString()
  @Length(20, 2000)
  motivation: string;

  @ApiProperty({ description: 'Acceptation de la politique de confidentialité.' })
  @Equals(true)
  consent: boolean;

  @ApiPropertyOptional({ description: 'Champ piège anti-robot (doit rester vide).' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;

  @ApiProperty({ description: 'Ouverture du formulaire (ms) : anti-robot.' })
  @IsInt()
  startedAt: number;
}

export class PartnerApplicationsQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({ enum: PARTNER_TYPES })
  @IsOptional()
  @IsIn(PARTNER_TYPES)
  type?: PartnerType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  page?: number;
}

export class DecisionNoteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class PartnerInvitationTokenDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{32,64}$/)
  token: string;
}

export class PartnerActivationDto extends PartnerInvitationTokenDto {
  @ApiProperty()
  @IsString()
  @Length(8, 200)
  password: string;
}

/** Recherche, filtres, tri et pagination des prospects (portail et Super Admin). */
export class ProspectsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ enum: PROSPECT_PIPELINE })
  @IsOptional()
  @IsIn(PROSPECT_PIPELINE)
  status?: (typeof PROSPECT_PIPELINE)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  product?: string;

  @ApiPropertyOptional({ description: 'Seulement les relances dues (date passée).' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  followUpDue?: boolean;

  @ApiPropertyOptional({ enum: ['createdAt', 'nextFollowUpAt', 'companyName', 'updatedAt'] })
  @IsOptional()
  @IsIn(['createdAt', 'nextFollowUpAt', 'companyName', 'updatedAt'])
  sort?: 'createdAt' | 'nextFollowUpAt' | 'companyName' | 'updatedAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  partnerId?: string;
}

export class PayoutRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class PayoutRequestDecisionDto {
  @ApiProperty({ enum: ['PROCESSED', 'REJECTED'] })
  @IsIn(['PROCESSED', 'REJECTED'])
  outcome: 'PROCESSED' | 'REJECTED';

  @ApiPropertyOptional({ description: 'Versement correspondant (pour « réglée »).' })
  @IsOptional()
  @IsUUID('4')
  payoutId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Coordonnées modifiables par le partenaire lui-même (jamais statut, type ni taux). */
export class PartnerProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  companyName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @Matches(PHONE)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  city?: string;
}

/** Demande préparée par un revendeur pour un client qui lui est attribué. */
export class ResellerRequestDto {
  @ApiProperty()
  @IsUUID('4')
  organizationId: string;

  @ApiProperty({ example: 'OCALL_PARK' })
  @Matches(/^[A-Z][A-Z0-9_]{2,39}$/)
  productCode: string;

  @ApiProperty({ enum: ['ACTIVATION', 'RENEWAL'] })
  @IsIn(['ACTIVATION', 'RENEWAL'])
  kind: 'ACTIVATION' | 'RENEWAL';

  @ApiProperty()
  @IsUUID('4')
  planId: string;
}

export class PartnerStatsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  country?: string;
}
