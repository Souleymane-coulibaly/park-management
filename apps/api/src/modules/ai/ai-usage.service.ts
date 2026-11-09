import { ConflictException, Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@ocall/database';
import { AI_FEATURES, type AiFeature, addDays, microUsdToXof } from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { organizationQuotas } from '../../common/quotas';
import { AiGatewayService } from '../../ai-core/ai-gateway.service';
import type { AiPrompt } from '../../ai-core/ai-prompts';
import type { AiProvider, AiResult } from '../../ai-core/ai-provider';
import { registerAiSimulation } from '../../ai-core/providers/simulated.provider';
import { PARK_AI_SIMULATION } from './park-ai-simulation';
import {
  ENABLED_FIELD,
  PARK_AI_APPLICATION,
  ParkAiUsageStore,
  SETTINGS_SELECT,
  effectiveLimit,
  monthStart,
} from './park-ai-usage.store';

export interface AiSettingsRow {
  catalogImportEnabled: boolean;
  ticketImportEnabled: boolean;
  copilotEnabled: boolean;
  voiceOrderEnabled: boolean;
  monthlyCallLimit: number;
  alertPercent: number;
  retentionDays: number;
}

/**
 * IA d'Ocall Park sur Ocall AI Core : réglages, état, consommation et rétention de l'organisation ;
 * chaque appel passe par l'orchestrateur commun (limitation de débit, quota réservé sous verrou par le
 * stockage Park, consommation, coût ESTIMÉ, version du prompt, journal technique des erreurs). Aucun
 * contenu n'est journalisé. Les contrats d'API du Sprint 8 sont inchangés.
 */
@Injectable()
export class AiUsageService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly gateway: AiGatewayService,
    private readonly store: ParkAiUsageStore,
  ) {}

  onModuleInit() {
    this.gateway.registerApplication(PARK_AI_APPLICATION, this.store);
    registerAiSimulation(PARK_AI_SIMULATION);
  }

  /** Fournisseur actif, ou erreur claire : l'application reste utilisable sans IA. */
  requireProvider(): AiProvider {
    return this.gateway.requireProvider();
  }

  model(feature: AiFeature): string {
    return this.gateway.model(feature);
  }

  transcribeModel(): string {
    return this.gateway.transcribeModel();
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
    // Plafond présenté = plafond réellement appliqué (min du réglage et de l'offre) : un réglage
    // antérieur ou par défaut supérieur à l'offre (ex. 500 face aux 150 de la grille S1) reste
    // enregistrable tel qu'affiché, au lieu de bloquer tout le formulaire.
    return {
      ...settings,
      monthlyCallLimit: Math.min(settings.monthlyCallLimit, quotas.aiMonthlyCalls),
      platformLimit: quotas.aiMonthlyCalls,
    };
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

  /** État de l'IA pour l'organisation : fonctionnalités, consommation du mois, alerte. */
  async status(auth: TenantContext) {
    const organizationId = auth.membership.organizationId;
    const settings = await this.settings(organizationId);
    const used = await this.prisma.aiUsage.count({
      where: { organizationId, createdAt: { gte: monthStart(auth.membership.timezone) } },
    });
    const limit = await effectiveLimit(this.prisma, organizationId, settings.monthlyCallLimit);
    const configured = this.gateway.configured;
    return {
      configured,
      simulated: this.gateway.providerName === 'simulated',
      features: Object.fromEntries(
        AI_FEATURES.map((f) => [f, configured && Boolean(settings[ENABLED_FIELD[f]])]),
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
    const since = monthStart(auth.membership.timezone);
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
        estimatedCostMicroUsd: null,
        // Coût inconnu : appels réussis, et appels échoués qui ont consommé des jetons.
        OR: [{ status: 'SUCCEEDED' }, { inputTokens: { gt: 0 } }, { outputTokens: { gt: 0 } }],
      },
    });
    const establishments = await this.prisma.establishment.findMany({
      where: { organizationId },
      select: { id: true, name: true },
    });
    const names = new Map(establishments.map((e) => [e.id, e.name]));
    const rate = this.gateway.usdXofRate;
    return {
      since,
      provider: this.gateway.providerName,
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
   * Exécute un appel IA de Park par Ocall AI Core : contexte construit depuis la session (application,
   * organisation, établissement contrôlé par l'appelant, utilisateur, rôle, fonctionnalité).
   */
  async run<T>(
    auth: TenantContext,
    feature: AiFeature,
    establishmentId: string | null,
    model: string,
    call: (provider: AiProvider) => Promise<AiResult<T>>,
    prompt: AiPrompt | null = null,
  ): Promise<T> {
    return this.gateway.run(
      {
        application: PARK_AI_APPLICATION,
        organizationId: auth.membership.organizationId,
        establishmentId,
        actorUserId: auth.user.id,
        actorRef: auth.membership.id,
        role: auth.membership.role,
        operation: feature,
        timezone: auth.membership.timezone,
      },
      { model, prompt },
      call,
    );
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
