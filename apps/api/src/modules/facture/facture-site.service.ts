import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/facture-database';
import {
  FACTURE_PRODUCT_CODE,
  FACTURE_SITE_MAX_GALLERY,
  type FactureSiteContent,
  type FactureSiteMediaKind,
  type FactureSitePublished,
  computeFactureTotals,
  demoSpamReason,
  isAccessibleBrandColor,
  factureSiteCanonicalUrl,
  safeHttpsUrl,
  siteSlugError,
  slugify,
  whatsappDigits,
} from '@ocall/shared';
import { loadAppAccess } from '../../common/app-access';
import { AuditService } from '../../common/audit/audit.service';
import { assertShowcaseAllowed } from '../../common/showcase';
import { STORAGE_PROVIDER, type StorageProvider } from '../../common/storage/storage-provider';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrismaService } from '../../prisma/prisma.service';
import type { FactureContext } from './facture-access';
import { normalizePhoto } from './facture-interventions.service';
import { FacturePrismaService } from './facture-prisma.service';
import type {
  FactureRequestQueryDto,
  FactureSiteContentDto,
  FactureSiteRequestDto,
} from './facture-site.dto';
import type { FactureUpload } from './facture.service';

const SITE_NOT_FOUND = { code: 'FACTURE_SITE_NOT_FOUND', message: 'Site introuvable.' };
const MEDIA_LIMITS: Record<FactureSiteMediaKind, number> = {
  LOGO: 1,
  COVER: 1,
  GALLERY: FACTURE_SITE_MAX_GALLERY,
};

const DEFAULT_CONTENT = (name: string): FactureSiteContent => ({
  headline: name,
  tagline: null,
  about: null,
  services: [],
  phone: null,
  whatsapp: null,
  email: null,
  address: null,
  city: null,
  hours: null,
  mapUrl: null,
  seoDescription: null,
  primaryColor: null,
  forms: ['CONTACT', 'QUOTE'],
});

/**
 * Site vitrine d'Ocall Facture (F5) : brouillon, médias, publication (offre Facture « avec vitrine »
 * exigée, sans droit historique), lecture publique de la seule version PUBLIÉE, demandes des visiteurs
 * (anti-spam, limitation de débit) qui arrivent dans la boîte de l'entreprise sans jamais créer de
 * document ni d'intervention. Aucune donnée interne n'est exposée.
 */
@Injectable()
export class FactureSiteService {
  constructor(
    private readonly db: FacturePrismaService,
    private readonly core: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ─── Back-office ───

  async get(ctx: FactureContext) {
    const site = await this.db.factureSite.findUnique({
      where: { organizationId: ctx.organizationId },
    });
    const [media, domains, entitled] = await Promise.all([
      this.db.factureSiteMedia.findMany({
        where: { organizationId: ctx.organizationId },
        orderBy: [{ kind: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, kind: true, storageKey: true, caption: true, isPublished: true },
      }),
      this.db.factureSiteDomain.findMany({
        where: { organizationId: ctx.organizationId },
        orderBy: { createdAt: 'asc' },
      }),
      this.entitled(ctx.organizationId),
    ]);
    if (!site) return { site: null, media, domains, entitled };
    const activeDomain = domains.find((d) => d.status === 'ACTIVE')?.hostname ?? null;
    return {
      site: {
        slug: site.slug,
        draft: site.draft as unknown as FactureSiteContent,
        isOnline: site.isOnline,
        publishedAt: site.publishedAt,
        url: this.url(site.slug, activeDomain),
      },
      media,
      domains,
      entitled,
    };
  }

  /** Création du site (adresse proposée d'après le nom) ou changement d'adresse avant publication. */
  async setSlug(ctx: FactureContext, slug: string) {
    const error = siteSlugError(slug);
    if (error) {
      throw new BadRequestException({
        code: error,
        message: 'Adresse invalide : 3 à 40 caractères, lettres minuscules, chiffres et tirets.',
      });
    }
    const existing = await this.db.factureSite.findUnique({
      where: { organizationId: ctx.organizationId },
    });
    if (existing?.isOnline && existing.slug !== slug) {
      throw new ConflictException({
        code: 'FACTURE_SITE_ONLINE',
        message: 'Retirez le site de la publication avant de changer son adresse.',
      });
    }
    try {
      if (existing) {
        await this.db.factureSite.update({
          where: { organizationId: ctx.organizationId },
          data: { slug, updatedByUserId: ctx.userId },
        });
      } else {
        const settings = await this.db.factureSettings.findUnique({
          where: { organizationId: ctx.organizationId },
          select: { legalName: true, tradeName: true },
        });
        await this.db.factureSite.create({
          data: {
            organizationId: ctx.organizationId,
            slug,
            draft: DEFAULT_CONTENT(
              settings?.tradeName || settings?.legalName || 'Mon entreprise',
            ) as unknown as Prisma.InputJsonValue,
            updatedByUserId: ctx.userId,
          },
        });
      }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          code: 'FACTURE_SITE_SLUG_TAKEN',
          message: 'Cette adresse est déjà prise : choisissez-en une autre.',
        });
      }
      throw e;
    }
    await this.record(ctx, 'facture.site_slug_set', { slug });
    return this.get(ctx);
  }

  /** Adresse proposée à partir du nom de l'entreprise. */
  async suggestSlug(ctx: FactureContext) {
    const settings = await this.db.factureSettings.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { legalName: true, tradeName: true },
    });
    return { slug: slugify(settings?.tradeName || settings?.legalName || '') || 'mon-entreprise' };
  }

  async saveDraft(ctx: FactureContext, dto: FactureSiteContentDto) {
    await this.requireSite(ctx.organizationId);
    if (dto.mapUrl && !safeHttpsUrl(dto.mapUrl)) {
      throw new BadRequestException({
        code: 'FACTURE_SITE_MAP_URL',
        message: 'Lien de carte invalide : adresse https complète.',
      });
    }
    if (dto.whatsapp && !whatsappDigits(dto.whatsapp)) {
      throw new BadRequestException({
        code: 'FACTURE_SITE_WHATSAPP',
        message: 'Numéro WhatsApp international invalide (+223 …).',
      });
    }
    if (dto.primaryColor && !isAccessibleBrandColor(dto.primaryColor)) {
      throw new BadRequestException({
        code: 'FACTURE_SITE_COLOR',
        message: 'Couleur trop claire : le texte blanc des boutons doit rester lisible.',
      });
    }
    const ids = dto.services.map((s) => s.itemId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException({
        code: 'FACTURE_SITE_SERVICES',
        message: 'Une prestation ne figure qu’une fois.',
      });
    }
    if (ids.length > 0) {
      const found = await this.db.factureItem.count({
        where: { organizationId: ctx.organizationId, id: { in: ids }, isArchived: false },
      });
      if (found !== ids.length) {
        throw new NotFoundException({
          code: 'FACTURE_ITEM_NOT_FOUND',
          message: 'Prestation du catalogue introuvable.',
        });
      }
    }
    const content: FactureSiteContent = {
      ...dto,
      mapUrl: dto.mapUrl ? safeHttpsUrl(dto.mapUrl) : null,
      services: dto.services.map((s) => ({ itemId: s.itemId, showPrice: s.showPrice })),
    };
    await this.db.factureSite.update({
      where: { organizationId: ctx.organizationId },
      data: { draft: content as unknown as Prisma.InputJsonValue, updatedByUserId: ctx.userId },
    });
    await this.record(ctx, 'facture.site_draft_saved');
    return this.get(ctx);
  }

  /** Image réencodée (sans métadonnées) ; logo et couverture remplacés, galerie de 12 images au plus. */
  async addMedia(
    ctx: FactureContext,
    kind: FactureSiteMediaKind,
    file: FactureUpload | undefined,
    caption: string | null,
  ) {
    await this.requireSite(ctx.organizationId);
    const jpeg = await normalizePhoto(file);
    const key = `${randomUUID()}.jpg`;
    await this.storage.put(key, jpeg, 'image/jpeg');
    let replaced: string[] = [];
    try {
      replaced = await this.db.$transaction(async (tx) => {
        // Sérialise les envois d'une organisation : plafond tenu même en envois simultanés.
        await tx.$queryRaw`SELECT "organizationId" FROM "FactureSite" WHERE "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`;
        const existing = await tx.factureSiteMedia.findMany({
          where: { organizationId: ctx.organizationId, kind },
          select: { id: true, storageKey: true, isPublished: true },
        });
        // Logo, couverture : l'ancienne image non publiée est remplacée ; la publiée reste servie
        // jusqu'à la prochaine publication.
        const drafts = kind === 'GALLERY' ? [] : existing.filter((m) => !m.isPublished);
        const kept = existing.length - drafts.length;
        if (kind === 'GALLERY' && kept >= MEDIA_LIMITS.GALLERY) {
          throw new ConflictException({
            code: 'FACTURE_SITE_MEDIA_LIMIT',
            message: `${FACTURE_SITE_MAX_GALLERY} photos au plus dans la galerie.`,
          });
        }
        if (drafts.length > 0) {
          await tx.factureSiteMedia.deleteMany({ where: { id: { in: drafts.map((d) => d.id) } } });
        }
        await tx.factureSiteMedia.create({
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
    await this.record(ctx, 'facture.site_media_added', { kind });
    return this.get(ctx);
  }

  /** Retrait d'une image : une image publiée disparaît du site à la prochaine publication. */
  /**
   * Retrait d'une image, publiée ou non : une image en ligne disparaît aussitôt de la version publiée
   * (logo, couverture ou galerie), sous le verrou du site — jamais d'image publiée impossible à retirer.
   */
  async removeMedia(ctx: FactureContext, id: string) {
    const key = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "organizationId" FROM "FactureSite" WHERE "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`;
      const media = await tx.factureSiteMedia.findUnique({
        where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      });
      if (!media) {
        throw new NotFoundException({
          code: 'FACTURE_SITE_MEDIA_NOT_FOUND',
          message: 'Image introuvable.',
        });
      }
      if (media.isPublished) {
        const site = await tx.factureSite.findUniqueOrThrow({
          where: { organizationId: ctx.organizationId },
        });
        const published = site.published as unknown as FactureSitePublished | null;
        if (published) {
          const next: FactureSitePublished = {
            ...published,
            logo: published.logo === media.storageKey ? null : published.logo,
            cover: published.cover === media.storageKey ? null : published.cover,
            gallery: published.gallery.filter((g) => g.key !== media.storageKey),
          };
          await tx.factureSite.update({
            where: { organizationId: ctx.organizationId },
            data: { published: next as unknown as Prisma.InputJsonValue },
          });
        }
      }
      await tx.factureSiteMedia.delete({ where: { id } });
      return media.storageKey;
    });
    await this.storage.delete(key).catch(() => undefined);
    await this.record(ctx, 'facture.site_media_removed');
    return this.get(ctx);
  }

  /** Aperçu d'une image du brouillon (back-office). */
  async draftMedia(ctx: FactureContext, id: string): Promise<Buffer> {
    const media = await this.db.factureSiteMedia.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
    });
    const body = media ? await this.storage.get(media.storageKey) : null;
    if (!body) {
      throw new NotFoundException({
        code: 'FACTURE_SITE_MEDIA_NOT_FOUND',
        message: 'Image introuvable.',
      });
    }
    return body;
  }

  /**
   * Publication : offre Facture « avec vitrine » exigée (droit historique Park exclu), contenu figé avec
   * les prestations résolues depuis le catalogue (libellés et prix TTC du jour, affichés seulement si
   * demandé), images marquées publiées. Une image retirée du brouillon n'est plus servie.
   */
  async publish(ctx: FactureContext, now = new Date()) {
    await assertShowcaseAllowed(this.core, ctx.organizationId, [FACTURE_PRODUCT_CODE], {
      honorGrandfathered: false,
    });
    await this.db.$transaction(async (tx) => {
      const site = await tx.factureSite.findUnique({
        where: { organizationId: ctx.organizationId },
      });
      if (!site) throw new NotFoundException(SITE_NOT_FOUND);
      const draft = site.draft as unknown as FactureSiteContent;
      const [settings, items, media] = await Promise.all([
        tx.factureSettings.findUnique({
          where: { organizationId: ctx.organizationId },
          select: { legalName: true, tradeName: true },
        }),
        tx.factureItem.findMany({
          where: {
            organizationId: ctx.organizationId,
            id: { in: draft.services.map((s) => s.itemId) },
            isArchived: false,
          },
        }),
        tx.factureSiteMedia.findMany({
          where: { organizationId: ctx.organizationId },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        }),
      ]);
      const byId = new Map(items.map((i) => [i.id, i]));
      const latest = (kind: FactureSiteMediaKind) =>
        media.filter((m) => m.kind === kind).at(-1)?.storageKey ?? null;
      const gallery = media.filter((m) => m.kind === 'GALLERY');
      const published: FactureSitePublished = {
        ...draft,
        businessName: settings?.tradeName || settings?.legalName || draft.headline,
        services: draft.services
          .filter((s) => byId.has(s.itemId))
          .map((s) => {
            const item = byId.get(s.itemId)!;
            return {
              itemId: item.id,
              name: item.name,
              description: item.description,
              unit: item.unit,
              priceTtc: s.showPrice
                ? computeFactureTotals([
                    {
                      quantity: 1,
                      unitPrice: item.unitPrice,
                      discountPercent: 0,
                      vatRate: item.vatRate,
                    },
                  ]).totalTtc
                : null,
            };
          }),
        logo: latest('LOGO'),
        cover: latest('COVER'),
        gallery: gallery.map((g) => ({ key: g.storageKey, caption: g.caption })),
        publishedAt: now.toISOString(),
      };
      const live = new Set(
        [published.logo, published.cover, ...published.gallery.map((g) => g.key)].filter(Boolean),
      );
      await tx.factureSiteMedia.updateMany({
        where: { organizationId: ctx.organizationId },
        data: { isPublished: false },
      });
      await tx.factureSiteMedia.updateMany({
        where: { organizationId: ctx.organizationId, storageKey: { in: [...live] as string[] } },
        data: { isPublished: true },
      });
      await tx.factureSite.update({
        where: { organizationId: ctx.organizationId },
        data: {
          published: published as unknown as Prisma.InputJsonValue,
          publishedAt: now,
          isOnline: true,
          updatedByUserId: ctx.userId,
        },
      });
    });
    await this.record(ctx, 'facture.site_published');
    return this.get(ctx);
  }

  async unpublish(ctx: FactureContext) {
    await this.requireSite(ctx.organizationId);
    await this.db.factureSite.update({
      where: { organizationId: ctx.organizationId },
      data: { isOnline: false, updatedByUserId: ctx.userId },
    });
    await this.record(ctx, 'facture.site_unpublished');
    return this.get(ctx);
  }

  // ─── Demandes des visiteurs (back-office) ───

  requests(ctx: FactureContext, query: FactureRequestQueryDto) {
    return this.db.factureRequest.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async updateRequest(
    ctx: FactureContext,
    id: string,
    status: 'NEW' | 'IN_PROGRESS' | 'DONE' | 'SPAM',
  ) {
    const { count } = await this.db.factureRequest.updateMany({
      where: { organizationId: ctx.organizationId, id },
      data: { status, handledByUserId: ctx.userId, handledAt: new Date() },
    });
    if (count === 0) {
      throw new NotFoundException({
        code: 'FACTURE_REQUEST_NOT_FOUND',
        message: 'Demande introuvable.',
      });
    }
    await this.record(ctx, 'facture.request_updated', { status });
    return this.db.factureRequest.findUniqueOrThrow({ where: { id } });
  }

  // ─── Public ───

  /** Version publiée d'un site en ligne et autorisé ; null sinon (jamais le brouillon). */
  async publicBySlug(slug: string) {
    if (siteSlugError(slug)) return null;
    const site = await this.db.factureSite.findUnique({ where: { slug } });
    if (!site?.isOnline || !site.published) return null;
    if (!(await this.entitled(site.organizationId))) return null;
    const active = await this.db.factureSiteDomain.findFirst({
      where: { organizationId: site.organizationId, status: 'ACTIVE' },
      select: { hostname: true },
    });
    return {
      slug: site.slug,
      url: this.url(site.slug, active?.hostname ?? null),
      site: site.published as unknown as FactureSitePublished,
    };
  }

  /** Domaine personnalisé ACTIF → adresse du site ; sous-domaine Facture → adresse. */
  async resolveHost(host: string) {
    const h = host.trim().toLowerCase().split(':')[0]!;
    const { baseDomain, subdomainsEnabled } = this.config.facture.sites;
    let slug: string | null = null;
    if (subdomainsEnabled && baseDomain && h.endsWith(`.${baseDomain}`)) {
      const label = h.slice(0, -baseDomain.length - 1);
      slug = !label.includes('.') && !siteSlugError(label) ? label : null;
    } else {
      const domain = await this.db.factureSiteDomain.findUnique({
        where: { hostname: h },
        select: { organizationId: true, status: true },
      });
      if (domain?.status === 'ACTIVE') {
        slug =
          (
            await this.db.factureSite.findUnique({
              where: { organizationId: domain.organizationId },
              select: { slug: true },
            })
          )?.slug ?? null;
      }
    }
    return slug && (await this.publicBySlug(slug)) ? { slug } : null;
  }

  /**
   * Plan du site selon l'hôte : sur un sous-domaine ou un domaine personnalisé de vitrine Facture, ce
   * seul site ; sur l'application (vitrines servies à `/v/<slug>`), les vitrines en ligne dont
   * l'adresse canonique est sur cet hôte. Brouillons et sites hors ligne n'y figurent jamais.
   */
  async sitemap(host: string) {
    const resolved = await this.resolveHost(host);
    const entry = async (slug: string) => {
      const found = await this.publicBySlug(slug);
      return found ? { url: found.url, lastModified: found.site.publishedAt } : null;
    };
    if (resolved) return [await entry(resolved.slug)].filter(Boolean);
    const h = host.trim().toLowerCase().split(':')[0]!;
    if (h !== new URL(this.config.sites.publicOrigin).hostname) return [];
    const online = await this.db.factureSite.findMany({
      where: { isOnline: true },
      select: { slug: true },
      take: 1000,
    });
    const entries = await Promise.all(online.map((s) => entry(s.slug)));
    return entries.filter((e): e is { url: string; lastModified: string } =>
      Boolean(e && e.url.startsWith(this.config.sites.publicOrigin.replace(/\/$/, ''))),
    );
  }

  /** Identifiant attendu par la page de contrôle HTTPS d'un domaine (activation par Ocall). */
  async siteIdForHost(host: string): Promise<string | null> {
    const domain = await this.db.factureSiteDomain.findUnique({
      where: { hostname: host.trim().toLowerCase().split(':')[0]! },
      select: { organizationId: true, status: true },
    });
    return domain && domain.status !== 'SUSPENDED' ? domain.organizationId : null;
  }

  /** Image publiée d'un site en ligne et autorisé. */
  async publicMedia(key: string): Promise<Buffer | null> {
    const media = await this.db.factureSiteMedia.findUnique({ where: { storageKey: key } });
    if (!media?.isPublished) return null;
    const site = await this.db.factureSite.findUnique({
      where: { organizationId: media.organizationId },
      select: { isOnline: true },
    });
    if (!site?.isOnline || !(await this.entitled(media.organizationId))) return null;
    return this.storage.get(key);
  }

  /**
   * Demande d'un visiteur : formulaire proposé par le site, anti-spam (champ piège, durée de saisie ;
   * un envoi suspect reçoit la même réponse sans rien enregistrer). La demande arrive dans la boîte de
   * l'entreprise ; elle ne crée jamais de devis, de facture ni d'intervention.
   */
  async submitRequest(slug: string, dto: FactureSiteRequestDto, now = Date.now()) {
    const found = await this.publicBySlug(slug);
    if (!found) throw new NotFoundException(SITE_NOT_FOUND);
    if (!found.site.forms.includes(dto.kind)) {
      throw new BadRequestException({
        code: 'FACTURE_REQUEST_KIND_CLOSED',
        message: 'Ce formulaire n’est pas proposé par ce site.',
      });
    }
    if (!dto.phone && !dto.email) {
      throw new BadRequestException({
        code: 'FACTURE_REQUEST_CONTACT',
        message: 'Indiquez un téléphone ou une adresse e-mail pour être recontacté.',
      });
    }
    if (demoSpamReason({ website: dto.website, startedAt: dto.startedAt }, now)) {
      return { received: true };
    }
    const site = await this.db.factureSite.findUniqueOrThrow({
      where: { slug },
      select: { organizationId: true },
    });
    const service = dto.serviceItemId
      ? found.site.services.find((s) => s.itemId === dto.serviceItemId)
      : undefined;
    await this.db.factureRequest.create({
      data: {
        organizationId: site.organizationId,
        kind: dto.kind,
        name: dto.name,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        message: dto.message,
        serviceLabel: service?.name ?? null,
        preferredDate:
          dto.preferredDate && (dto.kind === 'APPOINTMENT' || dto.kind === 'INTERVENTION')
            ? new Date(dto.preferredDate)
            : null,
      },
    });
    return { received: true };
  }

  // ─── Outils ───

  /**
   * Droit de mettre le site en ligne : Ocall Facture accessible en plein (essai ou abonnement en cours)
   * et offre « avec vitrine » (sans droit historique).
   */
  async entitled(organizationId: string): Promise<boolean> {
    // Organisation suspendue par Ocall : vitrine hors ligne (comme les sites Park), contenu conservé.
    const org = await this.core.organization.findUnique({
      where: { id: organizationId },
      select: { status: true },
    });
    if (org?.status !== 'ACTIVE') return false;
    if ((await loadAppAccess(this.core, organizationId, FACTURE_PRODUCT_CODE)) !== 'full')
      return false;
    try {
      await assertShowcaseAllowed(this.core, organizationId, [FACTURE_PRODUCT_CODE], {
        honorGrandfathered: false,
      });
      return true;
    } catch {
      return false;
    }
  }

  url(slug: string, activeDomain: string | null) {
    return factureSiteCanonicalUrl({
      slug,
      activeDomain,
      baseDomain: this.config.facture.sites.baseDomain,
      subdomainsEnabled: this.config.facture.sites.subdomainsEnabled,
      publicOrigin: this.config.sites.publicOrigin,
    });
  }

  private async requireSite(organizationId: string) {
    const site = await this.db.factureSite.findUnique({ where: { organizationId } });
    if (!site) {
      throw new ConflictException({
        code: 'FACTURE_SITE_REQUIRED',
        message: 'Choisissez d’abord l’adresse de votre site.',
      });
    }
    return site;
  }

  private record(ctx: FactureContext, action: string, metadata?: Record<string, string>) {
    return this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action,
      targetType: 'FactureSite',
      targetId: ctx.organizationId,
      ...(metadata ? { metadata } : {}),
    });
  }
}
