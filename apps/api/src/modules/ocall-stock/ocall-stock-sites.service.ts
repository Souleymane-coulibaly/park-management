import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@ocall/stock-database';
import {
  STOCK_DEFAULT_LOCATION_CODE,
  STOCK_PRODUCT_CODE,
  STOCK_SITE_KIND_LABELS,
  type StockRole,
  type StockSiteKind,
  parseStockLocationQr,
  stockLocationNests,
  siteMatchReason,
  stockLocationQr,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import { type StockContext, stockSiteAllowed, stockSiteWhere } from './ocall-stock-access';
import { renderLocationLabelsPdf } from './ocall-stock-label-pdf';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';
import type {
  StockLocationDto,
  StockLocationLabelsDto,
  StockSiteDto,
  StockSiteEstablishmentDto,
  UpdateStockLocationDto,
  UpdateStockSiteDto,
} from './ocall-stock.dto';
import {
  type RegistrySite,
  SITE_REGISTRY,
  type SiteRegistry,
} from '../../common/integration/site-registry';

const SITE_NOT_FOUND = { code: 'STOCK_SITE_NOT_FOUND', message: 'Site introuvable.' };
const LOCATION_NOT_FOUND = {
  code: 'STOCK_LOCATION_NOT_FOUND',
  message: 'Emplacement introuvable.',
};

const isUnique = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
const pgMessage = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError ||
  e instanceof Prisma.PrismaClientUnknownRequestError
    ? e.message
    : '';

/**
 * Sites (magasins, dépôts, entrepôts) et leurs emplacements (S2). Chaque site naît avec un emplacement
 * « Général » : un site non découpé fonctionne sans rien configurer. Un membre rattaché à des sites ne
 * voit qu'eux ; un site d'une autre organisation ou hors périmètre est « introuvable ».
 */
@Injectable()
export class OcallStockSitesService implements OnModuleInit {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly audit: AuditService,
    @Inject(SITE_REGISTRY) private readonly registryService: SiteRegistry,
  ) {}

  /** Sprint Suite 2B : le référentiel Suite affiche les sites Stock rattachés à ses établissements. */
  onModuleInit() {
    this.registryService.registerUsage({
      product: STOCK_PRODUCT_CODE,
      label: 'Ocall Stock',
      usages: async (organizationId) =>
        (
          await this.db.stockSite.findMany({
            where: { organizationId, isArchived: false, establishmentId: { not: null } },
            select: { id: true, name: true, establishmentId: true },
          })
        ).map((s) => ({
          establishmentId: s.establishmentId!,
          appSiteId: s.id,
          appSiteName: s.name,
        })),
    });
  }

  // ─── Référentiel Suite (Sprint Suite 2B) ───

  /**
   * Établissements de l'organisation (actifs) avec le site Stock déjà rattaché à chacun, et pour chaque
   * site Stock non rattaché du périmètre, les établissements libres qui lui ressemblent (même nom, même
   * ville). Simple suggestion : rien n'est rattaché sans choix explicite.
   */
  async registry(ctx: StockContext) {
    const [establishments, sites] = await Promise.all([
      this.registryService.list(ctx.organizationId),
      this.db.stockSite.findMany({
        where: { organizationId: ctx.organizationId },
        select: { id: true, name: true, city: true, establishmentId: true, isArchived: true },
      }),
    ]);
    const linkedTo = new Map(
      sites.filter((s) => s.establishmentId).map((s) => [s.establishmentId!, s.id]),
    );
    const free = establishments.filter((e) => e.isActive && !linkedTo.has(e.id));
    return {
      establishments: establishments
        .filter((e) => e.isActive)
        .map((e) => ({ ...e, stockSiteId: linkedTo.get(e.id) ?? null })),
      suggestions: sites
        .filter((s) => !s.establishmentId && !s.isArchived && stockSiteAllowed(ctx, s.id))
        .flatMap((s) =>
          free.flatMap((e) => {
            const reason = siteMatchReason(s, e);
            return reason ? [{ siteId: s.id, establishmentId: e.id, reason }] : [];
          }),
        ),
    };
  }

  /**
   * Rattache un site Stock à un établissement du référentiel (existant, ou créé à partir du site), ou retire
   * le rattachement. Un établissement d'une autre organisation est introuvable ; un établissement désactivé
   * ou déjà rattaché à un autre site Stock est refusé. Chaque changement est journalisé.
   */
  async linkEstablishment(ctx: StockContext, id: string, dto: StockSiteEstablishmentDto) {
    const site = await this.site(ctx, id);
    if (dto.createEstablishment && dto.establishmentId) throw this.establishmentChoice();
    let establishmentId: string | null;
    if (dto.createEstablishment) {
      establishmentId = (await this.newEstablishment(ctx, site)).id;
    } else if (dto.establishmentId !== undefined) {
      establishmentId = dto.establishmentId;
      if (establishmentId) await this.usableEstablishment(ctx, establishmentId, id);
    } else {
      throw this.establishmentChoice();
    }
    await this.saveLink(ctx, id, establishmentId);
    await this.record(
      ctx,
      establishmentId ? 'stock.site_establishment_linked' : 'stock.site_establishment_unlinked',
      'StockSite',
      id,
      { from: site.establishmentId, to: establishmentId, created: !!dto.createEstablishment },
    );
    return this.site(ctx, id);
  }

  private async saveLink(ctx: StockContext, id: string, establishmentId: string | null) {
    try {
      await this.db.stockSite.update({
        where: { organizationId_id: { organizationId: ctx.organizationId, id } },
        data: { establishmentId },
      });
    } catch (e) {
      if (isUnique(e)) throw this.establishmentTaken();
      throw e;
    }
  }

  /** Établissement actif de l'organisation, libre (ou déjà rattaché à ce site). */
  private async usableEstablishment(
    ctx: StockContext,
    establishmentId: string,
    siteId: string | null,
  ): Promise<RegistrySite> {
    const establishment = await this.registryService.get(ctx.organizationId, establishmentId);
    if (!establishment) {
      throw new NotFoundException({
        code: 'ESTABLISHMENT_NOT_FOUND',
        message: 'Établissement introuvable.',
      });
    }
    if (!establishment.isActive) {
      throw new ConflictException({
        code: 'ESTABLISHMENT_INACTIVE',
        message: 'Cet établissement est désactivé.',
      });
    }
    const taken = await this.db.stockSite.findFirst({
      where: {
        organizationId: ctx.organizationId,
        establishmentId,
        ...(siteId ? { NOT: { id: siteId } } : {}),
      },
      select: { id: true },
    });
    if (taken) throw this.establishmentTaken();
    return establishment;
  }

  private newEstablishment(
    ctx: StockContext,
    site: { name: string; kind: StockSiteKind; city: string | null; address: string | null },
  ) {
    return this.registryService.createSite({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      source: STOCK_PRODUCT_CODE,
      name: site.name,
      kind: site.kind === 'STORE' ? 'SHOP' : 'WAREHOUSE',
      city: site.city,
      address: site.address,
    });
  }

  private establishmentTaken() {
    return new ConflictException({
      code: 'STOCK_SITE_ESTABLISHMENT_TAKEN',
      message: 'Cet établissement est déjà rattaché à un autre site Stock.',
    });
  }

  private establishmentChoice() {
    return new BadRequestException({
      code: 'STOCK_SITE_ESTABLISHMENT_CHOICE',
      message: 'Choisissez un établissement existant ou la création d’un nouveau, pas les deux.',
    });
  }

  // ─── Sites ───

  listSites(ctx: StockContext, archived = false) {
    return this.db.stockSite.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(archived ? {} : { isArchived: false }),
        ...stockSiteWhere(ctx, 'id'),
      },
      orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
    });
  }

  async site(ctx: StockContext, id: string) {
    const site = await this.db.stockSite.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      include: {
        locations: {
          orderBy: [{ kind: 'asc' }, { code: 'asc' }],
          select: {
            id: true,
            parentId: true,
            kind: true,
            code: true,
            name: true,
            isArchived: true,
          },
        },
      },
    });
    if (!site || !stockSiteAllowed(ctx, site.id)) throw new NotFoundException(SITE_NOT_FOUND);
    return {
      ...site,
      locations: site.locations.map((l) => ({ ...l, qr: stockLocationQr(site.code, l.code) })),
    };
  }

  /** Site actif et accessible (contrôle commun des opérations de stock). */
  async activeSite(
    ctx: StockContext,
    id: string,
    tx: Prisma.TransactionClient | OcallStockPrismaService = this.db,
  ) {
    const site = await tx.stockSite.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      select: { id: true, code: true, name: true, isArchived: true },
    });
    if (!site || !stockSiteAllowed(ctx, site.id)) throw new NotFoundException(SITE_NOT_FOUND);
    if (site.isArchived) {
      throw new ConflictException({ code: 'STOCK_SITE_ARCHIVED', message: 'Site archivé.' });
    }
    return site;
  }

  /** Emplacement accessible ; `active` exige qu'il ne soit pas archivé (destination d'un mouvement). */
  async location(
    ctx: StockContext,
    id: string,
    opts: { active?: boolean } = {},
    tx: Prisma.TransactionClient | OcallStockPrismaService = this.db,
  ) {
    const location = await tx.stockLocation.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      select: {
        id: true,
        siteId: true,
        code: true,
        name: true,
        kind: true,
        isArchived: true,
        site: { select: { code: true, name: true, isArchived: true } },
      },
    });
    if (!location || !stockSiteAllowed(ctx, location.siteId))
      throw new NotFoundException(LOCATION_NOT_FOUND);
    if (opts.active && (location.isArchived || location.site.isArchived)) {
      throw new ConflictException({
        code: 'STOCK_LOCATION_ARCHIVED',
        message: 'Emplacement ou site archivé.',
      });
    }
    return location;
  }

  /** Emplacement par défaut (« Général ») d'un site. */
  async defaultLocation(
    ctx: StockContext,
    siteId: string,
    tx: Prisma.TransactionClient | OcallStockPrismaService = this.db,
  ) {
    const location = await tx.stockLocation.findFirst({
      where: { organizationId: ctx.organizationId, siteId, kind: 'DEFAULT' },
      select: { id: true },
    });
    if (!location) throw new NotFoundException(LOCATION_NOT_FOUND);
    return location.id;
  }

  async createSite(ctx: StockContext, dto: StockSiteDto) {
    const { establishmentId: chosen, createEstablishment, ...fields } = dto;
    if (chosen && createEstablishment) throw this.establishmentChoice();
    // Sprint Suite 2B : établissement vérifié (ou créé) avant le site ; code déjà pris refusé d'abord,
    // pour ne jamais créer un établissement pour rien.
    if (chosen) await this.usableEstablishment(ctx, chosen, null);
    if (createEstablishment) {
      const taken = await this.db.stockSite.findFirst({
        where: { organizationId: ctx.organizationId, code: dto.code },
        select: { id: true },
      });
      if (taken) {
        throw new ConflictException({
          code: 'STOCK_SITE_CODE_TAKEN',
          message: 'Un site porte déjà ce code.',
        });
      }
      // Ocall Suite Sprint 2C : nom déjà pris dans le référentiel, refusé avant toute écriture.
      if (await this.registryService.findByName(ctx.organizationId, fields.name)) {
        throw new ConflictException({
          code: 'ESTABLISHMENT_NAME_TAKEN',
          message:
            'Un site de ce nom existe déjà dans votre organisation : rattachez-le plutôt que d’en créer un second.',
        });
      }
    }
    const establishmentId = createEstablishment
      ? (
          await this.newEstablishment(ctx, {
            name: fields.name,
            kind: fields.kind,
            city: fields.city ?? null,
            address: fields.address ?? null,
          })
        ).id
      : (chosen ?? null);
    try {
      const site = await this.db.$transaction(async (tx) => {
        const created = await tx.stockSite.create({
          data: {
            organizationId: ctx.organizationId,
            code: fields.code,
            name: fields.name,
            kind: fields.kind,
            address: fields.address ?? null,
            city: fields.city ?? null,
            establishmentId,
          },
        });
        await tx.stockLocation.create({
          data: {
            organizationId: ctx.organizationId,
            siteId: created.id,
            kind: 'DEFAULT',
            code: STOCK_DEFAULT_LOCATION_CODE,
            name: 'Général',
          },
        });
        return created;
      });
      await this.record(ctx, 'stock.site_created', 'StockSite', site.id, {
        code: site.code,
        ...(establishmentId ? { establishmentId } : {}),
      });
      return this.site(ctx, site.id);
    } catch (e) {
      // Ocall Suite Sprint 2C : le lieu créé pour ce site est annulé si le site n'a pas pu être créé.
      if (createEstablishment && establishmentId) {
        await this.registryService.discardNewSite({
          organizationId: ctx.organizationId,
          actorUserId: ctx.userId,
          source: STOCK_PRODUCT_CODE,
          id: establishmentId,
        });
      }
      if (isUnique(e)) {
        if (pgMessage(e).includes('establishmentId')) throw this.establishmentTaken();
        throw new ConflictException({
          code: 'STOCK_SITE_CODE_TAKEN',
          message: 'Un site porte déjà ce code.',
        });
      }
      throw e;
    }
  }

  /** Le code d'un site ne change pas : il est imprimé dans les QR codes de ses emplacements. */
  async updateSite(ctx: StockContext, id: string, dto: UpdateStockSiteDto) {
    await this.site(ctx, id);
    if (dto.isArchived) await this.assertEmpty(ctx, { siteId: id }, 'Ce site');
    await this.db.stockSite.update({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      data: dto,
    });
    await this.record(ctx, 'stock.site_updated', 'StockSite', id, { fields: Object.keys(dto) });
    return this.site(ctx, id);
  }

  // ─── Emplacements ───

  async createLocation(ctx: StockContext, siteId: string, dto: StockLocationDto) {
    const site = await this.activeSite(ctx, siteId);
    if (dto.parentId) {
      const parent = await this.location(ctx, dto.parentId);
      if (parent.siteId !== site.id || !stockLocationNests(parent.kind, dto.kind)) {
        throw new BadRequestException({
          code: 'STOCK_LOCATION_TREE',
          message: 'Ordre des niveaux : zone, allée, rayonnage, emplacement, dans le même site.',
        });
      }
    }
    try {
      const location = await this.db.stockLocation.create({
        data: {
          organizationId: ctx.organizationId,
          siteId: site.id,
          parentId: dto.parentId ?? null,
          kind: dto.kind,
          code: dto.code,
          name: dto.name,
        },
        select: { id: true, parentId: true, kind: true, code: true, name: true, isArchived: true },
      });
      await this.record(ctx, 'stock.location_created', 'StockLocation', location.id, {
        code: location.code,
      });
      return { ...location, qr: stockLocationQr(site.code, location.code) };
    } catch (e) {
      if (isUnique(e)) {
        throw new ConflictException({
          code: 'STOCK_LOCATION_CODE_TAKEN',
          message: 'Un emplacement de ce site porte déjà ce code.',
        });
      }
      if (pgMessage(e).includes('STOCK_LOCATION_TREE')) {
        throw new BadRequestException({
          code: 'STOCK_LOCATION_TREE',
          message: 'Ordre des niveaux : zone, allée, rayonnage, emplacement, dans le même site.',
        });
      }
      throw e;
    }
  }

  /** Nom et archivage ; le code et la place dans l'arborescence restent (QR codes imprimés). */
  async updateLocation(ctx: StockContext, id: string, dto: UpdateStockLocationDto) {
    const location = await this.location(ctx, id);
    if (location.kind === 'DEFAULT' && dto.isArchived) {
      throw new ConflictException({
        code: 'STOCK_DEFAULT_LOCATION',
        message: 'L’emplacement « Général » ne s’archive pas : archivez le site.',
      });
    }
    if (dto.isArchived) {
      const children = await this.db.stockLocation.count({
        where: { organizationId: ctx.organizationId, parentId: id, isArchived: false },
      });
      if (children > 0) {
        throw new ConflictException({
          code: 'STOCK_LOCATION_HAS_CHILDREN',
          message: 'Archivez d’abord les emplacements qu’il contient.',
        });
      }
      await this.assertEmpty(ctx, { locationId: id }, 'Cet emplacement');
    }
    const updated = await this.db.stockLocation.update({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      data: { name: dto.name, isArchived: dto.isArchived },
      select: { id: true, parentId: true, kind: true, code: true, name: true, isArchived: true },
    });
    await this.record(ctx, 'stock.location_updated', 'StockLocation', id, {
      fields: Object.keys(dto),
    });
    return { ...updated, qr: stockLocationQr(location.site.code, updated.code) };
  }

  /** Lecture du QR code d'un emplacement (scan pendant un rangement, un transfert, un inventaire). */
  async lookupLocation(ctx: StockContext, code: string) {
    const parsed = parseStockLocationQr(code);
    if (!parsed) return { found: false as const };
    const location = await this.db.stockLocation.findFirst({
      where: {
        organizationId: ctx.organizationId,
        code: parsed.locationCode,
        site: { code: parsed.siteCode },
        ...stockSiteWhere(ctx),
      },
      select: {
        id: true,
        code: true,
        name: true,
        kind: true,
        isArchived: true,
        site: { select: { id: true, code: true, name: true } },
      },
    });
    return location ? { found: true as const, location } : { found: false as const };
  }

  /** Étiquettes QR des emplacements choisis d'un site (PDF à la taille du format). */
  async locationLabels(ctx: StockContext, siteId: string, dto: StockLocationLabelsDto) {
    const site = await this.site(ctx, siteId);
    const chosen = site.locations.filter((l) => dto.locationIds.includes(l.id));
    if (chosen.length !== new Set(dto.locationIds).size)
      throw new NotFoundException(LOCATION_NOT_FOUND);
    const pdf = await renderLocationLabelsPdf(
      dto.format,
      chosen.map((l) => ({
        siteName: `${site.name} · ${STOCK_SITE_KIND_LABELS[site.kind as StockSiteKind]}`,
        code: l.code,
        name: l.name,
        qr: l.qr,
      })),
    );
    await this.record(ctx, 'stock.location_labels_printed', 'StockSite', siteId, {
      labels: chosen.length,
    });
    return pdf;
  }

  // ─── Équipe ───

  /**
   * Sites d'un membre : la liste remplace la précédente (vide = tous les sites). `siteRoles` (Sprint
   * Suite 2A) donne un rôle propre à certains de ces sites ; il restreint le rôle principal, jamais plus.
   */
  async setMemberSites(
    ctx: StockContext,
    memberId: string,
    siteIds: string[],
    siteRoles: { siteId: string; role: StockRole }[] = [],
  ) {
    const unique = [...new Set(siteIds)];
    const roles = new Map(siteRoles.map((r) => [r.siteId, r.role]));
    if (roles.size !== siteRoles.length || [...roles.keys()].some((id) => !unique.includes(id))) {
      throw new BadRequestException({
        code: 'STOCK_SITE_ROLES',
        message: 'Un rôle de site porte sur un site rattaché, une seule fois.',
      });
    }
    await this.db.$transaction(async (tx) => {
      const member = await tx.stockMember.findUnique({
        where: { organizationId_id: { organizationId: ctx.organizationId, id: memberId } },
        select: { id: true, role: true },
      });
      if (!member)
        throw new NotFoundException({
          code: 'STOCK_MEMBER_NOT_FOUND',
          message: 'Utilisateur introuvable.',
        });
      // L'administrateur agit sur toute l'organisation : un rôle de site n'aurait aucun effet.
      if (member.role === 'ADMIN' && roles.size > 0) {
        throw new BadRequestException({
          code: 'STOCK_SITE_ROLES_ADMIN',
          message: 'Un administrateur a les mêmes droits sur tous les sites.',
        });
      }
      const sites = await tx.stockSite.count({
        where: { organizationId: ctx.organizationId, id: { in: unique } },
      });
      if (sites !== unique.length) throw new NotFoundException(SITE_NOT_FOUND);
      await tx.stockMemberSite.deleteMany({
        where: { organizationId: ctx.organizationId, memberId },
      });
      if (unique.length) {
        await tx.stockMemberSite.createMany({
          data: unique.map((siteId) => ({
            organizationId: ctx.organizationId,
            memberId,
            siteId,
            role: roles.get(siteId) ?? null,
          })),
        });
      }
    });
    await this.record(ctx, 'stock.member_sites_updated', 'StockMember', memberId, {
      sites: unique.length,
      siteRoles: Object.fromEntries(roles),
    });
    return {
      memberId,
      siteIds: unique,
      siteRoles: [...roles].map(([siteId, role]) => ({ siteId, role })),
    };
  }

  // ─── Outils ───

  /** Refus d'archiver un site ou un emplacement qui contient du stock ou une opération en cours. */
  private async assertEmpty(
    ctx: StockContext,
    where: { siteId?: string; locationId?: string },
    label: string,
  ) {
    const stocked = await this.db.stockLevel.count({
      where: {
        organizationId: ctx.organizationId,
        ...where,
        OR: [{ onHand: { not: 0 } }, { reserved: { not: 0 } }],
      },
    });
    const open = where.siteId
      ? (await this.db.stockTransfer.count({
          where: {
            organizationId: ctx.organizationId,
            status: { in: ['REQUESTED', 'PREPARED', 'SHIPPED', 'PARTIALLY_RECEIVED'] },
            OR: [{ fromSiteId: where.siteId }, { toSiteId: where.siteId }],
          },
        })) +
        (await this.db.stockCount.count({
          where: { organizationId: ctx.organizationId, siteId: where.siteId, status: 'OPEN' },
        }))
      : 0;
    if (stocked > 0 || open > 0) {
      throw new ConflictException({
        code: 'STOCK_NOT_EMPTY',
        message: `${label} contient du stock ou une opération en cours : videz-le ou terminez-la d’abord.`,
      });
    }
  }

  private async record(
    ctx: StockContext,
    action: string,
    targetType: string,
    targetId: string,
    metadata?: object,
  ) {
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action,
      targetType,
      targetId,
      ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
    });
  }
}
