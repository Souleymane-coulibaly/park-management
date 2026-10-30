import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  NotEquals,
} from 'class-validator';
import {
  LOYALTY_ACTIVITIES,
  type LoyaltyActivity,
  MAX_AMOUNT,
  MAX_LOYALTY_POINTS,
} from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class LoyaltyRuleDto {
  @ApiProperty()
  @IsBoolean()
  isActive: boolean;

  @ApiProperty({ description: 'Montant payé (FCFA) donnant 1 point.', example: 1000 })
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT)
  earnAmountStep: number;

  @ApiProperty({ description: 'Remise (FCFA) pour 1 point utilisé.', example: 10 })
  @IsInt()
  @Min(1)
  @Max(100_000)
  redeemValue: number;

  @ApiProperty({ description: 'Points minimum pour une utilisation.', example: 100 })
  @IsInt()
  @Min(1)
  @Max(MAX_LOYALTY_POINTS)
  minRedeemPoints: number;
}

export class ActivityParam {
  @ApiProperty({ enum: LOYALTY_ACTIVITIES })
  @IsIn(LOYALTY_ACTIVITIES)
  activity: LoyaltyActivity;
}

/** Correction manuelle (positive ou négative), motivée et auditée ; jamais de solde négatif. */
export class LoyaltyAdjustmentDto {
  @ApiProperty()
  @IsUUID('4')
  customerId: string;

  @ApiProperty({ enum: LOYALTY_ACTIVITIES })
  @IsIn(LOYALTY_ACTIVITIES)
  activity: LoyaltyActivity;

  @ApiProperty({ example: 50, description: 'Variation signée, non nulle.' })
  @IsInt()
  @NotEquals(0)
  @Min(-MAX_LOYALTY_POINTS)
  @Max(MAX_LOYALTY_POINTS)
  points: number;

  @ApiProperty({ example: 'Geste commercial' })
  @Transform(trim)
  @IsString()
  @Length(3, 200)
  reason: string;

  @ApiProperty({ description: 'Clé d’idempotence.' })
  @IsUUID('4')
  clientRequestId: string;
}

export class SaleCustomerDto {
  @ApiPropertyOptional({ nullable: true, description: 'null pour détacher le client.' })
  @IsOptional()
  @IsUUID('4')
  customerId: string | null;
}

export class RedemptionDto {
  @ApiProperty({ example: 150 })
  @IsInt()
  @Min(1)
  @Max(MAX_LOYALTY_POINTS)
  points: number;
}
