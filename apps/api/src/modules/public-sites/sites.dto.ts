import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  SITE_DOMAIN_STATUSES,
  SITE_MEDIA_KINDS,
  SITE_SLUG_MAX,
  SITE_THEMES,
  type SiteDomainStatus,
  type SiteMediaKind,
  type SiteTheme,
} from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateSiteDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiProperty({ example: 'maquis-le-baobab' })
  @Transform(trim)
  @IsString()
  @Length(1, SITE_SLUG_MAX)
  slug: string;
}

export class UpdateSiteDraftDto {
  @ApiProperty({ description: 'Contenu du brouillon (SiteContent), validé par le serveur.' })
  @IsObject()
  content: Record<string, unknown>;
}

export class UpdateSiteSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, SITE_SLUG_MAX)
  slug?: string;

  @ApiPropertyOptional({ enum: SITE_THEMES })
  @IsOptional()
  @IsIn(SITE_THEMES)
  theme?: SiteTheme;

  @ApiPropertyOptional({ example: '#176B53' })
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  primaryColor?: string;

  @ApiPropertyOptional({
    example: '#F5C94B',
    nullable: true,
    description: 'null = défaut du thème.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^#[0-9a-fA-F]{6}$/)
  accentColor?: string | null;
}

export class UploadSiteMediaDto {
  @ApiProperty({ enum: SITE_MEDIA_KINDS })
  @IsIn(SITE_MEDIA_KINDS)
  kind: SiteMediaKind;

  @ApiPropertyOptional({ description: 'Texte alternatif (accessibilité).' })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  alt?: string;
}

export class AddSiteDomainDto {
  @ApiProperty({ example: 'www.monrestaurant.ml' })
  @IsString()
  @Length(3, 260)
  hostname: string;
}

export class PlatformDomainsQueryDto {
  @ApiPropertyOptional({ enum: SITE_DOMAIN_STATUSES })
  @IsOptional()
  @IsIn(SITE_DOMAIN_STATUSES)
  status?: SiteDomainStatus;
}

export class SuspendDomainDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason: string;
}

export class ResolveHostQueryDto {
  @ApiProperty()
  @IsString()
  @Length(1, 260)
  host: string;
}
