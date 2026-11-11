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
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  FACTURE_REQUEST_KINDS,
  FACTURE_REQUEST_STATUSES,
  FACTURE_SITE_MAX_SERVICES,
  FACTURE_SITE_MEDIA_KINDS,
  type FactureRequestKind,
  type FactureRequestStatus,
  type FactureSiteMediaKind,
} from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const notNull = (_: unknown, v: unknown) => v !== null;

export class FactureSiteServiceDto {
  @ApiProperty()
  @IsUUID()
  itemId: string;

  @ApiProperty({ description: 'Afficher le prix du catalogue' })
  @IsBoolean()
  showPrice: boolean;
}

/** Contenu du brouillon de la vitrine (remplacé en entier à chaque enregistrement). */
export class FactureSiteContentDto {
  @ApiProperty({ description: 'Titre principal (ex. « Climatisation et froid à Bamako »)' })
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

  @ApiProperty({ type: [FactureSiteServiceDto] })
  @IsArray()
  @ArrayMaxSize(FACTURE_SITE_MAX_SERVICES)
  @ValidateNested({ each: true })
  @Type(() => FactureSiteServiceDto)
  services: FactureSiteServiceDto[] = [];

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
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || null : value,
  )
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

  @ApiProperty({ enum: FACTURE_REQUEST_KINDS, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn(FACTURE_REQUEST_KINDS, { each: true })
  forms: FactureRequestKind[] = ['CONTACT', 'QUOTE'];
}

export class FactureSiteSlugDto {
  @ApiProperty({ description: 'Adresse publique (lettres minuscules, chiffres, tirets)' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Length(3, 40)
  slug: string;
}

export class FactureSiteMediaDto {
  @ApiProperty({ enum: FACTURE_SITE_MEDIA_KINDS })
  @IsIn(FACTURE_SITE_MEDIA_KINDS)
  kind: FactureSiteMediaKind;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(160)
  caption?: string | null;
}

export class FactureSiteDomainDto {
  @ApiProperty({ description: 'Ex. www.froid-services.ml' })
  @IsString()
  @Length(4, 253)
  hostname: string;
}

export class FactureSiteHostQueryDto {
  @ApiProperty()
  @IsString()
  @Length(1, 253)
  host: string;
}

/** Demande déposée par un visiteur (formulaire public, anti-spam). */
export class FactureSiteRequestDto {
  @ApiProperty({ enum: FACTURE_REQUEST_KINDS })
  @IsIn(FACTURE_REQUEST_KINDS)
  kind: FactureRequestKind;

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
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || null : value,
  )
  @ValidateIf(notNull)
  @IsEmail()
  @MaxLength(160)
  email?: string | null;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(5, 2000)
  message: string;

  @ApiPropertyOptional({ description: 'Prestation de la vitrine concernée' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsUUID()
  serviceItemId?: string | null;

  @ApiPropertyOptional({ description: 'Date souhaitée (AAAA-MM-JJ), indicative' })
  @IsOptional()
  @ValidateIf(notNull)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  preferredDate?: string | null;

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

export class FactureRequestQueryDto {
  @ApiPropertyOptional({ enum: FACTURE_REQUEST_STATUSES })
  @IsOptional()
  @IsIn(FACTURE_REQUEST_STATUSES)
  status?: FactureRequestStatus;
}

export class UpdateFactureRequestDto {
  @ApiProperty({ enum: FACTURE_REQUEST_STATUSES })
  @IsIn(FACTURE_REQUEST_STATUSES)
  status: FactureRequestStatus;
}
