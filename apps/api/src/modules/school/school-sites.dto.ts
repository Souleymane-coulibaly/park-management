import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  SCHOOL_SITE_LANGUAGES,
  SCHOOL_SITE_LIMITS,
  SCHOOL_SITE_LINK_KINDS,
  SCHOOL_SITE_THEMES,
  type SchoolSiteLinkKind,
} from '@ocall/shared';
import { SCHOOL_SITE_MEDIA_KINDS, type SchoolSiteMediaKind } from './school-site-media.service';
import { DAY, lowerUuid, lowerUuids } from './school-portal.dto';

const SLUG = /^[a-z0-9-]{3,40}$/;
/** Champ booléen d'un formulaire multipart : « true » / « false ». */
const formBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : value;

export class SiteSchoolQueryDto {
  @Transform(lowerUuid)
  @IsUUID()
  schoolId!: string;
}

export class CreateSiteDto {
  @Transform(lowerUuid)
  @IsUUID()
  schoolId!: string;

  @ApiProperty({ example: 'medersa-annour' })
  @IsString()
  @Matches(SLUG)
  slug!: string;
}

export class SiteSlugDto {
  @IsString()
  @Matches(SLUG)
  slug!: string;
}

export class SiteEnabledDto {
  @IsBoolean()
  enabled!: boolean;
}

export class SiteSettingsDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @IsIn(SCHOOL_SITE_LANGUAGES, { each: true })
  languages?: string[];

  @IsOptional()
  @IsIn(SCHOOL_SITE_LANGUAGES)
  defaultLanguage?: string;

  @IsOptional()
  @IsIn(SCHOOL_SITE_THEMES)
  theme?: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  primaryColor?: string;
}

/** Brouillon : structure vérifiée en détail par validateSchoolSiteContent (clés exactes). */
export class SiteDraftDto {
  @IsObject()
  content!: Record<string, unknown>;

  /** Révision du brouillon sur laquelle s'appuie cette sauvegarde (conflit 409 si elle a changé). */
  @Matches(/^[0-9a-f]{64}$/)
  revision!: string;
}

export class SiteLinkDto {
  @IsIn(SCHOOL_SITE_LINK_KINDS)
  kind!: SchoolSiteLinkKind;

  @IsString()
  @MaxLength(500)
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(SCHOOL_SITE_LIMITS.linkLabel)
  label?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class SiteLinkUpdateDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SCHOOL_SITE_LIMITS.linkLabel)
  label?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class SiteLinksOrderDto {
  @Transform(lowerUuids)
  @IsArray()
  @ArrayMaxSize(SCHOOL_SITE_LIMITS.links)
  @IsUUID('all', { each: true })
  ids!: string[];
}

export class SiteNewsDto {
  @IsString()
  @MaxLength(SCHOOL_SITE_LIMITS.newsTitle)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(SCHOOL_SITE_LIMITS.newsTitle)
  titleAr?: string;

  @IsString()
  @MaxLength(SCHOOL_SITE_LIMITS.newsBody)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(SCHOOL_SITE_LIMITS.newsBody)
  bodyAr?: string;

  @Matches(DAY)
  // Date réelle du calendrier (2026-02-30 refusée, jamais normalisée au 2 mars).
  @IsISO8601({ strict: true })
  publishedOn!: string;

  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID()
  mediaId?: string | null;
}

export class SiteNewsUpdateDto {
  @IsOptional()
  @IsString()
  @MaxLength(SCHOOL_SITE_LIMITS.newsTitle)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SCHOOL_SITE_LIMITS.newsTitle)
  titleAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SCHOOL_SITE_LIMITS.newsBody)
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SCHOOL_SITE_LIMITS.newsBody)
  bodyAr?: string;

  @IsOptional()
  @Matches(DAY)
  // Date réelle du calendrier (2026-02-30 refusée, jamais normalisée au 2 mars).
  @IsISO8601({ strict: true })
  publishedOn?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID()
  mediaId?: string | null;
}

export class SiteNewsStatusDto {
  @IsBoolean()
  publish!: boolean;
}

/** Champs du formulaire d'envoi d'une image (multipart). */
export class SiteMediaUploadDto {
  @IsIn(SCHOOL_SITE_MEDIA_KINDS)
  kind!: SchoolSiteMediaKind;

  @IsOptional()
  @IsString()
  @MaxLength(SCHOOL_SITE_LIMITS.altText)
  alt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SCHOOL_SITE_LIMITS.altText)
  altAr?: string;

  @Transform(formBoolean)
  @IsBoolean()
  containsMinors!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(SCHOOL_SITE_LIMITS.consentReference)
  consentReference?: string;
}

export class SiteMediaWithdrawDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class SiteHostQueryDto {
  @IsString()
  @MaxLength(255)
  host!: string;
}
