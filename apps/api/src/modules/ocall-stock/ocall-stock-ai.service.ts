import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@ocall/stock-database';
import {
  STOCK_AI_DEFAULT_COVER_DAYS,
  STOCK_AI_DEFAULT_LEAD_DAYS,
  STOCK_AI_DEFAULT_LIMITS,
  STOCK_AI_FEATURES,
  STOCK_AI_LONG_WINDOW,
  STOCK_AI_MAX_LINES,
  STOCK_AI_SHORT_WINDOW,
  STOCK_RESTOCK_PRIORITIES,
  type StockAiFeature,
  type StockRestockPriority,
  type StockStockoutRisk,
  factureAiClaimsCertainty,
  formatStockQuantity,
  numbersAreGrounded,
  stockAiPhotoBarcode,
  stockDailyRate,
  stockRestockQuantity,
  stockStockoutEstimate,
} from '@ocall/shared';
import { AiGatewayService } from '../../ai-core/ai-gateway.service';
import type { AiPrompt } from '../../ai-core/ai-prompts';
import { type AiProvider, AiProviderError, type AiResult } from '../../ai-core/ai-provider';
import {
  registerAiSimulation,
  stripSimulationDirectives,
} from '../../ai-core/providers/simulated.provider';
import { AuditService } from '../../common/audit/audit.service';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
  privateKey,
} from '../../common/storage/storage-provider';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { type StockContext, stockCan, stockCanAt, stockSiteAllowed } from './ocall-stock-access';
import { STOCK_AI_SIMULATION } from './ocall-stock-ai-simulation';
import {
  OcallStockAiUsageStore,
  STOCK_AI_FIELDS,
  STOCK_AI_TIMEZONE,
  stockAiMonthStart,
} from './ocall-stock-ai-usage.store';
import {
  STOCK_ANALYSIS_PROMPT,
  STOCK_ILLUSTRATION_PROMPT,
  STOCK_PRODUCT_PHOTO_PROMPT,
  STOCK_RESTOCK_PROMPT,
  STOCK_STOCKOUT_PROMPT,
} from './ocall-stock-ai.prompts';
import type {
  StockAiAnalysisDto,
  StockAiApplyDto,
  StockAiRestockDto,
  StockAiSettingsDto,
  StockAiStockoutDto,
} from './ocall-stock-ai.dto';
import { type StockUpload, normalizeProductImage } from './ocall-stock-media.service';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';
import { OcallStockPurchasesService } from './ocall-stock-purchases.service';
import { OcallStockReportsService } from './ocall-stock-reports.service';

export const STOCK_AI_APPLICATION = 'stock';

/** Sorties qui expriment une demande (ventes, factures, pièces, sorties, transferts), retours déduits. */
const DEMAND_KINDS = [
  'SALE',
  'SALE_RETURN',
  'FACTURE_INVOICE',
  'FACTURE_PART',
  'FACTURE_CREDIT',
  'OUT',
  'TRANSFER_OUT',
];
const DAY = 86_400_000;

const invalid = (out: AiResult<unknown>, message: string): never => {
  throw new AiProviderError('AI_INVALID_OUTPUT', message, out.usage);
};

/** Texte court du modèle : chaîne nettoyée et bornée. */
const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

const list = (value: unknown, max: number, each: number) =>
  (Array.isArray(value) ? value : [])
    .map((v) => text(v, each))
    .filter(Boolean)
    .slice(0, max);

const q3 = (n: number) => Math.round(n * 1000) / 1000;
const fmt = (n: number) => formatStockQuantity(q3(n));

interface DemandRow {
  variantId: string;
  siteId: string;
  long: Prisma.Decimal | null;
  short: Prisma.Decimal | null;
}

/**
 * IA d'Ocall Stock (S8) sur Ocall AI Core : réapprovisionnement, prévision des ruptures, analyse
 * commerciale, fiche article depuis une photo, illustration générée. L'IA propose, une personne décide :
 * tous les chiffres sont calculés ici ; les textes du modèle sont contrôlés (références connues, aucun
 * chiffre absent des données, aucune rupture annoncée comme certaine) puis enregistrés comme proposition
 * tracée. Rien n'est appliqué sans une action explicite, et rien ne touche directement un stock, un prix
 * ou une commande passée. Contexte de chaque appel : la session Stock, jamais le modèle.
 */
@Injectable()
export class OcallStockAiService implements OnModuleInit {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly gateway: AiGatewayService,
    private readonly store: OcallStockAiUsageStore,
    private readonly purchases: OcallStockPurchasesService,
    private readonly reports: OcallStockReportsService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    // Sans base Stock (application désactivée), aucune inscription.
    if (!this.config.stock.enabled) return;
    this.gateway.registerApplication(STOCK_AI_APPLICATION, this.store);
    registerAiSimulation(STOCK_AI_SIMULATION);
  }

  // ─── Réglages et consommation ───

  async settings(ctx: StockContext) {
    const row = await this.db.stockAiSettings.findUnique({
      where: { organizationId: ctx.organizationId },
    });
    const values = {
      enabled: row?.enabled ?? false,
      restockEnabled: row?.restockEnabled ?? true,
      stockoutEnabled: row?.stockoutEnabled ?? true,
      analysisEnabled: row?.analysisEnabled ?? true,
      photoEnabled: row?.photoEnabled ?? true,
      illustrationEnabled: row?.illustrationEnabled ?? true,
      restockMonthlyLimit: row?.restockMonthlyLimit ?? STOCK_AI_DEFAULT_LIMITS.STOCK_RESTOCK,
      stockoutMonthlyLimit: row?.stockoutMonthlyLimit ?? STOCK_AI_DEFAULT_LIMITS.STOCK_STOCKOUT,
      analysisMonthlyLimit: row?.analysisMonthlyLimit ?? STOCK_AI_DEFAULT_LIMITS.STOCK_ANALYSIS,
      photoMonthlyLimit: row?.photoMonthlyLimit ?? STOCK_AI_DEFAULT_LIMITS.STOCK_PRODUCT_PHOTO,
      illustrationMonthlyLimit:
        row?.illustrationMonthlyLimit ?? STOCK_AI_DEFAULT_LIMITS.STOCK_ILLUSTRATION,
    };
    const usage = await this.db.stockAiUsage.groupBy({
      by: ['feature'],
      where: { organizationId: ctx.organizationId, createdAt: { gte: stockAiMonthStart() } },
      _count: { _all: true },
    });
    const used = new Map(usage.map((u) => [u.feature, u._count._all]));
    return {
      ...values,
      configured: this.gateway.configured,
      ceilings: this.config.stock.ai,
      usage: STOCK_AI_FEATURES.map((feature) => {
        const ceiling =
          feature === 'STOCK_ILLUSTRATION'
            ? this.config.stock.ai.imageMonthlyCeiling
            : this.config.stock.ai.monthlyCeiling;
        return {
          feature,
          used: used.get(feature) ?? 0,
          limit: Math.min(values[STOCK_AI_FIELDS[feature].limit], ceiling),
        };
      }),
    };
  }

  async updateSettings(ctx: StockContext, dto: StockAiSettingsDto) {
    await this.db.stockAiSettings.upsert({
      where: { organizationId: ctx.organizationId },
      create: { organizationId: ctx.organizationId, ...dto, updatedByUserId: ctx.userId },
      update: { ...dto, updatedByUserId: ctx.userId },
    });
    await this.record(ctx, 'stock.ai_settings_updated', ctx.organizationId, 'StockAiSettings', {
      enabled: String(dto.enabled),
    });
    return this.settings(ctx);
  }

  // ─── IA 1 : réapprovisionnement ───

  /**
   * Suggestion de commande pour un fournisseur et un site : quantités CALCULÉES par le serveur (sorties
   * réelles sur 90 jours, disponible, déjà commandé, délai fournisseur, couverture, seuil d'alerte) ;
   * l'IA classe et explique. Articles du fournisseur (déjà reçus de lui), sinon tous les articles stockés
   * qui sortent. Aucun article à commander : aucune consommation d'IA.
   */
  async restock(ctx: StockContext, dto: StockAiRestockDto) {
    await this.assertSite(ctx, dto.siteId);
    const supplier = await this.db.stockSupplier.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id: dto.supplierId } },
      select: { id: true, name: true, leadTimeDays: true, isArchived: true },
    });
    if (!supplier || supplier.isArchived) {
      throw new NotFoundException({
        code: 'STOCK_SUPPLIER_NOT_FOUND',
        message: 'Fournisseur introuvable.',
      });
    }
    const leadAssumed = supplier.leadTimeDays === null;
    const lead = supplier.leadTimeDays ?? STOCK_AI_DEFAULT_LEAD_DAYS;
    const cover = dto.coverDays ?? STOCK_AI_DEFAULT_COVER_DAYS;
    const prices = await this.db.$queryRaw<{ variantId: string; unitCost: number }[]>`
      SELECT DISTINCT ON (p."variantId") p."variantId", p."unitCost"
      FROM "StockSupplierPrice" p
      WHERE p."organizationId" = ${ctx.organizationId}::uuid AND p."supplierId" = ${supplier.id}::uuid
      ORDER BY p."variantId", p."createdAt" DESC`;
    const supplierPrice = new Map(prices.map((p) => [p.variantId, p.unitCost]));
    const scope: 'SUPPLIER' | 'ALL' = prices.length > 0 ? 'SUPPLIER' : 'ALL';
    const demand = await this.demand(ctx.organizationId, [dto.siteId]);
    const variants = await this.db.stockVariant.findMany({
      where: {
        organizationId: ctx.organizationId,
        isArchived: false,
        product: { isArchived: false, isStockable: true },
        ...(scope === 'SUPPLIER'
          ? { id: { in: [...supplierPrice.keys()] } }
          : {
              OR: [
                { id: { in: demand.map((d) => d.variantId) } },
                { product: { minStock: { not: null } } },
              ],
            }),
      },
      select: {
        id: true,
        sku: true,
        name: true,
        purchasePrice: true,
        product: {
          select: { name: true, unit: true, vatRate: true, minStock: true, purchasePrice: true },
        },
      },
      take: 2000,
    });
    const ids = variants.map((v) => v.id);
    const [available, incoming] = await Promise.all([
      this.available(ctx.organizationId, [dto.siteId], ids),
      this.incoming(ctx.organizationId, dto.siteId, ids),
    ]);
    const demandOf = new Map(demand.map((d) => [d.variantId, d]));
    const candidates = variants
      .map((v) => {
        const d = demandOf.get(v.id);
        const out90 = Math.max(0, Number(d?.long ?? 0));
        const rate = stockDailyRate(out90, STOCK_AI_LONG_WINDOW);
        const minStock = v.product.minStock === null ? null : Number(v.product.minStock);
        const avail = available.get(v.id) ?? 0;
        const inc = incoming.get(v.id) ?? 0;
        const quantity = stockRestockQuantity({
          dailyRate: rate,
          leadTimeDays: lead,
          coverDays: cover,
          minStock,
          available: avail,
          incoming: inc,
          unit: v.product.unit,
        });
        const daysLeft = rate > 0 ? Math.floor(Math.max(0, avail + inc) / rate) : null;
        return {
          variantId: v.id,
          sku: v.sku,
          label: v.name ? `${v.product.name} — ${v.name}` : v.product.name,
          unit: v.product.unit,
          vatRate: v.product.vatRate,
          unitCost: supplierPrice.get(v.id) ?? v.purchasePrice ?? v.product.purchasePrice ?? 0,
          costKnown:
            supplierPrice.has(v.id) || (v.purchasePrice ?? v.product.purchasePrice) !== null,
          out90: q3(out90),
          available: q3(avail),
          incoming: q3(inc),
          minStock,
          quantity,
          daysLeft,
        };
      })
      .filter((c) => c.quantity > 0)
      .sort((a, b) => (a.daysLeft ?? -1) - (b.daysLeft ?? -1) || a.label.localeCompare(b.label))
      .slice(0, STOCK_AI_MAX_LINES);
    if (candidates.length === 0) {
      return { proposal: null, lines: [], supplier, leadTimeDays: lead, leadAssumed, scope };
    }
    const refs = new Map(candidates.map((c, i) => [`r${i + 1}`, c]));
    const facts = [...refs]
      .map(([ref, c]) =>
        [
          `${ref} | ${c.label} (${c.sku})`,
          `sorties sur ${STOCK_AI_LONG_WINDOW} jours : ${fmt(c.out90)} ${c.unit}`,
          `disponible : ${fmt(c.available)}`,
          `déjà commandé : ${fmt(c.incoming)}`,
          `seuil d’alerte : ${c.minStock === null ? 'aucun' : fmt(c.minStock)}`,
          `couverture actuelle : ${c.daysLeft === null ? 'aucune sortie' : `${c.daysLeft} jours`}`,
          `quantité suggérée : ${fmt(c.quantity)} ${c.unit}`,
        ].join(' | '),
      )
      .join('\n');
    const header = `Fournisseur : ${supplier.name} | délai : ${lead} jours${leadAssumed ? ' (supposé)' : ''} | couverture visée : ${cover} jours`;
    const data = `${header}\n${facts}`;
    const out = await this.run(
      ctx,
      'STOCK_RESTOCK',
      STOCK_RESTOCK_PROMPT,
      async (provider, model) => {
        const res = await provider.structureText<Record<string, unknown>>({
          model,
          instructions: STOCK_RESTOCK_PROMPT.instructions,
          text: `ARTICLES À COMMANDER (calculs du serveur) :\n${data}`,
          schemaName: 'stock_ai_restock',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['summary', 'lines'],
            properties: {
              summary: { type: 'string' },
              lines: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['ref', 'priority', 'reason'],
                  properties: {
                    ref: { type: 'string' },
                    priority: { type: 'string', enum: [...STOCK_RESTOCK_PRIORITIES] },
                    reason: { type: 'string' },
                  },
                },
              },
            },
          },
        });
        if (!Array.isArray(res.value?.lines)) invalid(res, 'Suggestion illisible. Réessayez.');
        const summary = text(res.value.summary, 400);
        const notes = new Map<string, { priority: StockRestockPriority; reason: string }>();
        for (const raw of res.value.lines as unknown[]) {
          const l = raw as { ref?: unknown; priority?: unknown; reason?: unknown };
          const ref = typeof l.ref === 'string' ? l.ref.trim() : '';
          if (!refs.has(ref) || notes.has(ref)) continue;
          const priority = STOCK_RESTOCK_PRIORITIES.includes(l.priority as StockRestockPriority)
            ? (l.priority as StockRestockPriority)
            : 'MEDIUM';
          notes.set(ref, { priority, reason: text(l.reason, 300) });
        }
        this.grounded(res, [summary, ...[...notes.values()].map((n) => n.reason)], data);
        return { value: { summary, notes }, usage: res.usage };
      },
    );
    const lines = [...refs].map(([ref, c]) => {
      const note = out.notes.get(ref);
      return {
        ...c,
        // Classement de l'IA ; à défaut, celui du serveur (couverture la plus courte d'abord).
        priority:
          note?.priority ??
          (c.daysLeft !== null && c.daysLeft <= lead ? ('HIGH' as const) : ('MEDIUM' as const)),
        reason: note?.reason ?? '',
      };
    });
    const proposal = await this.propose(ctx, 'STOCK_RESTOCK', STOCK_RESTOCK_PROMPT, {
      targetType: 'SITE',
      targetId: dto.siteId,
      input: {
        supplierId: supplier.id,
        siteId: dto.siteId,
        leadTimeDays: lead,
        coverDays: cover,
        scope,
        sites: [dto.siteId],
      },
      output: { summary: out.summary, lines, leadAssumed, supplierName: supplier.name },
    });
    return {
      proposal,
      lines: this.costs(ctx, lines),
      summary: out.summary,
      supplier,
      leadTimeDays: lead,
      leadAssumed,
      scope,
    };
  }

  // ─── IA 2 : prévision des ruptures ───

  /**
   * Articles à risque de rupture : fourchette prudente de jours avant épuisement (rythmes sur 30 et 90
   * jours), risque selon le délai du dernier fournisseur connu. L'IA explique les facteurs ; aucune date,
   * aucune garantie. Aucun article à risque : aucune consommation d'IA.
   */
  async stockouts(ctx: StockContext, dto: StockAiStockoutDto) {
    const sites = dto.siteId ? [dto.siteId] : ctx.siteIds;
    if (dto.siteId) await this.assertSite(ctx, dto.siteId);
    const demand = await this.demand(ctx.organizationId, sites);
    if (demand.length === 0) return { proposal: null, items: [] };
    const ids = [...new Set(demand.map((d) => d.variantId))];
    const [variants, levels, leads, siteNames] = await Promise.all([
      this.db.stockVariant.findMany({
        where: {
          organizationId: ctx.organizationId,
          id: { in: ids },
          isArchived: false,
          product: { isArchived: false, isStockable: true },
        },
        select: {
          id: true,
          sku: true,
          name: true,
          product: { select: { name: true, unit: true } },
        },
      }),
      this.availableBySite(ctx.organizationId, sites, ids),
      this.leadTimes(ctx.organizationId, ids),
      this.db.stockSite.findMany({
        where: { organizationId: ctx.organizationId },
        select: { id: true, name: true },
      }),
    ]);
    const byId = new Map(variants.map((v) => [v.id, v]));
    const siteName = new Map(siteNames.map((s) => [s.id, s.name]));
    const items = demand
      .filter((d) => byId.has(d.variantId))
      .map((d) => {
        const v = byId.get(d.variantId)!;
        const lead = leads.get(d.variantId) ?? STOCK_AI_DEFAULT_LEAD_DAYS;
        const avail = levels.get(`${d.siteId}:${d.variantId}`) ?? 0;
        const shortRate = stockDailyRate(Math.max(0, Number(d.short ?? 0)), STOCK_AI_SHORT_WINDOW);
        const longRate = stockDailyRate(Math.max(0, Number(d.long ?? 0)), STOCK_AI_LONG_WINDOW);
        const estimate = stockStockoutEstimate({
          available: avail,
          shortRate,
          longRate,
          leadTimeDays: lead,
        });
        return {
          variantId: v.id,
          siteId: d.siteId,
          siteName: siteName.get(d.siteId) ?? '',
          sku: v.sku,
          label: v.name ? `${v.product.name} — ${v.name}` : v.product.name,
          unit: v.product.unit,
          available: q3(avail),
          out30: q3(Math.max(0, Number(d.short ?? 0))),
          out90: q3(Math.max(0, Number(d.long ?? 0))),
          leadTimeDays: lead,
          leadAssumed: !leads.has(d.variantId),
          daysMin: estimate?.daysMin ?? null,
          daysMax: estimate?.daysMax ?? null,
          risk: (estimate?.risk ?? null) as StockStockoutRisk | null,
        };
      })
      .filter((i) => i.risk !== null)
      .sort((a, b) => (a.daysMin ?? 0) - (b.daysMin ?? 0) || a.label.localeCompare(b.label))
      .slice(0, STOCK_AI_MAX_LINES);
    if (items.length === 0) return { proposal: null, items: [] };
    const refs = new Map(items.map((it, i) => [`s${i + 1}`, it]));
    const data = [...refs]
      .map(([ref, it]) =>
        [
          `${ref} | ${it.label} (${it.sku}) | site : ${it.siteName}`,
          `disponible : ${fmt(it.available)} ${it.unit}`,
          `sorties sur ${STOCK_AI_SHORT_WINDOW} jours : ${fmt(it.out30)}`,
          `sorties sur ${STOCK_AI_LONG_WINDOW} jours : ${fmt(it.out90)}`,
          `délai fournisseur : ${it.leadTimeDays} jours${it.leadAssumed ? ' (supposé)' : ''}`,
          `épuisement estimé : entre ${it.daysMin} et ${it.daysMax} jours`,
        ].join(' | '),
      )
      .join('\n');
    const out = await this.run(
      ctx,
      'STOCK_STOCKOUT',
      STOCK_STOCKOUT_PROMPT,
      async (provider, model) => {
        const res = await provider.structureText<Record<string, unknown>>({
          model,
          instructions: STOCK_STOCKOUT_PROMPT.instructions,
          text: `ARTICLES À RISQUE (calculs du serveur) :\n${data}`,
          schemaName: 'stock_ai_stockout',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['summary', 'items'],
            properties: {
              summary: { type: 'string' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['ref', 'explanation'],
                  properties: { ref: { type: 'string' }, explanation: { type: 'string' } },
                },
              },
            },
          },
        });
        if (!Array.isArray(res.value?.items)) invalid(res, 'Prévision illisible. Réessayez.');
        const summary = text(res.value.summary, 400);
        const notes = new Map<string, string>();
        for (const raw of res.value.items as unknown[]) {
          const it = raw as { ref?: unknown; explanation?: unknown };
          const ref = typeof it.ref === 'string' ? it.ref.trim() : '';
          if (refs.has(ref) && !notes.has(ref)) notes.set(ref, text(it.explanation, 500));
        }
        const said = [summary, ...notes.values()];
        if (said.some((s) => factureAiClaimsCertainty(s))) {
          invalid(res, 'Une explication annonçait une rupture comme certaine : refusée.');
        }
        this.grounded(res, said, data);
        return { value: { summary, notes }, usage: res.usage };
      },
    );
    const explained = [...refs].map(([ref, it]) => ({
      ...it,
      explanation: out.notes.get(ref) ?? '',
    }));
    const proposal = await this.propose(ctx, 'STOCK_STOCKOUT', STOCK_STOCKOUT_PROMPT, {
      targetType: dto.siteId ? 'SITE' : 'ORGANIZATION',
      targetId: dto.siteId ?? null,
      input: { siteId: dto.siteId ?? null, sites: this.sites(ctx, dto.siteId) },
      output: { summary: out.summary, items: explained },
    });
    return { proposal, items: explained, summary: out.summary };
  }

  // ─── IA 3 : analyse commerciale ───

  /**
   * Synthèse des ventes d'une période et de la précédente, à partir des indicateurs du tableau de bord
   * (mêmes droits : marges seulement pour qui voit les prix d'achat). L'IA rédige ; elle ne cite que les
   * chiffres fournis.
   */
  async analysis(ctx: StockContext, dto: StockAiAnalysisDto) {
    if (!stockCan(ctx, 'stock.sales.read')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'L’analyse commerciale exige le droit de consulter les ventes.',
      });
    }
    const current = await this.reports.dashboard(ctx, dto);
    const from = new Date(`${current.period.from}T00:00:00Z`);
    const to = new Date(`${current.period.to}T00:00:00Z`);
    const days = Math.round((to.getTime() - from.getTime()) / DAY) + 1;
    const previous = await this.reports.dashboard(ctx, {
      from: new Date(from.getTime() - days * DAY).toISOString().slice(0, 10),
      to: new Date(from.getTime() - DAY).toISOString().slice(0, 10),
      siteId: dto.siteId,
    });
    const s = current.sales!;
    const p = previous.sales!;
    if (s.count === 0 && p.count === 0) {
      throw new ConflictException({
        code: 'STOCK_AI_ANALYSIS_EMPTY',
        message: 'Aucune vente sur ces périodes : rien à analyser.',
      });
    }
    const lines = [
      `Période : du ${current.period.from} au ${current.period.to} (${days} jours)`,
      `Chiffre d’affaires net : ${s.netRevenue} FCFA ; période précédente : ${p.netRevenue} FCFA`,
      `Ventes : ${s.count} ; période précédente : ${p.count}`,
      `Panier moyen : ${s.averageBasket} FCFA ; période précédente : ${p.averageBasket} FCFA`,
      `Remboursements : ${s.refunds} FCFA`,
      `Articles les plus vendus : ${s.top.map((t) => `${t.label} (${fmt(t.quantity)} vendus, ${t.revenue} FCFA)`).join(' ; ') || 'aucun'}`,
    ];
    if (s.margins) {
      lines.push(
        `Marge brute : ${s.margins.gross ?? 'non calculable'}${s.margins.grossRate !== null ? ` FCFA (${s.margins.grossRate} %)` : ''}`,
      );
    }
    if (current.alerts) {
      lines.push(
        `Alertes : ${current.alerts.outOfStock} ruptures, ${current.alerts.low} sous le seuil, ${current.alerts.slowMoving} à faible rotation`,
      );
    }
    const data = lines.join('\n');
    const out = await this.run(
      ctx,
      'STOCK_ANALYSIS',
      STOCK_ANALYSIS_PROMPT,
      async (provider, model) => {
        const res = await provider.structureText<Record<string, unknown>>({
          model,
          instructions: STOCK_ANALYSIS_PROMPT.instructions,
          text: `INDICATEURS (calculs du serveur) :\n${data}`,
          schemaName: 'stock_ai_analysis',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['summary', 'trends', 'strengths', 'weaknesses', 'suggestions'],
            properties: {
              summary: { type: 'string' },
              trends: { type: 'array', items: { type: 'string' } },
              strengths: { type: 'array', items: { type: 'string' } },
              weaknesses: { type: 'array', items: { type: 'string' } },
              suggestions: { type: 'array', items: { type: 'string' } },
            },
          },
        });
        const value = {
          summary: text(res.value?.summary, 600),
          trends: list(res.value?.trends, 3, 300),
          strengths: list(res.value?.strengths, 3, 300),
          weaknesses: list(res.value?.weaknesses, 3, 300),
          suggestions: list(res.value?.suggestions, 3, 300),
        };
        if (!value.summary) invalid(res, 'Analyse illisible. Réessayez.');
        this.grounded(
          res,
          [
            value.summary,
            ...value.trends,
            ...value.strengths,
            ...value.weaknesses,
            ...value.suggestions,
          ],
          data,
        );
        return { value, usage: res.usage };
      },
    );
    const proposal = await this.propose(ctx, 'STOCK_ANALYSIS', STOCK_ANALYSIS_PROMPT, {
      targetType: 'ORGANIZATION',
      targetId: dto.siteId ?? null,
      input: {
        period: current.period,
        siteId: dto.siteId ?? null,
        sites: this.sites(ctx, dto.siteId),
        withCosts: Boolean(s.margins),
      },
      output: { ...out, period: current.period },
    });
    return { proposal, ...out, period: current.period, facts: lines };
  }

  // ─── IA du catalogue : fiche depuis une photo ───

  /**
   * Lecture de la photo d'un emballage : nom, marque, contenance, catégorie (parmi celles de
   * l'organisation) et code-barres seulement si sa clé GTIN est juste (« lu sur la photo, à vérifier »).
   * Le commerçant vérifie et enregistre lui-même l'article.
   */
  async productPhoto(ctx: StockContext, file: StockUpload | undefined) {
    const jpeg = await normalizeProductImage(file);
    const categories = await this.db.stockCategory.findMany({
      where: { organizationId: ctx.organizationId, isArchived: false },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
      take: 200,
    });
    const refs = new Map(categories.map((c, i) => [`c${i + 1}`, c]));
    const catalog = [...refs].map(([ref, c]) => `${ref} | ${c.name}`).join('\n') || 'aucune';
    const out = await this.run(
      ctx,
      'STOCK_PRODUCT_PHOTO',
      STOCK_PRODUCT_PHOTO_PROMPT,
      async (provider, model) => {
        const res = await provider.extractFromDocument<Record<string, unknown>>({
          model,
          instructions: STOCK_PRODUCT_PHOTO_PROMPT.instructions,
          prompt: `CATÉGORIES DE L’ENTREPRISE :\n${catalog}`,
          document: { mimeType: 'image/jpeg', data: jpeg, fileName: 'article.jpg' },
          schemaName: 'stock_ai_product_photo',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['readable', 'name', 'brand', 'size', 'categoryRef', 'barcode'],
            properties: {
              readable: { type: 'boolean' },
              name: { type: 'string' },
              brand: { type: 'string' },
              size: { type: 'string' },
              categoryRef: { type: 'string' },
              barcode: { type: 'string' },
            },
          },
        });
        return { value: res.value ?? {}, usage: res.usage };
      },
    );
    const readable = out.readable === true && Boolean(text(out.name, 120));
    const rawBarcode = text(out.barcode, 32);
    const barcode = rawBarcode ? stockAiPhotoBarcode(rawBarcode) : null;
    const category = refs.get(text(out.categoryRef, 10)) ?? null;
    const existing = barcode
      ? await this.db.stockBarcode.findFirst({
          where: { organizationId: ctx.organizationId, code: barcode },
          select: { variant: { select: { product: { select: { id: true, name: true } } } } },
        })
      : null;
    const fields = {
      readable,
      name: readable ? text(out.name, 120) : '',
      brand: readable ? text(out.brand, 60) : '',
      size: readable ? text(out.size, 40) : '',
      category,
      barcode,
      /** Un code lu mais dont la clé est fausse est écarté, jamais corrigé. */
      barcodeRejected: Boolean(rawBarcode) && barcode === null,
      existingProduct: existing?.variant.product ?? null,
    };
    const proposal = await this.propose(ctx, 'STOCK_PRODUCT_PHOTO', STOCK_PRODUCT_PHOTO_PROMPT, {
      targetType: 'PRODUCT',
      targetId: null,
      input: { bytes: jpeg.length },
      output: fields,
    });
    return { proposal, ...fields };
  }

  // ─── IA du catalogue : illustration générée ───

  /**
   * Illustration d'un article SANS photo : image générée à partir de sa description (serveur), gardée en
   * attente ; jamais ajoutée à l'article sans décision, toujours marquée « Illustration générée par IA »,
   * visible sur la vitrine seulement si le commerçant le décide.
   */
  async illustration(ctx: StockContext, productId: string) {
    const product = await this.db.stockProduct.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id: productId } },
      select: {
        id: true,
        name: true,
        description: true,
        isArchived: true,
        category: { select: { name: true } },
        _count: { select: { images: true } },
      },
    });
    if (!product || product.isArchived) {
      throw new NotFoundException({
        code: 'STOCK_PRODUCT_NOT_FOUND',
        message: 'Article introuvable.',
      });
    }
    if (product._count.images > 0) {
      throw new ConflictException({
        code: 'STOCK_AI_ILLUSTRATION_HAS_PHOTO',
        message:
          'Cet article a déjà une photo : l’illustration IA est réservée aux articles sans photo.',
      });
    }
    const description = [
      product.name,
      product.category ? `catégorie : ${product.category.name}` : null,
      product.description ? product.description.slice(0, 300) : null,
    ]
      .filter(Boolean)
      .join(' ; ');
    const model = this.gateway.imageModel();
    const generated = await this.gateway.run(
      this.context(ctx, 'STOCK_ILLUSTRATION'),
      { model, prompt: STOCK_ILLUSTRATION_PROMPT },
      (provider) =>
        provider.generateImage({
          model,
          prompt: `${STOCK_ILLUSTRATION_PROMPT.instructions} ${description}`,
          size: '1024x1024',
        }),
    );
    const jpeg = await normalizeProductImage({
      buffer: generated.image,
      mimetype: generated.mimeType,
      size: generated.image.length,
    });
    const key = privateKey(ctx.organizationId, null, randomUUID(), 'jpg');
    await this.storage.put(key, jpeg, 'image/jpeg');
    try {
      const proposal = await this.propose(ctx, 'STOCK_ILLUSTRATION', STOCK_ILLUSTRATION_PROMPT, {
        targetType: 'PRODUCT',
        targetId: product.id,
        input: { description },
        output: { storageKey: key, bytes: jpeg.length },
        model,
      });
      return { proposal };
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
  }

  /** Aperçu d'une illustration en attente (ou appliquée). */
  async proposalImage(ctx: StockContext, proposalId: string): Promise<Buffer> {
    const proposal = await this.find(ctx, proposalId);
    const key = (proposal.output as { storageKey?: string }).storageKey;
    const body =
      proposal.feature === 'STOCK_ILLUSTRATION' && proposal.status !== 'REJECTED' && key
        ? await this.storage.get(key)
        : null;
    if (!body) {
      throw new NotFoundException({
        code: 'STOCK_AI_IMAGE_NOT_FOUND',
        message: 'Image introuvable.',
      });
    }
    return body;
  }

  // ─── Propositions : liste, application, refus ───

  async proposals(ctx: StockContext, feature?: StockAiFeature) {
    const rows = await this.db.stockAiProposal.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(feature ? { feature } : {}),
        // Images : seulement pour qui gère l'IA du catalogue ; assistants : pour qui les utilise.
        ...(stockCan(ctx, 'stock.ai.use') && stockCan(ctx, 'stock.ai.images')
          ? {}
          : stockCan(ctx, 'stock.ai.use')
            ? { feature: { in: ['STOCK_RESTOCK', 'STOCK_STOCKOUT', 'STOCK_ANALYSIS'] } }
            : { feature: { in: ['STOCK_PRODUCT_PHOTO', 'STOCK_ILLUSTRATION'] } }),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows
      .filter((r) => this.visible(ctx, r))
      .slice(0, 50)
      .map((r) => this.view(r, ctx));
  }

  /**
   * Décision humaine : réapprovisionnement → commande fournisseur BROUILLON (lignes retenues, quantités
   * éventuellement corrigées ; jamais passée automatiquement) ; photo → lien avec l'article créé ;
   * illustration → photo de l'article, marquée IA, visible sur la vitrine selon le choix.
   */
  async apply(ctx: StockContext, proposalId: string, dto: StockAiApplyDto) {
    const proposal = await this.find(ctx, proposalId);
    this.assertFeatureRight(ctx, proposal.feature as StockAiFeature);
    if (proposal.status !== 'PROPOSED') throw this.decided();
    // Vérifications d'abord ; l'action (commande, photo) ne s'exécute qu'après la réservation.
    let act: () => Promise<string>;
    let edited = false;
    if (proposal.feature === 'STOCK_RESTOCK') {
      const input = proposal.input as { supplierId: string; siteId: string };
      // Sur le site livré : le rôle du membre sur ce site doit gérer les achats (rôle par site).
      if (!stockCanAt(ctx, 'stock.purchases.manage', input.siteId)) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Créer une commande fournisseur exige le droit de gérer les achats.',
        });
      }
      const proposed = (
        proposal.output as {
          lines: { variantId: string; quantity: number; unitCost: number; vatRate: number }[];
        }
      ).lines;
      const byVariant = new Map(proposed.map((l) => [l.variantId, l]));
      const chosen =
        dto.lines ?? proposed.map((l) => ({ variantId: l.variantId, quantity: l.quantity }));
      if (chosen.length === 0 || new Set(chosen.map((l) => l.variantId)).size !== chosen.length) {
        throw new BadRequestException({
          code: 'STOCK_AI_RESTOCK_LINES',
          message: 'Retenez au moins un article, une seule fois chacun.',
        });
      }
      if (chosen.some((l) => !byVariant.has(l.variantId))) {
        throw new BadRequestException({
          code: 'STOCK_AI_RESTOCK_LINES',
          message: 'Seuls les articles de la suggestion peuvent être commandés ici.',
        });
      }
      edited =
        chosen.length !== proposed.length ||
        chosen.some((l) => q3(l.quantity) !== q3(byVariant.get(l.variantId)!.quantity));
      act = async () => {
        const order = await this.purchases.create(ctx, {
          supplierId: input.supplierId,
          siteId: input.siteId,
          note: 'Brouillon préparé avec l’assistant de réapprovisionnement (IA), à vérifier.',
          lines: chosen.map((l) => ({
            variantId: l.variantId,
            quantity: q3(l.quantity),
            unitCost: byVariant.get(l.variantId)!.unitCost,
            vatRate: byVariant.get(l.variantId)!.vatRate,
          })),
        });
        return order.id;
      };
    } else if (proposal.feature === 'STOCK_PRODUCT_PHOTO') {
      if (!dto.productId) {
        throw new BadRequestException({
          code: 'STOCK_AI_PRODUCT_REQUIRED',
          message: 'Indiquez l’article créé à partir de la photo.',
        });
      }
      const product = await this.db.stockProduct.findUnique({
        where: { organizationId_id: { organizationId: ctx.organizationId, id: dto.productId } },
        select: { id: true, name: true },
      });
      if (!product) {
        throw new NotFoundException({
          code: 'STOCK_PRODUCT_NOT_FOUND',
          message: 'Article introuvable.',
        });
      }
      edited = product.name !== (proposal.output as { name?: string }).name;
      act = async () => product.id;
    } else if (proposal.feature === 'STOCK_ILLUSTRATION') {
      act = () => this.applyIllustration(ctx, proposal, dto.showcase === true);
    } else {
      throw new ConflictException({
        code: 'STOCK_AI_NOT_APPLICABLE',
        message: 'Cette proposition se consulte seulement : rien à appliquer.',
      });
    }
    // Réservation atomique (PROPOSED → APPLIED) : deux validations simultanées, ou une validation et un
    // refus, ne produisent jamais deux commandes ni une photo dont le fichier a été supprimé.
    const where = { organizationId: ctx.organizationId, id: proposalId };
    const { count } = await this.db.stockAiProposal.updateMany({
      where: { ...where, status: 'PROPOSED' },
      data: { status: 'APPLIED', decidedByUserId: ctx.userId, decidedAt: new Date(), edited },
    });
    if (count === 0) throw this.decided();
    let resultId: string;
    try {
      resultId = await act();
    } catch (error) {
      // Échec de l'action : la proposition redevient décidable.
      await this.db.stockAiProposal.updateMany({
        where: { ...where, status: 'APPLIED', resultId: null },
        data: { status: 'PROPOSED', decidedByUserId: null, decidedAt: null, edited: false },
      });
      throw error;
    }
    await this.db.stockAiProposal.updateMany({ where, data: { resultId } });
    await this.record(ctx, 'stock.ai_proposal_applied', proposalId, 'StockAiProposal', {
      feature: proposal.feature,
      resultId,
    });
    return this.view(await this.find(ctx, proposalId), ctx);
  }

  async reject(ctx: StockContext, proposalId: string) {
    const proposal = await this.find(ctx, proposalId);
    this.assertFeatureRight(ctx, proposal.feature as StockAiFeature);
    const { count } = await this.db.stockAiProposal.updateMany({
      where: { organizationId: ctx.organizationId, id: proposalId, status: 'PROPOSED' },
      data: { status: 'REJECTED', decidedByUserId: ctx.userId, decidedAt: new Date() },
    });
    if (count === 0) throw this.decided();
    const key = (proposal.output as { storageKey?: string }).storageKey;
    if (proposal.feature === 'STOCK_ILLUSTRATION' && key) {
      await this.storage.delete(key).catch(() => undefined);
    }
    await this.record(ctx, 'stock.ai_proposal_rejected', proposalId, 'StockAiProposal', {
      feature: proposal.feature,
    });
    return this.view(await this.find(ctx, proposalId), ctx);
  }

  // ─── Outils ───

  /** Illustration acceptée : photo de l'article (4 au plus), marquée IA, vitrine selon le choix. */
  private async applyIllustration(
    ctx: StockContext,
    proposal: { targetId: string | null; output: Prisma.JsonValue },
    showcase: boolean,
  ): Promise<string> {
    const key = (proposal.output as { storageKey?: string; bytes?: number }).storageKey;
    const bytes = (proposal.output as { bytes?: number }).bytes ?? 0;
    if (!key || !proposal.targetId) throw this.decided();
    return this.db.$transaction(async (tx) => {
      const [product] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "StockProduct"
        WHERE id = ${proposal.targetId}::uuid AND "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`;
      if (!product) {
        throw new NotFoundException({
          code: 'STOCK_PRODUCT_NOT_FOUND',
          message: 'Article introuvable.',
        });
      }
      const used = await tx.stockProductImage.findMany({
        where: { organizationId: ctx.organizationId, productId: product.id },
        select: { position: true },
      });
      const free = [0, 1, 2, 3].find((p) => !used.some((u) => u.position === p));
      if (free === undefined) {
        throw new ConflictException({
          code: 'STOCK_IMAGES_LIMIT',
          message: '4 photos au plus par article : retirez-en une d’abord.',
        });
      }
      const image = await tx.stockProductImage.create({
        data: {
          organizationId: ctx.organizationId,
          productId: product.id,
          storageKey: key,
          position: free,
          bytes,
          aiGenerated: true,
          showcaseApproved: showcase,
          createdByUserId: ctx.userId,
        },
        select: { id: true },
      });
      return image.id;
    });
  }

  /** Sorties nettes (retours déduits) par article et par site, sur 90 et 30 jours. */
  private demand(organizationId: string, sites: string[] | null): Promise<DemandRow[]> {
    const since = new Date(Date.now() - STOCK_AI_LONG_WINDOW * DAY);
    const recent = new Date(Date.now() - STOCK_AI_SHORT_WINDOW * DAY);
    return this.db.$queryRaw<DemandRow[]>`
      SELECT m."variantId", m."siteId",
             -sum(m."quantity") AS long,
             -sum(CASE WHEN m."createdAt" >= ${recent} THEN m."quantity" ELSE 0 END) AS short
      FROM "StockMovement" m
      WHERE m."organizationId" = ${organizationId}::uuid AND m."createdAt" >= ${since}
        AND m."kind"::text = ANY(${DEMAND_KINDS}::text[])
        ${sites === null ? Prisma.empty : Prisma.sql`AND m."siteId" = ANY(${sites}::uuid[])`}
      GROUP BY m."variantId", m."siteId"
      HAVING -sum(m."quantity") > 0`;
  }

  private async available(organizationId: string, sites: string[], ids: string[]) {
    const out = new Map<string, number>();
    if (ids.length === 0) return out;
    const rows = await this.db.$queryRaw<{ variantId: string; available: Prisma.Decimal }[]>`
      SELECT l."variantId", sum(l."onHand" - l."reserved") AS available
      FROM "StockLevel" l
      WHERE l."organizationId" = ${organizationId}::uuid AND l."siteId" = ANY(${sites}::uuid[])
        AND l."variantId" = ANY(${ids}::uuid[])
      GROUP BY l."variantId"`;
    for (const r of rows) out.set(r.variantId, Number(r.available));
    return out;
  }

  private async availableBySite(organizationId: string, sites: string[] | null, ids: string[]) {
    const rows = await this.db.$queryRaw<
      { variantId: string; siteId: string; available: Prisma.Decimal }[]
    >`
      SELECT l."variantId", l."siteId", sum(l."onHand" - l."reserved") AS available
      FROM "StockLevel" l
      WHERE l."organizationId" = ${organizationId}::uuid AND l."variantId" = ANY(${ids}::uuid[])
        ${sites === null ? Prisma.empty : Prisma.sql`AND l."siteId" = ANY(${sites}::uuid[])`}
      GROUP BY l."variantId", l."siteId"`;
    return new Map(rows.map((r) => [`${r.siteId}:${r.variantId}`, Number(r.available)]));
  }

  /** Déjà commandé, pas encore reçu, sur les commandes passées vers ce site. */
  private async incoming(organizationId: string, siteId: string, ids: string[]) {
    const out = new Map<string, number>();
    if (ids.length === 0) return out;
    const rows = await this.db.$queryRaw<{ variantId: string; incoming: Prisma.Decimal }[]>`
      SELECT l."variantId", sum(l."quantity" - l."receivedQuantity") AS incoming
      FROM "StockPurchaseLine" l JOIN "StockPurchaseOrder" o ON o.id = l."orderId"
      WHERE o."organizationId" = ${organizationId}::uuid AND o."siteId" = ${siteId}::uuid
        AND o."status" IN ('ORDERED', 'PARTIALLY_RECEIVED') AND l."variantId" = ANY(${ids}::uuid[])
      GROUP BY l."variantId"`;
    for (const r of rows) out.set(r.variantId, Math.max(0, Number(r.incoming)));
    return out;
  }

  /** Délai du dernier fournisseur connu de chaque article (réception la plus récente). */
  private async leadTimes(organizationId: string, ids: string[]) {
    const rows = await this.db.$queryRaw<{ variantId: string; leadTimeDays: number | null }[]>`
      SELECT DISTINCT ON (p."variantId") p."variantId", s."leadTimeDays"
      FROM "StockSupplierPrice" p JOIN "StockSupplier" s ON s.id = p."supplierId"
      WHERE p."organizationId" = ${organizationId}::uuid AND p."variantId" = ANY(${ids}::uuid[])
      ORDER BY p."variantId", p."createdAt" DESC`;
    return new Map(
      rows.filter((r) => r.leadTimeDays !== null).map((r) => [r.variantId, r.leadTimeDays!]),
    );
  }

  /** Aucun chiffre du modèle absent des données du serveur (statistique inventée refusée). */
  private grounded(out: AiResult<unknown>, texts: string[], data: string) {
    const truth = stripSimulationDirectives(data);
    if (texts.some((t) => !numbersAreGrounded(t, truth))) {
      invalid(out, 'La réponse citait des chiffres absents des données : refusée.');
    }
  }

  private async assertSite(ctx: StockContext, siteId: string) {
    const site = await this.db.stockSite.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id: siteId } },
      select: { id: true },
    });
    if (!site || !stockSiteAllowed(ctx, siteId)) {
      throw new NotFoundException({ code: 'STOCK_SITE_NOT_FOUND', message: 'Site introuvable.' });
    }
  }

  private assertFeatureRight(ctx: StockContext, feature: StockAiFeature) {
    const images = feature === 'STOCK_PRODUCT_PHOTO' || feature === 'STOCK_ILLUSTRATION';
    if (!stockCan(ctx, images ? 'stock.ai.images' : 'stock.ai.use')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: "Vous n'avez pas les droits nécessaires.",
      });
    }
  }

  private async find(ctx: StockContext, id: string) {
    const proposal = await this.db.stockAiProposal.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
    });
    if (!proposal || !this.visible(ctx, proposal)) {
      throw new NotFoundException({
        code: 'STOCK_AI_PROPOSAL_NOT_FOUND',
        message: 'Proposition introuvable.',
      });
    }
    return proposal;
  }

  private view(
    p: {
      id: string;
      feature: string;
      status: string;
      targetType: string;
      targetId: string | null;
      output: Prisma.JsonValue;
      model: string;
      promptId: string | null;
      promptVersion: number | null;
      createdAt: Date;
      decidedAt: Date | null;
      edited: boolean;
      resultId: string | null;
    },
    ctx: StockContext,
  ) {
    const { storageKey: _k, ...raw } = (p.output ?? {}) as Record<string, unknown>;
    const output = Array.isArray(raw.lines)
      ? { ...raw, lines: this.costs(ctx, raw.lines as Record<string, unknown>[]) }
      : raw;
    return {
      id: p.id,
      feature: p.feature as StockAiFeature,
      status: p.status as 'PROPOSED' | 'APPLIED' | 'REJECTED',
      targetType: p.targetType,
      targetId: p.targetId,
      output: output as Record<string, unknown>,
      model: p.model,
      prompt: p.promptId ? `${p.promptId}@${p.promptVersion}` : null,
      createdAt: p.createdAt,
      decidedAt: p.decidedAt,
      edited: p.edited,
      resultId: p.resultId,
    };
  }

  /** Périmètre réel d'une proposition : le site demandé, sinon les sites du membre (null = toute l'organisation). */
  private sites(ctx: StockContext, siteId?: string | null): string[] | null {
    return siteId ? [siteId] : ctx.siteIds;
  }

  /**
   * Une proposition n'est vue (liste, aperçu, décision) que par qui pourrait la produire : droit IA de la
   * fonctionnalité, tous ses sites autorisés (une proposition sur toute l'organisation reste aux membres
   * sans restriction de site), droit de consulter les ventes pour une analyse, et droit de voir les prix
   * d'achat si elle cite des marges. Les images du catalogue (sans site) suivent le seul droit IA.
   */
  private visible(ctx: StockContext, p: { feature: string; input: Prisma.JsonValue }): boolean {
    const images = p.feature === 'STOCK_PRODUCT_PHOTO' || p.feature === 'STOCK_ILLUSTRATION';
    if (!stockCan(ctx, images ? 'stock.ai.images' : 'stock.ai.use')) return false;
    if (images) return true;
    const input = (p.input ?? {}) as {
      sites?: string[] | null;
      siteId?: string | null;
      withCosts?: boolean;
    };
    if (p.feature === 'STOCK_ANALYSIS' && !stockCan(ctx, 'stock.sales.read')) return false;
    if (input.withCosts && !stockCan(ctx, 'stock.prices.purchase.read')) return false;
    const sites = input.sites !== undefined ? input.sites : input.siteId ? [input.siteId] : null;
    if (sites === null) return ctx.siteIds === null;
    return sites.every(
      (siteId) =>
        stockSiteAllowed(ctx, siteId) &&
        (p.feature !== 'STOCK_ANALYSIS' || stockCanAt(ctx, 'stock.sales.read', siteId)),
    );
  }

  /** Coûts d'achat retirés pour qui ne peut pas les voir (ils restent côté serveur pour le brouillon). */
  private costs<T extends Record<string, unknown>>(ctx: StockContext, lines: T[]): T[] {
    if (stockCan(ctx, 'stock.prices.purchase.read')) return lines;
    return lines.map(({ unitCost: _c, ...rest }) => rest as T);
  }

  private decided() {
    return new ConflictException({
      code: 'STOCK_AI_PROPOSAL_DECIDED',
      message: 'Cette proposition a déjà été traitée.',
    });
  }

  private async propose(
    ctx: StockContext,
    feature: StockAiFeature,
    prompt: AiPrompt,
    data: {
      targetType: string;
      targetId: string | null;
      input: Record<string, unknown>;
      output: Record<string, unknown>;
      model?: string;
    },
  ) {
    const created = await this.db.stockAiProposal.create({
      data: {
        organizationId: ctx.organizationId,
        feature,
        targetType: data.targetType,
        targetId: data.targetId,
        input: data.input as Prisma.InputJsonValue,
        output: JSON.parse(JSON.stringify(data.output)) as Prisma.InputJsonValue,
        promptId: prompt.id,
        promptVersion: prompt.version,
        model: data.model ?? this.gateway.model(feature),
        createdByUserId: ctx.userId,
      },
    });
    await this.record(ctx, 'stock.ai_proposal_created', created.id, 'StockAiProposal', { feature });
    return this.view(created, ctx);
  }

  private context(ctx: StockContext, feature: StockAiFeature) {
    return {
      application: STOCK_AI_APPLICATION,
      organizationId: ctx.organizationId,
      establishmentId: null,
      actorUserId: ctx.userId,
      actorRef: ctx.memberId,
      role: ctx.role,
      operation: feature,
      timezone: STOCK_AI_TIMEZONE,
    };
  }

  /** Appel IA de Stock par Ocall AI Core ; le contexte vient de la session, jamais du modèle. */
  private run<T>(
    ctx: StockContext,
    feature: StockAiFeature,
    prompt: AiPrompt,
    call: (provider: AiProvider, model: string) => Promise<AiResult<T>>,
  ): Promise<T> {
    const model = this.gateway.model(feature);
    return this.gateway.run(this.context(ctx, feature), { model, prompt }, (provider) =>
      call(provider, model),
    );
  }

  private record(
    ctx: StockContext,
    action: string,
    targetId: string,
    targetType: string,
    metadata: Record<string, string>,
  ) {
    return this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action,
      targetType,
      targetId,
      metadata,
    });
  }
}
