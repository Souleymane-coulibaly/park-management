import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  SCHOOL_AI_FEATURES,
  SchoolPermission,
  type SchoolAiFeature,
  hasSchoolPermission,
  microUsdToXof,
} from '@ocall/shared';
import { AiGatewayService } from '../../../ai-core/ai-gateway.service';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import type { AiPrompt } from '../../../ai-core/ai-prompts';
import type { AiProvider, AiResult } from '../../../ai-core/ai-provider';
import { registerAiSimulation } from '../../../ai-core/providers/simulated.provider';
import type { SchoolContext } from '../school-access';
import { SchoolPrismaService } from '../school-prisma.service';
import { SchoolService } from '../school.service';
import { SCHOOL_AI_SIMULATION } from './school-ai-simulation';
import {
  SCHOOL_AI_APPLICATION,
  SCHOOL_AI_ENABLED_FIELD,
  SchoolAiUsageStore,
  schoolMonthStart,
} from './school-ai-usage.store';
import type { SchoolAiSettingsDto } from './school-ai.dto';

const DEFAULTS = {
  enabled: false,
  copilotEnabled: true,
  teachingEnabled: true,
  analysisEnabled: true,
  monthlyCallLimit: 300,
  alertPercent: 80,
  conversationRetentionDays: 30,
};

const SETTINGS_SELECT = {
  enabled: true,
  copilotEnabled: true,
  teachingEnabled: true,
  analysisEnabled: true,
  monthlyCallLimit: true,
  alertPercent: true,
  conversationRetentionDays: true,
} as const;

export type SchoolAiSettingsView = typeof DEFAULTS;

/**
 * Socle d'Ocall School AI sur Ocall AI Core : inscription de l'application `school` (stockage de la
 * consommation dans la base School, scénarios de simulation), réglages par établissement (activation,
 * modules, quota, conservation des conversations), état, consommation et coût ESTIMÉ, contexte de chaque
 * appel construit depuis la session School (établissement contrôlé, utilisateur, rôle, opération).
 */
@Injectable()
export class SchoolAiService implements OnModuleInit {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    private readonly gateway: AiGatewayService,
    private readonly store: SchoolAiUsageStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    // Sans base School (module désactivé), l'application n'est pas inscrite : aucun nettoyage inutile.
    if (!this.config.school.enabled) return;
    this.gateway.registerApplication(SCHOOL_AI_APPLICATION, this.store);
    registerAiSimulation(SCHOOL_AI_SIMULATION);
  }

  model(feature: SchoolAiFeature): string {
    return this.gateway.model(feature);
  }

  /** Établissement contrôlé (organisation et périmètre de l'utilisateur) et son fuseau. */
  async scope(ctx: SchoolContext, schoolId: string) {
    const { defaultLocale } = await this.school.assertSchool(ctx, schoolId);
    const row = await this.db.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { id: true, name: true, nameAr: true, timezone: true },
    });
    return { ...row, defaultLocale };
  }

  /**
   * Appel IA de School par Ocall AI Core. Le contexte vient de la session : jamais du modèle ni du
   * navigateur (l'établissement a été contrôlé par `scope`).
   */
  run<T>(
    ctx: SchoolContext,
    school: { id: string; timezone: string },
    feature: SchoolAiFeature,
    prompt: AiPrompt,
    call: (provider: AiProvider, model: string) => Promise<AiResult<T>>,
  ): Promise<T> {
    const model = this.model(feature);
    return this.gateway.run(
      {
        application: SCHOOL_AI_APPLICATION,
        organizationId: ctx.organizationId,
        establishmentId: school.id,
        actorUserId: ctx.userId,
        actorRef: ctx.memberId,
        role: ctx.role,
        operation: feature,
        timezone: school.timezone,
        // Offre Ocall School Free (socle S1) : plafond contractuel par établissement.
        contractMonthlyLimit: ctx.limits.aiMonthlyCallsPerSchool ?? null,
      },
      { model, prompt },
      (provider) => call(provider, model),
    );
  }

  async settings(ctx: SchoolContext, schoolId: string): Promise<SchoolAiSettingsView> {
    await this.school.assertSchool(ctx, schoolId);
    const row = await this.db.schoolAiSettings.findFirst({
      where: { organizationId: ctx.organizationId, schoolId },
      select: SETTINGS_SELECT,
    });
    return row ?? DEFAULTS;
  }

  async updateSettings(ctx: SchoolContext, schoolId: string, dto: SchoolAiSettingsDto) {
    await this.school.assertSchool(ctx, schoolId);
    const row = await this.db.schoolAiSettings.upsert({
      where: { schoolId },
      create: { organizationId: ctx.organizationId, schoolId, ...dto, updatedByUserId: ctx.userId },
      update: { ...dto, updatedByUserId: ctx.userId },
      select: SETTINGS_SELECT,
    });
    await this.school.log(ctx, 'school.ai_settings_updated', 'School', schoolId, {
      ...Object.fromEntries(Object.entries(dto).map(([k, v]) => [k, String(v)])),
    });
    // Une conservation raccourcie s'applique aussitôt aux conversations existantes.
    if (dto.conversationRetentionDays !== undefined) await this.purgeExpired(ctx, schoolId);
    return row;
  }

  /**
   * État pour l'utilisateur : IA configurée sur la plateforme, activée pour l'établissement, modules
   * accessibles à son rôle, consommation du mois. Aucune clé ni configuration secrète n'est renvoyée.
   */
  async status(ctx: SchoolContext, schoolId: string) {
    const school = await this.scope(ctx, schoolId);
    const settings = await this.settings(ctx, schoolId);
    const used = await this.db.schoolAiUsage.count({
      where: {
        organizationId: ctx.organizationId,
        schoolId,
        createdAt: { gte: schoolMonthStart(school.timezone) },
      },
    });
    const allowed: Record<SchoolAiFeature, boolean> = {
      SCHOOL_COPILOT: hasSchoolPermission(ctx.role, SchoolPermission.AI_COPILOT),
      SCHOOL_TEACHING: hasSchoolPermission(ctx.role, SchoolPermission.AI_TEACHING),
      SCHOOL_ANALYSIS: hasSchoolPermission(ctx.role, SchoolPermission.AI_ANALYSIS),
    };
    const configured = this.gateway.configured;
    return {
      configured,
      simulated: this.gateway.providerName === 'simulated',
      enabled: settings.enabled,
      features: Object.fromEntries(
        SCHOOL_AI_FEATURES.map((f) => [
          f,
          configured && settings.enabled && settings[SCHOOL_AI_ENABLED_FIELD[f]] && allowed[f],
        ]),
      ) as Record<SchoolAiFeature, boolean>,
      canManage: hasSchoolPermission(ctx.role, SchoolPermission.AI_MANAGE),
      // Droits du rôle seuls : consulter ses contenus reste possible quand l'IA est coupée.
      allowed,
      usage: {
        used,
        limit: settings.monthlyCallLimit,
        alert:
          settings.monthlyCallLimit > 0 &&
          used * 100 >= settings.monthlyCallLimit * settings.alertPercent,
        exceeded: used >= settings.monthlyCallLimit,
      },
    };
  }

  /** Consommation du mois de l'établissement : appels, jetons et coût ESTIMÉ par module et statut. */
  async usage(ctx: SchoolContext, schoolId: string) {
    const school = await this.scope(ctx, schoolId);
    const since = schoolMonthStart(school.timezone);
    const rows = await this.db.schoolAiUsage.groupBy({
      by: ['feature', 'status'],
      where: { organizationId: ctx.organizationId, schoolId, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, estimatedCostMicroUsd: true },
    });
    const unestimated = await this.db.schoolAiUsage.count({
      where: {
        organizationId: ctx.organizationId,
        schoolId,
        createdAt: { gte: since },
        estimatedCostMicroUsd: null,
        // Coût inconnu : appels réussis, et appels échoués qui ont consommé des jetons.
        OR: [{ status: 'SUCCEEDED' }, { inputTokens: { gt: 0 } }, { outputTokens: { gt: 0 } }],
      },
    });
    const rate = this.gateway.usdXofRate;
    return {
      since,
      provider: this.gateway.providerName,
      usdXofRate: rate,
      costIsEstimate: true,
      unestimatedCalls: unestimated,
      rows: rows.map((r) => ({
        feature: r.feature,
        status: r.status,
        calls: r._count._all,
        inputTokens: r._sum.inputTokens ?? 0,
        outputTokens: r._sum.outputTokens ?? 0,
        estimatedCostMicroUsd: r._sum.estimatedCostMicroUsd ?? 0,
        estimatedCostXof: microUsdToXof(r._sum.estimatedCostMicroUsd ?? 0, rate),
      })),
    };
  }

  /** Échéance de conservation d'une conversation mise à jour maintenant. */
  async conversationExpiry(ctx: SchoolContext, schoolId: string): Promise<Date> {
    const { conversationRetentionDays } = await this.settings(ctx, schoolId);
    return new Date(Date.now() + conversationRetentionDays * 86_400_000);
  }

  /** Supprime les conversations arrivées à échéance (messages compris) ; renvoie leur nombre. */
  async purgeExpired(ctx: SchoolContext, schoolId: string) {
    await this.school.assertSchool(ctx, schoolId);
    const settings = await this.settings(ctx, schoolId);
    const cutoff = new Date(Date.now() - settings.conversationRetentionDays * 86_400_000);
    const deleted = await this.db.schoolAiConversation.deleteMany({
      where: {
        organizationId: ctx.organizationId,
        schoolId,
        OR: [{ expiresAt: { lt: new Date() } }, { updatedAt: { lt: cutoff } }],
      },
    });
    return { conversations: deleted.count };
  }
}
