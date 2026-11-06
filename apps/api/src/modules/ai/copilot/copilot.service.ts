import { Injectable } from '@nestjs/common';
import { coversActivity, hasPermission, numbersAreGrounded } from '@ocall/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import type { TenantContext } from '../../../common/auth-context';
import { type AiToolRejection, toolExecutor } from '../../../ai-core/ai-tools';
import { stripSimulationDirectives } from '../../../ai-core/providers/simulated.provider';
import { AnalyticsService } from '../../analytics/analytics.service';
import { findSellingEstablishment } from '../../pos/pos-scope';
import { AiUsageService } from '../ai-usage.service';
import {
  ANALYTICS_TOOLS,
  type AnalyticsContext,
  type AnalyticsResult,
  type AnalyticsTool,
} from './analytics-tools';
import { PARK_COPILOT_PROMPT } from './copilot.prompt';

/** Au plus 4 fonctions par question : borne le coût et la durée d'une réponse. */
const MAX_TOOL_CALLS = 4;

export type CopilotRejection = AiToolRejection;

/**
 * Copilote analytique : le modèle choisit parmi des fonctions de lecture prédéfinies ; le serveur
 * valide chaque appel (appel d'outils sécurisé d'Ocall AI Core), applique l'organisation et
 * l'établissement de la session (jamais ceux proposés par le modèle) et calcule les chiffres. Les
 * chiffres affichés viennent des résultats serveur ; une réponse rédigée qui citerait un chiffre absent
 * de ces résultats est écartée.
 */
@Injectable()
export class CopilotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiUsageService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** Fonctions proposées : seulement celles permises au rôle et à l'activité de l'établissement. */
  private availableTools(auth: TenantContext, businessType: Parameters<typeof coversActivity>[0]) {
    return ANALYTICS_TOOLS.filter(
      (t) =>
        hasPermission(auth.membership.role, t.permission) &&
        (!t.activity || coversActivity(businessType, t.activity)),
    );
  }

  async ask(auth: TenantContext, establishmentId: string, question: string) {
    // Établissement contrôlé par le serveur : organisation et périmètre d'affectation du membre.
    const scoped = await findSellingEstablishment(this.prisma, auth, establishmentId);
    const establishment = { id: scoped.id, name: scoped.name, timezone: scoped.timezone };
    const tools = this.availableTools(auth, scoped.businessType);
    const executor = toolExecutor<AnalyticsContext, AnalyticsTool, AnalyticsResult>({
      tools: ANALYTICS_TOOLS,
      maxCalls: MAX_TOOL_CALLS,
      allow: (tool) =>
        !hasPermission(auth.membership.role, tool.permission)
          ? 'NOT_ALLOWED'
          : tool.activity && !coversActivity(scoped.businessType, tool.activity)
            ? 'NOT_AVAILABLE'
            : null,
      context: () => ({
        prisma: this.prisma,
        organizationId: auth.membership.organizationId,
        establishment,
        now: new Date(),
        analytics: this.analytics,
      }),
      present: (result) => ({
        title: result.title,
        period: result.period?.label ?? null,
        data: result.data,
        missing: result.missing,
      }),
    });

    const model = this.ai.model('COPILOT');
    const { answer } = await this.ai.run(
      auth,
      'COPILOT',
      establishment.id,
      model,
      (provider) =>
        provider.runWithTools({
          model,
          instructions: `${PARK_COPILOT_PROMPT.instructions} Établissement courant : ${establishment.name}.`,
          question,
          tools: executor.definitions(tools),
          execute: executor.execute,
          maxRounds: 3,
        }),
      PARK_COPILOT_PROMPT,
    );

    // Données autorisées : la question (sans consigne de simulation), l'établissement et les
    // résultats calculés par le serveur.
    const results = executor.results;
    const groundTruth = `${stripSimulationDirectives(question)} ${establishment.name} ${JSON.stringify(results)}`;
    const grounded = numbersAreGrounded(answer, groundTruth);
    const text = answer.trim().slice(0, 2000);
    return {
      question,
      establishment: { id: establishment.id, name: establishment.name },
      answer: grounded
        ? text
        : results.length
          ? 'Voici les chiffres calculés sur vos données.'
          : 'Je ne peux pas répondre de façon fiable à cette question. Reformulez-la, par exemple avec une période.',
      // Faux : la formulation de l'IA citait un chiffre absent des données et a été écartée.
      grounded,
      results,
      rejected: executor.rejected,
    };
  }
}
