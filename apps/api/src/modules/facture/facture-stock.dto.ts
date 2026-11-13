import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { STOCK_FACTURE_SYNC_STATUSES, type StockFactureSyncStatus } from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Recherche d'articles Ocall Stock depuis Facture. */
export class FactureStockSearchDto {
  @ApiProperty({ description: 'Nom, référence ou code-barres (2 caractères au moins)' })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  q: string;
}

/** Article Stock choisi : miroir créé ou réutilisé, ou article Facture rapproché. */
export class FactureStockUseItemDto {
  @ApiProperty()
  @IsUUID()
  variantId: string;

  @ApiPropertyOptional({
    description: 'Article Facture existant à rapprocher (décision de l’utilisateur)',
  })
  @IsOptional()
  @IsUUID()
  linkItemId?: string;

  @ApiPropertyOptional({
    description: 'Créer un article distinct malgré un article de même référence',
  })
  @IsOptional()
  @IsBoolean()
  distinct?: boolean;
}

/** Facture d'une vente en caisse Ocall Stock. */
export class FactureStockInvoiceSaleDto {
  @ApiProperty({ description: 'Numéro de la vente (VTE-000123)' })
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  sale: string;

  @ApiProperty()
  @IsUUID()
  clientId: string;
}

export class FactureStockSyncQueryDto {
  @ApiPropertyOptional({ enum: STOCK_FACTURE_SYNC_STATUSES })
  @IsOptional()
  @IsIn(STOCK_FACTURE_SYNC_STATUSES)
  status?: StockFactureSyncStatus;
}
