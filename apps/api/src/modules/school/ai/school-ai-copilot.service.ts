import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { SCHOOL_AI_LIMITS, hasSchoolPermission, numbersAreGrounded } from '@ocall/shared';
import { toolExecutor } from '../../../ai-core/ai-tools';
import type { SchoolContext } from '../school-access';
import { SchoolPrismaService } from '../school-prisma.service';
import { today } from '../school-report-cards.service';
import { SchoolReportingService } from '../school-reporting.service';
import {
  SCHOOL_AI_TOOLS,
  type SchoolAiResult,
  type SchoolAiTool,
  type SchoolToolContext,
  allowedSchoolTools,
} from './school-ai-tools';
import { SCHOOL_COPILOT_PROMPT } from './school-ai.prompts';
import { SchoolAiPrivacyService } from './school-ai-privacy.service';
import { SchoolAiService } from './school-ai.service';

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Données autorisées pour le contrôle des chiffres : nombres décimaux écrits à la française (« 11,33 »),
 * comme les cite le modèle ; sans cela, « 11.33 » serait lu comme deux nombres.
 */
export function groundTruthOf(...parts: string[]): string {
  return parts.join(' ').replace(/(\d)\.(\d)/g, '$1,$2');
}

/**
 * Copilote de direction (Ocall School AI, module A) : questions en langage naturel sur les rapports du
 * Sprint 8, par appel d'outils sécurisé d'Ocall AI Core. Lecture seule ; établissement et année de la
 * session ; une réponse qui citerait un chiffre absent des résultats est écartée ; période, filtres et
 * sources affichés ; historique limité, propre à son auteur, conservé selon le réglage de l'école.
 */
@Injectable()
export class SchoolAiCopilotService {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly ai: SchoolAiService,
    private readonly reporting: SchoolReportingService,
    private readonly privacy: SchoolAiPrivacyService,
  ) {}

  async ask(ctx: SchoolContext, schoolId: string, asked: string, conversationId?: string) {
    const school = await this.ai.scope(ctx, schoolId);
    // Avant tout appel au fournisseur : aucun élève ni responsable cité, coordonnées masquées.
    const question = (await this.privacy.protect(ctx, schoolId, [asked]))[0]!;
    const year = await this.db.schoolYear.findFirst({
      where: { organizationId: ctx.organizationId, schoolId, status: 'ACTIVE' },
      select: { id: true, label: true, startsOn: true, endsOn: true },
    });
    if (!year) {
      throw new UnprocessableEntityException({
        code: 'AI_NO_ACTIVE_YEAR',
        message:
          'Aucune année scolaire en cours pour cet établissement : aucune donnée à analyser.',
      });
    }
    const conversation = conversationId
      ? await this.ownConversation(ctx, schoolId, conversationId)
      : null;
    if (conversation && conversation.messages >= SCHOOL_AI_LIMITS.messagesPerConversation) {
      throw new UnprocessableEntityException({
        code: 'AI_CONVERSATION_FULL',
        message: 'Cette conversation a atteint sa longueur maximale : commencez-en une nouvelle.',
      });
    }
    const classes = await this.db.schoolClass.findMany({
      where: { organizationId: ctx.organizationId, schoolYearId: year.id, isActive: true },
      select: { id: true, name: true, nameAr: true },
    });
    const toolContext: SchoolToolContext = {
      ctx,
      yearId: year.id,
      today: today(school.timezone),
      yearStart: day(year.startsOn),
      yearEnd: day(year.endsOn),
      reporting: this.reporting,
      classes,
    };
    const allowed = allowedSchoolTools(ctx);
    const executor = toolExecutor<SchoolToolContext, SchoolAiTool, SchoolAiResult>({
      tools: SCHOOL_AI_TOOLS,
      maxCalls: SCHOOL_AI_LIMITS.toolCallsPerQuestion,
      allow: (tool) =>
        tool.permission && !hasSchoolPermission(ctx.role, tool.permission) ? 'NOT_ALLOWED' : null,
      context: () => toolContext,
      present: (r) => ({
        title: r.title,
        period: r.period,
        filters: r.filters,
        data: r.data,
        missing: r.missing,
      }),
    });
    const { answer } = await this.ai.run(
      ctx,
      school,
      'SCHOOL_COPILOT',
      SCHOOL_COPILOT_PROMPT,
      (provider, model) =>
        provider.runWithTools({
          model,
          instructions: `${SCHOOL_COPILOT_PROMPT.instructions} Établissement courant : ${school.name}. Année scolaire en cours : ${year.label}.`,
          question,
          tools: executor.definitions(allowed),
          execute: executor.execute,
          maxRounds: 3,
        }),
    );
    const results = executor.results;
    const grounded = numbersAreGrounded(
      answer,
      // Chiffres autorisés : ceux des résultats calculés par le serveur (et l'identité de l'école),
      // jamais ceux de la question : « confirme qu'il y a 999 élèves » ne fonde aucun chiffre.
      groundTruthOf(
        school.name,
        year.label,
        // Valeurs calculées seulement : ni les filtres renvoyés tels quels (un argument du modèle
        // comme « classe 999 »), ni les résultats sans donnée ne fondent un chiffre.
        JSON.stringify(
          results
            .filter((r) => Object.keys(r.data).length > 0)
            .map((r) => ({ period: r.period, data: r.data })),
        ),
      ),
    );
    const text = answer.trim().slice(0, 4000);
    const finalAnswer = grounded
      ? text
      : results.length
        ? 'Voici les chiffres calculés sur les rapports de l’établissement.'
        : 'Je ne peux pas répondre de façon fiable à cette question à partir des rapports disponibles. Reformulez-la, par exemple en précisant la période.';
    const sources = results.map((r) => ({
      tool: r.tool,
      title: r.title,
      period: r.period,
      filters: r.filters,
      missing: r.missing,
    }));
    const saved = await this.save(ctx, schoolId, conversation?.id ?? null, question, {
      answer: finalAnswer,
      grounded,
      sources: { sources, results },
    });
    return {
      conversationId: saved,
      question,
      school: { id: school.id, name: school.name },
      year: { id: year.id, label: year.label },
      answer: finalAnswer,
      // Faux : la formulation de l'IA citait un chiffre absent des rapports et a été écartée.
      grounded,
      sources,
      results,
      rejected: executor.rejected,
    };
  }

  /** Conversations de l'utilisateur pour un établissement (les échues sont purgées d'abord). */
  async conversations(ctx: SchoolContext, schoolId: string) {
    await this.ai.purgeExpired(ctx, schoolId);
    return this.db.schoolAiConversation.findMany({
      where: { organizationId: ctx.organizationId, schoolId, ownerUserId: ctx.userId },
      orderBy: { updatedAt: 'desc' },
      take: SCHOOL_AI_LIMITS.conversationsPerUser,
      select: { id: true, title: true, updatedAt: true, expiresAt: true },
    });
  }

  async conversation(ctx: SchoolContext, schoolId: string, id: string): Promise<ConversationView> {
    await this.ai.purgeExpired(ctx, schoolId);
    await this.ownConversation(ctx, schoolId, id);
    return this.db.schoolAiConversation.findFirstOrThrow({
      where: { id, organizationId: ctx.organizationId },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        expiresAt: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            content: true,
            sources: true,
            grounded: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async deleteConversation(ctx: SchoolContext, schoolId: string, id: string) {
    await this.ownConversation(ctx, schoolId, id);
    await this.db.schoolAiConversation.deleteMany({
      where: { id, organizationId: ctx.organizationId },
    });
    return { ok: true };
  }

  private async ownConversation(ctx: SchoolContext, schoolId: string, id: string) {
    const row = await this.db.schoolAiConversation.findFirst({
      where: {
        id,
        organizationId: ctx.organizationId,
        schoolId,
        ownerUserId: ctx.userId,
        expiresAt: { gte: new Date() },
      },
      select: { id: true, _count: { select: { messages: true } } },
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return { id: row.id, messages: row._count.messages };
  }

  /** Enregistre la question et la réponse ; crée la conversation au besoin (au plus 50 par utilisateur). */
  private async save(
    ctx: SchoolContext,
    schoolId: string,
    conversationId: string | null,
    question: string,
    reply: { answer: string; grounded: boolean; sources: object },
  ): Promise<string> {
    const expiresAt = await this.ai.conversationExpiry(ctx, schoolId);
    return this.db.$transaction(async (tx) => {
      let id = conversationId;
      if (id) {
        await tx.schoolAiConversation.update({ where: { id }, data: { expiresAt } });
      } else {
        const owned = await tx.schoolAiConversation.findMany({
          where: { organizationId: ctx.organizationId, ownerUserId: ctx.userId },
          orderBy: { updatedAt: 'desc' },
          skip: SCHOOL_AI_LIMITS.conversationsPerUser - 1,
          select: { id: true },
        });
        // Historique limité : les plus anciennes conversations cèdent la place.
        if (owned.length) {
          await tx.schoolAiConversation.deleteMany({
            where: { id: { in: owned.map((o) => o.id) } },
          });
        }
        id = (
          await tx.schoolAiConversation.create({
            data: {
              organizationId: ctx.organizationId,
              schoolId,
              ownerUserId: ctx.userId,
              title: question.slice(0, 80),
              expiresAt,
            },
            select: { id: true },
          })
        ).id;
      }
      // Horodatage explicite : la réponse suit toujours la question dans l'historique.
      const asked = new Date();
      await tx.schoolAiMessage.createMany({
        data: [
          {
            organizationId: ctx.organizationId,
            conversationId: id,
            role: 'USER',
            createdAt: asked,
            content: question,
          },
          {
            organizationId: ctx.organizationId,
            conversationId: id,
            role: 'ASSISTANT',
            createdAt: new Date(asked.getTime() + 1),
            content: reply.answer,
            grounded: reply.grounded,
            sources: reply.sources,
          },
        ],
      });
      return id;
    });
  }
}

export interface ConversationView {
  id: string;
  title: string;
  updatedAt: Date;
  expiresAt: Date;
  messages: {
    id: string;
    role: string;
    content: string;
    sources: unknown;
    grounded: boolean | null;
    createdAt: Date;
  }[];
}
