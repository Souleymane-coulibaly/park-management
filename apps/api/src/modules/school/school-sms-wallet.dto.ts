import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  NotEquals,
} from 'class-validator';
import {
  SCHOOL_SMS_TOPUP_STATUSES,
  SMS_ADJUSTMENT_MAX_CREDITS,
  SMS_TOPUP_MAX_CREDITS,
  SMS_TOPUP_MIN_CREDITS,
  type SchoolSmsTopUpStatus,
} from '@ocall/shared';
import { SchoolIdQueryDto, lowerUuid } from './school-portal.dto';
import { trim, trimOrNull } from './school.dto';

/** Demande de recharge de l'établissement (crédits ; le montant est calculé côté serveur). */
export class SmsTopUpRequestDto extends SchoolIdQueryDto {
  @ApiProperty({ minimum: SMS_TOPUP_MIN_CREDITS, maximum: SMS_TOPUP_MAX_CREDITS })
  @Type(() => Number)
  @IsInt()
  @Min(SMS_TOPUP_MIN_CREDITS)
  @Max(SMS_TOPUP_MAX_CREDITS)
  credits: number;

  @ApiPropertyOptional({ description: 'Précision pour Ocall (mode de règlement prévu…).' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @Length(0, 300)
  note?: string | null;
}

export class SmsLedgerQueryDto extends SchoolIdQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  cursor?: string;
}

// ─── Super Admin ───

export class AdminTopUpQueryDto {
  @ApiPropertyOptional({ enum: SCHOOL_SMS_TOPUP_STATUSES })
  @IsOptional()
  @IsIn(SCHOOL_SMS_TOPUP_STATUSES)
  status?: SchoolSmsTopUpStatus;
}

export class AdminWalletsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  organizationId?: string;
}

export class AdminLedgerQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('4')
  cursor?: string;
}

export class ApproveTopUpDto {
  @ApiPropertyOptional({
    description: 'Crédits accordés (par défaut ceux demandés).',
    minimum: 1,
    maximum: SMS_TOPUP_MAX_CREDITS,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SMS_TOPUP_MAX_CREDITS)
  credits?: number;

  @ApiProperty({ description: 'Référence du règlement vérifié (virement, mobile money, reçu).' })
  @Transform(trim)
  @IsString()
  @Length(3, 120)
  paymentReference: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @Length(0, 300)
  note?: string | null;
}

export class RejectTopUpDto {
  @ApiProperty({ description: 'Motif communiqué à l’établissement.' })
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  note: string;
}

export class SmsAdjustmentDto {
  @ApiProperty({ description: 'Crédits ajoutés (positif) ou retirés (négatif).' })
  @Type(() => Number)
  @IsInt()
  @NotEquals(0)
  @Min(-SMS_ADJUSTMENT_MAX_CREDITS)
  @Max(SMS_ADJUSTMENT_MAX_CREDITS)
  credits: number;

  @ApiProperty({ description: 'Justification obligatoire, conservée dans le registre.' })
  @Transform(trim)
  @IsString()
  @Length(10, 300)
  reason: string;

  @ApiProperty({ description: 'Clé unique de la correction (un double envoi n’applique rien).' })
  @IsUUID('4')
  idempotencyKey: string;
}

export class SmsTariffDto {
  @ApiPropertyOptional({ description: 'Prix de vente d’un crédit en XOF ; nul = non publié.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  creditPriceXof?: number | null;

  @ApiPropertyOptional({ description: 'Coût fournisseur par segment en XOF (2 décimales).' })
  @IsOptional()
  @Matches(/^\d{1,6}(\.\d{1,2})?$/)
  providerCostPerSegmentXof?: string | null;

  @ApiPropertyOptional({
    description: 'Crédits par segment à l’international ; nul = international refusé.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  internationalCreditsPerSegment?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @Length(0, 300)
  note?: string | null;
}
