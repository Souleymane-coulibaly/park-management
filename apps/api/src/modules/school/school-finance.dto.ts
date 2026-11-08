import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  SCHOOL_BENEFIT_KINDS,
  SCHOOL_CURRENCY_CODES,
  SCHOOL_FEE_CATEGORIES,
  SCHOOL_MAX_AMOUNT,
  SCHOOL_PAYMENT_METHODS,
  SCHOOL_PLAN_KINDS,
  type SchoolBenefitKind,
  type SchoolCurrency,
  type SchoolFeeCategory,
  type SchoolPaymentMethod,
  type SchoolPlanKind,
} from '@ocall/shared';
import { trim, trimOrNull } from './school.dto';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Identifiants comparés en minuscules partout : un même UUID n'a qu'une écriture. */
const lowerUuid = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase() : value;

// ─── Réglages ───

export class FinanceSettingsDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  schoolId: string;

  @ApiPropertyOptional({ enum: SCHOOL_CURRENCY_CODES })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(SCHOOL_CURRENCY_CODES)
  currency?: SchoolCurrency;

  @ApiPropertyOptional({ example: 'REC' })
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(trim)
  @Matches(/^[A-Z0-9]{2,8}$/, { message: 'Préfixe : 2 à 8 lettres majuscules ou chiffres.' })
  receiptPrefix?: string;

  @ApiPropertyOptional()
  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  secretaryCanCollect?: boolean;
}

// ─── Frais et échéanciers ───

export class CustomInstallmentDto {
  @ApiProperty()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  dueOn: string;

  @ApiProperty({ description: 'Montant en unités mineures de la devise.' })
  @IsInt()
  @Min(0)
  @Max(SCHOOL_MAX_AMOUNT)
  amount: number;
}

export class FeePlanDto {
  @ApiProperty({ enum: SCHOOL_PLAN_KINDS })
  @IsIn(SCHOOL_PLAN_KINDS)
  kind: SchoolPlanKind;

  @ApiPropertyOptional({ description: 'Annuel : date limite.' })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  dueOn?: string;

  @ApiPropertyOptional({ description: 'Mensuel ou trimestriel : premier mois AAAA-MM.' })
  @IsOptional()
  @Matches(MONTH)
  firstMonth?: string;

  @ApiPropertyOptional({ description: 'Mensuel ou trimestriel : dernier mois AAAA-MM.' })
  @IsOptional()
  @Matches(MONTH)
  lastMonth?: string;

  @ApiPropertyOptional({ description: 'Jour limite dans le mois (1 à 31).' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay?: number;

  @ApiPropertyOptional({ type: [CustomInstallmentDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => CustomInstallmentDto)
  installments?: CustomInstallmentDto[];
}

export class CreateFeeDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  schoolYearId: string;

  @ApiPropertyOptional({ description: 'Frais limité à un niveau.' })
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  levelId?: string | null;

  @ApiPropertyOptional({ description: 'Frais limité à une classe de cette année.' })
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  classId?: string | null;

  @ApiProperty({ enum: SCHOOL_FEE_CATEGORIES })
  @IsIn(SCHOOL_FEE_CATEGORIES)
  category: SchoolFeeCategory;

  @ApiProperty({ example: 'Scolarité 2026-2027' })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(120)
  nameAr?: string | null;

  @ApiProperty({ description: 'Montant annuel par élève, en unités mineures de la devise.' })
  @IsInt()
  @Min(0)
  @Max(SCHOOL_MAX_AMOUNT)
  amount: number;

  @ApiProperty({ example: '2026-10-01' })
  @IsISO8601({ strict: true })
  @Matches(DAY)
  effectiveFrom: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  mandatory?: boolean;

  @ApiProperty({ type: FeePlanDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => FeePlanDto)
  plan: FeePlanDto;
}

/** Modification partielle : un champ absent est ignoré ; null n'est permis que pour `nameAr`. */
export class UpdateFeeDto {
  @ApiPropertyOptional()
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(120)
  nameAr?: string | null;

  @ApiPropertyOptional()
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(SCHOOL_MAX_AMOUNT)
  amount?: number;

  @ApiPropertyOptional()
  @ValidateIf((_o, v) => v !== undefined)
  @IsISO8601({ strict: true })
  @Matches(DAY)
  effectiveFrom?: string;

  @ApiPropertyOptional()
  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  mandatory?: boolean;

  @ApiPropertyOptional()
  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: FeePlanDto })
  @ValidateIf((_o, v) => v !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => FeePlanDto)
  plan?: FeePlanDto;
}

export class FeeQueryDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  schoolYearId: string;
}

export class GenerateChargesDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Élèves visés ; obligatoire pour un frais facultatif (cantine, transport…).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.toLowerCase() : v)) : value,
  )
  @IsUUID('4', { each: true })
  studentIds?: string[];
}

// ─── Échéances et avantages ───

export class AdjustChargeDto {
  @ApiProperty({ description: 'Ajustement signé, en unités mineures (jamais nul).' })
  @IsInt()
  @Min(-SCHOOL_MAX_AMOUNT)
  @Max(SCHOOL_MAX_AMOUNT)
  amount: number;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason: string;
}

export class CreateBenefitDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  studentId: string;

  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  schoolYearId: string;

  @ApiProperty({ enum: SCHOOL_BENEFIT_KINDS })
  @IsIn(SCHOOL_BENEFIT_KINDS)
  kind: SchoolBenefitKind;

  @ApiProperty({
    description:
      'Réduction fixe : montant par échéance (unités mineures). Taux : points de base (10 000 = 100 %).',
  })
  @IsInt()
  @Min(0)
  @Max(SCHOOL_MAX_AMOUNT)
  value: number;

  @ApiPropertyOptional({ enum: SCHOOL_FEE_CATEGORIES, description: 'Limité à une catégorie.' })
  @IsOptional()
  @IsIn(SCHOOL_FEE_CATEGORIES)
  category?: SchoolFeeCategory | null;

  @ApiPropertyOptional({ description: 'Limité à un frais.' })
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  feeId?: string | null;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason: string;
}

export class ReasonDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason: string;
}

export class BenefitQueryDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  schoolYearId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  studentId?: string;
}

export class StudentFinanceQueryDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  schoolYearId: string;
}

export class LeaversQueryDto extends StudentFinanceQueryDto {
  @ApiPropertyOptional({ description: 'Nom, prénom ou matricule (contient).' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  q?: string;
}

// ─── Encaissements ───

export class AllocationDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  chargeId: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(SCHOOL_MAX_AMOUNT)
  amount: number;
}

export class CreatePaymentDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  studentId: string;

  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  schoolYearId: string;

  @ApiProperty({ description: 'Montant en unités mineures de la devise de l’établissement.' })
  @IsInt()
  @Min(1)
  @Max(SCHOOL_MAX_AMOUNT)
  amount: number;

  @ApiProperty({ enum: SCHOOL_PAYMENT_METHODS })
  @IsIn(SCHOOL_PAYMENT_METHODS)
  method: SchoolPaymentMethod;

  @ApiPropertyOptional({ description: 'Référence de transaction (obligatoire hors espèces).' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(80)
  reference?: string | null;

  @ApiPropertyOptional({ description: 'Date et heure du paiement, jamais dans le futur.' })
  @IsOptional()
  @IsISO8601({ strict: true })
  paidAt?: string;

  @ApiPropertyOptional({
    type: [AllocationDto],
    description: 'Affectation aux échéances ; sinon de la plus ancienne à la plus récente.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => AllocationDto)
  allocations?: AllocationDto[];

  @ApiProperty({ description: 'Clé unique générée par l’écran pour ce formulaire.' })
  @IsUUID('4')
  idempotencyKey: string;

  @ApiPropertyOptional({
    description: 'Confirme un encaissement semblable enregistré il y a moins de deux minutes.',
  })
  @IsOptional()
  @IsBoolean()
  confirmDuplicate?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class PaymentQueryDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  schoolId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  schoolYearId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  studentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  to?: string;

  @ApiPropertyOptional({ enum: SCHOOL_PAYMENT_METHODS })
  @IsOptional()
  @IsIn(SCHOOL_PAYMENT_METHODS)
  method?: SchoolPaymentMethod;

  @ApiPropertyOptional({ description: 'Seulement les encaissements qui portent un reçu.' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  receipts?: boolean;

  @ApiPropertyOptional({ description: 'Dernier encaissement de la page précédente.' })
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  cursor?: string;
}

export class ReportQueryDto {
  @ApiProperty()
  @Transform(lowerUuid)
  @IsUUID('4')
  schoolYearId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  classId?: string;

  @ApiPropertyOptional({ enum: SCHOOL_FEE_CATEGORIES })
  @IsOptional()
  @IsIn(SCHOOL_FEE_CATEGORIES)
  category?: SchoolFeeCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  to?: string;
}

export class FinanceExportQueryDto extends ReportQueryDto {
  @ApiProperty({ enum: ['unpaid', 'payments'] })
  @IsIn(['unpaid', 'payments'])
  kind: 'unpaid' | 'payments';

  @ApiPropertyOptional({ enum: ['csv', 'xlsx'] })
  @IsOptional()
  @IsIn(['csv', 'xlsx'])
  format?: 'csv' | 'xlsx';
}
