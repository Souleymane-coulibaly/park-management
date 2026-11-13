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
  STOCK_LOCATION_CODE_PATTERN,
  STOCK_LOCATION_KINDS,
  STOCK_MANUAL_MOVEMENT_KINDS,
  STOCK_MAX_PRICE,
  STOCK_MAX_QUANTITY,
  STOCK_MAX_SALE_LINES,
  STOCK_PAYMENT_METHODS,
  STOCK_PREFIX_PATTERN,
  STOCK_ROLES,
  STOCK_SITE_CODE_PATTERN,
  STOCK_SITE_KINDS,
  STOCK_SKU_PATTERN,
  type StockBarcodeType,
  type StockLabelField,
  type StockLabelFormat,
  type StockManualMovementKind,
  type StockPaymentMethod,
  type StockSiteKind,
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

  @ApiPropertyOptional({ description: 'Autoriser le stock négatif (refusé par défaut)' })
  @IsOptional()
  @IsBoolean()
  allowNegativeStock?: boolean;

  @ApiPropertyOptional({ description: 'Remise maximale en caisse (% de la ligne), 0 à 100' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  maxDiscountPercent?: number;

  @ApiPropertyOptional({ description: 'Téléphone imprimé sur les tickets' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(40)
  receiptPhone?: string | null;

  @ApiPropertyOptional({ description: 'Adresse imprimée sur les tickets' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(160)
  receiptAddress?: string | null;

  @ApiPropertyOptional({ description: 'Mention de pied de ticket' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(160)
  receiptFooter?: string | null;
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

// ─── S2 : sites et emplacements ───

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** Quantité saisie : positive, 3 décimales au plus. */
function Quantity(): PropertyDecorator {
  return (target, key) => {
    IsNumber({ maxDecimalPlaces: 3 })(target, key);
    Min(0.001)(target, key);
    Max(STOCK_MAX_QUANTITY)(target, key);
  };
}

/** Clé d'idempotence fournie par l'appareil : un envoi répété (réseau instable) n'est compté qu'une fois. */
function IdempotencyKey(): PropertyDecorator {
  return (target, key) => {
    IsString()(target, key);
    Matches(/^[A-Za-z0-9_-]{8,80}$/, { message: 'Clé d’idempotence invalide.' })(target, key);
  };
}

export class StockSiteDto {
  @ApiProperty({
    description: 'Code court, unique (2 à 8 lettres ou chiffres) ; ne change plus ensuite',
  })
  @Transform(upper)
  @Matches(STOCK_SITE_CODE_PATTERN, { message: 'Code : 2 à 8 lettres ou chiffres.' })
  code: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiProperty({ enum: STOCK_SITE_KINDS })
  @IsIn(STOCK_SITE_KINDS)
  kind: StockSiteKind;

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
}

export class UpdateStockSiteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ enum: STOCK_SITE_KINDS })
  @IsOptional()
  @IsIn(STOCK_SITE_KINDS)
  kind?: StockSiteKind;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

export class StockLocationDto {
  @ApiProperty({ enum: STOCK_LOCATION_KINDS })
  @IsIn(STOCK_LOCATION_KINDS)
  kind: (typeof STOCK_LOCATION_KINDS)[number];

  @ApiProperty({ description: 'Code unique dans le site (A-01-03) ; ne change plus ensuite' })
  @Transform(upper)
  @Matches(STOCK_LOCATION_CODE_PATTERN, {
    message: 'Code : lettres, chiffres et tirets (A-01-03).',
  })
  code: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name: string;

  @ApiPropertyOptional({ description: 'Emplacement parent (même site, niveau plus large)' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsUUID()
  parentId?: string | null;
}

export class UpdateStockLocationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

export class StockLocationLabelsDto {
  @ApiProperty({ enum: STOCK_LABEL_FORMATS })
  @IsIn(STOCK_LABEL_FORMATS)
  format: StockLabelFormat;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  locationIds: string[];
}

export class StockMemberSitesDto {
  @ApiProperty({ type: [String], description: 'Sites du membre ; vide = tous les sites' })
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  siteIds: string[];
}

export class StockSiteQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  archived?: boolean;
}

// ─── S2 : stocks et mouvements ───

export class StockLevelsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Nom, référence ou code' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ description: 'Seulement les articles sous leur seuil d’alerte' })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  belowMin?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

export class StockMovementDto {
  @ApiProperty({ enum: STOCK_MANUAL_MOVEMENT_KINDS })
  @IsIn(STOCK_MANUAL_MOVEMENT_KINDS)
  kind: StockManualMovementKind;

  @ApiProperty()
  @IsUUID()
  variantId: string;

  @ApiProperty()
  @IsUUID()
  locationId: string;

  @ApiProperty({ description: 'Entrée et sortie : positive ; ajustement : signée, non nulle' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(-STOCK_MAX_QUANTITY)
  @Max(STOCK_MAX_QUANTITY)
  quantity: number;

  @ApiPropertyOptional({ description: 'Motif (obligatoire pour une sortie ou un ajustement)' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @IsString()
  @Length(3, 240)
  reason?: string | null;

  @ApiPropertyOptional({ description: 'Coût unitaire HT (entrée)' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(0)
  @Max(STOCK_MAX_PRICE)
  unitCost?: number | null;

  @ApiProperty()
  @IdempotencyKey()
  idempotencyKey: string;
}

export class StockMoveDto {
  @ApiProperty()
  @IsUUID()
  variantId: string;

  @ApiProperty()
  @IsUUID()
  fromLocationId: string;

  @ApiProperty()
  @IsUUID()
  toLocationId: string;

  @ApiProperty()
  @Quantity()
  quantity: number;

  @ApiProperty()
  @IdempotencyKey()
  idempotencyKey: string;
}

export class StockMovementsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

// ─── S2 : transferts ───

export class StockTransferLineDto {
  @ApiProperty()
  @IsUUID()
  variantId: string;

  @ApiProperty()
  @Quantity()
  quantity: number;
}

export class CreateStockTransferDto {
  @ApiProperty()
  @IsUUID()
  fromSiteId: string;

  @ApiProperty()
  @IsUUID()
  toSiteId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiProperty({ type: [StockTransferLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StockTransferLineDto)
  lines: StockTransferLineDto[];
}

export class StockTransferPickDto {
  @ApiProperty()
  @IsUUID()
  lineId: string;

  @ApiProperty({ description: 'Emplacement de prélèvement (site de départ)' })
  @IsUUID()
  fromLocationId: string;
}

export class PrepareStockTransferDto {
  @ApiProperty({ type: [StockTransferPickDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StockTransferPickDto)
  lines: StockTransferPickDto[];
}

export class StockTransferReceiptLineDto {
  @ApiProperty()
  @IsUUID()
  lineId: string;

  @ApiProperty()
  @Quantity()
  quantity: number;

  @ApiProperty({ description: 'Emplacement de rangement (site d’arrivée)' })
  @IsUUID()
  toLocationId: string;
}

export class ReceiveStockTransferDto {
  @ApiProperty()
  @IdempotencyKey()
  idempotencyKey: string;

  @ApiProperty({ type: [StockTransferReceiptLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StockTransferReceiptLineDto)
  lines: StockTransferReceiptLineDto[];
}

export class StockTransferLossDto {
  @ApiProperty()
  @IsUUID()
  lineId: string;

  @ApiProperty({ description: 'Motif du manque (casse, vol, erreur de préparation…)' })
  @Transform(trim)
  @IsString()
  @Length(3, 240)
  reason: string;
}

export class DeclareStockTransferLossDto {
  @ApiProperty({ type: [StockTransferLossDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StockTransferLossDto)
  lines: StockTransferLossDto[];
}

export class StockOperationsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @ApiPropertyOptional({ description: 'Seulement les opérations en cours' })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  open?: boolean;
}

// ─── S2 : inventaires ───

export class CreateStockCountDto {
  @ApiProperty()
  @IsUUID()
  siteId: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiProperty({ enum: ['FULL', 'PARTIAL'] })
  @IsIn(['FULL', 'PARTIAL'])
  scope: 'FULL' | 'PARTIAL';

  @ApiPropertyOptional({
    type: [String],
    description: 'Emplacements inventoriés ; vide = tout le site',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  locationIds?: string[];
}

export class StockCountLineDto {
  @ApiProperty()
  @IsUUID()
  variantId: string;

  @ApiProperty()
  @IsUUID()
  locationId: string;

  @ApiProperty({ description: 'Quantité comptée (SET) ou à ajouter au comptage (ADD, scan)' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(STOCK_MAX_QUANTITY)
  quantity: number;

  @ApiProperty({ enum: ['SET', 'ADD'] })
  @IsIn(['SET', 'ADD'])
  mode: 'SET' | 'ADD';
}

// ─── S3 : achats ───

export class StockPurchaseLineDto {
  @ApiProperty()
  @IsUUID()
  variantId: string;

  @ApiProperty()
  @Quantity()
  quantity: number;

  @ApiProperty({ description: 'Coût unitaire HT convenu' })
  @IsInt()
  @Min(0)
  @Max(STOCK_MAX_PRICE)
  unitCost: number;

  @ApiProperty({ description: 'TVA (0 à 30 %)' })
  @IsInt()
  @Min(0)
  @Max(30)
  vatRate: number;
}

export class CreateStockPurchaseOrderDto {
  @ApiProperty()
  @IsUUID()
  supplierId: string;

  @ApiProperty({ description: 'Site de livraison' })
  @IsUUID()
  siteId: string;

  @ApiPropertyOptional({ description: 'Livraison attendue (AAAA-MM-JJ)' })
  @IsOptional()
  @ValidateIf(notNull)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date au format AAAA-MM-JJ.' })
  expectedAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiProperty({ type: [StockPurchaseLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StockPurchaseLineDto)
  lines: StockPurchaseLineDto[];
}

/** Brouillon seulement : les lignes envoyées remplacent les précédentes. */
export class UpdateStockPurchaseOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf(notNull)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date au format AAAA-MM-JJ.' })
  expectedAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiPropertyOptional({ type: [StockPurchaseLineDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StockPurchaseLineDto)
  lines?: StockPurchaseLineDto[];
}

export class StockPurchaseQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @ApiPropertyOptional({
    description: 'Seulement les commandes en cours (brouillon, commandée, reçue en partie)',
  })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  open?: boolean;
}

export class StockReceiptLineDto {
  @ApiProperty()
  @IsUUID()
  orderLineId: string;

  @ApiProperty()
  @Quantity()
  quantity: number;

  @ApiProperty({ description: 'Emplacement de rangement (site de livraison)' })
  @IsUUID()
  locationId: string;

  @ApiPropertyOptional({
    description: 'Coût HT réellement facturé ; à défaut, celui de la commande',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(STOCK_MAX_PRICE)
  unitCost?: number;
}

export class ReceiveStockPurchaseDto {
  @ApiProperty()
  @IdempotencyKey()
  idempotencyKey: string;

  @ApiPropertyOptional({ description: 'Référence du bon de livraison' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(80)
  deliveryRef?: string | null;

  @ApiPropertyOptional({ description: 'Reporter les coûts reçus comme prix d’achat des articles' })
  @IsOptional()
  @IsBoolean()
  updatePurchasePrices?: boolean;

  @ApiProperty({ type: [StockReceiptLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StockReceiptLineDto)
  lines: StockReceiptLineDto[];
}

export class CancelStockReceiptDto {
  @ApiProperty({ description: 'Motif (erreur de saisie, mauvaise livraison…)' })
  @Transform(trim)
  @IsString()
  @Length(3, 240)
  reason: string;
}

export class StockSupplierReturnLineDto {
  @ApiProperty()
  @IsUUID()
  variantId: string;

  @ApiProperty({ description: 'Emplacement d’où part la marchandise' })
  @IsUUID()
  locationId: string;

  @ApiProperty()
  @Quantity()
  quantity: number;
}

export class CreateStockSupplierReturnDto {
  @ApiProperty()
  @IsUUID()
  supplierId: string;

  @ApiProperty()
  @IsUUID()
  siteId: string;

  @ApiPropertyOptional({ description: 'Commande d’origine (facultatif)' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsUUID()
  orderId?: string | null;

  @ApiProperty({ description: 'Motif (produit défectueux, erreur de livraison…)' })
  @Transform(trim)
  @IsString()
  @Length(3, 240)
  reason: string;

  @ApiProperty()
  @IdempotencyKey()
  idempotencyKey: string;

  @ApiProperty({ type: [StockSupplierReturnLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StockSupplierReturnLineDto)
  lines: StockSupplierReturnLineDto[];
}

// ─── S4 : caisse ───

const PRINTER_CONNECTIONS = [
  'NONE',
  'SIMULATED',
  'NETWORK',
  'BLUETOOTH',
  'USB',
  'WEBUSB',
  'WEBBLUETOOTH',
] as const;
export type StockPrinterConnection = (typeof PRINTER_CONNECTIONS)[number];

export class StockCustomerDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @IsEmail()
  @MaxLength(160)
  email?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class UpdateStockCustomerDto extends PartialType(StockCustomerDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

export class StockRegisterDto {
  @ApiProperty({ description: 'Code court (CAISSE1), unique' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9][A-Z0-9-]{0,15}$/, { message: 'Code : lettres, chiffres et tirets.' })
  code: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name: string;

  @ApiProperty({ description: 'Emplacement d’où sort la marchandise vendue' })
  @IsUUID()
  locationId: string;

  @ApiPropertyOptional({ enum: [58, 80] })
  @IsOptional()
  @IsIn([58, 80])
  paperWidth?: 58 | 80;

  @ApiPropertyOptional({ enum: PRINTER_CONNECTIONS })
  @IsOptional()
  @IsIn(PRINTER_CONNECTIONS)
  printerConnection?: StockPrinterConnection;

  @ApiPropertyOptional({ description: 'Adresse IP:port, MAC Bluetooth ou nom USB' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  printerAddress?: string | null;
}

export class UpdateStockRegisterDto extends PartialType(StockRegisterDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

export class OpenStockCashSessionDto {
  @ApiProperty({ description: 'Fond de caisse (espèces à l’ouverture)' })
  @IsInt()
  @Min(0)
  @Max(STOCK_MAX_PRICE)
  openingFloat: number;
}

export class CloseStockCashSessionDto {
  @ApiProperty({ description: 'Espèces comptées dans le tiroir' })
  @IsInt()
  @Min(0)
  @Max(STOCK_MAX_PRICE)
  countedCash: number;

  @ApiPropertyOptional({ description: 'Motif de l’écart (obligatoire s’il y en a un)' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(300)
  differenceReason?: string | null;
}

export class StockSaleLineDto {
  @ApiProperty()
  @IsUUID()
  variantId: string;

  @ApiProperty()
  @Quantity()
  quantity: number;

  @ApiPropertyOptional({ description: 'Remise sur la ligne (montant TTC)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(STOCK_MAX_PRICE)
  discount?: number;
}

export class StockPaymentDto {
  @ApiProperty({ enum: STOCK_PAYMENT_METHODS })
  @IsIn(STOCK_PAYMENT_METHODS)
  method: StockPaymentMethod;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(STOCK_MAX_PRICE)
  amount: number;

  @ApiPropertyOptional({ description: 'Espèces : somme remise par le client' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  @Max(STOCK_MAX_PRICE)
  tendered?: number | null;

  @ApiPropertyOptional({ description: 'Référence de la transaction (mobile money, carte)' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(80)
  reference?: string | null;
}

export class CreateStockSaleDto {
  @ApiProperty()
  @IdempotencyKey()
  idempotencyKey: string;

  @ApiProperty()
  @IsUUID()
  registerId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf(notNull)
  @IsUUID()
  customerId?: string | null;

  @ApiProperty({ type: [StockSaleLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(STOCK_MAX_SALE_LINES)
  @ValidateNested({ each: true })
  @Type(() => StockSaleLineDto)
  lines: StockSaleLineDto[];

  @ApiProperty({ type: [StockPaymentDto] })
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => StockPaymentDto)
  payments: StockPaymentDto[];
}

export class StockSaleQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Numéro de vente (VTE-000012 ou 12)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  q?: string;
}

export class StockSaleReturnLineDto {
  @ApiProperty()
  @IsUUID()
  saleLineId: string;

  @ApiProperty()
  @Quantity()
  quantity: number;
}

export class CreateStockSaleReturnDto {
  @ApiProperty()
  @IdempotencyKey()
  idempotencyKey: string;

  @ApiProperty({ description: 'Caisse dont la session ouverte rembourse' })
  @IsUUID()
  registerId: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason: string;

  @ApiProperty({ description: 'Remettre la marchandise en stock (faux : défectueuse)' })
  @IsBoolean()
  restock: boolean;

  @ApiProperty({ enum: STOCK_PAYMENT_METHODS })
  @IsIn(STOCK_PAYMENT_METHODS)
  refundMethod: StockPaymentMethod;

  @ApiProperty({ type: [StockSaleReturnLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(STOCK_MAX_SALE_LINES)
  @ValidateNested({ each: true })
  @Type(() => StockSaleReturnLineDto)
  lines: StockSaleReturnLineDto[];
}

export class StockHeldCartLineDto {
  @ApiProperty()
  @IsUUID()
  variantId: string;

  @ApiProperty()
  @Quantity()
  quantity: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(STOCK_MAX_PRICE)
  discount?: number;
}

export class HoldStockCartDto {
  @ApiProperty({ description: 'Libellé (nom du client, numéro…)' })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  label: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf(notNull)
  @IsUUID()
  customerId?: string | null;

  @ApiProperty({ type: [StockHeldCartLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(STOCK_MAX_SALE_LINES)
  @ValidateNested({ each: true })
  @Type(() => StockHeldCartLineDto)
  lines: StockHeldCartLineDto[];
}

export class StockReceiptQueryDto {
  @ApiPropertyOptional({ enum: [58, 80] })
  @IsOptional()
  @Type(() => Number)
  @IsIn([58, 80])
  width?: 58 | 80;
}

export class StockCashSessionQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  registerId?: string;
}
