import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import {
  AI_FEATURES,
  type AiFeature,
  addDays,
  estimateAiCostMicroUsd,
  localMoment,
  microUsdToXof,
  zonedMidnight,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { organizationQuotas } from '../../common/quotas';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import {
  AI_PROVIDER,
  type AiProvider,
  AiProviderError,
  type AiResult,
} from './providers/ai-provider';

const ENABLED_FIELD: Record<AiFeature, keyof AiSettingsRow> = {
  CATALOG_IMPORT: 'catalogImportEnabled',
  TICKET_IMPORT: 'ticketImportEnabled',
  COPILOT: 'copilotEnabled',
  VOICE_ORDER: 'voiceOrderEnabled',
};

export interface AiSettingsRow {
  catalogImportEnabled: boolean;
  ticketImportEnabled: boolean;
  copilotEnabled: boolean;
  voiceOrderEnabled: boolean;
  monthlyCallLimit: number;
  alertPercent: number;
  retentionDays: number;
}

const SETTINGS_SELECT = {
  catalogImportEnabled: true,
  ticketImportEnabled: true,
  copilotEnabled: true,
  voiceOrderEnabled: true,
  monthlyCallLimit: true,
  alertPercent: true,
  retentionDays: true,
} satisfies Prisma.AiSettingsSelect;

const PROVIDER_ERROR_STATUS: Record<AiProviderError['code'], HttpStatus> = {
  AI_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  AI_TIMEOUT: HttpStatus.GATEWAY_TIMEOUT,
  AI_RATE_LIMITED: HttpStatus.SERVICE_UNAVAILABLE,
  AI_INVALID_OUTPUT: HttpStatus.BAD_GATEWAY,
  AI_REFUSED: HttpStatus.UNPROCESSABLE_ENTITY,
};

/**
 * Point de passage obligé de tout appel IA : fonctionnalité activée, fournisseur configuré,
 * quota réservé AVANT l'appel (sous verrou, pour que des appels simultanés ne dépassent pas le
 * plafond), consommation et coût ESTIMÉ enregistrés après. Aucun contenu n'est journalisé.
 */
@Injectable()
export class AiUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider | null,
  ) {}

  /** Fournisseur actif, ou erreur claire : l'application reste utilisable sans IA. */
  requireProvider(): AiProvider {
    if (!this.provider) {
      throw new ServiceUnavailableException({
        code: 'AI_NOT_CONFIGURED',
        message: "L'IA n'est pas activée sur cette plateforme. Vous pouvez continuer sans IA.",
      });
    }
    return this.provider;
  }

  model(feature: AiFeature): string {
    return this.provider?.name === 'simulated' ? 'simulated' : this.config.ai.models[feature];
  }

  transcribeModel(): string {
    return this.provider?.name === 'simulated' ? 'simulated' : this.config.ai.transcribeModel;
  }

  async settings(organizationId: string): Promise<AiSettingsRow> {
    const row = await this.prisma.aiSettings.findUnique({
      where: { organizationId },
      select: SETTINGS_SELECT,
    });
    return (
      row ?? {
        catalogImportEnabled: true,
        ticketImportEnabled: true,
        copilotEnabled: true,
        voiceOrderEnabled: true,
        monthlyCallLimit: 500,
        alertPercent: 80,
        retentionDays: 30,
      }
    );
  }

  /**
   * Réglages avec le plafond fixé par Ocall (Sprint 11B : quota de l'offre ou dérogation du Super
   * Admin). Le plafond de l'organisation ne peut que le restreindre.
   */
  async settingsView(organizationId: string) {
    const [settings, quotas] = await Promise.all([
      this.settings(organizationId),
      organizationQuotas(this.prisma, organizationId),
    ]);
    return { ...settings, platformLimit: quotas.aiMonthlyCalls };
  }

  /** Plafond réellement appliqué : le plus bas entre celui de l'organisation et celui d'Ocall. */
  private async effectiveLimit(
    db: PrismaService | Prisma.TransactionClient,
    organizationId: string,
    organizationLimit: number,
  ): Promise<number> {
    const quotas = await organizationQuotas(db, organizationId);
    return Math.min(organizationLimit, quotas.aiMonthlyCalls);
  }

  async updateSettings(auth: TenantContext, dto: Partial<AiSettingsRow>) {
    const organizationId = auth.membership.organizationId;
    if (dto.monthlyCallLimit !== undefined) {
      const quotas = await organizationQuotas(this.prisma, organizationId);
      if (dto.monthlyCallLimit > quotas.aiMonthlyCalls) {
        throw new ConflictException({
          code: 'AI_LIMIT_ABOVE_PLAN',
          message: `Votre offre autorise ${quotas.aiMonthlyCalls} appels IA par mois au plus. Contactez Ocall pour l'augmenter.`,
        });
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.aiSettings.upsert({
        where: { organizationId },
        create: { organizationId, ...dto },
        update: dto,
        select: SETTINGS_SELECT,
      });
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'ai.settings_updated',
          targetType: 'AiSettings',
          targetId: organizationId,
          metadata: { ...dto },
        },
        tx,
      );
      return row;
    });
  }

  /** Début du mois civil en cours, dans le fuseau de l'organisation. */
  private monthStart(timezone: string): Date {
    const today = localMoment(new Date(), timezone).date;
    return zonedMidnight(`${today.slice(0, 8)}01`, timezone);
  }

  /** État de l'IA pour l'organisation : fonctionnalités, consommation du mois, alerte. */
  async status(auth: TenantContext) {
    const organizationId = auth.membership.organizationId;
    const settings = await this.settings(organizationId);
    const used = await this.prisma.aiUsage.count({
      where: { organizationId, createdAt: { gte: this.monthStart(auth.membership.timezone) } },
    });
    const limit = await this.effectiveLimit(this.prisma, organizationId, settings.monthlyCallLimit);
    return {
      configured: this.provider !== null,
      simulated: this.provider?.name === 'simulated',
      features: Object.fromEntries(
        AI_FEATURES.map((f) => [f, this.provider !== null && Boolean(settings[ENABLED_FIELD[f]])]),
      ) as Record<AiFeature, boolean>,
      usage: {
        used,
        limit,
        alert: limit > 0 && used * 100 >= limit * settings.alertPercent,
        exceeded: used >= limit,
      },
    };
  }

  /** Consommation détaillée du mois : appels, jetons, coût ESTIMÉ par fonctionnalité et établissement. */
  async usageReport(auth: TenantContext) {
    const organizationId = auth.membership.organizationId;
    const since = this.monthStart(auth.membership.timezone);
    const rows = await this.prisma.aiUsage.groupBy({
      by: ['feature', 'establishmentId', 'status'],
      where: { organizationId, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        audioSeconds: true,
        estimatedCostMicroUsd: true,
      },
    });
    const unestimated = await this.prisma.aiUsage.count({
      where: {
        organizationId,
        createdAt: { gte: since },
        status: 'SUCCEEDED',
        estimatedCostMicroUsd: null,
      },
    });
    const establishments = await this.prisma.establishment.findMany({
      where: { organizationId },
      select: { id: true, name: true },
    });
    const names = new Map(establishments.map((e) => [e.id, e.name]));
    const rate = this.config.ai.usdXofRate;
    return {
      since,
      provider: this.provider?.name ?? null,
      usdXofRate: rate,
      costIsEstimate: true,
      unestimatedCalls: unestimated,
      rows: rows.map((r) => ({
        feature: r.feature,
        establishmentId: r.establishmentId,
        establishmentName: r.establishmentId ? (names.get(r.establishmentId) ?? null) : null,
        status: r.status,
        calls: r._count._all,
        inputTokens: r._sum.inputTokens ?? 0,
        outputTokens: r._sum.outputTokens ?? 0,
        audioSeconds: r._sum.audioSeconds ?? 0,
        estimatedCostMicroUsd: r._sum.estimatedCostMicroUsd ?? 0,
        estimatedCostXof: microUsdToXof(r._sum.estimatedCostMicroUsd ?? 0, rate),
      })),
    };
  }

  /**
   * Exécute un appel IA en respectant fonctionnalité, quota et journalisation. `call` reçoit le
   * fournisseur et le modèle ; ses erreurs sont traduites en messages compréhensibles.
   */
  async run<T>(
    auth: TenantContext,
    feature: AiFeature,
    establishmentId: string | null,
    model: string,
    call: (provider: AiProvider) => Promise<AiResult<T>>,
  ): Promise<T> {
    const provider = this.requireProvider();
    const usageId = await this.reserve(auth, feature, establishmentId, provider.name, model);
    const started = Date.now();
    try {
      const result = await call(provider);
      await this.prisma.aiUsage.update({
        where: { id: usageId },
        data: {
          status: 'SUCCEEDED',
          inputTokens: result.usage.inputTokens,
          cachedInputTokens: result.usage.cachedInputTokens,
          outputTokens: result.usage.outputTokens,
          audioSeconds: result.usage.audioSeconds ?? null,
          estimatedCostMicroUsd:
            provider.name === 'simulated' ? 0 : estimateAiCostMicroUsd(model, result.usage),
          latencyMs: Date.now() - started,
        },
      });
      return result.value;
    } catch (error) {
      const code = error instanceof AiProviderError ? error.code : 'AI_INTERNAL_ERROR';
      await this.prisma.aiUsage.update({
        where: { id: usageId },
        data: { status: 'FAILED', errorCode: code, latencyMs: Date.now() - started },
      });
      if (error instanceof AiProviderError) {
        throw new HttpException(
          { code: error.code, message: `${error.message} Vous pouvez continuer sans IA.` },
          PROVIDER_ERROR_STATUS[error.code],
        );
      }
      throw error;
    }
  }

  /** Vérifie la fonctionnalité puis réserve un appel sur le quota du mois, sous verrou. */
  private async reserve(
    auth: TenantContext,
    feature: AiFeature,
    establishmentId: string | null,
    provider: string,
    model: string,
  ): Promise<string> {
    const organizationId = auth.membership.organizationId;
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
        where: { organizationId, createdAt: { gte: this.monthStart(auth.membership.timezone) } },
      });
      const limit = await this.effectiveLimit(tx, organizationId, settings.monthlyCallLimit);
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
          establishmentId,
          membershipId: auth.membership.id,
          feature,
          provider,
          model,
        },
        select: { id: true },
      });
      // Alerte de dépassement : journalisée une fois, au franchissement du seuil.
      const threshold = Math.ceil((limit * settings.alertPercent) / 100);
      if (used + 1 === threshold) {
        await this.audit.record(
          {
            organizationId,
            actorUserId: auth.user.id,
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

  /** Date d'échéance de conservation d'un résultat créé maintenant. */
  async expiryFor(organizationId: string): Promise<Date> {
    const { retentionDays } = await this.settings(organizationId);
    return new Date(`${addDays(new Date().toISOString().slice(0, 10), retentionDays)}T23:59:59Z`);
  }

  /**
   * Efface les contenus arrivés à échéance (résultats d'import, transcriptions, paniers proposés).
   * Les traces (qui, quand, quel fichier par son empreinte) restent pour l'audit.
   */
  async purgeExpired(organizationId: string) {
    const now = new Date();
    const [imports, drafts] = await this.prisma.$transaction([
      this.prisma.aiImport.updateMany({
        where: { organizationId, expiresAt: { lt: now }, purgedAt: null },
        data: { result: Prisma.DbNull, purgedAt: now },
      }),
      this.prisma.voiceOrderDraft.updateMany({
        where: { organizationId, expiresAt: { lt: now }, purgedAt: null },
        data: {
          transcript: null,
          proposal: Prisma.DbNull,
          purgedAt: now,
        },
      }),
    ]);
    return { imports: imports.count, voiceDrafts: drafts.count };
  }
}
