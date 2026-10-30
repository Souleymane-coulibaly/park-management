import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  MANUAL_STOCK_MOVEMENT_KINDS,
  MAX_AMOUNT,
  MAX_STOCK_QUANTITY,
  type ManualStockMovementKind,
  STOCK_UNITS,
  type StockUnit,
} from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Quantités : 3 décimales au plus. */
const QUANTITY = { maxDecimalPlaces: 3 } as const;

export class CreateStockItemDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiProperty({ example: 'Poulet entier' })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name: string;

  @ApiProperty({ enum: STOCK_UNITS, example: 'KG' })
  @IsIn(STOCK_UNITS)
  unit: StockUnit;

  @ApiPropertyOptional({ description: 'Seuil d’alerte, dans la même unité.', example: 5 })
  @IsOptional()
  @IsNumber(QUANTITY)
  @Min(0)
  @Max(MAX_STOCK_QUANTITY)
  alertThreshold?: number | null;

  @ApiPropertyOptional({ description: 'Coût d’achat unitaire facultatif (FCFA).', example: 3500 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  unitCost?: number | null;
}

export class UpdateStockItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber(QUANTITY)
  @Min(0)
  @Max(MAX_STOCK_QUANTITY)
  alertThreshold?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  unitCost?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Mouvement saisi à la main. IN et OUT : quantité positive (entrée ou sortie) ; ADJUSTMENT : quantité
 * réellement comptée (inventaire), le mouvement enregistre l'écart.
 */
export class CreateStockMovementDto {
  @ApiProperty()
  @IsUUID('4')
  stockItemId: string;

  @ApiProperty({ enum: MANUAL_STOCK_MOVEMENT_KINDS })
  @IsIn(MANUAL_STOCK_MOVEMENT_KINDS)
  kind: ManualStockMovementKind;

  @ApiProperty({ example: 10 })
  @IsNumber(QUANTITY)
  @Min(0)
  @Max(MAX_STOCK_QUANTITY)
  quantity: number;

  @ApiPropertyOptional({ description: 'Entrée : coût d’achat unitaire (FCFA), si connu.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  unitCost?: number;

  @ApiPropertyOptional({ example: 'Livraison du marché' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  reason?: string;

  @ApiProperty({ description: 'Clé d’idempotence : un renvoi ne double pas le mouvement.' })
  @IsUUID('4')
  clientRequestId: string;
}

export class StockQueryDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;
}

export class MovementsQueryDto extends StockQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  stockItemId?: string;
}

export class RecipeComponentDto {
  @ApiProperty()
  @IsUUID('4')
  stockItemId: string;

  @ApiProperty({ description: 'Quantité consommée par unité vendue.', example: 0.25 })
  @IsNumber(QUANTITY)
  @Min(0.001)
  @Max(MAX_STOCK_QUANTITY)
  quantity: number;
}

/** Recette d'une variante dans un établissement : remplace la liste complète des ingrédients. */
export class PutRecipeDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiProperty({ type: [RecipeComponentDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RecipeComponentDto)
  components: RecipeComponentDto[];
}
