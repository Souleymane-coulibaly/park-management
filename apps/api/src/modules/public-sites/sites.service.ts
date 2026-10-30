import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import {
  type BusinessType,
  type PublicSiteResponse,
  type PublishedMedia,
  type PublishedSite,
  SITE_SLUG_ERRORS,
  type SiteContent,
  type SiteStatus,
  type SiteTheme,
  canonicalSiteUrl,
  emptySiteContent,
  isAccessibleBrandColor,
  siteSlugError,
  slugFromHost,
  slugify,
  validateSiteContent,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { establishmentScope } from '../../common/tenant-scope';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';

type Db = Prisma.TransactionClient | PrismaService;

/** Chemin public d'une image publiée (relatif : servi par le frontend sur tous les domaines). */
export const publicMediaUrl = (key: string) => `/api/v1/public/media/${key}`;

/**
 * Disponibilité publique selon l'abonnement : organisation suspendue, abonnement expiré ou
 * résilié → site hors ligne, SANS perte de contenu (il revient à la réactivation).
 */
export function siteAvailability(
  orgStatus: 'ACTIVE' | 'SUSPENDED',
  subscriptionStatus: string | null | undefined,
): boolean {
  return (
    orgStatus === 'ACTIVE' && subscriptionStatus !== 'EXPIRED' && subscriptionStatus !== 'CANCELED'
  );
}

const SITE_SELECT = {
  id: true,
  organizationId: true,
  establishmentId: true,
  slug: true,
  isOnline: true,
  theme: true,
  primaryColor: true,
  draft: true,
  draftUpdatedAt: true,
  publishedAt: true,
  establishment: { select: { id: true, name: true, businessType: true } },
  organization: { select: { status: true, subscription: { select: { status: true } } } },
  domains: {
    select: {
      id: true,
      hostname: true,
      status: true,
      verifiedAt: true,
      activatedAt: true,
      lastCheckedAt: true,
      lastError: true,
      verificationToken: true,
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.PublicSiteSelect;

type SiteRow = Prisma.PublicSiteGetPayload<{ select: typeof SITE_SELECT }>;

@Injectable()
export class SitesService {
  private readonly logger = new Logger(SitesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ─── Lecture et vue de l'éditeur ───

  canonicalUrl(site: { slug: string; domains: { hostname: string; status: string }[] }): string {
    const c = this.config.sites;
    return canonicalSiteUrl({
      slug: site.slug,
      activeDomain: site.domains.find((d) => d.status === 'ACTIVE')?.hostname ?? null,
      sitesBaseDomain: c.baseDomain,
      subdomainsEnabled: c.subdomainsEnabled,
      publicOrigin: c.publicOrigin,
    });
  }

  private view(site: SiteRow) {
    const status: SiteStatus = !site.publishedAt
      ? 'DRAFT'
      : site.isOnline
        ? 'PUBLISHED'
        : 'UNPUBLISHED';
    return {
      id: site.id,
      establishment: site.establishment,
      slug: site.slug,
      status,
      isOnline: site.isOnline,
      theme: site.theme,
      primaryColor: site.primaryColor,
      draft: site.draft as unknown as SiteContent,
      draftUpdatedAt: site.draftUpdatedAt.toISOString(),
      publishedAt: site.publishedAt?.toISOString() ?? null,
      hasUnpublishedChanges: !site.publishedAt || site.draftUpdatedAt > site.publishedAt,
      publicUrl: this.canonicalUrl(site),
      fallbackUrl: `${this.config.sites.publicOrigin}/e/${site.slug}`,
      /** Faux si l'abonnement ou l'organisation empêche l'affichage public (contenu conservé). */
      availableByPlan: siteAvailability(
        site.organization.status,
        site.organization.subscription?.status,
      ),
      domains: site.domains.map((d) => ({
        id: d.id,
        hostname: d.hostname,
        status: d.status,
        verifiedAt: d.verifiedAt?.toISOString() ?? null,
        activatedAt: d.activatedAt?.toISOString() ?? null,
        lastCheckedAt: d.lastCheckedAt?.toISOString() ?? null,
        lastError: d.lastError,
        dns: this.dnsInstructions(d.hostname, d.verificationToken),
      })),
    };
  }

  dnsInstructions(hostname: string, token: string) {
    return {
      txtName: `_ocallpark-verify.${hostname}`,
      txtValue: `ocallpark-site-verification=${token}`,
      cnameName: hostname,
      cnameTarget: this.config.sites.customDomainTarget,
    };
  }

  async findSite(tenant: TenantContext, siteId: string): Promise<SiteRow> {
    const site = await this.prisma.publicSite.findFirst({
      where: {
        id: siteId,
        organizationId: tenant.membership.organizationId,
        establishment: establishmentScope(tenant),
      },
      select: SITE_SELECT,
    });
    if (!site)
      throw new NotFoundException({ code: 'SITE_NOT_FOUND', message: 'Site introuvable.' });
    return site;
  }

  private async findEstablishment(tenant: TenantContext, establishmentId: string) {
    const est = await this.prisma.establishment.findFirst({
      where: { ...establishmentScope(tenant), id: establishmentId },
      select: { id: true, name: true, businessType: true, address: true, city: true, phone: true },
    });
    if (!est) {
      throw new NotFoundException({
        code: 'ESTABLISHMENT_NOT_FOUND',
        message: 'Établissement introuvable.',
      });
    }
    return est;
  }

  /** Établissements de l'organisation et leur site éventuel (choix dans l'éditeur). */
  async overview(tenant: TenantContext) {
    const establishments = await this.prisma.establishment.findMany({
      where: establishmentScope(tenant),
      select: {
        id: true,
        name: true,
        businessType: true,
        publicSite: { select: { id: true, slug: true, isOnline: true, publishedAt: true } },
      },
      orderBy: { name: 'asc' },
    });
    return establishments.map((e) => ({
      id: e.id,
      name: e.name,
      businessType: e.businessType,
      suggestedSlug: slugify(e.name),
      site: e.publicSite
        ? {
            id: e.publicSite.id,
            slug: e.publicSite.slug,
            isOnline: e.publicSite.isOnline,
            publishedAt: e.publicSite.publishedAt?.toISOString() ?? null,
          }
        : null,
    }));
  }

  async get(tenant: TenantContext, siteId: string) {
    return this.view(await this.findSite(tenant, siteId));
  }

  private assertSlug(slug: string) {
    const error = siteSlugError(slug);
    if (error) throw new BadRequestException({ code: error, message: SITE_SLUG_ERRORS[error] });
  }

  private slugTaken(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ConflictException({
        code: 'SLUG_TAKEN',
        message: 'Cette adresse est déjà utilisée.',
      });
    }
    throw e;
  }

  /** Création d'un site en BROUILLON, prérempli avec les coordonnées de l'établissement. */
  async create(tenant: TenantContext, establishmentId: string, slug: string) {
    this.assertSlug(slug);
    const est = await this.findEstablishment(tenant, establishmentId);
    const draft = emptySiteContent(est.name, est.businessType as BusinessType);
    draft.address = est.address ?? '';
    draft.city = est.city ?? '';
    draft.phone = est.phone ?? '';
    const id = await this.prisma
      .$transaction(async (tx) => {
        const site = await tx.publicSite.create({
          data: {
            organizationId: tenant.membership.organizationId,
            establishmentId: est.id,
            slug,
            draft: draft as unknown as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        await this.audit.record(
          {
            organizationId: tenant.membership.organizationId,
            actorUserId: tenant.user.id,
            action: 'site.created',
            targetType: 'PublicSite',
            targetId: site.id,
            metadata: { slug, establishmentId: est.id },
          },
          tx,
        );
        return site.id;
      })
      .catch((e) => this.slugTaken(e));
    return this.get(tenant, id);
  }

  /** Enregistre le brouillon : jamais visible publiquement avant publication. */
  async updateDraft(tenant: TenantContext, siteId: string, input: unknown) {
    const site = await this.findSite(tenant, siteId);
    const result = validateSiteContent(input, site.establishment.businessType as BusinessType);
    if ('errors' in result) {
      throw new BadRequestException({
        code: 'SITE_CONTENT_INVALID',
        message: 'Contenu du site invalide.',
        details: result.errors,
      });
    }
    const content = result.content;
    // Médias : uniquement ceux de ce site, du bon type.
    const ids = [content.media.logoId, content.media.coverId, ...content.media.galleryIds].filter(
      Boolean,
    ) as string[];
    if (ids.length) {
      const media = await this.prisma.publicSiteMedia.findMany({
        where: { siteId, id: { in: ids } },
        select: { id: true, kind: true },
      });
      const kindOf = new Map(media.map((m) => [m.id, m.kind]));
      const wrong =
        (content.media.logoId && kindOf.get(content.media.logoId) !== 'LOGO') ||
        (content.media.coverId && kindOf.get(content.media.coverId) !== 'COVER') ||
        content.media.galleryIds.some((g) => kindOf.get(g) !== 'GALLERY');
      if (wrong)
        throw new BadRequestException({
          code: 'SITE_MEDIA_INVALID',
          message: 'Média inconnu ou de mauvais type.',
        });
    }
    await this.prisma.publicSite.update({
      where: { id: siteId },
      data: { draft: content as unknown as Prisma.InputJsonValue, draftUpdatedAt: new Date() },
    });
    return this.get(tenant, siteId);
  }

  /** Adresse, thème, couleur. Le thème et la couleur s'appliquent publiquement à la publication. */
  async updateSettings(
    tenant: TenantContext,
    siteId: string,
    dto: { slug?: string; theme?: SiteTheme; primaryColor?: string },
  ) {
    const site = await this.findSite(tenant, siteId);
    if (dto.slug !== undefined) this.assertSlug(dto.slug);
    if (dto.primaryColor !== undefined && !isAccessibleBrandColor(dto.primaryColor)) {
      throw new BadRequestException({
        code: 'COLOR_NOT_ACCESSIBLE',
        message:
          'Couleur trop claire : le texte blanc des boutons serait illisible (contraste 4,5:1 minimum).',
      });
    }
    await this.prisma
      .$transaction(async (tx) => {
        await tx.publicSite.update({
          where: { id: siteId },
          data: {
            ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
            ...(dto.theme !== undefined ? { theme: dto.theme } : {}),
            ...(dto.primaryColor !== undefined
              ? { primaryColor: dto.primaryColor.toUpperCase() }
              : {}),
            draftUpdatedAt: new Date(),
          },
        });
        await this.audit.record(
          {
            organizationId: tenant.membership.organizationId,
            actorUserId: tenant.user.id,
            action: 'site.settings_updated',
            targetType: 'PublicSite',
            targetId: siteId,
            metadata: {
              from: { slug: site.slug, theme: site.theme, primaryColor: site.primaryColor },
              to: dto,
            },
          },
          tx,
        );
      })
      .catch((e) => this.slugTaken(e));
    if (dto.slug !== undefined && dto.slug !== site.slug)
      void this.revalidate([site.slug, dto.slug]);
    return this.get(tenant, siteId);
  }

  // ─── Publication ───

  /**
   * Construit la version publique à partir d'un brouillon : textes, médias du site, produits et
   * tarifs EXPLICITEMENT sélectionnés, noms et prix figés. Aucun coût, stock, vente ni identifiant
   * interne n'y figure. Les éléments devenus indisponibles sont écartés et signalés.
   */
  async buildPublished(
    db: Db,
    site: SiteRow,
    mediaUrl: (m: { id: string; storageKey: string }) => string,
  ): Promise<{ published: PublishedSite; warnings: string[]; mediaIds: string[] }> {
    const draft = site.draft as unknown as SiteContent;
    const warnings: string[] = [];
    const establishmentId = site.establishmentId;

    const ids = [draft.media.logoId, draft.media.coverId, ...draft.media.galleryIds].filter(
      Boolean,
    ) as string[];
    const media = ids.length
      ? await db.publicSiteMedia.findMany({
          where: { siteId: site.id, id: { in: ids } },
          select: { id: true, storageKey: true, alt: true, width: true, height: true },
        })
      : [];
    const toPublished = (id: string | null): PublishedMedia | null => {
      const m = id ? media.find((x) => x.id === id) : undefined;
      return m ? { url: mediaUrl(m), alt: m.alt, width: m.width, height: m.height } : null;
    };

    const products = draft.menu.length
      ? await db.product.findMany({
          where: {
            organizationId: site.organizationId,
            id: { in: draft.menu.map((m) => m.productId) },
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            description: true,
            category: { select: { name: true, sortOrder: true } },
            variants: {
              where: { isActive: true },
              select: {
                prices: { where: { establishmentId, isAvailable: true }, select: { price: true } },
              },
            },
          },
        })
      : [];
    const groups = new Map<
      string,
      { sortOrder: number; items: PublishedSite['menu'][number]['items'] }
    >();
    for (const item of draft.menu) {
      const p = products.find((x) => x.id === item.productId);
      const prices = p?.variants.flatMap((v) => v.prices.map((x) => x.price)) ?? [];
      if (!p || prices.length === 0) {
        warnings.push(
          'Un produit sélectionné n’est plus proposé dans cet établissement : il n’est pas publié.',
        );
        continue;
      }
      const g = groups.get(p.category.name) ?? { sortOrder: p.category.sortOrder, items: [] };
      g.items.push({
        name: p.name,
        description: p.description,
        price: item.displayPrice ?? Math.min(...prices),
      });
      groups.set(p.category.name, g);
    }

    const categories = draft.tickets.length
      ? await db.ticketCategory.findMany({
          where: {
            organizationId: site.organizationId,
            establishmentId,
            id: { in: draft.tickets.map((t) => t.ticketCategoryId) },
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            description: true,
            conditions: true,
            price: true,
            peopleIncluded: true,
          },
        })
      : [];
    const tickets: PublishedSite['tickets'] = [];
    for (const t of draft.tickets) {
      const c = categories.find((x) => x.id === t.ticketCategoryId);
      if (!c) {
        warnings.push('Un tarif sélectionné n’est plus actif : il n’est pas publié.');
        continue;
      }
      tickets.push({
        name: c.name,
        description: c.description,
        conditions: c.conditions,
        price: t.displayPrice ?? c.price,
        peopleIncluded: c.peopleIncluded,
      });
    }

    const { menu: _m, tickets: _t, media: _media, ...content } = draft;
    void _m;
    void _t;
    void _media;
    return {
      published: {
        slug: site.slug,
        businessType: site.establishment.businessType as BusinessType,
        theme: site.theme,
        primaryColor: site.primaryColor,
        publishedAt: new Date().toISOString(),
        content,
        logo: toPublished(draft.media.logoId),
        cover: toPublished(draft.media.coverId),
        gallery: draft.media.galleryIds
          .map(toPublished)
          .filter((m): m is PublishedMedia => m !== null),
        menu: [...groups.entries()]
          .sort((a, b) => a[1].sortOrder - b[1].sortOrder || a[0].localeCompare(b[0]))
          .map(([category, g]) => ({ category, items: g.items })),
        tickets,
      },
      warnings,
      mediaIds: media.map((m) => m.id),
    };
  }

  /** Aperçu du brouillon (non indexé, réservé à l'éditeur) : images servies par une route authentifiée. */
  async preview(tenant: TenantContext, siteId: string) {
    const site = await this.findSite(tenant, siteId);
    const { published, warnings } = await this.buildPublished(
      this.prisma,
      site,
      (m) => `/api/v1/sites/${siteId}/media/${m.id}/file`,
    );
    return { site: published, warnings, canonicalUrl: this.canonicalUrl(site) };
  }

  async publish(tenant: TenantContext, siteId: string) {
    const site = await this.findSite(tenant, siteId);
    const warnings = await this.prisma.$transaction(async (tx) => {
      const built = await this.buildPublished(tx, site, (m) => publicMediaUrl(m.storageKey));
      const now = new Date(built.published.publishedAt);
      await tx.publicSite.update({
        where: { id: siteId },
        data: {
          published: built.published as unknown as Prisma.InputJsonValue,
          publishedAt: now,
          isOnline: true,
          draftUpdatedAt: now,
        },
      });
      // Seules les images de la version publiée sont servies publiquement.
      await tx.publicSiteMedia.updateMany({
        where: { siteId, id: { notIn: built.mediaIds } },
        data: { isPublished: false },
      });
      if (built.mediaIds.length) {
        await tx.publicSiteMedia.updateMany({
          where: { siteId, id: { in: built.mediaIds } },
          data: { isPublished: true },
        });
      }
      await this.audit.record(
        {
          organizationId: tenant.membership.organizationId,
          actorUserId: tenant.user.id,
          action: 'site.published',
          targetType: 'PublicSite',
          targetId: siteId,
          metadata: {
            slug: site.slug,
            menuItems: built.published.menu.reduce((s, g) => s + g.items.length, 0),
            tickets: built.published.tickets.length,
            warnings: built.warnings.length,
          },
        },
        tx,
      );
      return built.warnings;
    });
    void this.revalidate([site.slug]);
    return { ...(await this.get(tenant, siteId)), warnings };
  }

  /** Dépublication : le site sort du public immédiatement ; brouillon et version publiée conservés. */
  async unpublish(tenant: TenantContext, siteId: string) {
    const site = await this.findSite(tenant, siteId);
    await this.prisma.$transaction(async (tx) => {
      await tx.publicSite.update({ where: { id: siteId }, data: { isOnline: false } });
      await tx.publicSiteMedia.updateMany({ where: { siteId }, data: { isPublished: false } });
      await this.audit.record(
        {
          organizationId: tenant.membership.organizationId,
          actorUserId: tenant.user.id,
          action: 'site.unpublished',
          targetType: 'PublicSite',
          targetId: siteId,
          metadata: { slug: site.slug },
        },
        tx,
      );
    });
    void this.revalidate([site.slug]);
    return this.get(tenant, siteId);
  }

  /** Produits et tarifs que l'utilisateur peut choisir de publier (avec leur prix actuel). */
  async catalogOptions(tenant: TenantContext, siteId: string) {
    const site = await this.findSite(tenant, siteId);
    const [products, tickets] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          organizationId: site.organizationId,
          isActive: true,
          variants: {
            some: {
              isActive: true,
              prices: { some: { establishmentId: site.establishmentId, isAvailable: true } },
            },
          },
        },
        select: {
          id: true,
          name: true,
          category: { select: { name: true } },
          variants: {
            where: { isActive: true },
            select: {
              prices: { where: { establishmentId: site.establishmentId }, select: { price: true } },
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.ticketCategory.findMany({
        where: {
          organizationId: site.organizationId,
          establishmentId: site.establishmentId,
          isActive: true,
        },
        select: { id: true, name: true, price: true, peopleIncluded: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    ]);
    return {
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category.name,
        price: Math.min(...p.variants.flatMap((v) => v.prices.map((x) => x.price))),
      })),
      tickets,
    };
  }

  // ─── Public ───

  /** Lecture publique : seule la version publiée, jamais le brouillon. null = introuvable. */
  async publicBySlug(slug: string): Promise<(PublicSiteResponse & { siteId: string }) | null> {
    const site = await this.prisma.publicSite.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        isOnline: true,
        published: true,
        organization: { select: { status: true, subscription: { select: { status: true } } } },
        domains: { where: { status: 'ACTIVE' }, select: { hostname: true, status: true } },
      },
    });
    if (!site || !site.isOnline || !site.published) return null;
    const published = site.published as unknown as PublishedSite;
    if (!siteAvailability(site.organization.status, site.organization.subscription?.status)) {
      return { state: 'UNAVAILABLE', publicName: published.content.publicName, siteId: site.id };
    }
    return {
      state: 'PUBLISHED',
      site: published,
      canonicalUrl: this.canonicalUrl(site),
      siteId: site.id,
    };
  }

  /**
   * Hôte → site : sous-domaine Ocall (si activé) ou domaine personnalisé ACTIF uniquement. Un
   * domaine en attente ou non vérifié ne sert jamais de site.
   */
  async resolveHost(host: string): Promise<{ slug: string; siteId: string } | null> {
    const h = host.toLowerCase().split(':')[0]!;
    const c = this.config.sites;
    const sub = c.subdomainsEnabled ? slugFromHost(h, c.baseDomain) : null;
    const site = sub
      ? await this.prisma.publicSite.findUnique({
          where: { slug: sub },
          select: { id: true, slug: true },
        })
      : (
          await this.prisma.publicSiteDomain.findFirst({
            where: { hostname: h, status: 'ACTIVE' },
            select: { site: { select: { id: true, slug: true } } },
          })
        )?.site;
    return site ? { slug: site.slug, siteId: site.id } : null;
  }

  /** Entrées du plan du site pour un hôte : uniquement les sites en ligne dont l'adresse canonique est sur cet hôte. */
  async sitemap(host: string): Promise<{ url: string; lastModified: string }[]> {
    const sites = await this.prisma.publicSite.findMany({
      where: { isOnline: true, publishedAt: { not: null }, organization: { status: 'ACTIVE' } },
      select: {
        slug: true,
        publishedAt: true,
        domains: { where: { status: 'ACTIVE' }, select: { hostname: true, status: true } },
        organization: { select: { status: true, subscription: { select: { status: true } } } },
      },
      take: 50_000,
    });
    const h = host.toLowerCase().split(':')[0]!;
    return sites
      .filter((s) => siteAvailability(s.organization.status, s.organization.subscription?.status))
      .map((s) => ({ url: this.canonicalUrl(s), lastModified: s.publishedAt!.toISOString() }))
      .filter((e) => new URL(e.url).hostname === h);
  }

  /** Demande au frontend de régénérer les pages publiques (facultatif ; sinon expiration du cache). */
  async revalidate(slugs: string[]): Promise<void> {
    const { revalidateUrl, revalidateSecret } = this.config.sites;
    if (!revalidateUrl || !revalidateSecret) return;
    try {
      await fetch(revalidateUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-revalidate-secret': revalidateSecret },
        body: JSON.stringify({ slugs }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch (e) {
      this.logger.warn(`Revalidation des pages publiques impossible : ${(e as Error).message}`);
    }
  }
}
