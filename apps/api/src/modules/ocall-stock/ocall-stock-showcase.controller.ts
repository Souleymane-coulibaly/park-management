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
  CurrentStock,
  OcallStockAccessGuard,
  RequireStockPermission,
  type StockContext,
} from './ocall-stock-access';
import { STOCK_IMAGE_MAX_BYTES, type StockUpload } from './ocall-stock-media.service';
import { OcallStockShowcaseDomainsService } from './ocall-stock-showcase-domains.service';
import {
  StockShowcaseCatalogQueryDto,
  StockShowcaseContentDto,
  StockShowcaseDomainDto,
  StockShowcaseHostQueryDto,
  StockShowcaseMediaDto,
  StockShowcaseProductDto,
  StockShowcaseProductQueryDto,
  StockShowcaseRequestDto,
  StockShowcaseRequestQueryDto,
  StockShowcaseSlugDto,
  SuspendStockShowcaseDomainDto,
  UpdateStockShowcaseRequestDto,
} from './ocall-stock-showcase.dto';
import { OcallStockShowcaseService } from './ocall-stock-showcase.service';

const uuid = new ParseUUIDPipe();
const imageFile = FileInterceptor('file', {
  limits: { fileSize: STOCK_IMAGE_MAX_BYTES + 1, files: 1 },
});
const MEDIA_KEY = /^[0-9a-f-]{36}\.jpg$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG = /^[a-z0-9-]{1,40}$/;
const notFound = () =>
  new NotFoundException({ code: 'SITE_NOT_FOUND', message: 'Site introuvable.' });
const imageHeaders = {
  'Content-Type': 'image/jpeg',
  'Cache-Control': 'public, max-age=300',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};

/**
 * Ocall Stock — site vitrine (S7), back-office : contenu, médias, articles publiés, publication,
 * domaines, demandes des visiteurs.
 */
@ApiTags('Ocall Stock')
@UseGuards(OcallStockAccessGuard)
@Controller('ocall-stock')
export class OcallStockShowcaseController {
  constructor(
    private readonly sites: OcallStockShowcaseService,
    private readonly domains: OcallStockShowcaseDomainsService,
  ) {}

  @RequireStockPermission('stock.showcase.manage')
  @Get('showcase')
  get(@CurrentStock() ctx: StockContext) {
    return this.sites.get(ctx);
  }

  @RequireStockPermission('stock.showcase.manage')
  @Get('showcase/suggest-slug')
  suggest(@CurrentStock() ctx: StockContext) {
    return this.sites.suggestSlug(ctx);
  }

  @RequireStockPermission('stock.showcase.manage')
  @Put('showcase/slug')
  slug(@CurrentStock() ctx: StockContext, @Body() dto: StockShowcaseSlugDto) {
    return this.sites.setSlug(ctx, dto.slug);
  }

  @RequireStockPermission('stock.showcase.manage')
  @Put('showcase/draft')
  draft(@CurrentStock() ctx: StockContext, @Body() dto: StockShowcaseContentDto) {
    return this.sites.saveDraft(ctx, dto);
  }

  @RequireStockPermission('stock.showcase.manage')
  @Post('showcase/media')
  @UseInterceptors(imageFile)
  addMedia(
    @CurrentStock() ctx: StockContext,
    @UploadedFile() file: StockUpload | undefined,
    @Body() dto: StockShowcaseMediaDto,
  ) {
    return this.sites.addMedia(ctx, dto.kind, file, dto.caption ?? null);
  }

  @RequireStockPermission('stock.showcase.manage')
  @Get('showcase/media/:id')
  async media(
    @CurrentStock() ctx: StockContext,
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

  @RequireStockPermission('stock.showcase.manage')
  @Delete('showcase/media/:id')
  removeMedia(@CurrentStock() ctx: StockContext, @Param('id', uuid) id: string) {
    return this.sites.removeMedia(ctx, id);
  }

  @RequireStockPermission('stock.showcase.manage')
  @Get('showcase/products')
  products(@CurrentStock() ctx: StockContext, @Query() query: StockShowcaseProductQueryDto) {
    return this.sites.products(ctx, query);
  }

  @RequireStockPermission('stock.showcase.manage')
  @Put('showcase/products/:id')
  setProduct(
    @CurrentStock() ctx: StockContext,
    @Param('id', uuid) id: string,
    @Body() dto: StockShowcaseProductDto,
  ) {
    return this.sites.setProductPublished(ctx, id, dto.published);
  }

  @RequireStockPermission('stock.showcase.manage')
  @HttpCode(200)
  @Post('showcase/publish')
  publish(@CurrentStock() ctx: StockContext) {
    return this.sites.publish(ctx);
  }

  @RequireStockPermission('stock.showcase.manage')
  @HttpCode(200)
  @Post('showcase/unpublish')
  unpublish(@CurrentStock() ctx: StockContext) {
    return this.sites.unpublish(ctx);
  }

  @RequireStockPermission('stock.showcase.manage')
  @Post('showcase/domains')
  addDomain(@CurrentStock() ctx: StockContext, @Body() dto: StockShowcaseDomainDto) {
    return this.domains.add(ctx, dto.hostname);
  }

  @RequireStockPermission('stock.showcase.manage')
  @HttpCode(200)
  @Post('showcase/domains/:id/verify')
  verifyDomain(@CurrentStock() ctx: StockContext, @Param('id', uuid) id: string) {
    return this.domains.verify(ctx, id);
  }

  @RequireStockPermission('stock.showcase.manage')
  @HttpCode(204)
  @Delete('showcase/domains/:id')
  removeDomain(@CurrentStock() ctx: StockContext, @Param('id', uuid) id: string) {
    return this.domains.remove(ctx, id);
  }

  @RequireStockPermission('stock.showcase.requests')
  @Get('showcase/requests')
  requests(@CurrentStock() ctx: StockContext, @Query() query: StockShowcaseRequestQueryDto) {
    return this.sites.requests(ctx, query);
  }

  @RequireStockPermission('stock.showcase.requests')
  @Patch('showcase/requests/:id')
  updateRequest(
    @CurrentStock() ctx: StockContext,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateStockShowcaseRequestDto,
  ) {
    return this.sites.updateRequest(ctx, id, dto.status);
  }
}

/**
 * API publique des vitrines Stock : lecture seule de la version PUBLIÉE d'un site en ligne et autorisé,
 * catalogue des seuls articles publiés (aucun coût, quantité, fournisseur ni client), images publiées
 * seulement. Stock désactivé : tout est introuvable.
 */
@ApiTags('Vitrines Ocall Stock (public)')
@Public()
@PublicSiteRoute()
@Controller('public')
export class PublicStockShowcaseController {
  constructor(
    private readonly sites: OcallStockShowcaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('stock-sites/resolve')
  async resolve(@Query() q: StockShowcaseHostQueryDto) {
    const found = this.config.stock.enabled ? await this.sites.resolveHost(q.host) : null;
    if (!found) throw notFound();
    return found;
  }

  @Get('stock-sites/sitemap')
  sitemap(@Query() q: StockShowcaseHostQueryDto) {
    return this.config.stock.enabled ? this.sites.sitemap(q.host) : [];
  }

  /** Page de contrôle HTTPS d'un domaine personnalisé (activation par Ocall). */
  @Get('stock-sites/well-known')
  async wellKnown(@Query() q: StockShowcaseHostQueryDto) {
    const siteId = this.config.stock.enabled ? await this.sites.siteIdForHost(q.host) : null;
    if (!siteId) throw notFound();
    return { siteId };
  }

  @Get('stock-sites/:slug')
  async bySlug(@Param('slug') slug: string, @Res({ passthrough: true }) res: Response) {
    const found =
      this.config.stock.enabled && SLUG.test(slug) ? await this.sites.publicBySlug(slug) : null;
    if (!found) throw notFound();
    res.setHeader('Cache-Control', 'no-store');
    return found;
  }

  @Get('stock-sites/:slug/catalogue')
  async catalog(
    @Param('slug') slug: string,
    @Query() query: StockShowcaseCatalogQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const found =
      this.config.stock.enabled && SLUG.test(slug)
        ? await this.sites.publicCatalog(slug, query)
        : null;
    if (!found) throw notFound();
    res.setHeader('Cache-Control', 'no-store');
    return found;
  }

  @Get('stock-sites/:slug/articles/:id')
  async product(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const found =
      this.config.stock.enabled && SLUG.test(slug) && UUID.test(id)
        ? await this.sites.publicProduct(slug, id)
        : null;
    if (!found) {
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Article introuvable.' });
    }
    res.setHeader('Cache-Control', 'no-store');
    return found;
  }

  @Get('stock-media/:key')
  async media(@Param('key') key: string, @Res({ passthrough: true }) res: Response) {
    const body =
      this.config.stock.enabled && MEDIA_KEY.test(key) ? await this.sites.publicMedia(key) : null;
    if (!body) {
      throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', message: 'Image introuvable.' });
    }
    res.set(imageHeaders);
    return new StreamableFile(body);
  }

  @Get('stock-images/:id')
  async productImage(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const body =
      this.config.stock.enabled && UUID.test(id) ? await this.sites.publicProductImage(id) : null;
    if (!body) {
      throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', message: 'Image introuvable.' });
    }
    res.set(imageHeaders);
    return new StreamableFile(body);
  }
}

/** Formulaires des vitrines Stock : limitation de débit des demandes publiques. */
@ApiTags('Vitrines Ocall Stock (public)')
@Public()
@PublicLeadRoute()
@Controller('public')
export class PublicStockShowcaseRequestsController {
  constructor(
    private readonly sites: OcallStockShowcaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @HttpCode(200)
  @Post('stock-sites/:slug/requests')
  submit(@Param('slug') slug: string, @Body() dto: StockShowcaseRequestDto) {
    if (!this.config.stock.enabled || !SLUG.test(slug)) throw notFound();
    return this.sites.submitRequest(slug, dto);
  }
}

/** Super Admin : domaines personnalisés des vitrines Stock à activer. */
@ApiTags('Plateforme (Super Admin)')
@SuperAdminOnly()
@RequirePlatformPermission('platform.domains.manage')
@Controller('platform/stock-site-domains')
export class PlatformStockShowcaseDomainsController {
  constructor(
    private readonly domains: OcallStockShowcaseDomainsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.config.stock.enabled ? this.domains.platformList(status) : [];
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
    @Body() dto: SuspendStockShowcaseDomainDto,
  ) {
    return this.domains.suspend(auth.user.id, id, dto.reason);
  }
}
