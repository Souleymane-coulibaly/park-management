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
  ValidateNested,
} from 'class-validator';
import {
  ACTIVATION_MODES,
  type ActivationMode,
  BUSINESS_TYPES,
  type BusinessType,
  SUPPORTED_COUNTRIES,
  INVOICE_LINE_KINDS,
  INVOICE_STATUSES,
  type InvoiceLineKind,
  type InvoiceStatus,
  PLATFORM_ROLES,
  type PlatformRoleName,
  SAAS_PRODUCT_STATUSES,
  type SaasProductStatus,
} from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateOrganizationByAdminDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  organizationName: string;

  @ApiProperty({ enum: BUSINESS_TYPES })
  @IsIn(BUSINESS_TYPES)
  businessType: BusinessType;

  @ApiProperty({ example: 'ML' })
  @IsIn(SUPPORTED_COUNTRIES.map((c) => c.code))
  countryCode: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  establishmentName: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  ownerFirstName: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  ownerLastName: string;

  @ApiProperty()
  @Transform(lower)
  @IsEmail()
  @MaxLength(254)
  ownerEmail: string;
}

export class SetOrganizationStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] })
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status: 'ACTIVE' | 'SUSPENDED';
}

export class UpdatePlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name?: string;

  @ApiPropertyOptional({ description: 'Prix mensuel entier en FCFA.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  monthlyPrice?: number;

  @ApiPropertyOptional({ description: 'Frais de mise en service unique, entier en FCFA.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  setupFee?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
  @ApiPropertyOptional({ description: 'Appels IA par mois autorisés par l’offre.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  aiMonthlyCallQuota?: number;

  @ApiPropertyOptional({ description: 'Stockage de fichiers autorisé par l’offre (Mo).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  storageQuotaMb?: number;

  @ApiPropertyOptional({
    enum: ACTIVATION_MODES,
    description: 'Activation après paiement vérifié : AUTO ou ADMIN_APPROVAL (défaut).',
  })
  @IsOptional()
  @IsIn(ACTIVATION_MODES)
  activationMode?: ActivationMode;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ─── Sprint 11A : Ocall Suite ───

export class CreateProductDto {
  @ApiProperty({ example: 'OCALL_SCHOOL' })
  @Matches(/^[A-Z][A-Z0-9_]{2,39}$/)
  code: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ enum: SAAS_PRODUCT_STATUSES })
  @IsIn(SAAS_PRODUCT_STATUSES)
  status: SaasProductStatus;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @Matches(/^[a-z][a-z0-9-]{1,39}$/, { each: true })
  features?: string[];

  @ApiPropertyOptional({ description: 'Identifiant public de la page produit (ex. ocall-park).' })
  @IsOptional()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  @MaxLength(60)
  slug?: string;

  @ApiPropertyOptional({ description: 'Accroche du site public.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(140)
  tagline?: string;

  @ApiPropertyOptional({ description: 'Affiché dans le catalogue public.' })
  @IsOptional()
  @IsBoolean()
  listed?: boolean;

  @ApiPropertyOptional({ description: 'Adresse https de l’application, si elle est déployée.' })
  @IsOptional()
  @Matches(/^https:\/\/[^\s]{3,200}$/)
  appUrl?: string | null;

  @ApiPropertyOptional({ description: 'Date de disponibilité validée (AAAA-MM-JJ).' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  availableAt?: string | null;
}

export class UpdateProductDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: SAAS_PRODUCT_STATUSES })
  @IsOptional()
  @IsIn(SAAS_PRODUCT_STATUSES)
  status?: SaasProductStatus;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @Matches(/^[a-z][a-z0-9-]{1,39}$/, { each: true })
  features?: string[];

  @ApiPropertyOptional({ description: 'Identifiant public de la page produit (ex. ocall-park).' })
  @IsOptional()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  @MaxLength(60)
  slug?: string;

  @ApiPropertyOptional({ description: 'Accroche du site public.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(140)
  tagline?: string;

  @ApiPropertyOptional({ description: 'Affiché dans le catalogue public.' })
  @IsOptional()
  @IsBoolean()
  listed?: boolean;

  @ApiPropertyOptional({ description: 'Adresse https de l’application, si elle est déployée.' })
  @IsOptional()
  @Matches(/^https:\/\/[^\s]{3,200}$/)
  appUrl?: string | null;

  @ApiPropertyOptional({ description: 'Date de disponibilité validée (AAAA-MM-JJ).' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  availableAt?: string | null;
}

export class CreatePlanDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name: string;

  @ApiProperty({ description: 'Prix mensuel entier en FCFA.' })
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  monthlyPrice: number;

  @ApiPropertyOptional({ description: 'Frais de mise en service unique, entier en FCFA.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  setupFee?: number;

  @ApiPropertyOptional({ description: 'Appels IA par mois autorisés par l’offre.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  aiMonthlyCallQuota?: number;

  @ApiPropertyOptional({ description: 'Stockage de fichiers autorisé par l’offre (Mo).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  storageQuotaMb?: number;

  @ApiPropertyOptional({
    enum: ACTIVATION_MODES,
    description: 'Activation après paiement vérifié : AUTO ou ADMIN_APPROVAL (défaut).',
  })
  @IsOptional()
  @IsIn(ACTIVATION_MODES)
  activationMode?: ActivationMode;
}

export class SubscribeProductDto {
  @ApiProperty()
  @IsUUID('4')
  productId: string;

  @ApiProperty()
  @IsUUID('4')
  planId: string;
}

export class InvoiceLineDto {
  @ApiProperty({ enum: INVOICE_LINE_KINDS })
  @IsIn(INVOICE_LINE_KINDS)
  kind: InvoiceLineKind;

  @ApiPropertyOptional({ description: 'Mensualités facturées (MONTHLY).' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  months?: number;

  @ApiPropertyOptional({ description: 'Montant de l’ajustement (ADJUSTMENT), positif ou négatif.' })
  @IsOptional()
  @IsInt()
  amount?: number;

  @ApiPropertyOptional({ description: 'Motif obligatoire d’un ajustement.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class IssueInvoiceDto {
  @ApiProperty()
  @IsUUID('4')
  subscriptionId: string;

  @ApiProperty({ type: [InvoiceLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines: InvoiceLineDto[];

  @ApiPropertyOptional({ description: 'Échéance (AAAA-MM-JJ) ; défaut : 15 jours.' })
  @IsOptional()
  @Matches(DATE)
  dueAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({ description: 'Clé d’idempotence générée par l’écran (une facture par clé).' })
  @IsString()
  @Length(8, 80)
  idempotencyKey: string;
}

export class CancelInvoiceDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason: string;
}

export class InvoicesQueryDto {
  @ApiPropertyOptional({ enum: INVOICE_STATUSES })
  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  status?: InvoiceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  organizationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[A-Z][A-Z0-9_]{2,39}$/)
  product?: string;
}

export class CommercialQueryDto {
  @ApiPropertyOptional({ description: 'Code produit (ex. OCALL_PARK).' })
  @IsOptional()
  @Matches(/^[A-Z][A-Z0-9_]{2,39}$/)
  product?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE)
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE)
  to?: string;
}

export class CreateInternalUserDto {
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

  @ApiProperty()
  @Transform(lower)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ enum: PLATFORM_ROLES })
  @IsIn(PLATFORM_ROLES)
  role: PlatformRoleName;
}

export class ChangeInternalRoleDto {
  @ApiProperty({ enum: PLATFORM_ROLES })
  @IsIn(PLATFORM_ROLES)
  role: PlatformRoleName;
}

export class AuditQueryDto {
  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

/** Dérogations de quotas d'une organisation ; null = revenir au quota de l'offre. */
export class SetQuotasDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Appels IA par mois (null = quota de l’offre).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  aiMonthlyCalls?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Stockage en Mo (null = quota de l’offre).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  storageMb?: number | null;
}
