import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
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
  STOCK_SHOWCASE_MAX_REQUEST_ITEMS,
  STOCK_SHOWCASE_MEDIA_KINDS,
  STOCK_SHOWCASE_REQUEST_KINDS,
  STOCK_SHOWCASE_REQUEST_STATUSES,
  type StockShowcaseMediaKind,
  type StockShowcaseRequestKind,
  type StockShowcaseRequestStatus,
} from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const lowerOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() || null : value;
const notNull = (_: unknown, v: unknown) => v !== null;

/** Contenu du brouillon de la vitrine Stock (remplacé en entier à chaque enregistrement). */
export class StockShowcaseContentDto {
  @ApiProperty({ description: 'Titre principal (ex. « Tout pour bâtir à Bamako »)' })
  @Transform(trim)
  @IsString()
  @Length(3, 120)
  headline: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(200)
  tagline: string | null = null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(3000)
  about: string | null = null;

  @ApiPropertyOptional({ description: 'Téléphone au format international (+223 …)' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @Matches(/^\+[0-9][0-9 ().-]{6,22}$/, { message: 'Téléphone au format international (+223 …).' })
  phone: string | null = null;

  @ApiPropertyOptional({ description: 'Numéro WhatsApp international (+223 …)' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @Matches(/^(\+|00)[0-9 ().-]{8,24}$/, { message: 'Numéro WhatsApp international (+223 …).' })
  whatsapp: string | null = null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerOrNull)
  @ValidateIf(notNull)
  @IsEmail()
  @MaxLength(160)
  email: string | null = null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(240)
  address: string | null = null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(80)
  city: string | null = null;

  @ApiPropertyOptional({ description: 'Horaires (texte libre)' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(200)
  hours: string | null = null;

  @ApiPropertyOptional({ description: 'Lien https vers une carte' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  mapUrl: string | null = null;

  @ApiPropertyOptional({ description: 'Description pour les moteurs de recherche' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(300)
  seoDescription: string | null = null;

  @ApiPropertyOptional({
    description: 'Couleur principale #RRGGBB (texte blanc lisible) ; null = couleur Ocall',
  })
  @IsOptional()
  @ValidateIf(notNull)
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Couleur au format #RRGGBB.' })
  primaryColor: string | null = null;

  @ApiProperty({ description: 'Catalogue public (articles cochés « Publier sur la vitrine »)' })
  @IsBoolean()
  showCatalog: boolean = true;

  @ApiProperty({ description: 'Afficher les prix de vente TTC (sinon « Prix sur demande »)' })
  @IsBoolean()
  showPrices: boolean = false;

  @ApiProperty({ enum: STOCK_SHOWCASE_REQUEST_KINDS, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn(STOCK_SHOWCASE_REQUEST_KINDS, { each: true })
  forms: StockShowcaseRequestKind[] = ['CONTACT', 'QUOTE'];
}

export class StockShowcaseSlugDto {
  @ApiProperty({ description: 'Adresse publique (lettres minuscules, chiffres, tirets)' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Length(3, 40)
  slug: string;
}

export class StockShowcaseMediaDto {
  @ApiProperty({ enum: STOCK_SHOWCASE_MEDIA_KINDS })
  @IsIn(STOCK_SHOWCASE_MEDIA_KINDS)
  kind: StockShowcaseMediaKind;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(160)
  caption?: string | null;
}

export class StockShowcaseDomainDto {
  @ApiProperty({ description: 'Ex. www.quincaillerie-du-fleuve.ml' })
  @IsString()
  @Length(4, 253)
  hostname: string;
}

/** Article publié ou retiré de la vitrine. */
export class StockShowcaseProductDto {
  @ApiProperty()
  @IsBoolean()
  published: boolean;
}

/** Articles de l'organisation, avec leur état sur la vitrine (back-office). */
export class StockShowcaseProductQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ description: 'Seulement les articles publiés' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  published?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500)
  page?: number;
}

export class StockShowcaseHostQueryDto {
  @ApiProperty()
  @IsString()
  @Length(1, 253)
  host: string;
}

/** Catalogue public : catégorie, texte, page. */
export class StockShowcaseCatalogQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  page?: number;
}

export class StockShowcaseRequestItemDto {
  @ApiProperty()
  @IsUUID()
  productId: string;

  @ApiProperty({ description: 'Quantité souhaitée' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1_000_000)
  quantity: number;
}

/** Demande déposée par un visiteur (formulaire public, anti-spam). */
export class StockShowcaseRequestDto {
  @ApiProperty({ enum: STOCK_SHOWCASE_REQUEST_KINDS })
  @IsIn(STOCK_SHOWCASE_REQUEST_KINDS)
  kind: StockShowcaseRequestKind;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @Matches(/^\+?[0-9][0-9 ().-]{6,22}$/, { message: 'Numéro de téléphone invalide.' })
  phone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerOrNull)
  @ValidateIf(notNull)
  @IsEmail()
  @MaxLength(160)
  email?: string | null;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(5, 2000)
  message: string;

  @ApiPropertyOptional({ type: [StockShowcaseRequestItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(STOCK_SHOWCASE_MAX_REQUEST_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => StockShowcaseRequestItemDto)
  items?: StockShowcaseRequestItemDto[];

  /** Champ piège invisible : rempli par un robot seulement. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;

  /** Heure d'ouverture du formulaire (ms) : un envoi trop rapide est ignoré. */
  @ApiProperty()
  @IsInt()
  startedAt: number;
}

export class StockShowcaseRequestQueryDto {
  @ApiPropertyOptional({ enum: STOCK_SHOWCASE_REQUEST_STATUSES })
  @IsOptional()
  @IsIn(STOCK_SHOWCASE_REQUEST_STATUSES)
  status?: StockShowcaseRequestStatus;
}

export class UpdateStockShowcaseRequestDto {
  @ApiProperty({ enum: STOCK_SHOWCASE_REQUEST_STATUSES })
  @IsIn(STOCK_SHOWCASE_REQUEST_STATUSES)
  status: StockShowcaseRequestStatus;
}

export class SuspendStockShowcaseDomainDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason: string;
}
