import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
import {
  type ManualSubscriptionPaymentMethod,
  PAYMENT_ACTIVATION_STATUSES,
  type PaymentActivationStatus,
  SUBSCRIPTION_PAYMENT_MAX_AMOUNT,
  SUBSCRIPTION_PAYMENT_METHODS,
  SUBSCRIPTION_PAYMENT_STATUSES,
  type SubscriptionPaymentStatus,
} from '@ocall/shared';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Déclaration d'un règlement manuel (Sprint 12A) : espèces ou virement, toujours rattaché à une
 * facture. Ne vaut pas encaissement : seule une confirmation par un autre utilisateur le rend
 * définitif.
 */
export class DeclareSubscriptionPaymentDto {
  @ApiProperty()
  @IsUUID('4')
  organizationId: string;

  @ApiProperty({ description: 'Facture réglée (obligatoire).' })
  @IsUUID('4')
  invoiceId: string;

  @ApiProperty({ description: 'Montant entier en FCFA, au plus le reste dû de la facture.' })
  @IsInt()
  @Min(1)
  @Max(SUBSCRIPTION_PAYMENT_MAX_AMOUNT)
  amount: number;

  @ApiProperty({ description: 'Devise de la facture.', example: 'XOF' })
  @Matches(/^[A-Z]{3}$/)
  currency: string;

  @ApiProperty({ enum: SUBSCRIPTION_PAYMENT_METHODS })
  @IsIn(SUBSCRIPTION_PAYMENT_METHODS)
  method: ManualSubscriptionPaymentMethod;

  @ApiPropertyOptional({ description: 'Référence du virement.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  reference?: string;

  @ApiPropertyOptional({
    description: 'Espèces : référence du reçu papier remis au client (obligatoire pour CASH).',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  receiptReference?: string;

  @ApiPropertyOptional({
    description: 'Espèces : compte interne qui a collecté (par défaut, le déclarant).',
  })
  @IsOptional()
  @IsUUID('4')
  collectedById?: string;

  @ApiProperty({ description: 'Date du règlement ou de la collecte (AAAA-MM-JJ).' })
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

export class ReasonDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 500)
  reason: string;
}

export class PaymentsQueryDto {
  @ApiPropertyOptional({ enum: SUBSCRIPTION_PAYMENT_STATUSES })
  @IsOptional()
  @IsIn(SUBSCRIPTION_PAYMENT_STATUSES)
  status?: SubscriptionPaymentStatus;

  @ApiPropertyOptional({ enum: PAYMENT_ACTIVATION_STATUSES })
  @IsOptional()
  @IsIn(PAYMENT_ACTIVATION_STATUSES)
  activationStatus?: PaymentActivationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  organizationId?: string;
}

/** Remise d'espèces : règlements en espèces confirmés d'un même collecteur, non encore remis. */
export class DeclareRemittanceDto {
  @ApiProperty()
  @IsUUID('4')
  collectorId: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  paymentIds: string[];

  @ApiProperty({ description: 'Date de la remise (AAAA-MM-JJ).' })
  @Matches(DATE)
  remittedAt: string;

  @ApiPropertyOptional({ description: 'Bordereau de dépôt, reçu de caisse…' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ReconciliationQueryDto {
  @ApiPropertyOptional({ description: 'Début (AAAA-MM-JJ, inclus).' })
  @IsOptional()
  @Matches(DATE)
  from?: string;

  @ApiPropertyOptional({ description: 'Fin (AAAA-MM-JJ, incluse).' })
  @IsOptional()
  @Matches(DATE)
  to?: string;
}
