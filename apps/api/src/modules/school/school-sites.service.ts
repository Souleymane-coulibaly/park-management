import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/school-database';
import {
  SCHOOL_PRODUCT_CODE,
  SCHOOL_SITE_LANGUAGES,
  SCHOOL_SITE_LIMITS,
  SCHOOL_SITE_LINK_LABELS,
  SCHOOL_SITE_PAGES,
  SCHOOL_SITE_THEMES,
  type SchoolSiteAvailability,
  type SchoolSiteContent,
  type SchoolSiteLanguage,
  type SchoolSiteLinkKind,
  type SchoolSitePublicResponse,
  type SchoolSitePublished,
  type SchoolSitePublishedMedia,
  type SchoolSitePublishedNews,
  type SchoolSiteText,
  emptySchoolSiteContent,
  isAccessibleBrandColor,
  isHexColor,
  schoolSiteAvailability,
  schoolSiteMediaIds,
  schoolSitePath,
  schoolSiteSlugError,
  slugify,
  validateSchoolSiteContent,
  validateSchoolSiteLink,
  SITE_SLUG_ERRORS,
} from '@ocall/shared';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { SuiteContractsService } from '../suite-contracts/suite-contracts.service';
import type { SchoolContext } from './school-access';
import { SchoolPrismaService } from './school-prisma.service';
import {
  SCHOOL_SITE_HOST_RESOLVERS,
  type SchoolSiteHostResolver,
  schoolSiteCanonicalUrl,
} from './school-site-host';
import { SchoolService } from './school.service';

type Tx = Prisma.TransactionClient;
type Db = SchoolPrismaService | Tx;

const NOT_FOUND = { code: 'SCHOOL_SITE_NOT_FOUND', message: 'Site introuvable.' };
const MAX_NEWS = 200;
const PUBLIC_NEWS = 50;

export const schoolSiteTag = (slug: string) => `school-site:${slug}`;
export const publicMediaUrl = (key: string) => `/api/v1/public/school-media/${key}`;

const SITE_SELECT = {
  id: true,
  organizationId: true,
  schoolId: true,
  slug: true,
  enabled: true,
  isOnline: true,
  languages: true,
  defaultLanguage: true,
  theme: true,
  primaryColor: true,
  draft: true,
  published: true,
  publishedAt: true,
  updatedAt: true,
} as const;
type SiteRow = Prisma.SchoolSiteGetPayload<{ select: typeof SITE_SELECT }>;

interface MediaRow {
  id: string;
  storageKey: string | null;
  thumbKey: string | null;
  alt: string;
  altAr: string;
  width: number;
  height: number;
  withdrawnAt: Date | null;
}

const MEDIA_FIELDS = {
  id: true,
  storageKey: true,
  thumbKey: true,
  alt: true,
  altAr: true,
  width: true,
  height: true,
  withdrawnAt: true,
} as const;

/**
 * Sites vitrines des établissements (Sprint 10). Toutes les lectures et écritures sont bornées à
 * l'organisation et au périmètre d'établissements de l'utilisateur ; le public ne lit que la version
 * publiée d'un site activé, en ligne et couvert par le contrat (ou en période de maintien).
 */
@Injectable()
export class SchoolSitesService {
  private readonly logger = new Logger(SchoolSitesService.name);

  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    private readonly contracts: SuiteContractsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SCHOOL_SITE_HOST_RESOLVERS) private readonly resolvers: SchoolSiteHostResolver[],
  ) {}

  private get sitesConfig() {
    return this.config.school.sites;
  }

  // ─── Accès ───

  /** Site du périmètre de l'utilisateur ; introuvable sinon (aucune fuite d'existence). */
  async findSite(ctx: SchoolContext, siteId: string, db: Db = this.db): Promise<SiteRow> {
    const site = await db.schoolSite.findFirst({
      where: { id: siteId, organizationId: ctx.organizationId },
      select: SITE_SELECT,
    });
    if (!site || (ctx.schoolIds && !ctx.schoolIds.includes(site.schoolId))) {
      throw new NotFoundException(NOT_FOUND);
    }
    return site;
  }

  async availability(organizationId: string): Promise<SchoolSiteAvailability> {
    const window = await this.contracts.contractWindow(organizationId, SCHOOL_PRODUCT_CODE);
    return schoolSiteAvailability(window, this.sitesConfig.graceDays);
  }

  private view(site: SiteRow, availability: SchoolSiteAvailability) {
    return {
      id: site.id,
      schoolId: site.schoolId,
      slug: site.slug,
      enabled: site.enabled,
      isOnline: site.isOnline,
      languages: site.languages,
      defaultLanguage: site.defaultLanguage,
      theme: site.theme,
      primaryColor: site.primaryColor,
      draft: site.draft as unknown as SchoolSiteContent,
      publishedAt: site.publishedAt?.toISOString() ?? null,
      status: site.isOnline ? 'PUBLISHED' : site.publishedAt ? 'UNPUBLISHED' : 'DRAFT',
      publicUrl: schoolSiteCanonicalUrl(this.sitesConfig, site.slug),
      subdomainsEnabled: this.sitesConfig.subdomainsEnabled,
      availability: availability.online
        ? {
            online: true,
            canPublish: availability.canPublish,
            readOnlyUntil: availability.readOnlyUntil?.toISOString() ?? null,
          }
        : { online: false, canPublish: false, reason: availability.reason },
    };
  }

  // ─── Administration ───

  /** Site de l'établissement (null s'il n'a jamais été activé). */
  async forSchool(ctx: SchoolContext, schoolId: string) {
    await this.school.assertSchool(ctx, schoolId);
    const site = await this.db.schoolSite.findFirst({
      where: { organizationId: ctx.organizationId, schoolId },
      select: SITE_SELECT,
    });
    return site ? this.view(site, await this.availability(ctx.organizationId)) : null;
  }

  /** Création du site (adresse choisie) : désactivé, brouillon vide, rien n'est publié. */
  async create(ctx: SchoolContext, schoolId: string, slug: string) {
    await this.school.assertSchool(ctx, schoolId);
    this.assertSlug(slug);
    const site = await this.school.unique(
      () =>
        this.db.schoolSite.create({
          data: {
            organizationId: ctx.organizationId,
            schoolId,
            slug,
            draft: emptySchoolSiteContent() as unknown as Prisma.InputJsonValue,
          },
          select: SITE_SELECT,
        }),
      'SITE_SLUG_TAKEN',
      'Cette adresse est déjà utilisée, ou cet établissement a déjà un site.',
    );
    await this.school.log(ctx, 'school.site_created', 'SchoolSite', site.id, { slug });
    return this.view(site, await this.availability(ctx.organizationId));
  }

  private assertSlug(slug: string) {
    const error = schoolSiteSlugError(slug);
    if (error) throw new BadRequestException({ code: error, message: SITE_SLUG_ERRORS[error] });
  }

  /** Apparence et langues (préparation : aucune incidence sur la version publiée). */
  async updateSettings(
    ctx: SchoolContext,
    siteId: string,
    dto: {
      languages?: string[];
      defaultLanguage?: string;
      theme?: string;
      primaryColor?: string;
    },
  ) {
    const site = await this.findSite(ctx, siteId);
    const languages = dto.languages ?? site.languages;
    const defaultLanguage = dto.defaultLanguage ?? site.defaultLanguage;
    const known = (l: string): l is SchoolSiteLanguage =>
      (SCHOOL_SITE_LANGUAGES as readonly string[]).includes(l);
    if (
      languages.length === 0 ||
      new Set(languages).size !== languages.length ||
      !languages.every(known) ||
      !(languages as string[]).includes(defaultLanguage)
    ) {
      throw new BadRequestException({
        code: 'SITE_LANGUAGES',
        message: 'Langues invalides : au moins une, la langue par défaut parmi elles.',
      });
    }
    if (dto.theme && !(SCHOOL_SITE_THEMES as readonly string[]).includes(dto.theme)) {
      throw new BadRequestException({ code: 'SITE_THEME', message: 'Thème inconnu.' });
    }
    if (
      dto.primaryColor &&
      (!isHexColor(dto.primaryColor) || !isAccessibleBrandColor(dto.primaryColor))
    ) {
      throw new BadRequestException({
        code: 'SITE_COLOR',
        message: 'Couleur trop claire : le texte blanc doit rester lisible (contraste 4,5:1).',
      });
    }
    const updated = await this.db.schoolSite.update({
      where: { id: site.id },
      data: {
        languages,
        defaultLanguage,
        ...(dto.theme ? { theme: dto.theme } : {}),
        ...(dto.primaryColor ? { primaryColor: dto.primaryColor.toUpperCase() } : {}),
      },
      select: SITE_SELECT,
    });
    return this.view(updated, await this.availability(ctx.organizationId));
  }

  /** Activation (adresse réservée, préparation) ou désactivation (le site sort du public). */
  async setEnabled(ctx: SchoolContext, siteId: string, enabled: boolean) {
    const site = await this.findSite(ctx, siteId);
    const updated = await this.db.$transaction(async (tx) => {
      const row = await tx.schoolSite.update({
        where: { id: site.id },
        data: enabled ? { enabled } : { enabled, isOnline: false },
        select: SITE_SELECT,
      });
      if (!enabled) await this.syncPublishedMedia(tx, row);
      return row;
    });
    await this.school.log(
      ctx,
      enabled ? 'school.site_enabled' : 'school.site_disabled',
      'SchoolSite',
      site.id,
      {
        slug: site.slug,
      },
    );
    if (!enabled) void this.revalidate([site.slug]);
    return this.view(updated, await this.availability(ctx.organizationId));
  }

  /** Changement d'adresse : l'ancienne cesse aussitôt de répondre. */
  async changeSlug(ctx: SchoolContext, siteId: string, slug: string) {
    const site = await this.findSite(ctx, siteId);
    this.assertSlug(slug);
    const updated = await this.school.unique(
      () =>
        this.db.schoolSite.update({ where: { id: site.id }, data: { slug }, select: SITE_SELECT }),
      'SITE_SLUG_TAKEN',
      'Cette adresse est déjà utilisée.',
    );
    await this.school.log(ctx, 'school.site_slug_changed', 'SchoolSite', site.id, {
      from: site.slug,
      to: slug,
    });
    void this.revalidate([site.slug, slug]);
    return this.view(updated, await this.availability(ctx.organizationId));
  }

  async saveDraft(ctx: SchoolContext, siteId: string, input: unknown) {
    const site = await this.findSite(ctx, siteId);
    const result = validateSchoolSiteContent(input);
    if ('errors' in result) {
      throw new BadRequestException({
        code: 'SITE_CONTENT_INVALID',
        message: result.errors[0],
        errors: result.errors.slice(0, 20),
      });
    }
    await this.assertMediaOfSite(site, schoolSiteMediaIds(result.content));
    const updated = await this.db.schoolSite.update({
      where: { id: site.id },
      data: { draft: result.content as unknown as Prisma.InputJsonValue },
      select: SITE_SELECT,
    });
    return this.view(updated, await this.availability(ctx.organizationId));
  }

  /** Médias cités : ceux du site, jamais retirés (un identifiant étranger est refusé). */
  private async assertMediaOfSite(site: SiteRow, ids: string[], db: Db = this.db) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const count = await db.schoolSiteMedia.count({
      where: {
        organizationId: site.organizationId,
        siteId: site.id,
        id: { in: unique },
        withdrawnAt: null,
      },
    });
    if (count !== unique.length) {
      throw new BadRequestException({
        code: 'SITE_MEDIA_UNKNOWN',
        message: 'Une image citée est introuvable ou a été retirée.',
      });
    }
  }

  // ─── Version publiée ───

  private async mediaMap(db: Db, site: SiteRow, ids: string[]): Promise<Map<string, MediaRow>> {
    if (ids.length === 0) return new Map();
    const rows = await db.schoolSiteMedia.findMany({
      where: {
        organizationId: site.organizationId,
        siteId: site.id,
        id: { in: [...new Set(ids)] },
      },
      select: MEDIA_FIELDS,
    });
    return new Map(rows.map((m) => [m.id, m]));
  }

  private static published(m: MediaRow | undefined): SchoolSitePublishedMedia | null {
    if (!m || m.withdrawnAt || !m.storageKey || !m.thumbKey) return null;
    return {
      url: publicMediaUrl(m.storageKey),
      thumbUrl: publicMediaUrl(m.thumbKey),
      alt: { fr: m.alt, ar: m.altAr },
      width: m.width,
      height: m.height,
    };
  }

  /**
   * Version publique construite à partir du brouillon : textes et médias cités uniquement, résolus
   * en adresses publiques. Aucun identifiant interne, aucune donnée de l'établissement hors du site.
   */
  async buildPublished(db: Db, site: SiteRow): Promise<SchoolSitePublished> {
    const draft = site.draft as unknown as SchoolSiteContent;
    const school = await db.school.findFirst({
      where: { organizationId: site.organizationId, id: site.schoolId },
      select: { name: true, nameAr: true },
    });
    const media = await this.mediaMap(db, site, schoolSiteMediaIds(draft));
    const pick = (id: string | null) => (id ? SchoolSitesService.published(media.get(id)) : null);
    return {
      slug: site.slug,
      name: { fr: school?.name ?? '', ar: school?.nameAr ?? '' },
      languages: site.languages as SchoolSiteLanguage[],
      defaultLanguage: site.defaultLanguage as SchoolSiteLanguage,
      theme: site.theme as SchoolSitePublished['theme'],
      primaryColor: site.primaryColor,
      publishedAt: new Date().toISOString(),
      content: {
        home: draft.home,
        about: draft.about,
        teaching: draft.teaching,
        practical: draft.practical,
        contact: draft.contact,
      },
      logo: pick(draft.media.logoId),
      cover: pick(draft.media.coverId),
      gallery: draft.media.gallery.flatMap((g) => {
        const m = pick(g.mediaId);
        return m ? [{ ...m, caption: g.caption }] : [];
      }),
    };
  }

  /**
   * Médias servis au public : exactement ceux de la version publiée et des actualités publiées d'un
   * site en ligne ; tous les autres cessent aussitôt d'être servis.
   */
  async syncPublishedMedia(
    tx: Db,
    site: Pick<SiteRow, 'id' | 'organizationId' | 'isOnline' | 'published'>,
  ) {
    const where = { organizationId: site.organizationId, siteId: site.id };
    if (!site.isOnline || !site.published) {
      await tx.schoolSiteMedia.updateMany({ where, data: { isPublished: false } });
      return;
    }
    const published = site.published as unknown as SchoolSitePublished;
    const keys = [published.logo, published.cover, ...published.gallery]
      .filter((m): m is SchoolSitePublishedMedia => m !== null)
      .map((m) => m.url.split('/').pop()!);
    const news = await tx.schoolSiteNews.findMany({
      where: { ...where, status: 'PUBLISHED', mediaId: { not: null } },
      select: { mediaId: true },
    });
    const ids = news.map((n) => n.mediaId!);
    await tx.schoolSiteMedia.updateMany({ where, data: { isPublished: false } });
    await tx.schoolSiteMedia.updateMany({
      where: {
        ...where,
        withdrawnAt: null,
        OR: [{ storageKey: { in: keys } }, { id: { in: ids } }],
      },
      data: { isPublished: true },
    });
  }

  /** Publication : nouvelle version figée ; refusée sans contrat valide ou site désactivé. */
  async publish(ctx: SchoolContext, siteId: string) {
    const site = await this.findSite(ctx, siteId);
    if (!site.enabled) {
      throw new ConflictException({
        code: 'SITE_DISABLED',
        message: 'Activez le site avant de le publier.',
      });
    }
    const availability = await this.availability(ctx.organizationId);
    if (!availability.canPublish) {
      throw new ConflictException({
        code: 'SITE_CONTRACT_REQUIRED',
        message: 'Aucune publication sans contrat Ocall School valide.',
      });
    }
    const updated = await this.db.$transaction(async (tx) => {
      const fresh = await this.findSite(ctx, siteId, tx);
      const published = await this.buildPublished(tx, fresh);
      const row = await tx.schoolSite.update({
        where: { id: site.id },
        data: {
          isOnline: true,
          published: published as unknown as Prisma.InputJsonValue,
          publishedAt: new Date(published.publishedAt),
          publishedByUserId: ctx.userId,
        },
        select: SITE_SELECT,
      });
      await this.syncPublishedMedia(tx, row);
      return row;
    });
    await this.school.log(ctx, 'school.site_published', 'SchoolSite', site.id, { slug: site.slug });
    void this.revalidate([site.slug]);
    return this.view(updated, availability);
  }

  /** Dépublication : le site sort du public immédiatement ; brouillon et dernière version conservés. */
  async unpublish(ctx: SchoolContext, siteId: string) {
    const site = await this.findSite(ctx, siteId);
    const updated = await this.db.$transaction(async (tx) => {
      const row = await tx.schoolSite.update({
        where: { id: site.id },
        data: { isOnline: false },
        select: SITE_SELECT,
      });
      await this.syncPublishedMedia(tx, row);
      return row;
    });
    await this.school.log(ctx, 'school.site_unpublished', 'SchoolSite', site.id, {
      slug: site.slug,
    });
    void this.revalidate([site.slug]);
    return this.view(updated, await this.availability(ctx.organizationId));
  }

  /** Prévisualisation du brouillon (images servies par l'API authentifiée), jamais mise en cache. */
  async preview(ctx: SchoolContext, siteId: string) {
    const site = await this.findSite(ctx, siteId);
    const published = await this.buildPublished(this.db, site);
    const adminUrl = (url: string) => {
      const key = url.split('/').pop()!;
      return `/api/v1/school/sites/${site.id}/media-file/${key}`;
    };
    const rewrite = <T extends SchoolSitePublishedMedia | null>(m: T): T =>
      (m ? { ...m, url: adminUrl(m.url), thumbUrl: adminUrl(m.thumbUrl) } : m) as T;
    const links = await this.publicLinks(site.id, site.organizationId);
    const news = await this.newsFor(site, false);
    return {
      site: {
        ...published,
        logo: rewrite(published.logo),
        cover: rewrite(published.cover),
        gallery: published.gallery.map((g) => rewrite(g)),
      },
      links: links.links,
      whatsapp: links.whatsapp,
      news: news.map((n) => ({ ...n, image: rewrite(n.image) })),
    };
  }

  /** Export complet du site (résiliation, archive) : textes, réglages, actualités, liens, médias. */
  async exportSite(ctx: SchoolContext, siteId: string) {
    const site = await this.findSite(ctx, siteId);
    const [news, links, media] = await Promise.all([
      this.db.schoolSiteNews.findMany({
        where: { organizationId: site.organizationId, siteId: site.id },
        orderBy: { publishedOn: 'desc' },
        select: {
          slug: true,
          title: true,
          titleAr: true,
          body: true,
          bodyAr: true,
          publishedOn: true,
          status: true,
          mediaId: true,
        },
      }),
      this.db.schoolSiteLink.findMany({
        where: { organizationId: site.organizationId, siteId: site.id },
        orderBy: { position: 'asc' },
        select: { kind: true, label: true, url: true, enabled: true, position: true },
      }),
      this.db.schoolSiteMedia.findMany({
        where: { organizationId: site.organizationId, siteId: site.id, withdrawnAt: null },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          kind: true,
          alt: true,
          altAr: true,
          width: true,
          height: true,
          storageKey: true,
        },
      }),
    ]);
    await this.school.log(ctx, 'school.site_exported', 'SchoolSite', site.id, { slug: site.slug });
    const body = {
      format: 'ocall-school-site/1',
      exportedAt: new Date().toISOString(),
      site: {
        slug: site.slug,
        languages: site.languages,
        defaultLanguage: site.defaultLanguage,
        theme: site.theme,
        primaryColor: site.primaryColor,
        isOnline: site.isOnline,
        publishedAt: site.publishedAt?.toISOString() ?? null,
      },
      draft: site.draft,
      published: site.published,
      news: news.map((n) => ({ ...n, publishedOn: n.publishedOn.toISOString().slice(0, 10) })),
      links,
      media: media.map(({ storageKey, ...m }) => ({
        ...m,
        // Téléchargement par l'API authentifiée (aucune adresse publique pour un média non publié).
        download: storageKey ? `/api/v1/school/sites/${site.id}/media-file/${storageKey}` : null,
      })),
    };
    return {
      body: Buffer.from(JSON.stringify(body, null, 2), 'utf8'),
      mimeType: 'application/json; charset=utf-8',
      fileName: `site-${site.slug}.json`,
    };
  }

  // ─── Liens externes et réseaux sociaux ───

  async listLinks(ctx: SchoolContext, siteId: string) {
    const site = await this.findSite(ctx, siteId);
    return this.db.schoolSiteLink.findMany({
      where: { organizationId: site.organizationId, siteId: site.id },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, kind: true, label: true, url: true, enabled: true, position: true },
    });
  }

  private checkedLink(kind: SchoolSiteLinkKind, url: string, label: string) {
    const r = validateSchoolSiteLink(kind, url);
    if ('error' in r)
      throw new BadRequestException({ code: 'SITE_LINK_INVALID', message: r.error });
    const l = label.trim();
    if (kind === 'OTHER' && !l) {
      throw new BadRequestException({
        code: 'SITE_LINK_LABEL',
        message: 'Un libellé est obligatoire pour un autre lien.',
      });
    }
    return { url: r.url, label: l.slice(0, SCHOOL_SITE_LIMITS.linkLabel) };
  }

  async createLink(
    ctx: SchoolContext,
    siteId: string,
    dto: { kind: SchoolSiteLinkKind; url: string; label?: string; enabled?: boolean },
  ) {
    const site = await this.findSite(ctx, siteId);
    const checked = this.checkedLink(dto.kind, dto.url, dto.label ?? '');
    const link = await this.db.$transaction(async (tx) => {
      // Verrou du site : le plafond et la position restent exacts sous requêtes simultanées.
      await tx.$executeRaw`SELECT 1 FROM "SchoolSite" WHERE "id" = ${site.id}::uuid FOR UPDATE`;
      const count = await tx.schoolSiteLink.count({ where: { siteId: site.id } });
      if (count >= SCHOOL_SITE_LIMITS.links) {
        throw new ConflictException({
          code: 'SITE_LINKS_LIMIT',
          message: `${SCHOOL_SITE_LIMITS.links} liens au plus.`,
        });
      }
      const last = await tx.schoolSiteLink.aggregate({
        where: { siteId: site.id },
        _max: { position: true },
      });
      return tx.schoolSiteLink.create({
        data: {
          organizationId: site.organizationId,
          siteId: site.id,
          kind: dto.kind,
          url: checked.url,
          label: checked.label,
          enabled: dto.enabled ?? true,
          position: (last._max.position ?? -1) + 1,
        },
        select: { id: true, kind: true, label: true, url: true, enabled: true, position: true },
      });
    });
    await this.school.log(ctx, 'school.site_link_created', 'SchoolSiteLink', link.id, {
      kind: dto.kind,
    });
    if (site.isOnline) void this.revalidate([site.slug]);
    return link;
  }

  private async findLink(site: SiteRow, linkId: string) {
    const link = await this.db.schoolSiteLink.findFirst({
      where: { id: linkId, organizationId: site.organizationId, siteId: site.id },
      select: { id: true, kind: true, label: true, url: true },
    });
    if (!link) throw new NotFoundException(NOT_FOUND);
    return link;
  }

  async updateLink(
    ctx: SchoolContext,
    siteId: string,
    linkId: string,
    dto: { url?: string; label?: string; enabled?: boolean },
  ) {
    const site = await this.findSite(ctx, siteId);
    const link = await this.findLink(site, linkId);
    const checked =
      dto.url !== undefined || dto.label !== undefined
        ? this.checkedLink(
            link.kind as SchoolSiteLinkKind,
            dto.url ?? link.url,
            dto.label ?? link.label,
          )
        : null;
    const updated = await this.db.schoolSiteLink.update({
      where: { id: link.id },
      data: { ...(checked ?? {}), ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}) },
      select: { id: true, kind: true, label: true, url: true, enabled: true, position: true },
    });
    await this.school.log(ctx, 'school.site_link_updated', 'SchoolSiteLink', link.id, {
      kind: link.kind,
    });
    if (site.isOnline) void this.revalidate([site.slug]);
    return updated;
  }

  async removeLink(ctx: SchoolContext, siteId: string, linkId: string) {
    const site = await this.findSite(ctx, siteId);
    const link = await this.findLink(site, linkId);
    await this.db.schoolSiteLink.delete({ where: { id: link.id } });
    await this.school.log(ctx, 'school.site_link_deleted', 'SchoolSiteLink', link.id, {
      kind: link.kind,
    });
    if (site.isOnline) void this.revalidate([site.slug]);
    return { deleted: true };
  }

  /** Ordre d'affichage : la liste complète des liens du site, dans l'ordre voulu. */
  async reorderLinks(ctx: SchoolContext, siteId: string, ids: string[]) {
    const site = await this.findSite(ctx, siteId);
    const links = await this.db.schoolSiteLink.findMany({
      where: { organizationId: site.organizationId, siteId: site.id },
      select: { id: true },
    });
    const known = new Set(links.map((l) => l.id));
    if (
      ids.length !== known.size ||
      new Set(ids).size !== ids.length ||
      !ids.every((id) => known.has(id))
    ) {
      throw new BadRequestException({
        code: 'SITE_LINKS_ORDER',
        message: 'Ordre invalide : indiquez chaque lien du site une seule fois.',
      });
    }
    await this.db.$transaction(
      ids.map((id, position) =>
        this.db.schoolSiteLink.update({ where: { id }, data: { position } }),
      ),
    );
    if (site.isOnline) void this.revalidate([site.slug]);
    return this.listLinks(ctx, siteId);
  }

  /** Liens actifs, dans l'ordre ; le premier lien WhatsApp actif donne le numéro du bouton. */
  private async publicLinks(siteId: string, organizationId: string) {
    const rows = await this.db.schoolSiteLink.findMany({
      where: { organizationId, siteId, enabled: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { kind: true, label: true, url: true },
    });
    // Revalidation à la lecture : un lien enregistré sous d'anciennes règles n'est jamais servi.
    const links = rows.flatMap((r) => {
      const kind = r.kind as SchoolSiteLinkKind;
      const v = validateSchoolSiteLink(kind, r.url);
      return 'url' in v
        ? [{ kind, label: r.label || SCHOOL_SITE_LINK_LABELS[kind], url: v.url }]
        : [];
    });
    const wa = links.find((l) => l.kind === 'WHATSAPP');
    return { links, whatsapp: wa ? wa.url.replace('https://wa.me/', '') : null };
  }

  // ─── Actualités ───

  async listNews(ctx: SchoolContext, siteId: string) {
    const site = await this.findSite(ctx, siteId);
    return this.db.schoolSiteNews.findMany({
      where: { organizationId: site.organizationId, siteId: site.id },
      orderBy: [{ publishedOn: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        slug: true,
        title: true,
        titleAr: true,
        body: true,
        bodyAr: true,
        publishedOn: true,
        mediaId: true,
        status: true,
        publishedAt: true,
      },
    });
  }

  private checkedNews(dto: { title: string; titleAr?: string; body: string; bodyAr?: string }) {
    const L = SCHOOL_SITE_LIMITS;
    const title = dto.title.trim();
    const titleAr = (dto.titleAr ?? '').trim();
    const body = dto.body.trim();
    const bodyAr = (dto.bodyAr ?? '').trim();
    if ((!title && !titleAr) || (!body && !bodyAr)) {
      throw new BadRequestException({
        code: 'SITE_NEWS_EMPTY',
        message: 'Titre et texte obligatoires (en français ou en arabe).',
      });
    }
    if (
      title.length > L.newsTitle ||
      titleAr.length > L.newsTitle ||
      body.length > L.newsBody ||
      bodyAr.length > L.newsBody
    ) {
      throw new BadRequestException({ code: 'SITE_NEWS_TOO_LONG', message: 'Texte trop long.' });
    }
    return { title, titleAr, body, bodyAr };
  }

  private async newsMedia(site: SiteRow, mediaId: string | null | undefined) {
    if (!mediaId) return null;
    await this.assertMediaOfSite(site, [mediaId]);
    return mediaId;
  }

  async createNews(
    ctx: SchoolContext,
    siteId: string,
    dto: {
      title: string;
      titleAr?: string;
      body: string;
      bodyAr?: string;
      publishedOn: string;
      mediaId?: string | null;
    },
  ) {
    const site = await this.findSite(ctx, siteId);
    const text = this.checkedNews(dto);
    const mediaId = await this.newsMedia(site, dto.mediaId);
    const base = slugify(text.title || 'actualite').slice(0, 60) || 'actualite';
    const news = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "SchoolSite" WHERE "id" = ${site.id}::uuid FOR UPDATE`;
      if ((await tx.schoolSiteNews.count({ where: { siteId: site.id } })) >= MAX_NEWS) {
        throw new ConflictException({
          code: 'SITE_NEWS_LIMIT',
          message: `${MAX_NEWS} actualités au plus.`,
        });
      }
      const taken = new Set(
        (
          await tx.schoolSiteNews.findMany({
            where: { siteId: site.id, slug: { startsWith: base } },
            select: { slug: true },
          })
        ).map((n) => n.slug),
      );
      let slug = base;
      for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
      return tx.schoolSiteNews.create({
        data: {
          organizationId: site.organizationId,
          siteId: site.id,
          slug,
          ...text,
          publishedOn: new Date(`${dto.publishedOn}T00:00:00.000Z`),
          mediaId,
          createdByUserId: ctx.userId,
        },
        select: { id: true, slug: true, status: true },
      });
    });
    await this.school.log(ctx, 'school.site_news_created', 'SchoolSiteNews', news.id, {
      slug: news.slug,
    });
    return news;
  }

  private async findNews(site: SiteRow, newsId: string) {
    const news = await this.db.schoolSiteNews.findFirst({
      where: { id: newsId, organizationId: site.organizationId, siteId: site.id },
      select: {
        id: true,
        slug: true,
        status: true,
        title: true,
        titleAr: true,
        body: true,
        bodyAr: true,
      },
    });
    if (!news) throw new NotFoundException(NOT_FOUND);
    return news;
  }

  async updateNews(
    ctx: SchoolContext,
    siteId: string,
    newsId: string,
    dto: {
      title?: string;
      titleAr?: string;
      body?: string;
      bodyAr?: string;
      publishedOn?: string;
      mediaId?: string | null;
    },
  ) {
    const site = await this.findSite(ctx, siteId);
    const news = await this.findNews(site, newsId);
    const text = this.checkedNews({
      title: dto.title ?? news.title,
      titleAr: dto.titleAr ?? news.titleAr,
      body: dto.body ?? news.body,
      bodyAr: dto.bodyAr ?? news.bodyAr,
    });
    const mediaId = dto.mediaId === undefined ? undefined : await this.newsMedia(site, dto.mediaId);
    await this.db.$transaction(async (tx) => {
      await tx.schoolSiteNews.update({
        where: { id: news.id },
        data: {
          ...text,
          ...(dto.publishedOn ? { publishedOn: new Date(`${dto.publishedOn}T00:00:00.000Z`) } : {}),
          ...(mediaId !== undefined ? { mediaId } : {}),
        },
      });
      await this.syncPublishedMedia(tx, site);
    });
    if (site.isOnline && news.status === 'PUBLISHED') void this.revalidate([site.slug]);
    return { id: news.id };
  }

  async setNewsStatus(ctx: SchoolContext, siteId: string, newsId: string, publish: boolean) {
    const site = await this.findSite(ctx, siteId);
    const news = await this.findNews(site, newsId);
    await this.db.$transaction(async (tx) => {
      await tx.schoolSiteNews.update({
        where: { id: news.id },
        data: publish ? { status: 'PUBLISHED', publishedAt: new Date() } : { status: 'DRAFT' },
      });
      await this.syncPublishedMedia(tx, site);
    });
    await this.school.log(
      ctx,
      publish ? 'school.site_news_published' : 'school.site_news_unpublished',
      'SchoolSiteNews',
      news.id,
      { slug: news.slug },
    );
    if (site.isOnline) void this.revalidate([site.slug]);
    return { id: news.id, status: publish ? 'PUBLISHED' : 'DRAFT' };
  }

  async removeNews(ctx: SchoolContext, siteId: string, newsId: string) {
    const site = await this.findSite(ctx, siteId);
    const news = await this.findNews(site, newsId);
    await this.db.$transaction(async (tx) => {
      await tx.schoolSiteNews.delete({ where: { id: news.id } });
      await this.syncPublishedMedia(tx, site);
    });
    await this.school.log(ctx, 'school.site_news_deleted', 'SchoolSiteNews', news.id, {
      slug: news.slug,
    });
    if (site.isOnline && news.status === 'PUBLISHED') void this.revalidate([site.slug]);
    return { deleted: true };
  }

  /** Actualités d'un site : publiées seulement pour le public ; toutes pour la prévisualisation. */
  private async newsFor(
    site: SiteRow,
    publishedOnly: boolean,
  ): Promise<(SchoolSitePublishedNews & { status: string })[]> {
    const rows = await this.db.schoolSiteNews.findMany({
      where: {
        organizationId: site.organizationId,
        siteId: site.id,
        ...(publishedOnly ? { status: 'PUBLISHED' } : {}),
      },
      orderBy: [{ publishedOn: 'desc' }, { createdAt: 'desc' }],
      take: PUBLIC_NEWS,
      select: {
        slug: true,
        title: true,
        titleAr: true,
        body: true,
        bodyAr: true,
        publishedOn: true,
        mediaId: true,
        status: true,
      },
    });
    const media = await this.mediaMap(
      this.db,
      site,
      rows.flatMap((r) => (r.mediaId ? [r.mediaId] : [])),
    );
    return rows.map((r) => ({
      slug: r.slug,
      title: { fr: r.title, ar: r.titleAr },
      body: { fr: r.body, ar: r.bodyAr },
      publishedOn: r.publishedOn.toISOString().slice(0, 10),
      image: r.mediaId ? SchoolSitesService.published(media.get(r.mediaId)) : null,
      status: r.status,
    }));
  }

  // ─── Public ───

  /** Hôte → slug (sous-domaine Sprint 10 ; domaines personnalisés au Sprint 13). */
  async resolveHost(host: string): Promise<{ slug: string } | null> {
    if (!this.config.school.enabled) return null;
    for (const resolver of this.resolvers) {
      const slug = await resolver.slugForHost(host);
      if (slug) {
        const site = await this.db.schoolSite.findUnique({
          where: { slug },
          select: { slug: true },
        });
        return site ? { slug: site.slug } : null;
      }
    }
    return null;
  }

  /** Site en ligne et disponible (contrat valide ou maintien), avec la fin du maintien éventuel. */
  private async publicSite(slug: string) {
    if (!this.config.school.enabled || schoolSiteSlugError(slug)) return null;
    const site = await this.db.schoolSite.findUnique({ where: { slug }, select: SITE_SELECT });
    if (!site) return null;
    const school = await this.db.school.findFirst({
      where: { organizationId: site.organizationId, id: site.schoolId },
      select: { name: true, nameAr: true, isActive: true },
    });
    const availability = await this.availability(site.organizationId);
    const online =
      site.enabled &&
      site.isOnline &&
      !!site.published &&
      !!school?.isActive &&
      availability.online;
    return {
      site,
      name: { fr: school?.name ?? '', ar: school?.nameAr ?? '' } as SchoolSiteText,
      online,
      readOnlyUntil: availability.online ? availability.readOnlyUntil : null,
    };
  }

  async publicBySlug(slug: string): Promise<SchoolSitePublicResponse | null> {
    const found = await this.publicSite(slug);
    if (!found) return null;
    if (!found.online) return { state: 'UNAVAILABLE', name: found.name };
    const { site } = found;
    const links = await this.publicLinks(site.id, site.organizationId);
    const news = await this.newsFor(site, true);
    return {
      state: 'PUBLISHED',
      site: site.published as unknown as SchoolSitePublished,
      links: links.links,
      whatsapp: links.whatsapp,
      news: news.map(({ status: _status, ...n }) => n),
      canonicalUrl: schoolSiteCanonicalUrl(this.sitesConfig, site.slug),
      readOnlyUntil: found.readOnlyUntil?.toISOString() ?? null,
    };
  }

  /** Plan du site d'un hôte de site School : pages des langues publiées et actualités publiées. */
  async sitemap(host: string): Promise<{ url: string; lastModified: string | null }[]> {
    const resolved = await this.resolveHost(host);
    if (!resolved) return [];
    const data = await this.publicBySlug(resolved.slug);
    if (!data || data.state !== 'PUBLISHED') return [];
    const origin = data.canonicalUrl;
    const lastModified = data.site.publishedAt.slice(0, 10);
    return data.site.languages.flatMap((lang) => [
      ...SCHOOL_SITE_PAGES.map((page) => ({
        url: `${origin}${schoolSitePath(lang, page) === '/' ? '' : schoolSitePath(lang, page)}`,
        lastModified,
      })),
      ...data.news.map((n) => ({
        url: `${origin}${schoolSitePath(lang, 'news', n.slug)}`,
        lastModified: n.publishedOn,
      })),
    ]);
  }

  /** Image publique : publiée, non retirée, d'un site en ligne et disponible. */
  async publicMediaKey(key: string): Promise<{ storageKey: string } | null> {
    if (!this.config.school.enabled) return null;
    const media = await this.db.schoolSiteMedia.findFirst({
      where: {
        OR: [{ storageKey: key }, { thumbKey: key }],
        isPublished: true,
        withdrawnAt: null,
        site: { enabled: true, isOnline: true },
      },
      select: { organizationId: true, site: { select: { slug: true } } },
    });
    if (!media) return null;
    const found = await this.publicSite(media.site.slug);
    return found?.online ? { storageKey: key } : null;
  }

  // ─── Régénération des pages publiques ───

  async revalidate(slugs: string[]): Promise<void> {
    const { revalidateUrl, revalidateSecret } = this.config.sites;
    if (!revalidateUrl || !revalidateSecret) return;
    try {
      await fetch(revalidateUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-revalidate-secret': revalidateSecret },
        body: JSON.stringify({ schoolSlugs: [...new Set(slugs)] }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch (e) {
      this.logger.warn(`Revalidation des sites School impossible : ${(e as Error).message}`);
    }
  }
}
