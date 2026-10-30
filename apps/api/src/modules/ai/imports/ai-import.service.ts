import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import {
  AI_IMPORT_MAX_BYTES,
  type AiFeature,
  type Permission,
  detectImportMimeType,
  hasPermission,
  normalizeLabel,
} from '@ocall/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import type { TenantContext } from '../../../common/auth-context';
import { establishmentScope } from '../../../common/tenant-scope';
import { CatalogService } from '../../catalog/catalog.service';
import { findSellingEstablishment } from '../../pos/pos-scope';
import { TicketCategoriesService } from '../../ticketing/ticket-categories.service';
import { AiUsageService } from '../ai-usage.service';
import type { PublishCatalogDto, PublishTicketsDto } from './ai-import.dto';
import {
  CATALOG_SCHEMA,
  type CatalogLine,
  type ExistingName,
  IMPORT_INSTRUCTIONS,
  type ImportAnalysis,
  TICKETS_SCHEMA,
  type TicketLine,
  normalizeCatalog,
  normalizeTickets,
} from './import-extraction';

type Kind = 'CATALOG' | 'TICKETS';

const KIND: Record<Kind, { feature: AiFeature; permission: Permission; prompt: string }> = {
  CATALOG: {
    feature: 'CATALOG_IMPORT',
    permission: 'catalog.manage',
    prompt:
      'Carte de restaurant : extrais chaque plat ou boisson, avec sa catégorie, sa description ' +
      'éventuelle, ses variantes (tailles, accompagnements à prix différent) et son prix.',
  },
  TICKETS: {
    feature: 'TICKET_IMPORT',
    permission: 'ticketing.manage',
    prompt:
      'Grille tarifaire d’un parc aquatique : extrais chaque billet ou formule (adulte, enfant, ' +
      'famille, groupe…), son prix, le nombre de personnes incluses et ses conditions.',
  },
};

const IMPORT_SELECT = {
  id: true,
  kind: true,
  status: true,
  establishmentId: true,
  fileName: true,
  mimeType: true,
  fileSize: true,
  result: true,
  publication: true,
  errorCode: true,
  createdAt: true,
  publishedAt: true,
  expiresAt: true,
  purgedAt: true,
  establishment: { select: { name: true } },
} satisfies Prisma.AiImportSelect;

const NOT_FOUND = { code: 'AI_IMPORT_NOT_FOUND', message: 'Import introuvable.' };

/** Import tel que renvoyé à l'interface (le résultat est null après purge ou dans une liste). */
export interface AiImportView {
  id: string;
  kind: Kind;
  status: 'ANALYZED' | 'FAILED' | 'PUBLISHED' | 'DISCARDED';
  establishmentId: string;
  establishmentName: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  result: ImportAnalysis<CatalogLine> | ImportAnalysis<TicketLine> | null;
  publication: Publication | null;
  errorCode: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  expiresAt: Date;
  purgedAt: Date | null;
}

type ImportRow = Prisma.AiImportGetPayload<{ select: typeof IMPORT_SELECT }>;

const toView = ({ establishment, result, publication, ...row }: ImportRow): AiImportView => ({
  ...row,
  establishmentName: establishment.name,
  result: (result ?? null) as AiImportView['result'],
  publication: (publication ?? null) as Publication | null,
});

interface Publication {
  created: Array<{ index: number; id: string; name: string }>;
  skipped: number[];
  error?: string;
}

/** Nom de fichier affiché : sans chemin ni caractère de contrôle, 120 caractères au plus. */
const safeFileName = (name: string | undefined) =>
  (name ?? 'document')
    .split(/[\\/]/)
    .pop()!
    .split('')
    .filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f)
    .join('')
    .slice(0, 120) || 'document';

/**
 * Import IA d'une carte ou d'une grille tarifaire : analyse (jamais de publication automatique),
 * revue et correction par l'utilisateur, puis publication par les services existants du catalogue
 * et de la billetterie. Rien n'est écrasé : seules des créations ont lieu, et les billets importés
 * sont créés désactivés.
 */
@Injectable()
export class AiImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ai: AiUsageService,
    private readonly catalog: CatalogService,
    private readonly ticketCategories: TicketCategoriesService,
  ) {}

  async analyze(
    auth: TenantContext,
    kind: Kind,
    establishmentId: string,
    file: { buffer: Buffer; originalname?: string; size: number } | undefined,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'Ajoutez une photo ou un PDF.',
      });
    }
    if (file.size > AI_IMPORT_MAX_BYTES) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: 'Fichier trop lourd (10 Mo au plus).',
      });
    }
    const mimeType = detectImportMimeType(file.buffer);
    if (!mimeType) {
      throw new UnsupportedMediaTypeException({
        code: 'UNSUPPORTED_FILE_TYPE',
        message: 'Format non pris en charge : photo JPEG, PNG ou WebP, ou document PDF.',
      });
    }
    const establishment = await findSellingEstablishment(
      this.prisma,
      auth,
      establishmentId,
      kind === 'CATALOG' ? 'RESTAURANT' : 'PARK',
    );
    const organizationId = auth.membership.organizationId;
    const { feature, prompt } = KIND[kind];
    const fileName = safeFileName(file.originalname);
    const base = {
      organizationId,
      establishmentId: establishment.id,
      kind,
      fileName,
      mimeType,
      fileSize: file.size,
      fileSha256: createHash('sha256').update(file.buffer).digest('hex'),
      createdById: auth.membership.id,
      expiresAt: await this.ai.expiryFor(organizationId),
    };

    let raw: unknown;
    try {
      raw = await this.ai.run(auth, feature, establishment.id, this.ai.model(feature), (provider) =>
        provider.extractFromDocument({
          model: this.ai.model(feature),
          instructions: IMPORT_INSTRUCTIONS,
          prompt,
          document: { mimeType, data: file.buffer, fileName },
          schemaName: kind === 'CATALOG' ? 'restaurant_menu' : 'park_ticket_prices',
          schema: kind === 'CATALOG' ? CATALOG_SCHEMA : TICKETS_SCHEMA,
        }),
      );
    } catch (error) {
      // Échec du fournisseur : tracé (qui, quel fichier), puis signalé à l'utilisateur.
      const code =
        error instanceof HttpException ? (error.getResponse() as { code?: string }).code : null;
      if (
        code?.startsWith('AI_') &&
        code !== 'AI_QUOTA_EXCEEDED' &&
        code !== 'AI_FEATURE_DISABLED' &&
        code !== 'AI_NOT_CONFIGURED'
      ) {
        await this.prisma.aiImport.create({ data: { ...base, status: 'FAILED', errorCode: code } });
      }
      throw error;
    }

    const analysis =
      kind === 'CATALOG'
        ? normalizeCatalog(raw, await this.existingProducts(organizationId))
        : normalizeTickets(raw, await this.existingTicketCategories(establishment.id));
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.aiImport.create({
        data: { ...base, status: 'ANALYZED', result: analysis as unknown as Prisma.InputJsonValue },
        select: IMPORT_SELECT,
      });
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'ai.import_analyzed',
          targetType: 'AiImport',
          targetId: row.id,
          metadata: {
            kind,
            establishmentId: establishment.id,
            fileSha256: base.fileSha256,
            lines: analysis.lines.length,
            readable: analysis.readable,
          },
        },
        tx,
      );
      return row;
    });
    return toView(created);
  }

  async list(auth: TenantContext, kind: Kind): Promise<AiImportView[]> {
    await this.ai.purgeExpired(auth.membership.organizationId);
    const rows = await this.prisma.aiImport.findMany({
      where: {
        organizationId: auth.membership.organizationId,
        kind,
        establishment: establishmentScope(auth),
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: IMPORT_SELECT,
    });
    // Liste légère : le détail (lignes) se lit sur l'import lui-même.
    return rows.map((r) => ({ ...toView(r), result: null }));
  }

  async get(auth: TenantContext, id: string): Promise<AiImportView> {
    await this.ai.purgeExpired(auth.membership.organizationId);
    const row = await this.find(auth, id);
    this.assertKindPermission(auth, row.kind);
    return row;
  }

  async discard(auth: TenantContext, id: string) {
    const row = await this.find(auth, id);
    this.assertKindPermission(auth, row.kind);
    const updated = await this.prisma.aiImport.updateMany({
      where: { id, status: 'ANALYZED' },
      data: { status: 'DISCARDED' },
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        code: 'AI_IMPORT_CLOSED',
        message: 'Cet import est déjà clos.',
      });
    }
    return this.find(auth, id);
  }

  async publishCatalog(auth: TenantContext, id: string, dto: PublishCatalogDto) {
    const row = await this.openImport(auth, id, 'CATALOG');
    const analysis = row.result as ImportAnalysis<CatalogLine>;
    const previous = row.publication?.created ?? [];
    const lines = this.checkLines(dto.lines, analysis.lines.length, previous);
    const existing = await this.existingProducts(auth.membership.organizationId);
    this.assertNoNameCollision(lines.toCreate, existing, 'PRODUCT_NAME_TAKEN', 'produit');

    return this.publish(auth, row.id, previous, lines.skipped, async (created) => {
      const categories = new Map(
        (await this.catalog.listCategories(auth)).map((c) => [normalizeLabel(c.name), c.id]),
      );
      for (const line of lines.toCreate) {
        const key = normalizeLabel(line.category);
        let categoryId = categories.get(key);
        if (!categoryId) {
          categoryId = (await this.catalog.createCategory(auth, { name: line.category })).id;
          categories.set(key, categoryId);
        }
        const product = await this.catalog.createProduct(auth, {
          name: line.name,
          description: line.description,
          categoryId,
          variants: line.variants.map((v) => ({
            name: v.name,
            prices: [
              {
                establishmentId: row.establishmentId,
                price: v.price,
                isAvailable: line.isAvailable ?? true,
              },
            ],
          })),
        });
        created.push({ index: line.index, id: product.id, name: product.name });
      }
    });
  }

  async publishTickets(auth: TenantContext, id: string, dto: PublishTicketsDto) {
    const row = await this.openImport(auth, id, 'TICKETS');
    const analysis = row.result as ImportAnalysis<TicketLine>;
    const previous = row.publication?.created ?? [];
    const lines = this.checkLines(dto.lines, analysis.lines.length, previous);
    const existing = await this.existingTicketCategories(row.establishmentId);
    this.assertNoNameCollision(lines.toCreate, existing, 'TICKET_CATEGORY_NAME_TAKEN', 'billet');

    return this.publish(auth, row.id, previous, lines.skipped, async (created) => {
      for (const line of lines.toCreate) {
        const category = await this.ticketCategories.create(
          auth,
          {
            establishmentId: row.establishmentId,
            kind: line.kind,
            name: line.name,
            price: line.price,
            peopleIncluded: line.peopleIncluded,
            conditions: line.conditions,
          },
          { inactive: true, source: 'ai_import' },
        );
        created.push({ index: line.index, id: category.id, name: category.name });
      }
    });
  }

  // ─── Interne ───

  private async find(auth: TenantContext, id: string): Promise<AiImportView> {
    const row = await this.prisma.aiImport.findFirst({
      where: {
        id,
        organizationId: auth.membership.organizationId,
        establishment: establishmentScope(auth),
      },
      select: IMPORT_SELECT,
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return toView(row);
  }

  private assertKindPermission(auth: TenantContext, kind: Kind) {
    if (!hasPermission(auth.membership.role, KIND[kind].permission)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: "Vous n'avez pas les droits nécessaires.",
      });
    }
  }

  private async openImport(auth: TenantContext, id: string, kind: Kind) {
    const row = await this.find(auth, id);
    if (row.kind !== kind) throw new NotFoundException(NOT_FOUND);
    if (row.status !== 'ANALYZED') {
      throw new ConflictException({
        code: 'AI_IMPORT_CLOSED',
        message: 'Cet import est déjà publié ou abandonné.',
      });
    }
    if (!row.result) {
      throw new ConflictException({
        code: 'AI_IMPORT_PURGED',
        message:
          'Le résultat de cet import a été effacé (durée de conservation dépassée). Relancez l’analyse.',
      });
    }
    return row;
  }

  /** Lignes à créer : numéros existants, uniques, et non déjà publiés lors d'une tentative précédente. */
  private checkLines<L extends { index: number; action: 'CREATE' | 'SKIP' }>(
    lines: L[],
    available: number,
    previous: Publication['created'],
  ) {
    const seen = new Set<number>();
    for (const line of lines) {
      if (line.index >= available || seen.has(line.index)) {
        throw new BadRequestException({
          code: 'AI_IMPORT_LINE_INVALID',
          message: 'Ligne d’import inconnue ou en double.',
        });
      }
      seen.add(line.index);
    }
    const done = new Set(previous.map((p) => p.index));
    return {
      toCreate: lines.filter((l) => l.action === 'CREATE' && !done.has(l.index)),
      skipped: lines.filter((l) => l.action === 'SKIP').map((l) => l.index),
    };
  }

  /** Jamais d'écrasement : un nom déjà utilisé doit être renommé ou la ligne ignorée. */
  private assertNoNameCollision(
    lines: Array<{ index: number; name: string }>,
    existing: ExistingName[],
    code: string,
    noun: string,
  ) {
    const taken = new Set(existing.map((e) => normalizeLabel(e.name)));
    const batch = new Set<string>();
    const conflicts = lines.filter((l) => {
      const key = normalizeLabel(l.name);
      const clash = taken.has(key) || batch.has(key);
      batch.add(key);
      return clash;
    });
    if (conflicts.length) {
      throw new ConflictException({
        code,
        message: `Un ${noun} porte déjà ce nom : renommez la ligne ou ignorez-la (${conflicts
          .map((c) => c.name)
          .join(', ')}).`,
        lines: conflicts.map((c) => c.index),
      });
    }
  }

  /**
   * Publication : l'import est réservé (ANALYZED → PUBLISHED) avant toute création, ce qui empêche
   * une double publication concurrente. En cas d'échec en cours de route, l'import redevient
   * modifiable et les lignes déjà créées sont mémorisées : une nouvelle tentative ne les recrée pas.
   */
  private async publish(
    auth: TenantContext,
    id: string,
    previous: Publication['created'],
    skipped: number[],
    work: (created: Publication['created']) => Promise<void>,
  ) {
    const claimed = await this.prisma.aiImport.updateMany({
      where: { id, status: 'ANALYZED' },
      data: { status: 'PUBLISHED', publishedById: auth.membership.id, publishedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new ConflictException({
        code: 'AI_IMPORT_CLOSED',
        message: 'Cet import est déjà publié ou abandonné.',
      });
    }
    const created = [...previous];
    try {
      await work(created);
    } catch (error) {
      const publication: Publication = {
        created,
        skipped,
        error: 'Publication interrompue : relancez-la.',
      };
      await this.prisma.aiImport.update({
        where: { id },
        data: {
          status: 'ANALYZED',
          publishedById: null,
          publishedAt: null,
          publication: publication as unknown as Prisma.InputJsonValue,
        },
      });
      throw error;
    }
    const publication: Publication = { created, skipped };
    await this.prisma.$transaction(async (tx) => {
      await tx.aiImport.update({
        where: { id },
        data: { publication: publication as unknown as Prisma.InputJsonValue },
      });
      await this.audit.record(
        {
          organizationId: auth.membership.organizationId,
          actorUserId: auth.user.id,
          action: 'ai.import_published',
          targetType: 'AiImport',
          targetId: id,
          metadata: { created: created.length, skipped: skipped.length },
        },
        tx,
      );
    });
    return this.find(auth, id);
  }

  private existingProducts(organizationId: string): Promise<ExistingName[]> {
    return this.prisma.product.findMany({
      where: { organizationId },
      select: { id: true, name: true },
    });
  }

  private existingTicketCategories(establishmentId: string): Promise<ExistingName[]> {
    return this.prisma.ticketCategory.findMany({
      where: { establishmentId },
      select: { id: true, name: true },
    });
  }
}
