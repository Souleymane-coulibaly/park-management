import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { SITE_MEDIA_MAX_BYTES } from '@ocall/shared';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import {
  CurrentAuth,
  Public,
  RequirePermission,
  RequirePlatformPermission,
  SuperAdminOnly,
} from '../../common/decorators';
import { PublicSiteRoute } from '../../common/throttling';
import type { UploadedFileInMemory } from '../ai/uploaded-file';
import {
  AddSiteDomainDto,
  CreateSiteDto,
  PlatformDomainsQueryDto,
  ResolveHostQueryDto,
  SuspendDomainDto,
  UpdateSiteDraftDto,
  UpdateSiteSettingsDto,
  UploadSiteMediaDto,
} from './sites.dto';
import { SiteDomainsService } from './site-domains.service';
import { SiteMediaService } from './site-media.service';
import { SitesService } from './sites.service';

const upload = FileInterceptor('file', { limits: { fileSize: SITE_MEDIA_MAX_BYTES, files: 1 } });

/** En-têtes d'une image servie : type fixé par le serveur, aucun script possible. */
function imageHeaders(res: Response, mimeType: string, cache: string) {
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', cache);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
  res.setHeader('Content-Disposition', 'inline');
}

/** Éditeur de site (espace client) : organisation et établissements de la session uniquement. */
@ApiTags('Sites vitrines')
@Controller('sites')
export class SitesController {
  constructor(
    private readonly sites: SitesService,
    private readonly media: SiteMediaService,
    private readonly domains: SiteDomainsService,
  ) {}

  @RequirePermission('site.manage')
  @Get()
  overview(@CurrentAuth() auth: AuthContext) {
    return this.sites.overview(requireTenant(auth));
  }

  @RequirePermission('site.manage')
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateSiteDto) {
    return this.sites.create(requireTenant(auth), dto.establishmentId, dto.slug);
  }

  @RequirePermission('site.manage')
  @Get(':id')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.sites.get(requireTenant(auth), id);
  }

  @RequirePermission('site.manage')
  @Put(':id/draft')
  updateDraft(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSiteDraftDto,
  ) {
    return this.sites.updateDraft(requireTenant(auth), id, dto.content);
  }

  @RequirePermission('site.manage')
  @Put(':id/settings')
  updateSettings(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSiteSettingsDto,
  ) {
    return this.sites.updateSettings(requireTenant(auth), id, dto);
  }

  @RequirePermission('site.manage')
  @Get(':id/preview')
  preview(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.sites.preview(requireTenant(auth), id);
  }

  @RequirePermission('site.manage')
  @Get(':id/catalog-options')
  catalogOptions(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.sites.catalogOptions(requireTenant(auth), id);
  }

  @RequirePermission('site.publish')
  @Post(':id/publish')
  publish(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.sites.publish(requireTenant(auth), id);
  }

  @RequirePermission('site.publish')
  @Post(':id/unpublish')
  unpublish(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.sites.unpublish(requireTenant(auth), id);
  }

  // ─── Médias ───

  @RequirePermission('site.manage')
  @Get(':id/media')
  listMedia(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.list(requireTenant(auth), id);
  }

  @RequirePermission('site.manage')
  @Post(':id/media')
  @UseInterceptors(upload)
  uploadMedia(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadSiteMediaDto,
    @UploadedFile() file: UploadedFileInMemory | undefined,
  ) {
    return this.media.upload(requireTenant(auth), id, dto.kind, dto.alt ?? '', file);
  }

  @RequirePermission('site.manage')
  @Get(':id/media/:mediaId/file')
  async mediaFile(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.media.file(requireTenant(auth), id, mediaId);
    imageHeaders(res, file.mimeType, 'private, no-store');
    return new StreamableFile(file.body);
  }

  @RequirePermission('site.manage')
  @Delete(':id/media/:mediaId')
  removeMedia(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ) {
    return this.media.remove(requireTenant(auth), id, mediaId);
  }

  // ─── Domaine personnalisé ───

  @RequirePermission('site.domain')
  @Post(':id/domains')
  addDomain(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddSiteDomainDto,
  ) {
    return this.domains.add(requireTenant(auth), id, dto.hostname);
  }

  @RequirePermission('site.domain')
  @Post(':id/domains/:domainId/verify')
  verifyDomain(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
  ) {
    return this.domains.verify(requireTenant(auth), id, domainId);
  }

  @RequirePermission('site.domain')
  @Delete(':id/domains/:domainId')
  removeDomain(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
  ) {
    return this.domains.remove(requireTenant(auth), id, domainId);
  }
}

/**
 * API publique des sites : lecture seule de la version PUBLIÉE (jamais le brouillon), images
 * publiées uniquement, limitation de débit dédiée. Aucune donnée interne exposée.
 */
@ApiTags('Sites vitrines (public)')
@Public()
@PublicSiteRoute()
@Controller('public')
export class PublicSitesController {
  constructor(
    private readonly sites: SitesService,
    private readonly media: SiteMediaService,
  ) {}

  @Get('sites/resolve')
  async resolve(@Query() q: ResolveHostQueryDto) {
    const site = await this.sites.resolveHost(q.host);
    if (!site)
      throw new NotFoundException({ code: 'SITE_NOT_FOUND', message: 'Site introuvable.' });
    return site;
  }

  @Get('sites/sitemap')
  sitemap(@Query() q: ResolveHostQueryDto) {
    return this.sites.sitemap(q.host);
  }

  @Get('sites/:slug')
  async bySlug(@Param('slug') slug: string, @Res({ passthrough: true }) res: Response) {
    const site = /^[a-z0-9-]{1,40}$/.test(slug) ? await this.sites.publicBySlug(slug) : null;
    if (!site)
      throw new NotFoundException({ code: 'SITE_NOT_FOUND', message: 'Site introuvable.' });
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    return site;
  }

  @Get('media/:key')
  async mediaFile(@Param('key') key: string, @Res({ passthrough: true }) res: Response) {
    const file = /^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key)
      ? await this.media.publicFile(key)
      : null;
    if (!file)
      throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', message: 'Image introuvable.' });
    imageHeaders(res, file.mimeType, 'public, max-age=86400, stale-while-revalidate=604800');
    return new StreamableFile(file.body);
  }
}

/** Super Admin : domaines personnalisés à activer (procédure administrative). */
@ApiTags('Plateforme (Super Admin)')
@SuperAdminOnly()
@RequirePlatformPermission('platform.domains.manage')
@Controller('platform/site-domains')
export class PlatformSiteDomainsController {
  constructor(private readonly domains: SiteDomainsService) {}

  @Get()
  list(@Query() q: PlatformDomainsQueryDto) {
    return this.domains.platformList(q.status);
  }

  @Post(':id/activate')
  activate(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.domains.activate(auth, id);
  }

  @Post(':id/suspend')
  suspend(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendDomainDto,
  ) {
    return this.domains.suspend(auth, id, dto.reason);
  }
}
