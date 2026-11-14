import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { type StockAiFeature, localMoment, zonedMidnight } from '@ocall/shared';
import type {
  AiCallContext,
  AiCallFailed,
  AiCallMeta,
  AiCallSucceeded,
  AiUsageStore,
} from '../../ai-core/ai-context';
import { AuditService } from '../../common/audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';

/** Fuseau des organisations Stock (Mali, UTC) : période de quota = mois civil. */
export const STOCK_AI_TIMEZONE = 'Africa/Bamako';

/** Colonnes d'activation et de plafond de chaque fonctionnalité. */
export const STOCK_AI_FIELDS = {
  STOCK_RESTOCK: { enabled: 'restockEnabled', limit: 'restockMonthlyLimit' },
  STOCK_STOCKOUT: { enabled: 'stockoutEnabled', limit: 'stockoutMonthlyLimit' },
  STOCK_ANALYSIS: { enabled: 'analysisEnabled', limit: 'analysisMonthlyLimit' },
  STOCK_PRODUCT_PHOTO: { enabled: 'photoEnabled', limit: 'photoMonthlyLimit' },
  STOCK_ILLUSTRATION: { enabled: 'illustrationEnabled', limit: 'illustrationMonthlyLimit' },
} as const satisfies Record<StockAiFeature, { enabled: string; limit: string }>;

export function stockAiMonthStart(now = new Date()): Date {
  const today = localMoment(now, STOCK_AI_TIMEZONE).date;
  return zonedMidnight(`${today.slice(0, 8)}01`, STOCK_AI_TIMEZONE);
}

/**
 * Stockage de la consommation IA d'Ocall Stock (S8) pour Ocall AI Core, dans la base Stock : IA activée
 * par l'organisation (désactivée par défaut), fonctionnalité activée, plafond mensuel PAR FONCTIONNALITÉ
 * (le plus restrictif du réglage de l'administrateur et du plafond Ocall ; illustrations à part).
 * Réservation atomique sous verrou de la ligne de réglages ; un échec consomme le quota (comme Facture).
 * Aucun contenu n'est enregistré ici.
 */
@Injectable()
export class OcallStockAiUsageStore implements AiUsageStore {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async reserve(ctx: AiCallContext, meta: AiCallMeta): Promise<string> {
    const feature = ctx.operation as StockAiFeature;
    const fields = STOCK_AI_FIELDS[feature];
    if (!fields) throw new Error(`Fonctionnalité IA Stock inconnue : ${ctx.operation}.`);
    return this.db.$transaction(async (tx) => {
      await tx.stockAiSettings.createMany({
        data: [{ organizationId: ctx.organizationId }],
        skipDuplicates: true,
      });
      // Sérialise les réservations d'une organisation : comptage puis insertion atomiques.
      await tx.$queryRaw`SELECT "organizationId" FROM "StockAiSettings" WHERE "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`;
      const settings = await tx.stockAiSettings.findUniqueOrThrow({
        where: { organizationId: ctx.organizationId },
      });
      if (!settings.enabled) {
        throw new ForbiddenException({
          code: 'AI_STOCK_DISABLED',
          message:
            'L’IA d’Ocall Stock n’est pas activée pour votre entreprise. L’administrateur peut l’activer ; vous pouvez continuer sans IA.',
        });
      }
      if (!settings[fields.enabled]) {
        throw new ForbiddenException({
          code: 'AI_FEATURE_DISABLED',
          message:
            'Cette fonctionnalité IA est désactivée par l’administrateur. Vous pouvez continuer sans IA.',
        });
      }
      const used = await tx.stockAiUsage.count({
        where: {
          organizationId: ctx.organizationId,
          feature,
          createdAt: { gte: stockAiMonthStart() },
        },
      });
      const ceiling =
        feature === 'STOCK_ILLUSTRATION'
          ? this.config.stock.ai.imageMonthlyCeiling
          : this.config.stock.ai.monthlyCeiling;
      const limit = Math.min(settings[fields.limit], ceiling);
      if (used >= limit) {
        throw new HttpException(
          {
            code: 'AI_QUOTA_EXCEEDED',
            message:
              'Le plafond mensuel de cette fonctionnalité IA est atteint. L’administrateur peut le relever dans la limite Ocall ; vous pouvez continuer sans IA.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const usage = await tx.stockAiUsage.create({
        data: {
          organizationId: ctx.organizationId,
          actorUserId: ctx.actorUserId,
          memberId: ctx.actorRef,
          feature,
          provider: meta.provider,
          model: meta.model,
          promptId: meta.prompt?.id ?? null,
          promptVersion: meta.prompt?.version ?? null,
        },
        select: { id: true },
      });
      if (used + 1 === Math.ceil(limit * 0.8)) {
        await this.audit.record({
          organizationId: ctx.organizationId,
          actorUserId: ctx.actorUserId,
          action: 'stock.ai_quota_alert',
          targetType: 'StockAiSettings',
          targetId: ctx.organizationId,
          metadata: { feature, used: used + 1, limit },
        });
      }
      return usage.id;
    });
  }

  async succeed(reservationId: string, result: AiCallSucceeded): Promise<void> {
    await this.db.stockAiUsage.update({
      where: { id: reservationId },
      data: {
        status: 'SUCCEEDED',
        inputTokens: result.usage.inputTokens,
        cachedInputTokens: result.usage.cachedInputTokens,
        outputTokens: result.usage.outputTokens,
        estimatedCostMicroUsd: result.estimatedCostMicroUsd,
        latencyMs: result.latencyMs,
      },
    });
  }

  async fail(reservationId: string, failure: AiCallFailed): Promise<void> {
    await this.db.stockAiUsage.update({
      where: { id: reservationId },
      data: {
        status: 'FAILED',
        errorCode: failure.errorCode,
        latencyMs: failure.latencyMs,
        ...(failure.usage
          ? {
              inputTokens: failure.usage.inputTokens,
              cachedInputTokens: failure.usage.cachedInputTokens,
              outputTokens: failure.usage.outputTokens,
              estimatedCostMicroUsd: failure.estimatedCostMicroUsd,
            }
          : {}),
      },
    });
  }

  async releaseOrphans(olderThan: Date): Promise<number> {
    const released = await this.db.stockAiUsage.updateMany({
      where: { status: 'PENDING', createdAt: { lt: olderThan } },
      data: { status: 'FAILED', errorCode: 'AI_ABANDONED' },
    });
    return released.count;
  }
}
