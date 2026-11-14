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
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { STOCK_AI_FEATURES, STOCK_AI_MAX_LINES, type StockAiFeature } from '@ocall/shared';

/** Réglages IA (administrateur) : activation générale et par fonctionnalité, plafonds mensuels. */
export class StockAiSettingsDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;

  @ApiProperty()
  @IsBoolean()
  restockEnabled: boolean;

  @ApiProperty()
  @IsBoolean()
  stockoutEnabled: boolean;

  @ApiProperty()
  @IsBoolean()
  analysisEnabled: boolean;

  @ApiProperty()
  @IsBoolean()
  photoEnabled: boolean;

  @ApiProperty()
  @IsBoolean()
  illustrationEnabled: boolean;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(100_000)
  restockMonthlyLimit: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(100_000)
  stockoutMonthlyLimit: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(100_000)
  analysisMonthlyLimit: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(100_000)
  photoMonthlyLimit: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(100_000)
  illustrationMonthlyLimit: number;
}

/** Assistant de réapprovisionnement : site de livraison et fournisseur de la future commande. */
export class StockAiRestockDto {
  @ApiProperty()
  @IsUUID()
  siteId: string;

  @ApiProperty()
  @IsUUID()
  supplierId: string;

  @ApiPropertyOptional({
    description: 'Couverture visée au-delà du délai fournisseur (jours, 0 à 120)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  coverDays?: number;
}

export class StockAiStockoutDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  siteId?: string;
}

export class StockAiAnalysisDto {
  @ApiPropertyOptional({ description: 'Début (AAAA-MM-JJ)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({ description: 'Fin incluse (AAAA-MM-JJ)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  siteId?: string;
}

export class StockAiProposalQueryDto {
  @ApiPropertyOptional({ enum: STOCK_AI_FEATURES })
  @IsOptional()
  @IsIn(STOCK_AI_FEATURES)
  feature?: StockAiFeature;
}

export class StockAiRestockLineDto {
  @ApiProperty()
  @IsUUID()
  variantId: string;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1_000_000)
  quantity: number;
}

/**
 * Application d'une proposition. Réapprovisionnement : lignes retenues (sous-ensemble, quantités
 * corrigées) → commande BROUILLON. Photo : article créé. Illustration : visible ou non sur la vitrine.
 */
export class StockAiApplyDto {
  @ApiPropertyOptional({ type: [StockAiRestockLineDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(STOCK_AI_MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => StockAiRestockLineDto)
  lines?: StockAiRestockLineDto[];

  @ApiPropertyOptional({ description: 'Photo : article créé à partir de la proposition' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Illustration : visible sur la vitrine' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  showcase?: boolean;
}
