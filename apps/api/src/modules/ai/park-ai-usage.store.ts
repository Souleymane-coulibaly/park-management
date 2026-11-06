import { ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { AiFeature } from '@ocall/shared';
import { localMoment, zonedMidnight } from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { organizationQuotas } from '../../common/quotas';
import type {
  AiCallContext,
  AiCallFailed,
  AiCallMeta,
  AiCallSucceeded,
  AiUsageStore,
} from '../../ai-core/ai-context';
import type { Prisma } from '@ocall/database';

export const PARK_AI_APPLICATION = 'park';

/** Colonne d'activation de chaque fonctionnalité IA de Park (réglages de l'organisation). */
export const ENABLED_FIELD = {
  CATALOG_IMPORT: 'catalogImportEnabled',
  TICKET_IMPORT: 'ticketImportEnabled',
  COPILOT: 'copilotEnabled',
  VOICE_ORDER: 'voiceOrderEnabled',
} as const satisfies Record<AiFeature, string>;

export const SETTINGS_SELECT = {
  catalogImportEnabled: true,
  ticketImportEnabled: true,
  copilotEnabled: true,
  voiceOrderEnabled: true,
  monthlyCallLimit: true,
  alertPercent: true,
  retentionDays: true,
} satisfies Prisma.AiSettingsSelect;

/** Début du mois civil en cours, dans un fuseau donné. */
export function monthStart(timezone: string): Date {
  const today = localMoment(new Date(), timezone).date;
  return zonedMidnight(`${today.slice(0, 8)}01`, timezone);
}

/** Plafond réellement appliqué : le plus bas entre celui de l'organisation et celui d'Ocall. */
export async function effectiveLimit(
  db: PrismaService | Prisma.TransactionClient,
  organizationId: string,
  organizationLimit: number,
): Promise<number> {
  const quotas = await organizationQuotas(db, organizationId);
  return Math.min(organizationLimit, quotas.aiMonthlyCalls);
}

/**
 * Stockage de la consommation IA d'Ocall Park pour Ocall AI Core : base Park (`AiSettings`,
 * `AiUsage`), quota mensuel de l'organisation plafonné par l'offre (Sprint 11B), alerte de seuil
 * journalisée une fois. Règles inchangées depuis le Sprint 8 : toutes les lignes du mois comptent
 * (en cours, réussies, échouées), la réservation est atomique sous verrou de l'organisation.
 */
@Injectable()
export class ParkAiUsageStore implements AiUsageStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async reserve(ctx: AiCallContext, meta: AiCallMeta): Promise<string> {
    const feature = ctx.operation as AiFeature;
    const organizationId = ctx.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await tx.aiSettings.createMany({ data: [{ organizationId }], skipDuplicates: true });
      // Sérialise les réservations d'une organisation : le comptage puis l'insertion sont atomiques.
      await tx.$queryRaw`SELECT "organizationId" FROM "AiSettings" WHERE "organizationId" = ${organizationId}::uuid FOR UPDATE`;
      const settings = await tx.aiSettings.findUniqueOrThrow({
        where: { organizationId },
        select: SETTINGS_SELECT,
      });
      if (!settings[ENABLED_FIELD[feature]]) {
        throw new ForbiddenException({
          code: 'AI_FEATURE_DISABLED',
          message:
            'Cette fonctionnalité IA est désactivée par votre administrateur. Vous pouvez continuer sans IA.',
        });
      }
      const used = await tx.aiUsage.count({
        where: { organizationId, createdAt: { gte: monthStart(ctx.timezone) } },
      });
      const limit = await effectiveLimit(tx, organizationId, settings.monthlyCallLimit);
      if (used >= limit) {
        throw new HttpException(
          {
            code: 'AI_QUOTA_EXCEEDED',
            message:
              'Le plafond mensuel d’appels IA est atteint. Votre administrateur peut le relever ; ' +
              'vous pouvez continuer sans IA.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const usage = await tx.aiUsage.create({
        data: {
          organizationId,
          establishmentId: ctx.establishmentId,
          membershipId: ctx.actorRef,
          feature,
          provider: meta.provider,
          model: meta.model,
          promptId: meta.prompt?.id ?? null,
          promptVersion: meta.prompt?.version ?? null,
        },
        select: { id: true },
      });
      // Alerte de dépassement : journalisée une fois, au franchissement du seuil.
      const threshold = Math.ceil((limit * settings.alertPercent) / 100);
      if (used + 1 === threshold) {
        await this.audit.record(
          {
            organizationId,
            actorUserId: ctx.actorUserId,
            action: 'ai.quota_alert',
            targetType: 'AiSettings',
            targetId: organizationId,
            metadata: { used: used + 1, limit },
          },
          tx,
        );
      }
      return usage.id;
    });
  }

  async succeed(reservationId: string, result: AiCallSucceeded): Promise<void> {
    await this.prisma.aiUsage.update({
      where: { id: reservationId },
      data: {
        status: 'SUCCEEDED',
        inputTokens: result.usage.inputTokens,
        cachedInputTokens: result.usage.cachedInputTokens,
        outputTokens: result.usage.outputTokens,
        audioSeconds: result.usage.audioSeconds ?? null,
        estimatedCostMicroUsd: result.estimatedCostMicroUsd,
        latencyMs: result.latencyMs,
      },
    });
  }

  async fail(reservationId: string, failure: AiCallFailed): Promise<void> {
    await this.prisma.aiUsage.update({
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
    const released = await this.prisma.aiUsage.updateMany({
      where: { status: 'PENDING', createdAt: { lt: olderThan } },
      data: { status: 'FAILED', errorCode: 'AI_ABANDONED' },
    });
    return released.count;
  }
}
