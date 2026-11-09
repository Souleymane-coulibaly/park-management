import { ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { localMoment, zonedMidnight } from '@ocall/shared';
import type {
  AiCallContext,
  AiCallFailed,
  AiCallMeta,
  AiCallSucceeded,
  AiUsageStore,
} from '../../../ai-core/ai-context';
import { AuditService } from '../../../common/audit/audit.service';
import { SchoolPrismaService } from '../school-prisma.service';

export const SCHOOL_AI_APPLICATION = 'school';

/** Colonne d'activation de chaque module d'Ocall School AI. */
export const SCHOOL_AI_ENABLED_FIELD = {
  SCHOOL_COPILOT: 'copilotEnabled',
  SCHOOL_TEACHING: 'teachingEnabled',
  SCHOOL_ANALYSIS: 'analysisEnabled',
} as const;

export type SchoolAiOperation = keyof typeof SCHOOL_AI_ENABLED_FIELD;

/** Début du mois civil en cours, dans le fuseau de l'établissement. */
export function schoolMonthStart(timezone: string): Date {
  const today = localMoment(new Date(), timezone).date;
  return zonedMidnight(`${today.slice(0, 8)}01`, timezone);
}

/**
 * Stockage de la consommation IA d'Ocall School pour Ocall AI Core, dans la base School : quota mensuel
 * PAR ÉTABLISSEMENT, IA activée par établissement (désactivée par défaut), module activé. Réservation
 * atomique sous verrou de la ligne de réglages de l'établissement ; toutes les lignes du mois comptent
 * (un échec consomme le quota, comme pour Park). Aucun contenu n'est enregistré.
 */
@Injectable()
export class SchoolAiUsageStore implements AiUsageStore {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly audit: AuditService,
  ) {}

  async reserve(ctx: AiCallContext, meta: AiCallMeta): Promise<string> {
    const schoolId = ctx.establishmentId;
    if (!schoolId) throw new Error('Ocall School AI exige un établissement.');
    const operation = ctx.operation as SchoolAiOperation;
    return this.db.$transaction(async (tx) => {
      await tx.schoolAiSettings.createMany({
        data: [{ organizationId: ctx.organizationId, schoolId }],
        skipDuplicates: true,
      });
      // Sérialise les réservations d'un établissement : comptage puis insertion atomiques.
      await tx.$queryRaw`SELECT "schoolId" FROM "SchoolAiSettings" WHERE "schoolId" = ${schoolId}::uuid AND "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`;
      const settings = await tx.schoolAiSettings.findUniqueOrThrow({ where: { schoolId } });
      if (!settings.enabled) {
        throw new ForbiddenException({
          code: 'AI_SCHOOL_DISABLED',
          message:
            'Ocall School AI n’est pas activé pour cet établissement. La direction peut l’activer ; vous pouvez continuer sans IA.',
        });
      }
      if (!settings[SCHOOL_AI_ENABLED_FIELD[operation]]) {
        throw new ForbiddenException({
          code: 'AI_FEATURE_DISABLED',
          message:
            'Cette fonctionnalité IA est désactivée par la direction. Vous pouvez continuer sans IA.',
        });
      }
      const used = await tx.schoolAiUsage.count({
        where: {
          organizationId: ctx.organizationId,
          schoolId,
          createdAt: { gte: schoolMonthStart(ctx.timezone) },
        },
      });
      const contractLimit = ctx.contractMonthlyLimit ?? null;
      const limit =
        contractLimit === null
          ? settings.monthlyCallLimit
          : Math.min(settings.monthlyCallLimit, contractLimit);
      if (used >= limit) {
        if (contractLimit !== null && used >= contractLimit) {
          throw new HttpException(
            {
              code: 'SCHOOL_FREE_AI_LIMIT',
              message: `Offre gratuite : ${contractLimit} requêtes IA par mois et par établissement. Passez à l’offre payante pour continuer ; vous pouvez continuer sans IA.`,
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        throw new HttpException(
          {
            code: 'AI_QUOTA_EXCEEDED',
            message:
              'Le plafond mensuel d’appels IA de l’établissement est atteint. La direction peut le relever ; ' +
              'vous pouvez continuer sans IA.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const usage = await tx.schoolAiUsage.create({
        data: {
          organizationId: ctx.organizationId,
          schoolId,
          actorUserId: ctx.actorUserId,
          memberId: ctx.actorRef,
          feature: operation,
          provider: meta.provider,
          model: meta.model,
          promptId: meta.prompt?.id ?? null,
          promptVersion: meta.prompt?.version ?? null,
        },
        select: { id: true },
      });
      const threshold = Math.ceil((settings.monthlyCallLimit * settings.alertPercent) / 100);
      if (used + 1 === threshold) {
        await this.audit.record({
          organizationId: ctx.organizationId,
          actorUserId: ctx.actorUserId,
          action: 'school.ai_quota_alert',
          targetType: 'School',
          targetId: schoolId,
          metadata: { used: used + 1, limit: settings.monthlyCallLimit },
        });
      }
      return usage.id;
    });
  }

  async succeed(reservationId: string, result: AiCallSucceeded): Promise<void> {
    await this.db.schoolAiUsage.update({
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
    await this.db.schoolAiUsage.update({
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
    const released = await this.db.schoolAiUsage.updateMany({
      where: { status: 'PENDING', createdAt: { lt: olderThan } },
      data: { status: 'FAILED', errorCode: 'AI_ABANDONED' },
    });
    return released.count;
  }
}
