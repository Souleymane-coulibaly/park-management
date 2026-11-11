import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@ocall/facture-database';
import {
  FACTURE_INTERVENTION_PRIORITY_LABELS,
  FACTURE_MAINTENANCE_REASON_LABELS,
  FACTURE_PLANNING_HORIZON_DAYS,
  type FactureInterventionPriority,
  type FactureMaintenanceReason,
  type PlanningCandidate,
  factureAiClaimsCertainty,
  factureMaintenanceCandidates,
  facturePlanningCandidates,
  hasFacturePermission,
  numbersAreGrounded,
} from '@ocall/shared';
import { AiProviderError, type AiResult, attachAiUsage } from '../../ai-core/ai-provider';
import { stripSimulationDirectives } from '../../ai-core/providers/simulated.provider';
import type { FactureContext } from './facture-access';
import { FACTURE_MAINTENANCE_PROMPT, FACTURE_PLANNING_PROMPT } from './facture-ai.prompts';
import { FactureAiService } from './facture-ai.service';
import { FactureInterventionsService } from './facture-interventions.service';
import { FacturePrismaService } from './facture-prisma.service';

type Db = FacturePrismaService | Prisma.TransactionClient;

const DAY = 86_400_000;
const MAX_MAINTENANCE_SUGGESTIONS = 20;
const INTERVENTION_REF = /INT-\d{4}-\d{5,}/g;

const dateFr = (d: Date) => d.toLocaleDateString('fr-FR', { timeZone: 'UTC' });
const timeFr = (d: Date) =>
  d.toLocaleTimeString('fr-FR', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Sortie inacceptable du modèle : refusée (consommation enregistrée), jamais proposée. */
function invalid(result: AiResult<unknown>, message: string): never {
  const error = new AiProviderError('AI_INVALID_OUTPUT', message);
  attachAiUsage(error, result.usage);
  throw error;
}

export interface PlanningProposalCandidate {
  memberId: string;
  name: string;
  start: string;
  end: string;
  requestedSlot: boolean;
  skillsMatched: number;
  skillsRequired: number;
  load: number;
  conflicts: string[];
  reason: string | null;
}

/**
 * Planification intelligente et maintenance préventive intelligente (F6B). Le SERVEUR calcule
 * disponibilités, conflits, créneaux libres et équipements à entretenir (`@ocall/shared`) ; l'IA classe
 * et explique ces seuls candidats. Affectation après validation du responsable, revérifiée au moment
 * d'appliquer ; une suggestion de maintenance ne devient une intervention que par le formulaire de
 * planification.
 */
@Injectable()
export class FactureAiPlanningService {
  constructor(
    private readonly db: FacturePrismaService,
    private readonly ai: FactureAiService,
    private readonly interventions: FactureInterventionsService,
  ) {}

  // ─── Planification intelligente ───

  async planning(ctx: FactureContext, interventionId: string, now = new Date()) {
    const row = await this.db.factureIntervention.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id: interventionId } },
      include: { requiredSkills: { select: { skillId: true, skill: { select: { name: true } } } } },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'FACTURE_INTERVENTION_NOT_FOUND',
        message: 'Intervention introuvable.',
      });
    }
    if (row.status !== 'PLANNED') {
      throw new ConflictException({
        code: 'FACTURE_AI_PLANNING_CLOSED',
        message: 'Seule une intervention planifiée, pas encore commencée, se réaffecte.',
      });
    }
    const requiredSkillIds = row.requiredSkills.map((s) => s.skillId);
    const candidates = await this.candidates(this.db, ctx.organizationId, {
      id: row.id,
      start: row.scheduledStart,
      end: row.scheduledEnd,
      priority: row.priority,
      requiredSkillIds,
      now,
    });
    if (candidates.length === 0) {
      throw new ConflictException({
        code: 'FACTURE_AI_NO_CANDIDATE',
        message: `Aucun technicien disponible avec ces compétences dans les ${FACTURE_PLANNING_HORIZON_DAYS} prochains jours.`,
      });
    }
    const refs = new Map(candidates.map((c, i) => [`c${i + 1}`, c]));
    const facts = [
      `INTERVENTION : ${row.number} — ${row.title}`,
      `Priorité : ${FACTURE_INTERVENTION_PRIORITY_LABELS[row.priority]}`,
      `Créneau demandé : ${dateFr(row.scheduledStart)} ${timeFr(row.scheduledStart)}–${timeFr(row.scheduledEnd)}`,
      `Compétences requises : ${row.requiredSkills.map((s) => s.skill.name).join(', ') || 'aucune'}`,
      'CANDIDATS (référence | technicien | créneau | compétences détenues | interventions prévues) :',
      ...[...refs].map(
        ([ref, c]) =>
          `${ref} | ${c.name} | ${dateFr(c.start)} ${timeFr(c.start)}–${timeFr(c.end)}${c.requestedSlot ? ' (créneau demandé)' : ''} | ${c.skillsMatched}/${c.skillsRequired} | ${c.load}${c.conflicts.length ? ` | occupé sur le créneau demandé : ${c.conflicts.join(', ')}` : ''}`,
      ),
    ].join('\n');

    const result = await this.ai.run(
      ctx,
      'FACTURE_PLANNING',
      FACTURE_PLANNING_PROMPT,
      async (provider, model) => {
        const out = await provider.structureText<Record<string, unknown>>({
          model,
          instructions: FACTURE_PLANNING_PROMPT.instructions,
          text: facts,
          schemaName: 'facture_ai_planning',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['summary', 'ranking'],
            properties: {
              summary: { type: 'string' },
              ranking: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['ref', 'reason'],
                  properties: { ref: { type: 'string' }, reason: { type: 'string' } },
                },
              },
            },
          },
        });
        const ranking = Array.isArray(out.value?.ranking) ? (out.value.ranking as unknown[]) : [];
        // Seuls les candidats calculés par le serveur ; un candidat cité deux fois ne compte qu'une fois.
        const seen = new Set<string>();
        const ranked: { ref: string; reason: string }[] = [];
        for (const raw of ranking) {
          const r = raw as { ref?: unknown; reason?: unknown };
          const ref = typeof r.ref === 'string' ? r.ref.trim() : '';
          if (!refs.has(ref) || seen.has(ref)) continue;
          seen.add(ref);
          ranked.push({ ref, reason: text(r.reason, 300) });
        }
        const summary = text(out.value?.summary, 400);
        if (ranked.length === 0) invalid(out, 'Classement proposé illisible. Réessayez.');
        const said = `${summary} ${ranked.map((r) => r.reason).join(' ')}`;
        if (!numbersAreGrounded(said, stripSimulationDirectives(facts))) {
          invalid(out, 'Le classement proposé citait des chiffres absents du planning. Réessayez.');
        }
        return { value: { summary, ranked }, usage: out.usage };
      },
    );

    // Classement de l'IA, puis les candidats qu'elle n'a pas cités (le serveur ne perd personne).
    const order = [
      ...result.ranked.map((r) => ({ c: refs.get(r.ref)!, reason: r.reason || null })),
      ...[...refs]
        .filter(([ref]) => !result.ranked.some((r) => r.ref === ref))
        .map(([, c]) => ({ c, reason: null })),
    ];
    const output = {
      summary: result.summary || null,
      candidates: order.map(({ c, reason }) => ({ ...view(c), reason })),
    };
    const proposal = await this.db.factureAiProposal.create({
      data: {
        organizationId: ctx.organizationId,
        feature: 'FACTURE_PLANNING',
        targetType: 'FactureIntervention',
        targetId: row.id,
        input: {
          priority: row.priority,
          requiredSkills: requiredSkillIds.length,
          candidates: candidates.length,
        },
        output: output as unknown as Prisma.InputJsonValue,
        promptId: FACTURE_PLANNING_PROMPT.id,
        promptVersion: FACTURE_PLANNING_PROMPT.version,
        model: this.ai.modelOf('FACTURE_PLANNING'),
        createdByUserId: ctx.userId,
      },
      select: { id: true },
    });
    await this.ai.record(ctx, 'facture.ai_planning_proposed', proposal.id);
    return { proposalId: proposal.id, ...output };
  }

  /**
   * Affectation choisie par le responsable : le créneau est revérifié au moment d'appliquer (sous verrou
   * du technicien : deux affectations simultanées ne se chevauchent pas), puis l'intervention est
   * modifiée dans la même transaction (notifications de report comprises).
   */
  async assign(ctx: FactureContext, proposalId: string, choice: number, now = new Date()) {
    if (
      !hasFacturePermission(ctx.role, 'facture.ai.planning') ||
      !hasFacturePermission(ctx.role, 'facture.interventions.manage')
    ) {
      throw this.ai.denied();
    }
    const interventionId = await this.db.$transaction(async (tx) => {
      const proposal = await this.ai.lockProposal(tx, ctx, proposalId);
      if (proposal.feature !== 'FACTURE_PLANNING') {
        throw new ConflictException({
          code: 'FACTURE_AI_PROPOSAL_INVALID',
          message: 'Cette proposition n’est pas une affectation.',
        });
      }
      if (proposal.status === 'APPLIED') return proposal.targetId;
      if (proposal.status !== 'PROPOSED') throw this.ai.decided();
      const output = proposal.output as unknown as { candidates: PlanningProposalCandidate[] };
      const chosen = output.candidates[choice];
      if (!chosen) {
        throw new BadRequestException({
          code: 'FACTURE_AI_CHOICE_INVALID',
          message: 'Candidat introuvable dans la proposition.',
        });
      }
      const start = new Date(chosen.start);
      const end = new Date(chosen.end);
      // Proposition encore d'actualité : intervention toujours planifiée, même durée, créneau à venir.
      const [current] = await tx.$queryRaw<
        { status: string; scheduledStart: Date; scheduledEnd: Date }[]
      >`SELECT "status", "scheduledStart", "scheduledEnd" FROM "FactureIntervention"
        WHERE "organizationId" = ${ctx.organizationId}::uuid AND "id" = ${proposal.targetId}::uuid FOR UPDATE`;
      if (
        !current ||
        current.status !== 'PLANNED' ||
        start.getTime() <= now.getTime() ||
        end.getTime() - start.getTime() !==
          current.scheduledEnd.getTime() - current.scheduledStart.getTime()
      ) {
        throw new ConflictException({
          code: 'FACTURE_AI_PROPOSAL_STALE',
          message:
            'L’intervention ou le créneau a changé depuis la proposition : demandez une nouvelle proposition.',
        });
      }
      // Sérialise les affectations d'un même technicien, puis revérifie qu'il est encore libre.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`facture-member/${chosen.memberId}`}))`;
      const taken =
        (await tx.factureInterventionTechnician.count({
          where: {
            organizationId: ctx.organizationId,
            memberId: chosen.memberId,
            interventionId: { not: proposal.targetId },
            intervention: {
              status: { in: ['PLANNED', 'IN_PROGRESS'] },
              scheduledStart: { lt: end },
              scheduledEnd: { gt: start },
            },
          },
        })) +
        (await tx.factureUnavailability.count({
          where: {
            organizationId: ctx.organizationId,
            memberId: chosen.memberId,
            startsAt: { lt: end },
            endsAt: { gt: start },
          },
        }));
      if (taken > 0) {
        throw new ConflictException({
          code: 'FACTURE_AI_SLOT_TAKEN',
          message:
            'Ce créneau n’est plus libre pour ce technicien : demandez une nouvelle proposition.',
        });
      }
      await this.interventions.updateInTx(
        tx,
        ctx,
        proposal.targetId,
        {
          scheduledStart: start.toISOString(),
          scheduledEnd: end.toISOString(),
          technicianIds: [chosen.memberId],
        },
        now,
      );
      await tx.factureAiProposal.update({
        where: { organizationId_id: { organizationId: ctx.organizationId, id: proposalId } },
        data: {
          status: 'APPLIED',
          decidedByUserId: ctx.userId,
          decidedAt: now,
          resultId: proposal.targetId,
          edited: choice !== 0,
        },
      });
      return proposal.targetId;
    });
    await this.ai.record(ctx, 'facture.ai_planning_applied', proposalId, { choice });
    return this.interventions.get(ctx, interventionId);
  }

  // ─── Maintenance préventive intelligente ───

  /** Suggestions encore en attente (sans appel IA). */
  async suggestions(ctx: FactureContext) {
    const rows = await this.db.factureAiProposal.findMany({
      where: {
        organizationId: ctx.organizationId,
        feature: 'FACTURE_MAINTENANCE',
        status: 'PROPOSED',
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: { id: true, output: true },
    });
    return rows.map((r) => ({ proposalId: r.id, ...(r.output as object) }));
  }

  /**
   * Analyse de l'historique RÉEL des équipements : le serveur sélectionne les équipements à entretenir
   * ou à vérifier ; l'IA rédige l'intitulé et l'explication, prudente et sourcée. Une suggestion déjà en
   * attente pour un équipement n'est pas dupliquée ; sans nouveau candidat, aucun appel IA.
   */
  async maintenance(ctx: FactureContext, now = new Date()) {
    const equipment = await this.db.factureEquipment.findMany({
      where: {
        organizationId: ctx.organizationId,
        isArchived: false,
        client: { isArchived: false },
      },
      take: 300,
      select: {
        id: true,
        name: true,
        brand: true,
        model: true,
        installedAt: true,
        maintenanceIntervalMonths: true,
        client: { select: { id: true, name: true } },
        interventions: {
          where: { completedAt: { not: null } },
          select: { number: true, completedAt: true, title: true },
          orderBy: { completedAt: 'desc' },
          take: 20,
        },
      },
    });
    const pending = new Set(
      (
        await this.db.factureAiProposal.findMany({
          where: {
            organizationId: ctx.organizationId,
            feature: 'FACTURE_MAINTENANCE',
            status: 'PROPOSED',
          },
          select: { targetId: true },
        })
      ).map((p) => p.targetId),
    );
    const byId = new Map(equipment.map((e) => [e.id, e]));
    const fresh = factureMaintenanceCandidates(
      equipment.map((e) => ({
        id: e.id,
        installedAt: e.installedAt,
        maintenanceIntervalMonths: e.maintenanceIntervalMonths,
        history: e.interventions.map((h) => ({ number: h.number, completedAt: h.completedAt! })),
      })),
      now,
    )
      .filter((c) => !pending.has(c.equipmentId))
      .slice(0, MAX_MAINTENANCE_SUGGESTIONS);
    if (fresh.length > 0) {
      const refs = new Map(fresh.map((c, i) => [`e${i + 1}`, c]));
      const facts = [...refs]
        .map(([ref, c]) => {
          const e = byId.get(c.equipmentId)!;
          return [
            `${ref} | ${[e.name, e.brand, e.model].filter(Boolean).join(' ')} | client : ${e.client.name}`,
            `signaux : ${c.reasons.map((r) => FACTURE_MAINTENANCE_REASON_LABELS[r]).join(' ; ')}`,
            `dernier entretien : ${c.lastServiceAt ? dateFr(c.lastServiceAt) : 'aucun'}`,
            `échéance conseillée : ${c.dueDate ? dateFr(c.dueDate) : 'non renseignée'}`,
            `historique : ${e.interventions.map((h) => `${h.number} (${dateFr(h.completedAt!)}, ${h.title})`).join(' ; ') || 'aucun'}`,
          ].join(' | ');
        })
        .join('\n');

      const result = await this.ai.run(
        ctx,
        'FACTURE_MAINTENANCE',
        FACTURE_MAINTENANCE_PROMPT,
        async (provider, model) => {
          const out = await provider.structureText<Record<string, unknown>>({
            model,
            instructions: FACTURE_MAINTENANCE_PROMPT.instructions,
            text: `ÉQUIPEMENTS À ENTRETENIR OU À VÉRIFIER (données du serveur) :\n${facts}`,
            schemaName: 'facture_ai_maintenance',
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['suggestions'],
              properties: {
                suggestions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['ref', 'title', 'explanation'],
                    properties: {
                      ref: { type: 'string' },
                      title: { type: 'string' },
                      explanation: { type: 'string' },
                    },
                  },
                },
              },
            },
          });
          if (!Array.isArray(out.value?.suggestions)) {
            invalid(out, 'Suggestions illisibles. Réessayez.');
          }
          const texts = new Map<string, { title: string; explanation: string }>();
          for (const raw of out.value.suggestions as unknown[]) {
            const s = raw as { ref?: unknown; title?: unknown; explanation?: unknown };
            const ref = typeof s.ref === 'string' ? s.ref.trim() : '';
            const candidate = refs.get(ref);
            if (!candidate || texts.has(ref)) continue;
            const title = text(s.title, 120);
            const explanation = text(s.explanation, 600);
            const said = `${title} ${explanation}`;
            // Jamais de panne annoncée comme certaine.
            if (factureAiClaimsCertainty(said)) {
              invalid(out, 'Une suggestion annonçait une panne comme certaine : refusée.');
            }
            // Seules les interventions de CET équipement peuvent être citées.
            const history = new Set(
              byId.get(candidate.equipmentId)!.interventions.map((h) => h.number),
            );
            if ((said.match(INTERVENTION_REF) ?? []).some((n) => !history.has(n))) {
              invalid(out, 'Une suggestion citait une intervention étrangère à l’équipement.');
            }
            if (
              !numbersAreGrounded(
                said.replace(INTERVENTION_REF, ' '),
                stripSimulationDirectives(facts),
              )
            ) {
              invalid(out, 'Une suggestion citait des chiffres absents de l’historique.');
            }
            texts.set(ref, { title, explanation });
          }
          return { value: texts, usage: out.usage };
        },
      );

      await this.db.factureAiProposal.createMany({
        data: [...refs].map(([ref, c]) => {
          const e = byId.get(c.equipmentId)!;
          const t = result.get(ref);
          return {
            organizationId: ctx.organizationId,
            feature: 'FACTURE_MAINTENANCE',
            targetType: 'FactureEquipment',
            targetId: e.id,
            input: { reasons: c.reasons, history: e.interventions.length },
            output: {
              equipmentId: e.id,
              equipmentName: e.name,
              clientId: e.client.id,
              clientName: e.client.name,
              reasons: c.reasons as FactureMaintenanceReason[],
              lastServiceAt: c.lastServiceAt?.toISOString() ?? null,
              dueDate: c.dueDate?.toISOString() ?? null,
              evidence: c.evidence,
              title: t?.title || `Entretien préventif — ${e.name}`,
              explanation:
                t?.explanation ||
                c.reasons.map((r) => FACTURE_MAINTENANCE_REASON_LABELS[r]).join(' ; '),
            },
            promptId: FACTURE_MAINTENANCE_PROMPT.id,
            promptVersion: FACTURE_MAINTENANCE_PROMPT.version,
            model: this.ai.modelOf('FACTURE_MAINTENANCE'),
            createdByUserId: ctx.userId,
          };
        }),
      });
      await this.ai.record(ctx, 'facture.ai_maintenance_proposed', ctx.organizationId, {
        suggestions: fresh.length,
      });
    }
    return this.suggestions(ctx);
  }

  // ─── Outils ───

  /** Candidats calculés par le serveur (membres actifs, compétences, interventions, indisponibilités). */
  private async candidates(
    db: Db,
    organizationId: string,
    req: {
      id: string;
      start: Date;
      end: Date;
      priority: FactureInterventionPriority;
      requiredSkillIds: string[];
      now: Date;
    },
  ): Promise<PlanningCandidate[]> {
    const members = await db.factureMember.findMany({
      where: { organizationId, isActive: true, role: { in: ['TECHNICIAN', 'MANAGER'] } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        skills: { select: { skillId: true } },
      },
    });
    const ids = members.map((m) => m.id);
    const from = new Date(Math.min(req.now.getTime(), req.start.getTime()) - DAY);
    const until = new Date(
      Math.max(
        req.now.getTime() + (FACTURE_PLANNING_HORIZON_DAYS + 1) * DAY,
        req.end.getTime() + DAY,
      ),
    );
    const [assignments, absences] = await Promise.all([
      db.factureInterventionTechnician.findMany({
        where: {
          organizationId,
          memberId: { in: ids },
          interventionId: { not: req.id },
          intervention: {
            status: { in: ['PLANNED', 'IN_PROGRESS'] },
            scheduledEnd: { gt: from },
            scheduledStart: { lt: until },
          },
        },
        select: {
          memberId: true,
          intervention: { select: { number: true, scheduledStart: true, scheduledEnd: true } },
        },
      }),
      db.factureUnavailability.findMany({
        where: {
          organizationId,
          memberId: { in: ids },
          endsAt: { gt: from },
          startsAt: { lt: until },
        },
        select: { memberId: true, startsAt: true, endsAt: true },
      }),
    ]);
    return facturePlanningCandidates({
      start: req.start,
      end: req.end,
      priority: req.priority,
      requiredSkillIds: req.requiredSkillIds,
      members: members.map((m) => ({
        id: m.id,
        name: `${m.firstName} ${m.lastName}`.trim(),
        skillIds: m.skills.map((s) => s.skillId),
      })),
      busy: [
        ...assignments.map((a) => ({
          memberId: a.memberId,
          start: a.intervention.scheduledStart,
          end: a.intervention.scheduledEnd,
          label: a.intervention.number,
        })),
        ...absences.map((u) => ({
          memberId: u.memberId,
          start: u.startsAt,
          end: u.endsAt,
          label: 'indisponibilité',
        })),
      ],
      now: req.now,
    });
  }
}

const view = (c: PlanningCandidate) => ({
  memberId: c.memberId,
  name: c.name,
  start: c.start.toISOString(),
  end: c.end.toISOString(),
  requestedSlot: c.requestedSlot,
  skillsMatched: c.skillsMatched,
  skillsRequired: c.skillsRequired,
  load: c.load,
  conflicts: c.conflicts,
});
