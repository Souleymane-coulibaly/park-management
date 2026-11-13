import { ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@ocall/facture-database';
import { FACTURE_VAT_RATES, stockQuantitiesByVariant, stockTtcToHt } from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import {
  STOCK_CATALOG_READER,
  type StockCatalogEntry,
  type StockCatalogReader,
} from '../../common/integration/catalog-integration';
import type { FactureContext } from './facture-access';
import type { FactureLineDto } from './facture-commercial.dto';
import { FactureDocumentsService } from './facture-documents.service';
import { FacturePrismaService } from './facture-prisma.service';
import { FactureStockService } from './facture-stock.service';

type Tx = Prisma.TransactionClient;

const SEARCH_LIMIT = 20;
/** Référence d'un article Facture (même règle que la saisie). */
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/;
const MAX_VAT = Math.max(...FACTURE_VAT_RATES);

const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new ConflictException({ code, message, ...(details ? { details } : {}) });

const notFound = (code: string, message: string) => new NotFoundException({ code, message });

/** Article Stock tel qu'un article Facture le reprend (prix hors taxe, TVA dans la plage de Facture). */
function mirrorFields(e: StockCatalogEntry) {
  if (e.vatRate > MAX_VAT) {
    throw conflict(
      'FACTURE_STOCK_VAT_UNSUPPORTED',
      `TVA de ${e.vatRate} % : Ocall Facture accepte au plus ${MAX_VAT} %.`,
    );
  }
  return {
    kind: e.isStockable ? ('PRODUCT' as const) : ('SERVICE' as const),
    name: e.label.length >= 2 ? e.label.slice(0, 160) : `${e.label} ${e.sku}`.slice(0, 160),
    description: e.description ? e.description.slice(0, 1000) : null,
    unit: (e.unit || 'unité').slice(0, 24),
    unitPrice: stockTtcToHt(e.salePrice, e.vatRate),
    vatRate: e.vatRate,
  };
}

/**
 * Ocall Facture ↔ Ocall Stock, côté catalogue (S5, cas C) : recherche des articles Stock, articles miroirs,
 * rapprochement d'un article Facture existant (sur décision de l'utilisateur, jamais automatique), facture
 * d'une vente en caisse, avertissement de stock avant l'émission. Lecture seule de Stock, par le contrat
 * commun ; droits vérifiés des deux côtés (Facture ici, Stock dans le lecteur).
 */
@Injectable()
export class FactureStockCatalogService {
  constructor(
    private readonly db: FacturePrismaService,
    private readonly audit: AuditService,
    private readonly documents: FactureDocumentsService,
    private readonly stock: FactureStockService,
    @Optional() @Inject(STOCK_CATALOG_READER) private readonly reader?: StockCatalogReader,
  ) {}

  /** Stock consultable (articles) et Stock modifiable (mouvements) pour l'organisation. */
  async status(ctx: FactureContext) {
    const available = this.reader ? await this.reader.isAvailable(ctx.organizationId) : false;
    return {
      available,
      writable: available && (await this.stock.writable(ctx.organizationId)),
    };
  }

  /**
   * Recherche dans Ocall Stock : prix du jour (TTC et hors taxe), disponibilité à l'emplacement des ventes
   * Facture (si le compte a le droit de la voir), article miroir existant, et article Facture de même
   * référence à rapprocher (proposé, jamais lié d'office).
   */
  async search(ctx: FactureContext, q: string) {
    const reader = await this.availableReader(ctx);
    const entries = await reader.search(ctx.organizationId, q, SEARCH_LIMIT);
    if (entries.length === 0) return [];
    const ids = entries.map((e) => e.variantId);
    const [mirrors, duplicates, availability] = await Promise.all([
      this.db.factureItem.findMany({
        where: { organizationId: ctx.organizationId, stockVariantId: { in: ids } },
        select: { id: true, name: true, stockVariantId: true, isArchived: true },
      }),
      this.db.factureItem.findMany({
        where: {
          organizationId: ctx.organizationId,
          stockVariantId: null,
          OR: entries.map((e) => ({ reference: { equals: e.sku, mode: 'insensitive' as const } })),
        },
        select: { id: true, name: true, reference: true },
      }),
      reader.availability(ctx.organizationId, ctx.userId, ids),
    ]);
    const mirrorOf = new Map(mirrors.map((m) => [m.stockVariantId!, m]));
    return entries.map((e) => {
      const mirror = mirrorOf.get(e.variantId);
      const duplicate = mirror
        ? undefined
        : duplicates.find((d) => d.reference?.toLowerCase() === e.sku.toLowerCase());
      return {
        variantId: e.variantId,
        productId: e.productId,
        sku: e.sku,
        label: e.label,
        unit: e.unit,
        barcode: e.barcode,
        isStockable: e.isStockable,
        salePrice: e.salePrice,
        unitPriceHt: stockTtcToHt(e.salePrice, e.vatRate),
        vatRate: e.vatRate,
        vatSupported: e.vatRate <= MAX_VAT,
        available: e.isStockable ? (availability?.get(e.variantId) ?? null) : null,
        mirror: mirror ? { id: mirror.id, name: mirror.name } : null,
        duplicate: duplicate ? { id: duplicate.id, name: duplicate.name } : null,
      };
    });
  }

  /**
   * Article Stock choisi pour un document : article miroir créé, ou réutilisé (nom, unité, prix et TVA relus
   * dans Stock : le prix du jour vaut pour les nouveaux ajouts, jamais pour les documents émis). Un article
   * Facture de même référence : l'utilisateur choisit de le rapprocher (`linkItemId`) ou de créer un
   * article distinct (`distinct`) ; sans choix, la demande est refusée et le doublon proposé.
   */
  async useItem(
    ctx: FactureContext,
    dto: { variantId: string; linkItemId?: string; distinct?: boolean },
  ) {
    const reader = await this.availableReader(ctx);
    const [entry] = await reader.variants(ctx.organizationId, [dto.variantId]);
    if (!entry || entry.isArchived) {
      throw notFound('FACTURE_STOCK_ITEM_NOT_FOUND', 'Article Ocall Stock introuvable.');
    }
    const result = await this.db.$transaction((tx) =>
      this.ensureMirror(tx, ctx, entry, dto.linkItemId ?? null, dto.distinct ?? false),
    );
    if (result.action !== 'refreshed') {
      await this.audit.record({
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action:
          result.action === 'linked' ? 'facture.item_stock_linked' : 'facture.item_stock_created',
        targetType: 'FactureItem',
        targetId: result.item.id,
        metadata: { stockVariantId: entry.variantId },
      });
    }
    return result.item;
  }

  /**
   * Délier un article miroir : il redevient un article Facture ordinaire (valeurs conservées). Refusé dès
   * qu'une demande de mouvement en dépend (le rapprochement n'est réversible qu'avant tout mouvement).
   */
  async unlink(ctx: FactureContext, itemId: string) {
    const item = await this.db.factureItem.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id: itemId } },
      select: { id: true, stockVariantId: true },
    });
    if (!item) throw notFound('FACTURE_ITEM_NOT_FOUND', 'Article introuvable.');
    if (!item.stockVariantId) {
      throw conflict('FACTURE_ITEM_NOT_LINKED', 'Cet article n’est pas lié à Ocall Stock.');
    }
    const probe = JSON.stringify([{ variantId: item.stockVariantId }]);
    // Demandes de mouvement (transmises ou non) et factures de ventes en caisse qui citent l'article.
    const used = await this.db.$queryRaw<{ found: number }[]>`
      SELECT 1 AS found FROM "FactureStockOutbox"
      WHERE "organizationId" = ${ctx.organizationId}::uuid
        AND ("lines" @> ${probe}::jsonb OR "covered" @> ${probe}::jsonb)
      UNION ALL
      SELECT 1 AS found FROM "FactureDocument"
      WHERE "organizationId" = ${ctx.organizationId}::uuid AND "stockCovered" @> ${probe}::jsonb
      LIMIT 1`;
    if (used.length > 0) {
      throw conflict(
        'FACTURE_STOCK_LINK_IN_USE',
        'Des mouvements de stock dépendent de ce lien : il ne peut plus être défait.',
      );
    }
    const updated = await this.db.factureItem.update({
      where: { organizationId_id: { organizationId: ctx.organizationId, id: itemId } },
      data: { stockVariantId: null, stockProductId: null, stockLinkedAt: null },
    });
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'facture.item_stock_unlinked',
      targetType: 'FactureItem',
      targetId: itemId,
      metadata: { stockVariantId: item.stockVariantId },
    });
    return updated;
  }

  /**
   * Avant l'émission d'une facture : ce qui sortira du stock et ce qui manque à l'emplacement des ventes
   * Facture (avertissement, jamais bloquant : la demande en échec se relance une fois le stock corrigé).
   */
  async preview(ctx: FactureContext, documentId: string) {
    const doc = await this.db.factureDocument.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id: documentId } },
      select: {
        id: true,
        type: true,
        stockCovered: true,
        lines: { select: { itemId: true, quantity: true } },
      },
    });
    if (!doc) throw notFound('FACTURE_DOCUMENT_NOT_FOUND', 'Document introuvable.');
    const status = await this.status(ctx);
    const exit =
      doc.type === 'INVOICE'
        ? await this.stock.invoiceExit(this.db, ctx.organizationId, doc)
        : null;
    if (!exit || !status.available || !this.reader) {
      return { ...status, availabilityKnown: false, lines: [], shortages: 0 };
    }
    const ids = exit.lines.map((l) => l.variantId);
    const [availability, items] = await Promise.all([
      this.reader.availability(ctx.organizationId, ctx.userId, ids),
      this.db.factureItem.findMany({
        where: { organizationId: ctx.organizationId, stockVariantId: { in: ids } },
        select: { stockVariantId: true, name: true },
      }),
    ]);
    const names = new Map(items.map((i) => [i.stockVariantId!, i.name]));
    const lines = exit.lines.map((l) => {
      const available = availability?.get(l.variantId) ?? null;
      return {
        variantId: l.variantId,
        label: names.get(l.variantId) ?? 'Article Ocall Stock',
        quantity: -l.quantity,
        available,
        short: available !== null && available < -l.quantity,
      };
    });
    return {
      ...status,
      availabilityKnown: availability !== null,
      lines,
      shortages: lines.filter((l) => l.short).length,
    };
  }

  /**
   * Facture d'une vente en caisse : brouillon au client choisi, lignes de la vente (quantités nettes des
   * retours, montants réellement encaissés convertis hors taxe), marquées « déjà déstockées » : son émission
   * ne ressort rien de ce que la vente a sorti. Une seule facture par vente (la seconde demande la renvoie).
   */
  async invoiceSale(ctx: FactureContext, dto: { sale: string; clientId: string }) {
    const reader = await this.availableReader(ctx);
    const sale = await reader.sale(ctx.organizationId, ctx.userId, dto.sale);
    if (!sale) {
      throw notFound('FACTURE_STOCK_SALE_NOT_FOUND', 'Vente en caisse introuvable.');
    }
    // Facture déjà créée pour cette vente : vérifié sous verrou, dans la transaction (une seule par vente).
    if (sale.lines.length === 0) {
      throw conflict(
        'FACTURE_STOCK_SALE_EMPTY',
        'Cette vente a été entièrement reprise en caisse.',
      );
    }
    const entries = new Map(
      (
        await reader.variants(
          ctx.organizationId,
          sale.lines.map((l) => l.variantId),
        )
      ).map((e) => [e.variantId, e]),
    );
    const created = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${ctx.organizationId}:facture-sale:${sale.id}`}, 0))`;
      const again = await this.saleInvoice(tx, ctx.organizationId, sale.id);
      if (again) return { id: again, created: false };
      const lines: FactureLineDto[] = [];
      for (const l of sale.lines) {
        const entry: StockCatalogEntry = entries.get(l.variantId) ?? {
          variantId: l.variantId,
          productId: l.productId,
          sku: l.sku,
          label: l.label,
          description: null,
          unit: l.unit,
          salePrice: Math.round(l.total / l.quantity),
          vatRate: l.vatRate,
          barcode: null,
          isStockable: l.isStockable,
          isArchived: true,
        };
        const { item } = await this.ensureMirror(tx, ctx, entry, null, true);
        lines.push({
          itemId: item.id,
          reference: item.reference ?? (REFERENCE.test(l.sku) ? l.sku : null),
          label: l.label.slice(0, 200),
          unit: item.unit,
          quantity: l.quantity,
          unitPrice: stockTtcToHt(Math.round(l.total / l.quantity), l.vatRate),
          discountPercent: 0,
          vatRate: l.vatRate,
        });
      }
      const day = sale.createdAt.toLocaleDateString('fr-FR', { timeZone: 'UTC' });
      const id = await this.documents.createDraft(tx, ctx, {
        type: 'INVOICE',
        clientId: dto.clientId,
        subject: `Vente en caisse ${sale.number}`,
        notes: `Vente en caisse ${sale.number} du ${day}, réglée en caisse.`,
        lines,
      });
      const covered = [...stockQuantitiesByVariant(sale.lines.filter((l) => l.isStockable))].map(
        ([variantId, q]) => ({ variantId, quantity: q / 1000 }),
      );
      await tx.factureDocument.update({
        where: { organizationId_id: { organizationId: ctx.organizationId, id } },
        data: {
          stockSaleId: sale.id,
          stockSaleNumber: sale.number,
          stockCovered: covered as unknown as Prisma.InputJsonValue,
        },
      });
      return { id, created: true };
    });
    if (created.created) {
      await this.documents.record(ctx, 'facture.document_created', created.id, {
        type: 'INVOICE',
        stockSale: sale.number,
      });
    }
    return this.documents.get(ctx, created.id);
  }

  // ─── Outils ───

  private async availableReader(ctx: FactureContext): Promise<StockCatalogReader> {
    if (!this.reader || !(await this.reader.isAvailable(ctx.organizationId))) {
      throw conflict(
        'FACTURE_STOCK_UNAVAILABLE',
        'Ocall Stock n’est pas disponible pour votre organisation.',
      );
    }
    return this.reader;
  }

  private async saleInvoice(db: Tx | FacturePrismaService, organizationId: string, saleId: string) {
    const doc = await db.factureDocument.findUnique({
      where: { organizationId_stockSaleId: { organizationId, stockSaleId: saleId } },
      select: { id: true },
    });
    return doc?.id ?? null;
  }

  /** Miroir d'un article Stock, sous verrou de l'article (deux demandes simultanées : un seul miroir). */
  private async ensureMirror(
    tx: Tx,
    ctx: FactureContext,
    entry: StockCatalogEntry,
    linkItemId: string | null,
    distinct: boolean,
  ) {
    const organizationId = ctx.organizationId;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${organizationId}:facture-mirror:${entry.variantId}`}, 0))`;
    const fields = mirrorFields(entry);
    const link = {
      stockProductId: entry.productId,
      stockVariantId: entry.variantId,
    };
    const mirror = await tx.factureItem.findUnique({
      where: { organizationId_stockVariantId: { organizationId, stockVariantId: entry.variantId } },
    });
    if (mirror) {
      if (linkItemId && linkItemId !== mirror.id) {
        throw conflict(
          'FACTURE_STOCK_ALREADY_LINKED',
          'Cet article Ocall Stock est déjà lié à un autre article Facture.',
        );
      }
      const item = await tx.factureItem.update({
        where: { organizationId_id: { organizationId, id: mirror.id } },
        data: { ...fields, isArchived: entry.isArchived },
      });
      return { item, action: 'refreshed' as const };
    }
    if (linkItemId) {
      const target = await tx.factureItem.findUnique({
        where: { organizationId_id: { organizationId, id: linkItemId } },
        select: { id: true, stockVariantId: true },
      });
      if (!target) throw notFound('FACTURE_ITEM_NOT_FOUND', 'Article introuvable.');
      if (target.stockVariantId) {
        throw conflict(
          'FACTURE_ITEM_ALREADY_LINKED',
          'Cet article Facture est déjà lié à un autre article Ocall Stock.',
        );
      }
      const item = await tx.factureItem.update({
        where: { organizationId_id: { organizationId, id: linkItemId } },
        data: { ...fields, ...link, stockLinkedAt: new Date(), isArchived: entry.isArchived },
      });
      return { item, action: 'linked' as const };
    }
    const sameReference = REFERENCE.test(entry.sku)
      ? await tx.factureItem.findFirst({
          where: { organizationId, reference: { equals: entry.sku, mode: 'insensitive' } },
          select: { id: true, name: true, stockVariantId: true },
        })
      : null;
    if (sameReference && !sameReference.stockVariantId && !distinct) {
      throw conflict(
        'FACTURE_STOCK_DUPLICATE',
        `L’article Facture « ${sameReference.name} » porte déjà la référence ${entry.sku} : rapprochez-le ou créez un article distinct.`,
        { itemId: sameReference.id, name: sameReference.name },
      );
    }
    const item = await tx.factureItem.create({
      data: {
        organizationId,
        ...fields,
        ...link,
        stockLinkedAt: new Date(),
        isArchived: entry.isArchived,
        reference: sameReference || !REFERENCE.test(entry.sku) ? null : entry.sku,
      },
    });
    return { item, action: 'created' as const };
  }
}
