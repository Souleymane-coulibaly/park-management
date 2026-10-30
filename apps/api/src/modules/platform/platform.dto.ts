import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
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
import {
  BUSINESS_TYPES,
  type BusinessType,
  SUBSCRIPTION_PAYMENT_MAX_AMOUNT,
  SUBSCRIPTION_PAYMENT_METHODS,
  SUBSCRIPTION_PAYMENT_STATUSES,
  SUPPORTED_COUNTRIES,
  type SubscriptionPaymentMethod,
  type SubscriptionPaymentStatus,
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Saisie d'un règlement d'abonnement reçu HORS plateforme (espèces, virement, mobile money…). */
export class RecordSubscriptionPaymentDto {
  @ApiProperty()
  @IsUUID('4')
  organizationId: string;

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
