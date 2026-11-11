import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  STOCK_ADJUSTABLE_PERMISSIONS,
  STOCK_BARCODE_TYPES,
  STOCK_LABEL_FIELDS,
  STOCK_LABEL_FORMATS,
  STOCK_LABEL_MAX_COPIES,
  STOCK_MAX_PRICE,
  STOCK_PREFIX_PATTERN,
  STOCK_ROLES,
  STOCK_SKU_PATTERN,
  type StockBarcodeType,
  type StockLabelField,
  type StockLabelFormat,
  type StockPermission,
  type StockRole,
} from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const notNull = (_: unknown, v: unknown) => v !== null;
const bool = ({ value }: { value: unknown }) =>
  value === 'true' || value === true ? true : value === 'false' || value === false ? false : value;

// ─── Réglages et équipe ───

export class StockSettingsDto {
  @ApiProperty({ description: 'Nom imprimé sur les étiquettes' })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  storeName: string;

  @ApiProperty({ description: 'TVA proposée pour un nouvel article (0 à 30 %)' })
  @IsInt()
  @Min(0)
  @Max(30)
  defaultVatRate: number;

  @ApiProperty({ description: 'Préfixe des références et des codes internes (2 à 4 lettres)' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(STOCK_PREFIX_PATTERN, { message: 'Préfixe : 2 à 4 lettres majuscules.' })
  internalCodePrefix: string;
}

export class CreateStockMemberDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || null : value,
  )
  @ValidateIf(notNull)
  @IsEmail()
  email?: string | null;

  @ApiProperty({ enum: STOCK_ROLES })
  @IsIn(STOCK_ROLES)
  role: StockRole;
}

export class UpdateStockMemberDto {
  @ApiPropertyOptional({ enum: STOCK_ROLES })
  @IsOptional()
  @IsIn(STOCK_ROLES)
  role?: StockRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class StockPermissionOverrideDto {
  @ApiProperty({ enum: STOCK_ADJUSTABLE_PERMISSIONS })
  @IsIn(STOCK_ADJUSTABLE_PERMISSIONS)
  permission: StockPermission;

  @ApiProperty({ description: 'Accordée (true) ou retirée (false) par rapport au rôle' })
  @IsBoolean()
  granted: boolean;
}

/** Ajustements d'un membre : la liste remplace la précédente (liste vide = rôle seul). */
export class StockMemberPermissionsDto {
  @ApiProperty({ type: [StockPermissionOverrideDto] })
  @IsArray()
  @ArrayMaxSize(STOCK_ADJUSTABLE_PERMISSIONS.length)
  @ValidateNested({ each: true })
  @Type(() => StockPermissionOverrideDto)
  overrides: StockPermissionOverrideDto[];
}

// ─── Listes ───

export class StockListQueryDto {
  @ApiPropertyOptional({ description: 'Recherche' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ description: 'Inclure les éléments archivés' })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  archived?: boolean;
}

export class StockProductQueryDto extends StockListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class StockSearchQueryDto {
  @ApiProperty({ description: 'Texte, référence ou code-barres' })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  q: string;
}

export class StockLookupQueryDto {
  @ApiProperty({ description: 'Code lu par un scanner ou saisi' })
  @IsString()
  @Length(1, 64)
  code: string;
}

// ─── Catégories et marques ───

export class StockCategoryDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name: string;

  @ApiPropertyOptional({
    description: 'Catégorie parente (sous-catégorie) ; null = premier niveau',
  })
  @IsOptional()
  @ValidateIf(notNull)
  @IsUUID()
  parentId?: string | null;
}

export class UpdateStockCategoryDto extends PartialType(StockCategoryDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

export class StockBrandDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name: string;
}

export class UpdateStockBrandDto extends PartialType(StockBrandDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

// ─── Articles et variantes ───

export class StockProductDto {
  @ApiPropertyOptional({ description: 'Référence (SKU) ; générée si absente' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @Matches(STOCK_SKU_PATTERN, { message: 'Référence invalide.' })
  sku?: string | null;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 160)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf(notNull)
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf(notNull)
  @IsUUID()
  brandId?: string | null;

  @ApiPropertyOptional({ description: 'Unité de vente' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 24)
  unit?: string;

  @ApiProperty({ description: 'Prix de vente TTC (entier, devise de l’organisation)' })
  @IsInt()
  @Min(0)
  @Max(STOCK_MAX_PRICE)
  salePrice: number;

  @ApiPropertyOptional({ description: 'Prix d’achat HT ; null s’il est inconnu' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(0)
  @Max(STOCK_MAX_PRICE)
  purchasePrice?: number | null;

  @ApiPropertyOptional({ description: 'TVA (0 à 30 %) ; défaut des réglages' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  vatRate?: number;

  @ApiPropertyOptional({ description: 'Seuil d’alerte ; null = aucun' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1_000_000_000)
  minStock?: number | null;

  @ApiPropertyOptional({ description: 'Faux pour un service ou un article non compté' })
  @IsOptional()
  @IsBoolean()
  isStockable?: boolean;
}

export class UpdateStockProductDto extends PartialType(StockProductDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

export class StockVariantDto {
  @ApiProperty({ description: 'Nom de la déclinaison (taille, couleur…)' })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name: string;

  @ApiPropertyOptional({ description: 'Référence ; générée si absente' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @Matches(STOCK_SKU_PATTERN, { message: 'Référence invalide.' })
  sku?: string | null;

  @ApiPropertyOptional({ description: 'Prix de vente TTC propre ; null = celui de l’article' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(0)
  @Max(STOCK_MAX_PRICE)
  salePrice?: number | null;

  @ApiPropertyOptional({ description: 'Prix d’achat HT propre ; null = celui de l’article' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(0)
  @Max(STOCK_MAX_PRICE)
  purchasePrice?: number | null;
}

export class UpdateStockVariantDto extends PartialType(StockVariantDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

export class StockBarcodeDto {
  @ApiProperty({ enum: STOCK_BARCODE_TYPES.filter((t) => t !== 'INTERNAL') })
  @IsIn(STOCK_BARCODE_TYPES.filter((t) => t !== 'INTERNAL'))
  type: Exclude<StockBarcodeType, 'INTERNAL'>;

  @ApiProperty({ description: 'Code du fabricant (chiffres)' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\s+/g, '') : value,
  )
  @IsString()
  @Length(8, 13)
  code: string;
}

// ─── Fournisseurs ───

export class StockSupplierDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 160)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  contactName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @Matches(/^\+?[0-9 ().-]{6,24}$/, { message: 'Téléphone invalide.' })
  phone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || null : value,
  )
  @ValidateIf(notNull)
  @IsEmail()
  email?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(240)
  address?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(80)
  city?: string | null;

  @ApiPropertyOptional({ description: 'Pays (code ISO à 2 lettres)' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{2}$/)
  country?: string;

  @ApiPropertyOptional({ description: 'Numéro d’identification fiscale' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(40)
  nif?: string | null;

  @ApiPropertyOptional({ description: 'Délai de livraison habituel (jours)' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(0)
  @Max(365)
  leadTimeDays?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class UpdateStockSupplierDto extends PartialType(StockSupplierDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

// ─── Étiquettes ───

export class StockLabelItemDto {
  @ApiProperty()
  @IsUUID()
  variantId: string;

  @ApiProperty({ minimum: 1, maximum: STOCK_LABEL_MAX_COPIES })
  @IsInt()
  @Min(1)
  @Max(STOCK_LABEL_MAX_COPIES)
  copies: number;
}

export class StockLabelsDto {
  @ApiProperty({ enum: STOCK_LABEL_FORMATS })
  @IsIn(STOCK_LABEL_FORMATS)
  format: StockLabelFormat;

  @ApiProperty({ enum: STOCK_LABEL_FIELDS, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(STOCK_LABEL_FIELDS.length)
  @IsIn(STOCK_LABEL_FIELDS, { each: true })
  fields: StockLabelField[];

  @ApiProperty({ type: [StockLabelItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StockLabelItemDto)
  items: StockLabelItemDto[];
}
