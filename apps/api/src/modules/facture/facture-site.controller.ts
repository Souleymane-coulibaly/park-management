import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
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
import type { AuthContext } from '../../common/auth-context';
import {
  CurrentAuth,
  Public,
  RequirePlatformPermission,
  SuperAdminOnly,
} from '../../common/decorators';
import { PublicLeadRoute, PublicSiteRoute } from '../../common/throttling';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import {
  CurrentFacture,
  FactureAccessGuard,
  type FactureContext,
  RequireFacturePermission,
} from './facture-access';
import { CancelFactureInterventionDto } from './facture-interventions.dto';
import { FACTURE_PHOTO_MAX_BYTES } from './facture-interventions.service';
import { FactureSiteDomainsService } from './facture-site-domains.service';
import {
  FactureRequestQueryDto,
  FactureSiteContentDto,
  FactureSiteDomainDto,
  FactureSiteHostQueryDto,
  FactureSiteMediaDto,
  FactureSiteRequestDto,
  FactureSiteSlugDto,
  UpdateFactureRequestDto,
} from './facture-site.dto';
import { FactureSiteService } from './facture-site.service';
import type { FactureUpload } from './facture.service';

const uuid = new ParseUUIDPipe();
const imageFile = FileInterceptor('file', {
  limits: { fileSize: FACTURE_PHOTO_MAX_BYTES + 1, files: 1 },
});
const MEDIA_KEY = /^[0-9a-f-]{36}\.jpg$/;
const SLUG = /^[a-z0-9-]{1,40}$/;
const notFound = () =>
  new NotFoundException({ code: 'SITE_NOT_FOUND', message: 'Site introuvable.' });

/** Ocall Facture — site vitrine (F5), back-office : contenu, médias, publication, domaines, demandes. */
@ApiTags('Ocall Facture')
@UseGuards(FactureAccessGuard)
@Controller('facture')
export class FactureSiteController {
  constructor(
    private readonly sites: FactureSiteService,
    private readonly domains: FactureSiteDomainsService,
  ) {}

  @RequireFacturePermission('facture.site.manage')
  @Get('site')
  get(@CurrentFacture() ctx: FactureContext) {
    return this.sites.get(ctx);
  }

  @RequireFacturePermission('facture.site.manage')
  @Get('site/suggest-slug')
  suggest(@CurrentFacture() ctx: FactureContext) {
    return this.sites.suggestSlug(ctx);
  }

  @RequireFacturePermission('facture.site.manage')
  @Put('site/slug')
  slug(@CurrentFacture() ctx: FactureContext, @Body() dto: FactureSiteSlugDto) {
    return this.sites.setSlug(ctx, dto.slug);
  }

  @RequireFacturePermission('facture.site.manage')
  @Put('site/draft')
  draft(@CurrentFacture() ctx: FactureContext, @Body() dto: FactureSiteContentDto) {
    return this.sites.saveDraft(ctx, dto);
  }

  @RequireFacturePermission('facture.site.manage')
  @Post('site/media')
  @UseInterceptors(imageFile)
  addMedia(
    @CurrentFacture() ctx: FactureContext,
    @UploadedFile() file: FactureUpload | undefined,
    @Body() dto: FactureSiteMediaDto,
  ) {
    return this.sites.addMedia(ctx, dto.kind, file, dto.caption ?? null);
  }

  @RequireFacturePermission('facture.site.manage')
  @Get('site/media/:id')
  async media(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const body = await this.sites.draftMedia(ctx, id);
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(body);
  }

  @RequireFacturePermission('facture.site.manage')
  @Delete('site/media/:id')
  removeMedia(@CurrentFacture() ctx: FactureContext, @Param('id', uuid) id: string) {
    return this.sites.removeMedia(ctx, id);
  }

  @RequireFacturePermission('facture.site.manage')
  @HttpCode(200)
  @Post('site/publish')
  publish(@CurrentFacture() ctx: FactureContext) {
    return this.sites.publish(ctx);
  }

  @RequireFacturePermission('facture.site.manage')
  @HttpCode(200)
  @Post('site/unpublish')
  unpublish(@CurrentFacture() ctx: FactureContext) {
    return this.sites.unpublish(ctx);
  }

  @RequireFacturePermission('facture.site.manage')
  @Post('site/domains')
  addDomain(@CurrentFacture() ctx: FactureContext, @Body() dto: FactureSiteDomainDto) {
    return this.domains.add(ctx, dto.hostname);
  }

  @RequireFacturePermission('facture.site.manage')
  @HttpCode(200)
  @Post('site/domains/:id/verify')
  verifyDomain(@CurrentFacture() ctx: FactureContext, @Param('id', uuid) id: string) {
    return this.domains.verify(ctx, id);
  }

  @RequireFacturePermission('facture.site.manage')
  @HttpCode(204)
  @Delete('site/domains/:id')
  removeDomain(@CurrentFacture() ctx: FactureContext, @Param('id', uuid) id: string) {
    return this.domains.remove(ctx, id);
  }

  @RequireFacturePermission('facture.requests.manage')
  @Get('requests')
  requests(@CurrentFacture() ctx: FactureContext, @Query() query: FactureRequestQueryDto) {
    return this.sites.requests(ctx, query);
  }

  @RequireFacturePermission('facture.requests.manage')
  @Patch('requests/:id')
  updateRequest(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateFactureRequestDto,
  ) {
    return this.sites.updateRequest(ctx, id, dto.status);
  }
}

/**
 * API publique des vitrines Facture : lecture seule de la version PUBLIÉE d'un site en ligne et
 * autorisé, images publiées seulement, aucune donnée interne. Facture désactivé : tout est introuvable.
 */
@ApiTags('Vitrines Ocall Facture (public)')
@Public()
@PublicSiteRoute()
@Controller('public')
export class PublicFactureSitesController {
  constructor(
    private readonly sites: FactureSiteService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('facture-sites/resolve')
  async resolve(@Query() q: FactureSiteHostQueryDto) {
    const found = this.config.facture.enabled ? await this.sites.resolveHost(q.host) : null;
    if (!found) throw notFound();
    return found;
  }

  @Get('facture-sites/sitemap')
  sitemap(@Query() q: FactureSiteHostQueryDto) {
    return this.config.facture.enabled ? this.sites.sitemap(q.host) : [];
  }

  /** Page de contrôle HTTPS d'un domaine personnalisé (activation par Ocall). */
  @Get('facture-sites/well-known')
  async wellKnown(@Query() q: FactureSiteHostQueryDto) {
    const siteId = this.config.facture.enabled ? await this.sites.siteIdForHost(q.host) : null;
    if (!siteId) throw notFound();
    return { siteId };
  }

  @Get('facture-sites/:slug')
  async bySlug(@Param('slug') slug: string, @Res({ passthrough: true }) res: Response) {
    const found =
      this.config.facture.enabled && SLUG.test(slug) ? await this.sites.publicBySlug(slug) : null;
    if (!found) throw notFound();
    res.setHeader('Cache-Control', 'no-store');
    return found;
  }

  @Get('facture-media/:key')
  async media(@Param('key') key: string, @Res({ passthrough: true }) res: Response) {
    const body =
      this.config.facture.enabled && MEDIA_KEY.test(key) ? await this.sites.publicMedia(key) : null;
    if (!body)
      throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', message: 'Image introuvable.' });
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    return new StreamableFile(body);
  }
}

/** Formulaires des vitrines Facture : limitation de débit des demandes publiques (5 / 10 min par IP). */
@ApiTags('Vitrines Ocall Facture (public)')
@Public()
@PublicLeadRoute()
@Controller('public')
export class PublicFactureRequestsController {
  constructor(
    private readonly sites: FactureSiteService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @HttpCode(200)
  @Post('facture-sites/:slug/requests')
  submit(@Param('slug') slug: string, @Body() dto: FactureSiteRequestDto) {
    if (!this.config.facture.enabled || !SLUG.test(slug)) throw notFound();
    return this.sites.submitRequest(slug, dto);
  }
}

/** Super Admin : domaines personnalisés des vitrines Facture à activer. */
@ApiTags('Plateforme (Super Admin)')
@SuperAdminOnly()
@RequirePlatformPermission('platform.domains.manage')
@Controller('platform/facture-site-domains')
export class PlatformFactureSiteDomainsController {
  constructor(
    private readonly domains: FactureSiteDomainsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.config.facture.enabled ? this.domains.platformList(status) : [];
  }

  @HttpCode(200)
  @Post(':id/activate')
  activate(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.domains.activate(auth.user.id, id);
  }

  @HttpCode(200)
  @Post(':id/suspend')
  suspend(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: CancelFactureInterventionDto,
  ) {
    return this.domains.suspend(auth.user.id, id, dto.reason);
  }
}
