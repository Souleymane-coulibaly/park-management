import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/stock-database';
import {
  STOCK_PRODUCT_CODE,
  STOCK_SHOWCASE_MAX_GALLERY,
  STOCK_SHOWCASE_PAGE_SIZE,
  type StockShowcaseContent,
  type StockShowcaseMediaKind,
  type StockShowcaseProduct,
  type StockShowcasePublished,
  demoSpamReason,
  isAccessibleBrandColor,
  safeHttpsUrl,
  siteSlugError,
  slugify,
  stockShowcaseCanonicalUrl,
  whatsappDigits,
} from '@ocall/shared';
import { loadAppAccess } from '../../common/app-access';
import { AuditService } from '../../common/audit/audit.service';
import { assertShowcaseAllowed } from '../../common/showcase';
import { STORAGE_PROVIDER, type StorageProvider } from '../../common/storage/storage-provider';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrismaService } from '../../prisma/prisma.service';
import type { StockContext } from './ocall-stock-access';
import { FUZZY_THRESHOLD } from './ocall-stock-catalog.service';
import { type StockUpload, normalizeProductImage } from './ocall-stock-media.service';
import {
  STOCK_DOMAIN_PENDING_DAYS,
  stockDomainHttpsProof,
} from './ocall-stock-showcase-domains.service';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';
import type {
  StockShowcaseCatalogQueryDto,
  StockShowcaseContentDto,
  StockShowcaseProductQueryDto,
  StockShowcaseRequestDto,
  StockShowcaseRequestQueryDto,
} from './ocall-stock-showcase.dto';

type Tx = Prisma.TransactionClient;

const SITE_NOT_FOUND = { code: 'STOCK_SHOWCASE_NOT_FOUND', message: 'Site introuvable.' };
const FEATURED = 8;
const BACK_OFFICE_PAGE = 30;

const DEFAULT_CONTENT = (name: string): StockShowcaseContent => ({
  headline: name,
  tagline: null,
  about: null,
  phone: null,
  whatsapp: null,
  email: null,
  address: null,
  city: null,
  hours: null,
  mapUrl: null,
  seoDescription: null,
  primaryColor: null,
  showCatalog: true,
  showPrices: false,
  forms: ['CONTACT', 'QUOTE'],
});

/** Article lu pour la vitrine : seulement des champs de vente (jamais coût, quantité, fournisseur). */
const PUBLIC_PRODUCT = {
  id: true,
  name: true,
  description: true,
  unit: true,
  salePrice: true,
  isStockable: true,
  category: { select: { id: true, name: true } },
  brand: { select: { name: true } },
  variants: { where: { isArchived: false }, select: { id: true, salePrice: true } },
  // Illustrations IA : seulement celles que le commerçant a autorisées sur la vitrine (S8).
  images: {
    where: { OR: [{ aiGenerated: false }, { showcaseApproved: true }] },
    orderBy: { position: 'asc' },
    select: { id: true, aiGenerated: true },
  },
} satisfies Prisma.StockProductSelect;

type PublicProductRow = Prisma.StockProductGetPayload<{ select: typeof PUBLIC_PRODUCT }>;

/** Demande telle que le back-office la lit (articles typés). */
export interface StockShowcaseRequestView {
  id: string;
  kind: string;
  status: string;
  name: string;
  phone: string | null;
  email: string | null;
  message: string;
  items: { productId: string; name: string; quantity: number }[];
  handledAt: Date | null;
  createdAt: Date;
}

const requestView = (r: {
  id: string;
  kind: string;
  status: string;
  name: string;
  phone: string | null;
  email: string | null;
  message: string;
  items: Prisma.JsonValue;
  handledAt: Date | null;
  createdAt: Date;
}): StockShowcaseRequestView => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  name: r.name,
  phone: r.phone,
  email: r.email,
  message: r.message,
  items: r.items as unknown as StockShowcaseRequestView['items'],
  handledAt: r.handledAt,
  createdAt: r.createdAt,
});

/**
 * Site vitrine d'Ocall Stock (S7) : brouillon, médias, publication (offre Stock « avec vitrine » exigée),
 * catalogue public facultatif (articles cochés un par un, lus en direct : prix de vente TTC si l'entreprise
 * les affiche, badge « Disponible » / « Sur commande » sans chiffre), demandes des visiteurs (anti-spam)
 * qui arrivent dans Stock sans jamais créer de vente ni de commande. Jamais publiés : prix d'achat,
 * marges, quantités, fournisseurs, clients.
 */
type SitemapEntry = { url: string; lastModified: string | null };
const SITEMAP_TTL_MS = 10 * 60_000;
const SITEMAP_MAX_HOSTS = 500;

@Injectable()
export class OcallStockShowcaseService {
  private readonly sitemaps = new Map<string, { at: number; value: Promise<SitemapEntry[]> }>();

  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly core: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ─── Back-office ───

  async get(ctx: StockContext) {
    const site = await this.db.stockShowcase.findUnique({
      where: { organizationId: ctx.organizationId },
    });
    const [media, domains, entitled, published] = await Promise.all([
      this.db.stockShowcaseMedia.findMany({
        where: { organizationId: ctx.organizationId },
        orderBy: [{ kind: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, kind: true, storageKey: true, caption: true, isPublished: true },
      }),
      this.db.stockShowcaseDomain.findMany({
        where: { organizationId: ctx.organizationId },
        orderBy: { createdAt: 'asc' },
      }),
      this.entitled(ctx.organizationId),
      this.db.stockProduct.count({
        where: { organizationId: ctx.organizationId, showcasePublished: true, isArchived: false },
      }),
    ]);
    const base = { media, domains, entitled, publishedProducts: published };
    if (!site) return { site: null, ...base };
    const activeDomain = domains.find((d) => d.status === 'ACTIVE')?.hostname ?? null;
    return {
      site: {
        slug: site.slug,
        draft: site.draft as unknown as StockShowcaseContent,
        isOnline: site.isOnline,
        publishedAt: site.publishedAt,
        url: this.url(site.slug, activeDomain),
      },
      ...base,
    };
  }

  /** Création du site (adresse proposée d'après le nom) ou changement d'adresse avant publication. */
  async setSlug(ctx: StockContext, slug: string) {
    const error = siteSlugError(slug);
    if (error) {
      throw new BadRequestException({
        code: error,
        message: 'Adresse invalide : 3 à 40 caractères, lettres minuscules, chiffres et tirets.',
      });
    }
    const existing = await this.db.stockShowcase.findUnique({
      where: { organizationId: ctx.organizationId },
    });
    if (existing?.isOnline && existing.slug !== slug) {
      throw new ConflictException({
        code: 'STOCK_SHOWCASE_ONLINE',
        message: 'Retirez le site de la publication avant de changer son adresse.',
      });
    }
    try {
      if (existing) {
        await this.db.stockShowcase.update({
          where: { organizationId: ctx.organizationId },
          data: { slug, updatedByUserId: ctx.userId },
        });
      } else {
        await this.db.stockShowcase.create({
          data: {
            organizationId: ctx.organizationId,
            slug,
            draft: DEFAULT_CONTENT(
              await this.businessName(ctx.organizationId),
            ) as unknown as Prisma.InputJsonValue,
            updatedByUserId: ctx.userId,
          },
        });
      }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          code: 'STOCK_SHOWCASE_SLUG_TAKEN',
          message: 'Cette adresse est déjà prise : choisissez-en une autre.',
        });
      }
      throw e;
    }
    await this.record(ctx, 'stock.showcase_slug_set', { slug });
    return this.get(ctx);
  }

  async suggestSlug(ctx: StockContext) {
    return { slug: slugify(await this.businessName(ctx.organizationId)) || 'ma-boutique' };
  }

  async saveDraft(ctx: StockContext, dto: StockShowcaseContentDto) {
    await this.requireSite(ctx.organizationId);
    if (dto.mapUrl && !safeHttpsUrl(dto.mapUrl)) {
      throw new BadRequestException({
        code: 'STOCK_SHOWCASE_MAP_URL',
        message: 'Lien de carte invalide : adresse https complète.',
      });
    }
    if (dto.whatsapp && !whatsappDigits(dto.whatsapp)) {
      throw new BadRequestException({
        code: 'STOCK_SHOWCASE_WHATSAPP',
        message: 'Numéro WhatsApp international invalide (+223 …).',
      });
    }
    if (dto.primaryColor && !isAccessibleBrandColor(dto.primaryColor)) {
      throw new BadRequestException({
        code: 'STOCK_SHOWCASE_COLOR',
        message: 'Couleur trop claire : le texte blanc des boutons doit rester lisible.',
      });
    }
    const content: StockShowcaseContent = {
      ...dto,
      mapUrl: dto.mapUrl ? safeHttpsUrl(dto.mapUrl) : null,
    };
    await this.db.stockShowcase.update({
      where: { organizationId: ctx.organizationId },
      data: { draft: content as unknown as Prisma.InputJsonValue, updatedByUserId: ctx.userId },
    });
    await this.record(ctx, 'stock.showcase_draft_saved');
    return this.get(ctx);
  }

  /** Image réencodée (sans métadonnées) ; logo et couverture remplacés, galerie de 12 images au plus. */
  async addMedia(
    ctx: StockContext,
    kind: StockShowcaseMediaKind,
    file: StockUpload | undefined,
    caption: string | null,
  ) {
    await this.requireSite(ctx.organizationId);
    const jpeg = await normalizeProductImage(file);
    const key = `${randomUUID()}.jpg`;
    await this.storage.put(key, jpeg, 'image/jpeg');
    let replaced: string[] = [];
    try {
      replaced = await this.db.$transaction(async (tx) => {
        // Sérialise les envois d'une organisation : plafond tenu même en envois simultanés.
        await this.lockSite(tx, ctx.organizationId);
        const existing = await tx.stockShowcaseMedia.findMany({
          where: { organizationId: ctx.organizationId, kind },
          select: { id: true, storageKey: true, isPublished: true },
        });
        const drafts = kind === 'GALLERY' ? [] : existing.filter((m) => !m.isPublished);
        const kept = existing.length - drafts.length;
        if (kind === 'GALLERY' && kept >= STOCK_SHOWCASE_MAX_GALLERY) {
          throw new ConflictException({
            code: 'STOCK_SHOWCASE_MEDIA_LIMIT',
            message: `${STOCK_SHOWCASE_MAX_GALLERY} photos au plus dans la galerie.`,
          });
        }
        if (drafts.length > 0) {
          await tx.stockShowcaseMedia.deleteMany({
            where: { id: { in: drafts.map((d) => d.id) } },
          });
        }
        await tx.stockShowcaseMedia.create({
          data: {
            organizationId: ctx.organizationId,
            kind,
            storageKey: key,
            caption,
            position: existing.length,
            createdByUserId: ctx.userId,
          },
        });
        return drafts.map((d) => d.storageKey);
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
    for (const old of replaced) await this.storage.delete(old).catch(() => undefined);
    await this.record(ctx, 'stock.showcase_media_added', { kind });
    return this.get(ctx);
  }

  /** Retrait d'une image : une image en ligne disparaît aussitôt de la version publiée. */
  async removeMedia(ctx: StockContext, id: string) {
    const key = await this.db.$transaction(async (tx) => {
      await this.lockSite(tx, ctx.organizationId);
      const media = await tx.stockShowcaseMedia.findUnique({
        where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      });
      if (!media) {
        throw new NotFoundException({
          code: 'STOCK_SHOWCASE_MEDIA_NOT_FOUND',
          message: 'Image introuvable.',
        });
      }
      if (media.isPublished) {
        const site = await tx.stockShowcase.findUniqueOrThrow({
          where: { organizationId: ctx.organizationId },
        });
        const published = site.published as unknown as StockShowcasePublished | null;
        if (published) {
          const next: StockShowcasePublished = {
            ...published,
            logo: published.logo === media.storageKey ? null : published.logo,
            cover: published.cover === media.storageKey ? null : published.cover,
            gallery: published.gallery.filter((g) => g.key !== media.storageKey),
          };
          await tx.stockShowcase.update({
            where: { organizationId: ctx.organizationId },
            data: { published: next as unknown as Prisma.InputJsonValue },
          });
        }
      }
      await tx.stockShowcaseMedia.delete({ where: { id } });
      return media.storageKey;
    });
    await this.storage.delete(key).catch(() => undefined);
    await this.record(ctx, 'stock.showcase_media_removed');
    return this.get(ctx);
  }

  async draftMedia(ctx: StockContext, id: string): Promise<Buffer> {
    const media = await this.db.stockShowcaseMedia.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
    });
    const body = media ? await this.storage.get(media.storageKey) : null;
    if (!body) {
      throw new NotFoundException({
        code: 'STOCK_SHOWCASE_MEDIA_NOT_FOUND',
        message: 'Image introuvable.',
      });
    }
    return body;
  }

  /** Publication : offre « avec vitrine » exigée ; contenu et images figés. */
  async publish(ctx: StockContext, now = new Date()) {
    await assertShowcaseAllowed(this.core, ctx.organizationId, [STOCK_PRODUCT_CODE], {
      honorGrandfathered: false,
    });
    const businessName = await this.businessName(ctx.organizationId);
    await this.db.$transaction(async (tx) => {
      const site = await this.lockSite(tx, ctx.organizationId);
      const draft = site.draft as unknown as StockShowcaseContent;
      const media = await tx.stockShowcaseMedia.findMany({
        where: { organizationId: ctx.organizationId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      });
      const latest = (kind: StockShowcaseMediaKind) =>
        media.filter((m) => m.kind === kind).at(-1)?.storageKey ?? null;
      const gallery = media.filter((m) => m.kind === 'GALLERY');
      const published: StockShowcasePublished = {
        ...draft,
        businessName,
        logo: latest('LOGO'),
        cover: latest('COVER'),
        gallery: gallery.map((g) => ({ key: g.storageKey, caption: g.caption })),
        publishedAt: now.toISOString(),
      };
      const live = [published.logo, published.cover, ...published.gallery.map((g) => g.key)].filter(
        (k): k is string => Boolean(k),
      );
      await tx.stockShowcaseMedia.updateMany({
        where: { organizationId: ctx.organizationId },
        data: { isPublished: false },
      });
      await tx.stockShowcaseMedia.updateMany({
        where: { organizationId: ctx.organizationId, storageKey: { in: live } },
        data: { isPublished: true },
      });
      await tx.stockShowcase.update({
        where: { organizationId: ctx.organizationId },
        data: {
          published: published as unknown as Prisma.InputJsonValue,
          publishedAt: now,
          isOnline: true,
          updatedByUserId: ctx.userId,
        },
      });
    });
    await this.record(ctx, 'stock.showcase_published');
    return this.get(ctx);
  }

  async unpublish(ctx: StockContext) {
    await this.requireSite(ctx.organizationId);
    await this.db.stockShowcase.update({
      where: { organizationId: ctx.organizationId },
      data: { isOnline: false, updatedByUserId: ctx.userId },
    });
    await this.record(ctx, 'stock.showcase_unpublished');
    return this.get(ctx);
  }

  /** Articles de l'organisation et leur état sur la vitrine (choix article par article). */
  async products(ctx: StockContext, query: StockShowcaseProductQueryDto) {
    const page = query.page ?? 0;
    const where: Prisma.StockProductWhereInput = {
      organizationId: ctx.organizationId,
      isArchived: false,
      ...(query.published ? { showcasePublished: true } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { sku: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.db.stockProduct.count({ where }),
      this.db.stockProduct.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: page * BACK_OFFICE_PAGE,
        take: BACK_OFFICE_PAGE,
        select: {
          id: true,
          sku: true,
          name: true,
          salePrice: true,
          showcasePublished: true,
          category: { select: { name: true } },
          _count: { select: { images: true } },
        },
      }),
    ]);
    return {
      total,
      page,
      pageSize: BACK_OFFICE_PAGE,
      items: items.map(({ _count, ...p }) => ({ ...p, images: _count.images })),
    };
  }

  /** « Publier sur la vitrine » : choix explicite, article par article, tracé. */
  async setProductPublished(ctx: StockContext, productId: string, published: boolean) {
    const { count } = await this.db.stockProduct.updateMany({
      where: { organizationId: ctx.organizationId, id: productId },
      data: { showcasePublished: published },
    });
    if (count === 0) {
      throw new NotFoundException({
        code: 'STOCK_PRODUCT_NOT_FOUND',
        message: 'Article introuvable.',
      });
    }
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: published ? 'stock.showcase_product_published' : 'stock.showcase_product_withdrawn',
      targetType: 'StockProduct',
      targetId: productId,
    });
    return { id: productId, showcasePublished: published };
  }

  // ─── Demandes des visiteurs (back-office) ───

  async requests(ctx: StockContext, query: StockShowcaseRequestQueryDto) {
    const rows = await this.db.stockShowcaseRequest.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map(requestView);
  }

  async updateRequest(
    ctx: StockContext,
    id: string,
    status: 'NEW' | 'IN_PROGRESS' | 'DONE' | 'SPAM',
  ) {
    const { count } = await this.db.stockShowcaseRequest.updateMany({
      where: { organizationId: ctx.organizationId, id },
      data: { status, handledByUserId: ctx.userId, handledAt: new Date() },
    });
    if (count === 0) {
      throw new NotFoundException({
        code: 'STOCK_SHOWCASE_REQUEST_NOT_FOUND',
        message: 'Demande introuvable.',
      });
    }
    await this.record(ctx, 'stock.showcase_request_updated', { status });
    return requestView(await this.db.stockShowcaseRequest.findUniqueOrThrow({ where: { id } }));
  }

  // ─── Public ───

  /**
   * Accueil d'un site en ligne et autorisé : version PUBLIÉE (jamais le brouillon), catégories du
   * catalogue public et premiers articles. Null si introuvable, hors ligne ou non autorisé.
   */
  async publicBySlug(slug: string) {
    const found = await this.live(slug);
    if (!found) return null;
    const { site, organizationId } = found;
    const catalog = site.showCatalog
      ? await this.catalogPage(organizationId, site, { page: 0 }, FEATURED)
      : null;
    return {
      slug,
      url: found.url,
      site,
      categories: catalog?.categories ?? [],
      featured: catalog?.items ?? [],
    };
  }

  /** Catalogue public : articles publiés, filtre par catégorie et texte (fautes tolérées), pages. */
  async publicCatalog(slug: string, query: StockShowcaseCatalogQueryDto) {
    const found = await this.live(slug);
    if (!found?.site.showCatalog) return null;
    const page = await this.catalogPage(
      found.organizationId,
      found.site,
      query,
      STOCK_SHOWCASE_PAGE_SIZE,
    );
    return { slug, url: found.url, site: found.site, ...page };
  }

  /** Fiche d'un article publié. */
  async publicProduct(slug: string, productId: string) {
    const found = await this.live(slug);
    if (!found?.site.showCatalog) return null;
    const row = await this.db.stockProduct.findFirst({
      where: {
        organizationId: found.organizationId,
        id: productId,
        showcasePublished: true,
        isArchived: false,
      },
      select: PUBLIC_PRODUCT,
    });
    if (!row) return null;
    const [product] = await this.toPublic(found.organizationId, found.site, [row]);
    return { slug, url: found.url, site: found.site, product: product! };
  }

  /** Domaine personnalisé ACTIF ou sous-domaine des vitrines Stock → adresse du site. */
  async resolveHost(host: string) {
    const h = host.trim().toLowerCase().split(':')[0]!;
    const { baseDomain, subdomainsEnabled } = this.config.stock.sites;
    let slug: string | null = null;
    if (subdomainsEnabled && baseDomain && h.endsWith(`.${baseDomain}`)) {
      const label = h.slice(0, -baseDomain.length - 1);
      slug = !label.includes('.') && !siteSlugError(label) ? label : null;
    } else {
      const domain = await this.db.stockShowcaseDomain.findUnique({
        where: { hostname: h },
        select: { organizationId: true, status: true },
      });
      if (domain?.status === 'ACTIVE') {
        slug =
          (
            await this.db.stockShowcase.findUnique({
              where: { organizationId: domain.organizationId },
              select: { slug: true },
            })
          )?.slug ?? null;
      }
    }
    return slug && (await this.live(slug)) ? { slug } : null;
  }

  /**
   * Plan du site selon l'hôte : accueil, catalogue et fiches des articles publiés. Sur l'application
   * (vitrines servies à `/m/<slug>`), les vitrines en ligne dont l'adresse canonique est sur cet hôte.
   */
  /**
   * Plan du site public, gardé en mémoire 10 minutes par adresse servie (une requête anonyme ne relance
   * pas le calcul de toutes les vitrines) ; les adresses inconnues ne sont pas gardées (pas d'éviction
   * forcée par des noms au hasard).
   */
  async sitemap(host: string): Promise<SitemapEntry[]> {
    const h = host.trim().toLowerCase().split(':')[0]!;
    const hit = this.sitemaps.get(h);
    if (hit && Date.now() - hit.at < SITEMAP_TTL_MS) return hit.value;
    const built = this.buildSitemap(h);
    const value = built.then((b) => b.entries);
    built
      .then((b) => {
        if (!b.cacheable) return;
        if (this.sitemaps.size >= SITEMAP_MAX_HOSTS) {
          this.sitemaps.delete(this.sitemaps.keys().next().value!);
        }
        this.sitemaps.set(h, { at: Date.now(), value });
      })
      .catch(() => undefined);
    return value;
  }

  private async buildSitemap(
    host: string,
  ): Promise<{ entries: SitemapEntry[]; cacheable: boolean }> {
    const resolved = await this.resolveHost(host);
    const entries = async (slug: string) => {
      const found = await this.live(slug);
      if (!found) return [];
      const at = found.site.publishedAt;
      const list = [{ url: found.url, lastModified: at }];
      if (found.site.showCatalog) {
        list.push({ url: `${found.url}/catalogue`, lastModified: at });
        const products = await this.db.stockProduct.findMany({
          where: {
            organizationId: found.organizationId,
            showcasePublished: true,
            isArchived: false,
          },
          select: { id: true, updatedAt: true },
          take: 5000,
        });
        for (const p of products) {
          list.push({
            url: `${found.url}/article/${p.id}`,
            lastModified: p.updatedAt.toISOString(),
          });
        }
      }
      return list;
    };
    if (resolved) return { entries: await entries(resolved.slug), cacheable: true };
    if (host !== new URL(this.config.sites.publicOrigin).hostname) {
      return { entries: [], cacheable: false };
    }
    const online = await this.db.stockShowcase.findMany({
      where: { isOnline: true },
      select: { slug: true },
      take: 1000,
    });
    const origin = this.config.sites.publicOrigin.replace(/\/$/, '');
    // Par lots de 10 : jamais 1 000 vitrines interrogées en même temps.
    const all: SitemapEntry[] = [];
    for (let i = 0; i < online.length; i += 10) {
      const batch = await Promise.all(online.slice(i, i + 10).map((s) => entries(s.slug)));
      all.push(...batch.flat().filter((e) => e.url.startsWith(origin)));
    }
    return { entries: all, cacheable: true };
  }

  /**
   * Preuve attendue par la page de contrôle HTTPS d'un domaine (activation par Ocall) : dérivée du jeton du
   * domaine, jamais l'identifiant de l'organisation ; rien pour un domaine suspendu ou une déclaration en
   * attente expirée.
   */
  async siteIdForHost(host: string): Promise<string | null> {
    const domain = await this.db.stockShowcaseDomain.findUnique({
      where: { hostname: host.trim().toLowerCase().split(':')[0]! },
      select: { verificationToken: true, status: true, createdAt: true },
    });
    if (!domain || domain.status === 'SUSPENDED') return null;
    const expired =
      domain.status === 'PENDING' &&
      domain.createdAt.getTime() < Date.now() - STOCK_DOMAIN_PENDING_DAYS * 86_400_000;
    return expired ? null : stockDomainHttpsProof(domain.verificationToken);
  }

  /** Image publiée (logo, couverture, galerie) d'un site en ligne et autorisé. */
  async publicMedia(key: string): Promise<Buffer | null> {
    const media = await this.db.stockShowcaseMedia.findUnique({ where: { storageKey: key } });
    if (!media?.isPublished) return null;
    if (!(await this.onlineOrg(media.organizationId))) return null;
    return this.storage.get(key);
  }

  /** Photo d'un article publié, sur un site en ligne et autorisé qui montre son catalogue. */
  async publicProductImage(imageId: string): Promise<Buffer | null> {
    const image = await this.db.stockProductImage.findUnique({
      where: { id: imageId },
      select: {
        organizationId: true,
        storageKey: true,
        aiGenerated: true,
        showcaseApproved: true,
        product: { select: { showcasePublished: true, isArchived: true } },
      },
    });
    if (!image?.product.showcasePublished || image.product.isArchived) return null;
    // Illustration IA : visible seulement sur décision du commerçant (S8).
    if (image.aiGenerated && !image.showcaseApproved) return null;
    const site = await this.onlineOrg(image.organizationId);
    if (!site?.showCatalog) return null;
    return this.storage.get(image.storageKey);
  }

  /**
   * Demande d'un visiteur : formulaire proposé par le site, anti-spam (champ piège, durée de saisie ; un
   * envoi suspect reçoit la même réponse sans rien enregistrer). Les articles joints doivent être publiés ;
   * leurs libellés sont copiés. La demande ne crée jamais de vente ni de commande.
   */
  async submitRequest(slug: string, dto: StockShowcaseRequestDto, now = Date.now()) {
    const found = await this.live(slug);
    if (!found) throw new NotFoundException(SITE_NOT_FOUND);
    if (!found.site.forms.includes(dto.kind)) {
      throw new BadRequestException({
        code: 'STOCK_SHOWCASE_REQUEST_KIND_CLOSED',
        message: 'Ce formulaire n’est pas proposé par ce site.',
      });
    }
    if (!dto.phone && !dto.email) {
      throw new BadRequestException({
        code: 'STOCK_SHOWCASE_REQUEST_CONTACT',
        message: 'Indiquez un téléphone ou une adresse e-mail pour être recontacté.',
      });
    }
    if (demoSpamReason({ website: dto.website, startedAt: dto.startedAt }, now)) {
      return { received: true };
    }
    const wanted = dto.items ?? [];
    const ids = [...new Set(wanted.map((i) => i.productId))];
    if (ids.length !== wanted.length) {
      throw new BadRequestException({
        code: 'STOCK_SHOWCASE_REQUEST_ITEMS',
        message: 'Un article ne figure qu’une fois dans la demande.',
      });
    }
    const products = ids.length
      ? await this.db.stockProduct.findMany({
          where: {
            organizationId: found.organizationId,
            id: { in: ids },
            showcasePublished: true,
            isArchived: false,
          },
          select: { id: true, name: true },
        })
      : [];
    if (products.length !== ids.length || (ids.length > 0 && !found.site.showCatalog)) {
      throw new BadRequestException({
        code: 'STOCK_SHOWCASE_REQUEST_ITEMS',
        message: 'Article introuvable sur ce site.',
      });
    }
    const names = new Map(products.map((p) => [p.id, p.name]));
    await this.db.stockShowcaseRequest.create({
      data: {
        organizationId: found.organizationId,
        kind: dto.kind,
        name: dto.name,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        message: dto.message,
        items: wanted.map((i) => ({
          productId: i.productId,
          name: names.get(i.productId)!,
          quantity: i.quantity,
        })) as unknown as Prisma.InputJsonValue,
      },
    });
    return { received: true };
  }

  // ─── Outils ───

  /**
   * Droit de mettre le site en ligne : organisation active, Ocall Stock accessible en plein (essai ou
   * abonnement en cours) et offre « avec vitrine » (sans droit historique).
   */
  async entitled(organizationId: string): Promise<boolean> {
    if (!this.config.stock.enabled) return false;
    const org = await this.core.organization.findUnique({
      where: { id: organizationId },
      select: { status: true },
    });
    if (org?.status !== 'ACTIVE') return false;
    if ((await loadAppAccess(this.core, organizationId, STOCK_PRODUCT_CODE)) !== 'full') {
      return false;
    }
    try {
      await assertShowcaseAllowed(this.core, organizationId, [STOCK_PRODUCT_CODE], {
        honorGrandfathered: false,
      });
      return true;
    } catch {
      return false;
    }
  }

  url(slug: string, activeDomain: string | null) {
    return stockShowcaseCanonicalUrl({
      slug,
      activeDomain,
      baseDomain: this.config.stock.sites.baseDomain,
      subdomainsEnabled: this.config.stock.sites.subdomainsEnabled,
      publicOrigin: this.config.sites.publicOrigin,
    });
  }

  /** Site en ligne et autorisé : version publiée et adresse canonique ; null sinon. */
  private async live(slug: string) {
    if (siteSlugError(slug)) return null;
    const site = await this.db.stockShowcase.findUnique({ where: { slug } });
    if (!site?.isOnline || !site.published) return null;
    if (!(await this.entitled(site.organizationId))) return null;
    const active = await this.db.stockShowcaseDomain.findFirst({
      where: { organizationId: site.organizationId, status: 'ACTIVE' },
      select: { hostname: true },
    });
    return {
      organizationId: site.organizationId,
      url: this.url(site.slug, active?.hostname ?? null),
      site: site.published as unknown as StockShowcasePublished,
    };
  }

  /** Version publiée d'un site en ligne et autorisé, par organisation (images publiques). */
  private async onlineOrg(organizationId: string) {
    const site = await this.db.stockShowcase.findUnique({
      where: { organizationId },
      select: { isOnline: true, published: true },
    });
    if (!site?.isOnline || !site.published || !(await this.entitled(organizationId))) return null;
    return site.published as unknown as StockShowcasePublished;
  }

  private async catalogPage(
    organizationId: string,
    site: StockShowcasePublished,
    query: StockShowcaseCatalogQueryDto,
    size: number,
  ) {
    const q = query.q?.trim() || null;
    const ids = q
      ? (
          await this.db.$queryRaw<{ id: string }[]>`
            SELECT id FROM "StockProduct"
            WHERE "organizationId" = ${organizationId}::uuid AND "showcasePublished" AND NOT "isArchived"
              AND ("stock_search_text"(name) LIKE '%' || "stock_search_text"(${q}) || '%'
                   OR word_similarity("stock_search_text"(${q}), "stock_search_text"(name)) >= ${FUZZY_THRESHOLD})
            LIMIT 2000`
        ).map((r) => r.id)
      : null;
    const where: Prisma.StockProductWhereInput = {
      organizationId,
      showcasePublished: true,
      isArchived: false,
      ...(query.category ? { categoryId: query.category } : {}),
      ...(ids ? { id: { in: ids } } : {}),
    };
    const page = query.page ?? 0;
    const [total, rows, categories] = await Promise.all([
      this.db.stockProduct.count({ where }),
      this.db.stockProduct.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: page * size,
        take: size,
        select: PUBLIC_PRODUCT,
      }),
      this.db.stockCategory.findMany({
        where: {
          organizationId,
          isArchived: false,
          products: { some: { showcasePublished: true, isArchived: false } },
        },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    ]);
    return {
      total,
      page,
      pageSize: size,
      categories,
      items: await this.toPublic(organizationId, site, rows),
    };
  }

  /**
   * Article public : prix de vente TTC (le plus bas des variantes actives, « à partir de » s'ils
   * diffèrent) seulement si l'entreprise affiche ses prix ; disponibilité réduite à un badge (somme du
   * disponible des sites actifs > 0), jamais une quantité.
   */
  private async toPublic(
    organizationId: string,
    site: StockShowcasePublished,
    rows: PublicProductRow[],
  ): Promise<StockShowcaseProduct[]> {
    const variantIds = rows.flatMap((r) => r.variants.map((v) => v.id));
    const available = variantIds.length
      ? await this.db.$queryRaw<{ productId: string }[]>`
          SELECT v."productId"
          FROM "StockLevel" l
          JOIN "StockVariant" v ON v.id = l."variantId"
          JOIN "StockSite" s ON s.id = l."siteId"
          WHERE l."organizationId" = ${organizationId}::uuid AND l."variantId" = ANY(${variantIds}::uuid[])
            AND NOT s."isArchived"
          GROUP BY v."productId"
          HAVING sum(l."onHand" - l."reserved") > 0`
      : [];
    const inStock = new Set(available.map((a) => a.productId));
    return rows.map((r) => {
      const prices = (r.variants.length ? r.variants : [{ salePrice: null }]).map(
        (v) => v.salePrice ?? r.salePrice,
      );
      const min = Math.min(...prices);
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        category: r.category,
        brand: r.brand?.name ?? null,
        unit: r.unit,
        priceTtc: site.showPrices ? min : null,
        priceFrom: site.showPrices && new Set(prices).size > 1,
        availability: !r.isStockable || inStock.has(r.id) ? 'AVAILABLE' : 'ON_ORDER',
        images: r.images.map((i) => i.id),
        illustrations: r.images.filter((i) => i.aiGenerated).map((i) => i.id),
      };
    });
  }

  private async businessName(organizationId: string) {
    const [settings, org] = await Promise.all([
      this.db.stockSettings.findUnique({
        where: { organizationId },
        select: { storeName: true },
      }),
      this.core.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    ]);
    return settings?.storeName || org?.name || 'Ma boutique';
  }

  private async lockSite(tx: Tx, organizationId: string) {
    const [site] = await tx.$queryRaw<{ organizationId: string }[]>`
      SELECT "organizationId" FROM "StockShowcase" WHERE "organizationId" = ${organizationId}::uuid FOR UPDATE`;
    if (!site) throw new NotFoundException(SITE_NOT_FOUND);
    return tx.stockShowcase.findUniqueOrThrow({ where: { organizationId } });
  }

  private async requireSite(organizationId: string) {
    const site = await this.db.stockShowcase.findUnique({ where: { organizationId } });
    if (!site) {
      throw new ConflictException({
        code: 'STOCK_SHOWCASE_REQUIRED',
        message: 'Choisissez d’abord l’adresse de votre site.',
      });
    }
    return site;
  }

  private record(ctx: StockContext, action: string, metadata?: Record<string, string>) {
    return this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action,
      targetType: 'StockShowcase',
      targetId: ctx.organizationId,
      ...(metadata ? { metadata } : {}),
    });
  }
}
