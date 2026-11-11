import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { type FactureAiFeature, localMoment, zonedMidnight } from '@ocall/shared';
import type {
  AiCallContext,
  AiCallFailed,
  AiCallMeta,
  AiCallSucceeded,
  AiUsageStore,
} from '../../ai-core/ai-context';
import { AuditService } from '../../common/audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { FacturePrismaService } from './facture-prisma.service';

/** Fuseau des organisations Facture (Mali, UTC) : période de quota = mois civil. */
export const FACTURE_AI_TIMEZONE = 'Africa/Bamako';

/** Colonnes d'activation et de plafond de chaque fonctionnalité. */
export const FACTURE_AI_FIELDS = {
  FACTURE_REPORT: { enabled: 'reportEnabled', limit: 'reportMonthlyLimit' },
  FACTURE_QUOTE: { enabled: 'quoteEnabled', limit: 'quoteMonthlyLimit' },
  FACTURE_PLANNING: { enabled: 'planningEnabled', limit: 'planningMonthlyLimit' },
  FACTURE_MAINTENANCE: { enabled: 'maintenanceEnabled', limit: 'maintenanceMonthlyLimit' },
} as const satisfies Record<FactureAiFeature, { enabled: string; limit: string }>;

export function factureAiMonthStart(now = new Date()): Date {
  const today = localMoment(now, FACTURE_AI_TIMEZONE).date;
  return zonedMidnight(`${today.slice(0, 8)}01`, FACTURE_AI_TIMEZONE);
}

/**
 * Stockage de la consommation IA d'Ocall Facture pour Ocall AI Core, dans la base Facture : IA activée
 * par l'organisation (désactivée par défaut), fonctionnalité activée, plafond mensuel PAR
 * FONCTIONNALITÉ (le plus restrictif du réglage du gérant et du plafond plateforme Ocall). Réservation
 * atomique sous verrou de la ligne de réglages ; un échec consomme le quota (comme Park et School).
 * Aucun contenu n'est enregistré ici.
 */
@Injectable()
export class FactureAiUsageStore implements AiUsageStore {
  constructor(
    private readonly db: FacturePrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async reserve(ctx: AiCallContext, meta: AiCallMeta): Promise<string> {
    const feature = ctx.operation as FactureAiFeature;
    const fields = FACTURE_AI_FIELDS[feature];
    if (!fields) throw new Error(`Fonctionnalité IA Facture inconnue : ${ctx.operation}.`);
    return this.db.$transaction(async (tx) => {
      await tx.factureAiSettings.createMany({
        data: [{ organizationId: ctx.organizationId }],
        skipDuplicates: true,
      });
      // Sérialise les réservations d'une organisation : comptage puis insertion atomiques.
      await tx.$queryRaw`SELECT "organizationId" FROM "FactureAiSettings" WHERE "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`;
      const settings = await tx.factureAiSettings.findUniqueOrThrow({
        where: { organizationId: ctx.organizationId },
      });
      if (!settings.enabled) {
        throw new ForbiddenException({
          code: 'AI_FACTURE_DISABLED',
          message:
            'L’IA d’Ocall Facture n’est pas activée pour votre entreprise. Le gérant peut l’activer ; vous pouvez continuer sans IA.',
        });
      }
      if (!settings[fields.enabled]) {
        throw new ForbiddenException({
          code: 'AI_FEATURE_DISABLED',
          message:
            'Cette fonctionnalité IA est désactivée par le gérant. Vous pouvez continuer sans IA.',
        });
      }
      const used = await tx.factureAiUsage.count({
        where: {
          organizationId: ctx.organizationId,
          feature,
          createdAt: { gte: factureAiMonthStart() },
        },
      });
      const limit = Math.min(settings[fields.limit], this.config.facture.aiMonthlyCeiling);
      if (used >= limit) {
        throw new HttpException(
          {
            code: 'AI_QUOTA_EXCEEDED',
            message:
              'Le plafond mensuel de cette fonctionnalité IA est atteint. Le gérant peut le relever dans la limite Ocall ; vous pouvez continuer sans IA.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const usage = await tx.factureAiUsage.create({
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
          action: 'facture.ai_quota_alert',
          targetType: 'FactureAiSettings',
          targetId: ctx.organizationId,
          metadata: { feature, used: used + 1, limit },
        });
      }
      return usage.id;
    });
  }

  async succeed(reservationId: string, result: AiCallSucceeded): Promise<void> {
    await this.db.factureAiUsage.update({
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
    await this.db.factureAiUsage.update({
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
    const released = await this.db.factureAiUsage.updateMany({
      where: { status: 'PENDING', createdAt: { lt: olderThan } },
      data: { status: 'FAILED', errorCode: 'AI_ABANDONED' },
    });
    return released.count;
  }
}
