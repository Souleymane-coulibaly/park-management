import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { SITE_MEDIA_MAX_BYTES, SchoolPermission } from '@ocall/shared';
import { Public } from '../../common/decorators';
import { PublicSiteRoute } from '../../common/throttling';
import {
  AllowInReadOnly,
  CurrentSchool,
  RequireSchoolPermission,
  SchoolAccessGuard,
  type SchoolContext,
} from './school-access';
import type { SchoolUpload } from './school-documents.service';
import { SchoolSiteMediaService } from './school-site-media.service';
import {
  CreateSiteDto,
  SiteDraftDto,
  SiteEnabledDto,
  SiteHostQueryDto,
  SiteLinkDto,
  SiteLinkUpdateDto,
  SiteLinksOrderDto,
  SiteMediaUploadDto,
  SiteMediaWithdrawDto,
  SiteNewsDto,
  SiteNewsStatusDto,
  SiteNewsUpdateDto,
  SiteSchoolQueryDto,
  SiteSettingsDto,
  SiteSlugDto,
} from './school-sites.dto';
import { SchoolSitesService } from './school-sites.service';

const SP = SchoolPermission;
const MEDIA_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

const mediaFile = FileInterceptor('file', {
  limits: { fileSize: SITE_MEDIA_MAX_BYTES, files: 1 },
});

/** En-têtes d'une image : type imposé, aucune exécution, aucun encadrement par un autre site. */
function imageHeaders(res: Response, cache: string) {
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', cache);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
}

/**
 * Administration des sites vitrines (Sprint 10). Le secrétariat prépare (contenu, médias, actualités,
 * liens) ; la direction active, publie et dépublie. Retirer une image et dépublier restent possibles
 * en lecture seule (contrat suspendu) : ils ne font que réduire ce qui est exposé.
 */
@ApiTags('Ocall School — site vitrine')
@UseGuards(SchoolAccessGuard)
@Controller('school/sites')
export class SchoolSitesController {
  constructor(
    private readonly sites: SchoolSitesService,
    private readonly media: SchoolSiteMediaService,
  ) {}

  @RequireSchoolPermission(SP.SITE_MANAGE)
  @Get()
  forSchool(@CurrentSchool() ctx: SchoolContext, @Query() q: SiteSchoolQueryDto) {
    return this.sites.forSchool(ctx, q.schoolId);
  }

  @RequireSchoolPermission(SP.SITE_PUBLISH)
  @Post()
  create(@CurrentSchool() ctx: SchoolContext, @Body() dto: CreateSiteDto) {
    return this.sites.create(ctx, dto.schoolId, dto.slug);
  }

  @RequireSchoolPermission(SP.SITE_MANAGE)
  @Patch(':id/settings')
  settings(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SiteSettingsDto,
  ) {
    return this.sites.updateSettings(ctx, id, dto);
  }

  @RequireSchoolPermission(SP.SITE_PUBLISH)
  @Put(':id/slug')
  slug(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SiteSlugDto,
  ) {
    return this.sites.changeSlug(ctx, id, dto.slug);
  }

  /** Désactiver est protecteur (permis en lecture seule) ; réactiver exige un contrat valide. */
  @RequireSchoolPermission(SP.SITE_PUBLISH)
  @AllowInReadOnly()
  @Put(':id/enabled')
  enabled(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SiteEnabledDto,
  ) {
    if (dto.enabled && ctx.access !== 'full') {
      throw new ForbiddenException({
        code: 'CONTRACT_READ_ONLY',
        message: 'Votre contrat ne permet plus que la consultation et l’export des données.',
      });
    }
    return this.sites.setEnabled(ctx, id, dto.enabled);
  }

  @RequireSchoolPermission(SP.SITE_MANAGE)
  @Put(':id/draft')
  draft(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SiteDraftDto,
  ) {
    return this.sites.saveDraft(ctx, id, dto.content, dto.revision);
  }

  @RequireSchoolPermission(SP.SITE_MANAGE)
  @Get(':id/preview')
  preview(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.sites.preview(ctx, id);
  }

  @RequireSchoolPermission(SP.SITE_PUBLISH)
  @HttpCode(200)
  @Post(':id/publish')
  publish(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.sites.publish(ctx, id);
  }

  @RequireSchoolPermission(SP.SITE_PUBLISH)
  @AllowInReadOnly()
  @HttpCode(200)
  @Post(':id/unpublish')
  unpublish(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.sites.unpublish(ctx, id);
  }

  /** Export complet (résiliation, archive), disponible aussi en lecture seule. */
  @RequireSchoolPermission(SP.SITE_MANAGE)
  @Get(':id/export')
  async export(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.sites.exportSite(ctx, id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(file.body);
  }

  // ─── Médias ───

  @RequireSchoolPermission(SP.SITE_MANAGE)
  @Get(':id/media')
  listMedia(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.list(ctx, id);
  }

  @RequireSchoolPermission(SP.SITE_MANAGE)
  @UseInterceptors(mediaFile)
  @Post(':id/media')
  upload(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SiteMediaUploadDto,
    @UploadedFile() file: SchoolUpload | undefined,
  ) {
    return this.media.upload(ctx, id, dto, file);
  }

  @RequireSchoolPermission(SP.SITE_MANAGE)
  @Get(':id/media-file/:key')
  async mediaFile(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!MEDIA_KEY.test(key))
      throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', message: 'Image introuvable.' });
    const file = await this.media.file(ctx, id, key);
    imageHeaders(res, 'private, no-store');
    return new StreamableFile(file.body);
  }

  /** Retrait immédiat (photo de mineur, demande d'une famille…) : permis en lecture seule. */
  @RequireSchoolPermission(SP.SITE_MANAGE)
  @AllowInReadOnly()
  @HttpCode(200)
  @Post(':id/media/:mediaId/withdraw')
  withdraw(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Body() dto: SiteMediaWithdrawDto,
  ) {
    return this.media.withdraw(ctx, id, mediaId, dto.reason ?? '');
  }

  // ─── Liens externes et réseaux sociaux ───

  @RequireSchoolPermission(SP.SITE_MANAGE)
  @Get(':id/links')
  links(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.sites.listLinks(ctx, id);
  }

  @RequireSchoolPermission(SP.SITE_MANAGE)
  @Post(':id/links')
  createLink(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SiteLinkDto,
  ) {
    return this.sites.createLink(ctx, id, dto);
  }

  @RequireSchoolPermission(SP.SITE_MANAGE)
  @Put(':id/links-order')
  reorderLinks(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SiteLinksOrderDto,
  ) {
    return this.sites.reorderLinks(ctx, id, dto.ids);
  }

  @RequireSchoolPermission(SP.SITE_MANAGE)
  @Patch(':id/links/:linkId')
  updateLink(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @Body() dto: SiteLinkUpdateDto,
  ) {
    return this.sites.updateLink(ctx, id, linkId, dto);
  }

  @RequireSchoolPermission(SP.SITE_MANAGE)
  @AllowInReadOnly()
  @Delete(':id/links/:linkId')
  removeLink(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
  ) {
    return this.sites.removeLink(ctx, id, linkId);
  }

  // ─── Actualités ───

  @RequireSchoolPermission(SP.SITE_MANAGE)
  @Get(':id/news')
  news(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.sites.listNews(ctx, id);
  }

  @RequireSchoolPermission(SP.SITE_MANAGE)
  @Post(':id/news')
  createNews(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SiteNewsDto,
  ) {
    return this.sites.createNews(ctx, id, dto);
  }

  @RequireSchoolPermission(SP.SITE_MANAGE)
  @Patch(':id/news/:newsId')
  updateNews(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('newsId', ParseUUIDPipe) newsId: string,
    @Body() dto: SiteNewsUpdateDto,
  ) {
    return this.sites.updateNews(ctx, id, newsId, dto);
  }

  /** Publier une actualité : direction ; la retirer reste possible en lecture seule. */
  @RequireSchoolPermission(SP.SITE_PUBLISH)
  @AllowInReadOnly()
  @Put(':id/news/:newsId/status')
  newsStatus(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('newsId', ParseUUIDPipe) newsId: string,
    @Body() dto: SiteNewsStatusDto,
  ) {
    if (dto.publish && ctx.access !== 'full') {
      throw new ForbiddenException({
        code: 'CONTRACT_READ_ONLY',
        message: 'Votre contrat ne permet plus que la consultation et l’export des données.',
      });
    }
    return this.sites.setNewsStatus(ctx, id, newsId, dto.publish);
  }

  @RequireSchoolPermission(SP.SITE_MANAGE)
  @AllowInReadOnly()
  @Delete(':id/news/:newsId')
  removeNews(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('newsId', ParseUUIDPipe) newsId: string,
  ) {
    return this.sites.removeNews(ctx, id, newsId);
  }
}

/**
 * Lecture publique des sites School : version publiée uniquement, images publiées uniquement,
 * limitation de débit des sites publics. Aucune donnée scolaire, aucun identifiant interne.
 */
@ApiTags('Ocall School — sites vitrines (public)')
@Public()
@PublicSiteRoute()
@Controller('public')
export class PublicSchoolSitesController {
  constructor(
    private readonly sites: SchoolSitesService,
    private readonly media: SchoolSiteMediaService,
  ) {}

  @Get('school-sites/resolve')
  async resolve(@Query() q: SiteHostQueryDto) {
    const site = await this.sites.resolveHost(q.host);
    if (!site)
      throw new NotFoundException({ code: 'SITE_NOT_FOUND', message: 'Site introuvable.' });
    return site;
  }

  @Get('school-sites/sitemap')
  sitemap(@Query() q: SiteHostQueryDto) {
    return this.sites.sitemap(q.host);
  }

  @Get('school-sites/:slug')
  async bySlug(@Param('slug') slug: string, @Res({ passthrough: true }) res: Response) {
    const site = /^[a-z0-9-]{1,40}$/.test(slug) ? await this.sites.publicBySlug(slug) : null;
    if (!site)
      throw new NotFoundException({ code: 'SITE_NOT_FOUND', message: 'Site introuvable.' });
    // Jamais mis en cache : une dépublication, une résiliation ou un retrait valent immédiatement.
    res.setHeader('Cache-Control', 'no-store');
    return site;
  }

  /** Article publié, résolu par son adresse (y compris au-delà des 50 plus récents). */
  @Get('school-sites/:slug/news/:newsSlug')
  async news(
    @Param('slug') slug: string,
    @Param('newsSlug') newsSlug: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const news = /^[a-z0-9-]{1,40}$/.test(slug)
      ? await this.sites.publicNews(slug, newsSlug)
      : null;
    if (!news)
      throw new NotFoundException({ code: 'SITE_NOT_FOUND', message: 'Actualité introuvable.' });
    res.setHeader('Cache-Control', 'no-store');
    return news;
  }

  /** Cache court : une image retirée cesse d'être servie aussitôt, et des caches sous 5 minutes. */
  @Get('school-media/:key')
  async mediaFile(@Param('key') key: string, @Res({ passthrough: true }) res: Response) {
    const file = MEDIA_KEY.test(key) ? await this.media.publicFile(key) : null;
    if (!file)
      throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', message: 'Image introuvable.' });
    imageHeaders(res, 'public, max-age=300');
    return new StreamableFile(file.body);
  }
}
