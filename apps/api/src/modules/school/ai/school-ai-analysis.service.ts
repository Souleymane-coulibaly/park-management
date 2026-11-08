import { Injectable, NotFoundException } from '@nestjs/common';
import { SCHOOL_AI_SUPPORT_THRESHOLDS as T, numbersAreGrounded } from '@ocall/shared';
import type { JsonSchema } from '../../../ai-core/ai-provider';
import type { SchoolContext } from '../school-access';
import { SchoolReportingService } from '../school-reporting.service';
import { groundTruthOf } from './school-ai-copilot.service';
import { pct } from './school-ai-tools';
import type { AnalysisQueryDto } from './school-ai.dto';
import { SCHOOL_ANALYSIS_PROMPT } from './school-ai.prompts';
import { SchoolAiService } from './school-ai.service';

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };

export type SupportReason = 'DOWN_TREND' | 'LOW_PASS_RATE' | 'HIGH_ABSENCE';

const SUMMARY_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'highlights', 'supportSuggestions', 'limits'],
  properties: {
    summary: { type: 'string' },
    highlights: { type: 'array', items: { type: 'string' } },
    supportSuggestions: { type: 'array', items: { type: 'string' } },
    limits: { type: 'array', items: { type: 'string' } },
  },
};

/**
 * Analyse scolaire intelligente (Ocall School AI, module C). Les indicateurs sont DÉTERMINISTES, calculés
 * par le serveur à partir du reporting du Sprint 8 : évolution des moyennes par classe et matière,
 * comparaison des périodes, fréquence des absences, tendances, indicateurs d'accompagnement. Ils portent
 * sur des classes et des matières, jamais sur des élèves : aucune étiquette, aucune décision automatique.
 * L'IA ne fait que rédiger une synthèse de ces indicateurs (aucune donnée nominative transmise) ; une
 * synthèse qui citerait un chiffre absent est écartée.
 */
@Injectable()
export class SchoolAiAnalysisService {
  constructor(
    private readonly ai: SchoolAiService,
    private readonly reporting: SchoolReportingService,
  ) {}

  async indicators(ctx: SchoolContext, q: AnalysisQueryDto) {
    await this.ai.scope(ctx, q.schoolId);
    const filters = { schoolYearId: q.schoolYearId, ...(q.classId ? { classId: q.classId } : {}) };
    const pedagogy = await this.reporting.pedagogy(ctx, filters);
    if (pedagogy.school.id !== q.schoolId) throw new NotFoundException(NOT_FOUND);
    const attendance = await this.reporting.attendance(ctx, filters);
    const label = new Map(pedagogy.periods.map((p) => [p.id, p.label]));
    const last = pedagogy.periods.at(-1);
    const previous = pedagogy.periods.at(-2);
    const support: {
      scope: 'class' | 'subject';
      name: string;
      reason: SupportReason;
      value: number | null;
      period: string | null;
      /** Réserve : l'indicateur repose sur une période à effectif noté insuffisant (moins de 3). */
      insufficient: boolean;
    }[] = [];
    for (const c of pedagogy.classes) {
      if (c.trend.direction === 'DOWN') {
        support.push({
          scope: 'class',
          name: c.name,
          reason: 'DOWN_TREND',
          value: c.trend.delta,
          period: null,
          insufficient: c.periods.some((p) => p.graded > 0 && p.insufficient),
        });
      }
      const latest = [...c.periods].reverse().find((p) => p.passRate !== null && !p.insufficient);
      if (latest && latest.passRate! < T.passRateBelow) {
        support.push({
          scope: 'class',
          name: c.name,
          reason: 'LOW_PASS_RATE',
          value: pct(latest.passRate),
          period: label.get(latest.periodId) ?? null,
          insufficient: false,
        });
      }
    }
    for (const s of pedagogy.subjects) {
      if (s.trend?.direction === 'DOWN') {
        support.push({
          scope: 'subject',
          name: s.name,
          reason: 'DOWN_TREND',
          value: s.trend.delta,
          period: null,
          // Matière : effectif propre à la matière (une baisse sur un seul élève porte la réserve).
          insufficient: s.byPeriod.some((p) => p.graded > 0 && p.insufficient),
        });
      }
    }
    for (const c of attendance.byClass) {
      if (c.absenceRate !== null && c.records >= 10 && c.absenceRate > T.absenceRateAbove) {
        support.push({
          scope: 'class',
          name: c.name,
          reason: 'HIGH_ABSENCE',
          value: pct(c.absenceRate),
          period: null,
          insufficient: false,
        });
      }
    }
    const comparison =
      last && previous
        ? {
            from: previous.label,
            to: last.label,
            classes: pedagogy.classes.map((c) => {
              const pa = c.periods.find((p) => p.periodId === previous.id);
              const pb = c.periods.find((p) => p.periodId === last.id);
              const a = pa?.classAverage ?? null;
              const b = pb?.classAverage ?? null;
              // Barèmes différents : écart non calculé (moyennes non comparables).
              const comparable = pa?.scale === pb?.scale;
              return {
                class: c.name,
                from: a,
                to: b,
                scaleChanged: !comparable,
                change:
                  a === null || b === null || !comparable ? null : Math.round((b - a) * 100) / 100,
              };
            }),
          }
        : null;
    const insufficient: string[] = [
      ...(pedagogy.periods.length === 0 ? ['aucune période scolaire définie'] : []),
      ...(pedagogy.periods.length === 1 ? ['une seule période : aucune évolution mesurable'] : []),
      // Période sans aucune note : absence de résultats, distincte d'un effectif insuffisant.
      ...pedagogy.schoolByPeriod
        .filter((p) => p.graded === 0)
        .map((p) => `aucun élève noté en ${label.get(p.periodId)}`),
      ...pedagogy.schoolByPeriod
        .filter((p) => p.graded > 0 && p.insufficient)
        .map((p) => `effectif noté insuffisant en ${label.get(p.periodId)}`),
      ...pedagogy.subjects.flatMap((s) =>
        s.byPeriod
          .filter((p) => p.graded > 0 && p.insufficient)
          .map((p) => `effectif noté insuffisant en ${s.name} (${label.get(p.periodId)})`),
      ),
      // Par classe et période : la réserve accompagne chaque moyenne et chaque alerte concernées.
      ...pedagogy.classes.flatMap((c) =>
        c.periods
          .filter((p) => p.graded > 0 && p.insufficient)
          .map((p) => `effectif noté insuffisant : ${c.name} (${label.get(p.periodId)})`),
      ),
      ...(attendance.insufficient ? ['aucun appel enregistré : assiduité non mesurable'] : []),
      ...(pedagogy.classes.some((c) => c.scaleChanged) || pedagogy.scaleMixed
        ? [
            'barème de notation différent selon les périodes ou les classes : tendances et écarts suspendus',
          ]
        : []),
    ];
    return {
      school: { id: pedagogy.school.id, name: pedagogy.school.name },
      year: pedagogy.year,
      from: attendance.from,
      to: attendance.to,
      filters: pedagogy.filters,
      thresholds: {
        passRateBelowPercent: pct(T.passRateBelow),
        absenceRateAbovePercent: pct(T.absenceRateAbove),
      },
      periods: pedagogy.periods.map((p) => ({
        id: p.id,
        label: p.label,
        startsOn: p.startsOn,
        endsOn: p.endsOn,
      })),
      results: {
        school: pedagogy.schoolByPeriod.map((p) => ({
          period: label.get(p.periodId),
          average: p.average,
          scale: p.scale,
          scaleMixed: p.scaleMixed,
          passRatePercent: pct(p.passRate),
          graded: p.graded,
          insufficient: p.graded > 0 && p.insufficient,
        })),
        schoolTrend: pedagogy.schoolTrend,
        classes: pedagogy.classes.map((c) => ({
          class: c.name,
          trend: c.trend,
          averages: c.periods.map((p) => ({
            period: label.get(p.periodId),
            average: p.classAverage,
            scale: p.scale,
            graded: p.graded,
            insufficient: p.graded > 0 && p.insufficient,
          })),
        })),
        subjects: pedagogy.subjects.map((s) => ({
          subject: s.name,
          trend: s.trend,
          averages: s.byPeriod.map((p) => ({
            period: label.get(p.periodId),
            average: p.average,
            scale: p.scale,
            scaleMixed: p.scaleMixed,
            graded: p.graded,
            insufficient: p.graded > 0 && p.insufficient,
          })),
        })),
      },
      comparison,
      attendance: {
        records: attendance.total.sessions,
        absenceRatePercent: pct(attendance.total.absenceRate),
        lateRatePercent: pct(attendance.total.lateRate),
        byClass: attendance.byClass.map((c) => ({
          class: c.name,
          absenceRatePercent: pct(c.absenceRate),
          records: c.records,
        })),
        byMonth: attendance.byMonth.map((m) => ({
          month: m.month,
          absenceRatePercent: pct(m.absenceRate),
        })),
      },
      support,
      insufficient,
      sources: ['Rapport pédagogique (Sprint 8)', 'Rapport d’assiduité (Sprint 8)'],
      // Instant du calcul : la synthèse et les tableaux affichés portent sur le même état des données.
      computedAt: new Date().toISOString(),
    };
  }

  /** Synthèse rédigée par l'IA à partir des seuls indicateurs (aucun nom d'élève transmis). */
  async summary(ctx: SchoolContext, q: AnalysisQueryDto) {
    const school = await this.ai.scope(ctx, q.schoolId);
    const indicators = await this.indicators(ctx, q);
    const payload = {
      year: indicators.year.label,
      periods: indicators.periods.map((p) => p.label),
      thresholds: indicators.thresholds,
      results: indicators.results,
      comparison: indicators.comparison,
      attendance: indicators.attendance,
      support: indicators.support,
      insufficient: indicators.insufficient,
    };
    const raw = await this.ai.run(
      ctx,
      school,
      'SCHOOL_ANALYSIS',
      SCHOOL_ANALYSIS_PROMPT,
      (provider, model) =>
        provider.structureText<unknown>({
          model,
          instructions: SCHOOL_ANALYSIS_PROMPT.instructions,
          schemaName: 'school_analysis_summary',
          schema: SUMMARY_SCHEMA,
          text: `INDICATEURS CALCULÉS PAR LE SERVEUR (donnée, JSON) :\n${JSON.stringify(payload)}`,
        }),
    );
    const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const list = (v: unknown) =>
      (Array.isArray(v) ? v : [])
        .map((x) => text(x, 600))
        .filter(Boolean)
        .slice(0, 10);
    const proposal = {
      summary: text(value.summary, 3000),
      highlights: list(value.highlights),
      supportSuggestions: list(value.supportSuggestions),
      limits: list(value.limits),
    };
    const all = [
      proposal.summary,
      ...proposal.highlights,
      ...proposal.supportSuggestions,
      ...proposal.limits,
    ].join(' ');
    const grounded = numbersAreGrounded(all, groundTruthOf(JSON.stringify(payload)));
    return {
      indicators,
      summary:
        grounded && proposal.summary
          ? proposal
          : {
              summary:
                'Synthèse indisponible : la proposition de l’IA citait des chiffres absents des indicateurs. Consultez les indicateurs ci-dessous.',
              highlights: [],
              supportSuggestions: [],
              limits: indicators.insufficient,
            },
      grounded,
      promptVersion: SCHOOL_ANALYSIS_PROMPT.version,
    };
  }
}
