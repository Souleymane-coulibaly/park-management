import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  MAX_AMOUNT,
  MAX_LINE_QUANTITY,
  MAX_SALE_LINES,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Ligne de panier : la caisse n'envoie QUE la variante et la quantité, jamais de prix. */
export class CartLineDto {
  @ApiProperty()
  @IsUUID('4')
  variantId: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  @Max(MAX_LINE_QUANTITY)
  quantity: number;
}

export class QuoteDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiProperty({ type: [CartLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SALE_LINES)
  @ValidateNested({ each: true })
  @Type(() => CartLineDto)
  lines: CartLineDto[];
}

export class CreateSaleDto extends QuoteDto {
  @ApiPropertyOptional({
    description:
      'Clé d’idempotence générée par la caisse : une nouvelle tentative renvoie la même vente.',
  })
  @IsOptional()
  @IsUUID('4')
  clientRequestId?: string;
}

export class PaySaleDto {
  @ApiProperty({ enum: PAYMENT_METHODS, example: 'CASH' })
  @IsIn(PAYMENT_METHODS)
  method: PaymentMethod;

  @ApiPropertyOptional({
    description: 'Espèces remises par le client (obligatoire en espèces).',
    example: 5000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  amountTendered?: number;

  @ApiPropertyOptional({ description: 'Clé d’idempotence du paiement.' })
  @IsOptional()
  @IsUUID('4')
  clientRequestId?: string;
}

export class CancelSaleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class SalesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  establishmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  cashSessionId?: string;

  @ApiPropertyOptional({ enum: ['UNPAID', 'PAID'] })
  @IsOptional()
  @IsIn(['UNPAID', 'PAID'])
  paymentStatus?: 'UNPAID' | 'PAID';

  @ApiPropertyOptional({ enum: ['OPEN', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['OPEN', 'CANCELLED'])
  status?: 'OPEN' | 'CANCELLED';

  @ApiPropertyOptional({ enum: ['RESTAURANT', 'PARK'] })
  @IsOptional()
  @IsIn(['RESTAURANT', 'PARK'])
  activity?: 'RESTAURANT' | 'PARK';

  @ApiPropertyOptional({ example: '2026-10-29T00:00:00Z' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class OpenCashSessionDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiProperty({ description: 'Fond de caisse en FCFA.', example: 10000 })
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  openingFloat: number;
}

export class CloseCashSessionDto {
  @ApiProperty({ description: 'Espèces comptées dans le tiroir, en FCFA.', example: 16500 })
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  countedCash: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class CashSessionsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  establishmentId?: string;

  @ApiPropertyOptional({ enum: ['OPEN', 'CLOSED'] })
  @IsOptional()
  @IsIn(['OPEN', 'CLOSED'])
  status?: 'OPEN' | 'CLOSED';
}

export class EstablishmentQueryDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;
}
