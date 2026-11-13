import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import { type FactureStockSyncStatus, Prisma } from '@ocall/facture-database';
import {
  STOCK_FACTURE_MAX_ATTEMPTS,
  type StockFactureLine,
  stockFactureNetExit,
  stockFactureRetryDelayMs,
  stockFactureReturn,
  stockQuantitiesByVariant,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import {
  STOCK_MOVEMENT_GATEWAY,
  type StockMovementGateway,
  StockMovementError,
} from '../../common/integration/stock-movements';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import type { FactureContext } from './facture-access';
import { FacturePrismaService } from './facture-prisma.service';

type Tx = Prisma.TransactionClient;
type Db = Tx | FacturePrismaService;

const LEASE_MS = 2 * 60_000;
const POLL_MS = 30_000;
const BATCH = 20;
const LIST_LIMIT = 200;

/** Lignes d'un document, réduites à ce qui sert au stock. */
interface StockLineInput {
  itemId: string | null;
  quantity: Prisma.Decimal | number;
}

const asLines = (value: Prisma.JsonValue): StockFactureLine[] =>
  Array.isArray(value) ? (value as unknown as StockFactureLine[]) : [];

/** Quantités (millièmes, positives) d'une liste de lignes signées. */
const absByVariant = (lines: StockFactureLine[]) =>
  stockQuantitiesByVariant(lines.map((l) => ({ ...l, quantity: Math.abs(l.quantity) })));

const merge = (...maps: ReadonlyMap<string, number>[]) => {
  const out = new Map<string, number>();
  for (const m of maps) for (const [k, v] of m) out.set(k, (out.get(k) ?? 0) + v);
  return out;
};

const toLines = (m: ReadonlyMap<string, number>): StockFactureLine[] =>
  [...m]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([variantId, q]) => ({ variantId, quantity: q / 1000 }));

/**
 * Ocall Facture → Ocall Stock : file de sortie des demandes de mouvement (S5).
 *
 * Un seul déclencheur par source, écrit dans la transaction de l'événement : émission d'une facture (ce
 * que sa source — vente en caisse, intervention — n'a pas déjà sorti), signature d'une intervention (pièces
 * posées), émission d'un avoir « marchandise retournée » (plafonné à ce qui est sorti). Un devis, une pro
 * forma, un bon de commande ou un brouillon ne demandent jamais rien. Le répartiteur transmet ensuite la
 * demande à Stock ; la clé la rend sans effet si elle est rejouée.
 */
@Injectable()
export class FactureStockService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: FacturePrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(STOCK_MOVEMENT_GATEWAY) private readonly gateway?: StockMovementGateway,
  ) {}

  onModuleInit() {
    // Les essais déclenchent la transmission explicitement (processDue) : aucun traitement de fond en test.
    if (process.env.NODE_ENV === 'test' || !this.config.facture.enabled || !this.gateway) return;
    this.timer = setInterval(() => this.kick(), POLL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Transmission immédiate (après une émission, une signature, une relance), sans attendre le passage. */
  kick() {
    if (this.running || process.env.NODE_ENV === 'test' || !this.gateway) return;
    this.running = true;
    void this.processDue()
      .catch(() => undefined)
      .finally(() => {
        this.running = false;
      });
  }

  /** Vrai si Stock accepte des mouvements pour l'organisation (lu avant la transaction de l'émission). */
  async writable(organizationId: string): Promise<boolean> {
    if (!this.gateway) return false;
    try {
      return await this.gateway.canWrite(organizationId);
    } catch {
      return false;
    }
  }

  // ─── Déclencheurs (dans la transaction de l'émission ou de la signature) ───

  /**
   * Facture émise : sortie de ses articles Stock, moins ce que sa source a déjà sorti (vente en caisse
   * facturée, pièces de l'intervention facturée). Rien n'est demandé si tout est déjà sorti.
   */
  async onInvoiceIssued(
    tx: Tx,
    ctx: FactureContext,
    doc: { id: string; number: string; lines: StockLineInput[]; stockCovered: Prisma.JsonValue },
    writable: boolean,
  ) {
    const exit = await this.invoiceExit(tx, ctx.organizationId, doc);
    if (!exit) return;
    await this.enqueue(tx, ctx, {
      key: `facture-invoice:${doc.id}`,
      source: 'INVOICE',
      documentId: doc.id,
      reference: doc.number,
      lines: exit.lines,
      covered: exit.covered,
      writable,
    });
  }

  /** Ce qu'une facture doit sortir du stock (null si elle ne porte aucun article Stock). */
  async invoiceExit(
    db: Db,
    organizationId: string,
    doc: { id: string; lines: StockLineInput[]; stockCovered: Prisma.JsonValue },
  ): Promise<{ lines: StockFactureLine[]; covered: StockFactureLine[] } | null> {
    const wanted = await this.wanted(db, organizationId, doc.lines);
    const coveredLines = await this.coveredOf(db, organizationId, doc);
    if (wanted.size === 0 && coveredLines.length === 0) return null;
    return {
      lines: stockFactureNetExit(wanted, absByVariant(coveredLines)),
      covered: coveredLines,
    };
  }

  /**
   * Avoir émis avec « marchandise retournée » : retour en stock de ses articles, jamais plus que ce qui est
   * sorti pour la facture (sa demande, si elle n'a pas été écartée, et sa source), avoirs précédents déduits.
   */
  async onCreditNoteIssued(
    tx: Tx,
    ctx: FactureContext,
    note: {
      id: string;
      number: string;
      creditedInvoiceId: string | null;
      stockReturnGoods: boolean;
      lines: StockLineInput[];
    },
    writable: boolean,
  ) {
    if (!note.stockReturnGoods || !note.creditedInvoiceId) return;
    const credited = await this.wanted(tx, ctx.organizationId, note.lines);
    if (credited.size === 0) return;
    const invoiceRequest = await tx.factureStockOutbox.findUnique({
      where: {
        organizationId_key: {
          organizationId: ctx.organizationId,
          key: `facture-invoice:${note.creditedInvoiceId}`,
        },
      },
      select: { status: true, lines: true, covered: true },
    });
    const out = invoiceRequest
      ? merge(
          absByVariant(asLines(invoiceRequest.covered)),
          invoiceRequest.status === 'SKIPPED'
            ? new Map()
            : absByVariant(asLines(invoiceRequest.lines)),
        )
      : new Map<string, number>();
    const previous = await tx.factureStockOutbox.findMany({
      where: {
        organizationId: ctx.organizationId,
        source: 'CREDIT_NOTE',
        status: { not: 'SKIPPED' },
        document: { creditedInvoiceId: note.creditedInvoiceId },
      },
      select: { lines: true },
    });
    const returned = merge(...previous.map((p) => absByVariant(asLines(p.lines))));
    await this.enqueue(tx, ctx, {
      key: `facture-credit:${note.id}`,
      source: 'CREDIT_NOTE',
      documentId: note.id,
      reference: note.number,
      lines: stockFactureReturn(credited, out, returned),
      covered: [],
      writable,
    });
  }

  /** Intervention signée : sortie des pièces posées (articles Stock seulement). */
  async onInterventionSigned(
    tx: Tx,
    ctx: FactureContext,
    row: { id: string; number: string; parts: StockLineInput[] },
    writable: boolean,
  ) {
    const wanted = await this.wanted(tx, ctx.organizationId, row.parts);
    if (wanted.size === 0) return;
    await this.enqueue(tx, ctx, {
      key: `facture-part:${row.id}`,
      source: 'INTERVENTION',
      interventionId: row.id,
      reference: row.number,
      lines: toLines(wanted).map((l) => ({ ...l, quantity: -l.quantity })),
      covered: [],
      writable,
    });
  }

  // ─── Répartiteur ───

  /**
   * Transmet les demandes dues : réservation sous bail (`SKIP LOCKED`, deux processus ne prennent jamais la
   * même), puis appel de Stock hors transaction. Refus de Stock (stock insuffisant, emplacement non réglé,
   * Stock indisponible) : « en échec », visible du gérant qui corrige puis relance. Incident passager :
   * nouvelle tentative espacée, puis « en échec ». Un résultat perdu (bail expiré) est sans danger : la
   * demande rejouée est reconnue par Stock.
   */
  async processDue(now = new Date(), limit = BATCH) {
    const result = { done: 0, retried: 0, failed: 0 };
    const claimed = await this.db.$transaction(async (tx) => {
      const due = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "FactureStockOutbox"
        WHERE status = 'PENDING'
          AND "nextAttemptAt" <= (${now}::timestamptz AT TIME ZONE 'UTC')
        ORDER BY "nextAttemptAt", id LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
      if (due.length === 0) return [];
      const ids = due.map((r) => r.id);
      await tx.factureStockOutbox.updateMany({
        where: { id: { in: ids } },
        data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
      });
      return tx.factureStockOutbox.findMany({ where: { id: { in: ids } } });
    });
    for (const row of claimed) {
      try {
        if (!this.gateway) {
          throw new StockMovementError('STOCK_UNAVAILABLE', 'Ocall Stock est indisponible.');
        }
        await this.gateway.apply({
          organizationId: row.organizationId,
          key: row.key,
          source: row.source,
          sourceId: (row.documentId ?? row.interventionId)!,
          reference: row.reference,
          actorUserId: row.actorUserId,
          lines: asLines(row.lines),
        });
        await this.db.factureStockOutbox.update({
          where: { id: row.id },
          data: { status: 'DONE', doneAt: new Date(), lastError: null },
        });
        result.done += 1;
      } catch (error) {
        const refused = error instanceof StockMovementError && error.permanent;
        const final = refused || row.attempts >= STOCK_FACTURE_MAX_ATTEMPTS;
        await this.db.factureStockOutbox.update({
          where: { id: row.id },
          data: final
            ? {
                status: 'FAILED',
                lastError: refused ? (error as StockMovementError).code : 'ATTEMPTS_EXHAUSTED',
              }
            : {
                lastError: 'TRANSIENT',
                nextAttemptAt: new Date(now.getTime() + stockFactureRetryDelayMs(row.attempts)),
              },
        });
        if (final) result.failed += 1;
        else result.retried += 1;
      }
    }
    return result;
  }

  // ─── Suivi et relance (gérant) ───

  async list(ctx: FactureContext, status?: FactureStockSyncStatus) {
    const rows = await this.db.factureStockOutbox.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(status ? { status } : {}),
      },
      include: {
        document: { select: { id: true, type: true, number: true } },
        intervention: { select: { id: true, number: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
    });
    const variantIds = [...new Set(rows.flatMap((r) => asLines(r.lines).map((l) => l.variantId)))];
    const names = new Map(
      (
        await this.db.factureItem.findMany({
          where: { organizationId: ctx.organizationId, stockVariantId: { in: variantIds } },
          select: { stockVariantId: true, name: true },
        })
      ).map((i) => [i.stockVariantId!, i.name]),
    );
    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      reference: r.reference,
      status: r.status,
      attempts: r.attempts,
      lastError: r.lastError,
      createdAt: r.createdAt,
      doneAt: r.doneAt,
      document: r.document,
      intervention: r.intervention,
      lines: asLines(r.lines).map((l) => ({
        ...l,
        label: names.get(l.variantId) ?? 'Article Ocall Stock',
      })),
    }));
  }

  /** « Relancer » : une demande en échec repart en file, compteur de tentatives remis à zéro. */
  async retry(ctx: FactureContext, id: string) {
    const { count } = await this.db.factureStockOutbox.updateMany({
      where: { organizationId: ctx.organizationId, id, status: 'FAILED' },
      data: { status: 'PENDING', attempts: 0, lastError: null, nextAttemptAt: new Date() },
    });
    if (count === 0) {
      const exists = await this.db.factureStockOutbox.findFirst({
        where: { organizationId: ctx.organizationId, id },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException({
          code: 'FACTURE_STOCK_SYNC_NOT_FOUND',
          message: 'Demande introuvable.',
        });
      }
      throw new ConflictException({
        code: 'FACTURE_STOCK_SYNC_NOT_FAILED',
        message: 'Seule une demande en échec se relance.',
      });
    }
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'facture.stock_sync_retried',
      targetType: 'FactureStockOutbox',
      targetId: id,
    });
    this.kick();
    return { id, status: 'PENDING' as const };
  }

  // ─── Outils ───

  /** Quantités (millièmes) par article Stock des lignes qui portent un article miroir stocké. */
  private async wanted(db: Db, organizationId: string, lines: StockLineInput[]) {
    const itemIds = [...new Set(lines.map((l) => l.itemId).filter((v): v is string => Boolean(v)))];
    if (itemIds.length === 0) return new Map<string, number>();
    const items = new Map(
      (
        await db.factureItem.findMany({
          // Miroirs d'articles stockés seulement (un service Stock ne sort jamais du stock).
          where: {
            organizationId,
            id: { in: itemIds },
            stockVariantId: { not: null },
            kind: 'PRODUCT',
          },
          select: { id: true, stockVariantId: true },
        })
      ).map((i) => [i.id, i.stockVariantId!]),
    );
    return stockQuantitiesByVariant(
      lines.map((l) => ({
        variantId: l.itemId ? (items.get(l.itemId) ?? null) : null,
        quantity: Number(l.quantity.toString()),
      })),
    );
  }

  /**
   * Déjà sorti du stock par la source d'une facture : la vente en caisse facturée (quantités figées à la
   * création de la facture), ou les pièces de l'intervention facturée (sa demande, si elle n'a pas été
   * écartée faute de Stock).
   */
  private async coveredOf(
    db: Db,
    organizationId: string,
    doc: { id: string; stockCovered: Prisma.JsonValue },
  ): Promise<StockFactureLine[]> {
    if (doc.stockCovered) return asLines(doc.stockCovered);
    const intervention = await db.factureIntervention.findUnique({
      where: { organizationId_invoiceId: { organizationId, invoiceId: doc.id } },
      select: { id: true },
    });
    if (!intervention) return [];
    const parts = await db.factureStockOutbox.findUnique({
      where: { organizationId_key: { organizationId, key: `facture-part:${intervention.id}` } },
      select: { status: true, lines: true },
    });
    if (!parts || parts.status === 'SKIPPED') return [];
    return asLines(parts.lines).map((l) => ({ ...l, quantity: Math.abs(l.quantity) }));
  }

  /**
   * Écrit la demande. Stock indisponible à l'émission : « stock non mis à jour », jamais transmise. Rien à
   * transmettre (déjà sorti par la source) : terminée d'emblée, gardée pour la traçabilité.
   */
  private async enqueue(
    tx: Tx,
    ctx: FactureContext,
    req: {
      key: string;
      source: 'INVOICE' | 'INTERVENTION' | 'CREDIT_NOTE';
      documentId?: string;
      interventionId?: string;
      reference: string;
      lines: StockFactureLine[];
      covered: StockFactureLine[];
      writable: boolean;
    },
  ) {
    const now = new Date();
    const empty = req.lines.length === 0;
    await tx.factureStockOutbox.create({
      data: {
        organizationId: ctx.organizationId,
        key: req.key,
        source: req.source,
        documentId: req.documentId ?? null,
        interventionId: req.interventionId ?? null,
        reference: req.reference,
        lines: req.lines as unknown as Prisma.InputJsonValue,
        covered: req.covered as unknown as Prisma.InputJsonValue,
        status: empty ? 'DONE' : req.writable ? 'PENDING' : 'SKIPPED',
        doneAt: empty ? now : null,
        lastError: !empty && !req.writable ? 'STOCK_UNAVAILABLE' : null,
        nextAttemptAt: now,
        actorUserId: ctx.userId,
      },
    });
  }
}
