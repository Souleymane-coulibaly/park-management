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
  BUSINESS_TYPES,
  type BusinessType,
  SUBSCRIPTION_PAYMENT_MAX_AMOUNT,
  SUBSCRIPTION_PAYMENT_METHODS,
  SUBSCRIPTION_PAYMENT_STATUSES,
  SUPPORTED_COUNTRIES,
  type SubscriptionPaymentMethod,
  type SubscriptionPaymentStatus,
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
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Saisie d'un règlement d'abonnement reçu HORS plateforme (espèces, virement, mobile money…). */
export class RecordSubscriptionPaymentDto {
  @ApiProperty()
  @IsUUID('4')
  organizationId: string;

  @ApiPropertyOptional({
    description: 'Facture réglée (le montant doit couvrir le reste à payer).',
  })
  @IsOptional()
  @IsUUID('4')
  invoiceId?: string;

  @ApiProperty({ description: 'Montant entier en FCFA.' })
  @IsInt()
  @Min(1)
  @Max(SUBSCRIPTION_PAYMENT_MAX_AMOUNT)
  amount: number;

  @ApiProperty({ enum: SUBSCRIPTION_PAYMENT_METHODS })
  @IsIn(SUBSCRIPTION_PAYMENT_METHODS)
  method: SubscriptionPaymentMethod;

  @ApiPropertyOptional({ description: 'Référence du virement, du reçu ou de la transaction.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  reference?: string;

  @ApiProperty({ description: 'Date du règlement (AAAA-MM-JJ).' })
  @Matches(DATE)
  paidAt: string;

  @ApiProperty({ description: 'Début de la période couverte (incluse).' })
  @Matches(DATE)
  periodStart: string;

  @ApiProperty({ description: 'Fin de la période couverte (incluse).' })
  @Matches(DATE)
  periodEnd: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ValidateSubscriptionPaymentDto {
  @ApiProperty({
    description:
      'Activer / prolonger l’abonnement jusqu’à la fin de la période couverte. Choix explicite du Super Admin, faux par défaut.',
  })
  @IsBoolean()
  extendSubscription: boolean;
}

export class RejectSubscriptionPaymentDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason: string;
}

export class SubscriptionPaymentsQueryDto {
  @ApiPropertyOptional({ enum: SUBSCRIPTION_PAYMENT_STATUSES })
  @IsOptional()
  @IsIn(SUBSCRIPTION_PAYMENT_STATUSES)
  status?: SubscriptionPaymentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  organizationId?: string;
}

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
