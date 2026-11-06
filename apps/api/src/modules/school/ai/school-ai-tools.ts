import {
  type SchoolCurrency,
  SchoolPermission,
  addDays,
  hasSchoolPermission,
  toMajorUnits,
} from '@ocall/shared';
import { type AiTool, exactKeys, strictObject } from '../../../ai-core/ai-tools';
import type { SchoolContext } from '../school-access';
import type { SchoolReportingService } from '../school-reporting.service';

/**
 * Registre FERMÉ des fonctions du copilote de direction : des lectures du reporting du Sprint 8
 * (`SchoolReportingService`, mêmes calculs que les écrans et les exports), jamais d'écriture, jamais de
 * SQL. Le modèle ne choisit qu'une fonction et des paramètres bornés (plage de dates nommée, numéro de
 * période, nom de classe cherché par le serveur) ; l'établissement, l'année et les droits viennent de la
 * session. Les résultats ne contiennent aucun nom d'élève.
 */

export interface SchoolToolContext {
  ctx: SchoolContext;
  yearId: string;
  /** Aujourd'hui, dans le fuseau de l'établissement. */
  today: string;
  yearStart: string;
  yearEnd: string;
  reporting: SchoolReportingService;
  classes: { id: string; name: string; nameAr: string | null }[];
}

export interface SchoolAiResult {
  tool: string;
  /** Rapport métier utilisé (source affichée à l'utilisateur). */
  title: string;
  period: { label: string; from: string; to: string } | null;
  /** Filtres appliqués, lisibles. */
  filters: string[];
  /** Chiffres calculés par le serveur : seuls chiffres affichés comme résultats. */
  data: Record<string, unknown>;
  /** Données absentes ou insuffisantes, signalées plutôt que comblées. */
  missing: string[];
}

export interface SchoolAiTool extends AiTool<SchoolToolContext, SchoolAiResult> {
  /** Permission School exigée en plus du copilote (rapports financiers). */
  permission?: SchoolPermission;
}

const RANGES = ['this_month', 'last_30_days', 'year'] as const;
type Range = (typeof RANGES)[number];

/** Taux en points de base → pourcentage à une décimale (forme citée par le modèle). */
export const pct = (bp: number | null) => (bp === null ? null : Math.round(bp / 10) / 10);

function resolveRange(t: SchoolToolContext, range: Range) {
  const to = t.today < t.yearEnd ? t.today : t.yearEnd;
  const from =
    range === 'this_month'
      ? `${t.today.slice(0, 8)}01`
      : range === 'last_30_days'
        ? addDays(t.today, -29)
        : t.yearStart;
  const bounded = from < t.yearStart ? t.yearStart : from;
  const label =
    range === 'this_month'
      ? 'ce mois-ci'
      : range === 'last_30_days'
        ? 'les 30 derniers jours'
        : 'depuis le début de l’année scolaire';
  return { from: bounded, to: bounded > to ? bounded : to, label };
}

const rangeSchema = {
  type: 'string',
  enum: [...RANGES],
  description: 'Plage : this_month (mois en cours), last_30_days, year (année scolaire en cours).',
};

function parseRange(args: unknown) {
  const a = exactKeys(args, ['range']);
  return a && RANGES.includes(a.range as Range) ? { range: a.range } : null;
}

/** Classe cherchée par son nom parmi celles de l'année (insensible à la casse) ; '' = toutes. */
function findClass(t: SchoolToolContext, name: string) {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  return (
    t.classes.find((c) => c.name.toLowerCase() === wanted || c.nameAr?.toLowerCase() === wanted) ??
    undefined
  );
}

export const SCHOOL_AI_TOOLS: readonly SchoolAiTool[] = [
  {
    name: 'school_overview',
    description:
      'Tableau de bord de direction de l’année en cours : élèves inscrits (actifs), classes, enseignants, ' +
      'élèves par classe, assiduité, résultats de la dernière période et, si autorisé, frais scolaires.',
    parameters: strictObject({}),
    parse: (args) => exactKeys(args ?? {}, []),
    async run(t) {
      const d = await t.reporting.overview(t.ctx, { schoolYearId: t.yearId });
      return {
        tool: 'school_overview',
        title: 'Tableau de bord de direction',
        period: { label: `année ${d.year.label}`, from: d.from, to: d.to },
        filters: [],
        data: {
          activeStudents: d.students.active,
          studentsWithoutClass: d.students.unplaced,
          classes: d.classCount,
          teachers: d.teachers,
          studentsByClass: d.byClass.map((c) => ({ class: c.name, students: c.students })),
          attendance: {
            records: d.attendance.sessions,
            presenceRatePercent: pct(d.attendance.presenceRate),
            absenceRatePercent: pct(d.attendance.absenceRate),
          },
          latestResults: d.results
            ? {
                period: d.results.period.label,
                schoolAverage: d.results.average,
                scale: d.results.scale,
                ...(d.results.scaleMixed ? { scaleMixed: true } : {}),
                passRatePercent: pct(d.results.passRate),
                gradedStudents: d.results.graded,
                insufficient: d.results.insufficient,
                classes: d.results.byClass.map((c) => ({
                  class: c.name,
                  average: c.classAverage,
                  scale: c.scale,
                  gradedStudents: c.graded,
                  insufficient: c.insufficient,
                })),
              }
            : null,
          schoolFees: d.finance
            ? {
                currency: d.finance.currency,
                // Montants dans l'unité de la devise (jamais d'unités mineures sous un code de devise).
                invoiced: toMajorUnits(d.finance.expected, d.finance.currency),
                collected: toMajorUnits(d.finance.collected, d.finance.currency),
                outstanding: toMajorUnits(d.finance.balance, d.finance.currency),
                overdueUnpaid: toMajorUnits(d.finance.overdueAmount, d.finance.currency),
                studentsInArrears: d.finance.studentsInArrears,
              }
            : 'non autorisé pour ce rôle',
        },
        missing: [
          ...(d.results ? [] : ['aucune période commencée : pas encore de résultats']),
          ...(d.results?.graded === 0 ? [`aucun élève noté en ${d.results.period.label}`] : []),
          ...(d.results?.insufficient
            ? [`effectif noté insuffisant en ${d.results.period.label}`]
            : []),
          ...(d.results?.byClass ?? [])
            .filter((c) => c.insufficient)
            .map((c) => `effectif noté insuffisant : ${c.name} (${d.results!.period.label})`),
          ...(d.attendance.sessions === 0 ? ['aucun appel enregistré'] : []),
        ],
      };
    },
  },
  {
    name: 'results_by_period',
    description:
      'Résultats scolaires par période : moyenne et réussite de l’établissement, par classe et par ' +
      'matière, avec la tendance. class_name : nom exact d’une classe, ou chaîne vide pour toutes.',
    parameters: strictObject({ class_name: { type: 'string', maxLength: 60 } }),
    parse(args) {
      const a = exactKeys(args, ['class_name']);
      return a && typeof a.class_name === 'string' && a.class_name.length <= 60
        ? { className: a.class_name }
        : null;
    },
    async run(t, args) {
      const cls = findClass(t, String(args.className));
      if (cls === undefined) {
        return {
          tool: 'results_by_period',
          title: 'Rapport pédagogique',
          period: null,
          filters: [`classe « ${String(args.className).slice(0, 60)} »`],
          data: {},
          missing: ['classe introuvable dans l’année en cours'],
        };
      }
      const d = await t.reporting.pedagogy(t.ctx, {
        schoolYearId: t.yearId,
        ...(cls ? { classId: cls.id } : {}),
      });
      const label = new Map(d.periods.map((p) => [p.id, p.label]));
      return {
        tool: 'results_by_period',
        title: 'Rapport pédagogique',
        period: { label: `année ${d.year.label}`, from: d.from, to: d.to },
        filters: cls ? [`classe ${cls.name}`] : [],
        data: {
          periods: d.periods.map((p, i) => ({ number: i + 1, label: p.label })),
          school: d.schoolByPeriod.map((p) => ({
            period: label.get(p.periodId),
            average: p.average,
            scale: p.scale,
            ...(p.scaleMixed ? { scaleMixed: true } : {}),
            passRatePercent: pct(p.passRate),
            gradedStudents: p.graded,
            // Période sans aucune note : absence de résultats (voir `missing`), pas un effectif insuffisant.
            insufficient: p.graded > 0 && p.insufficient,
          })),
          classes: d.classes.map((c) => ({
            class: c.name,
            trend: c.trend.direction,
            periods: c.periods.map((p) => ({
              period: label.get(p.periodId),
              average: p.classAverage,
              scale: p.scale,
              passRatePercent: pct(p.passRate),
              gradedStudents: p.graded,
              insufficient: p.graded > 0 && p.insufficient,
            })),
          })),
          subjects: d.subjects.map((s) => ({
            subject: s.name,
            trend: s.trend?.direction ?? null,
            averages: s.byPeriod.map((p) => ({
              period: label.get(p.periodId),
              average: p.average,
              scale: p.scale,
              ...(p.scaleMixed ? { scaleMixed: true } : {}),
              gradedStudents: p.graded,
              insufficient: p.graded > 0 && p.insufficient,
            })),
          })),
        },
        missing: [
          ...(d.periods.length === 0 ? ['aucune période scolaire définie'] : []),
          ...d.schoolByPeriod
            .filter((p) => p.graded === 0)
            .map((p) => `aucun élève noté en ${label.get(p.periodId)}`),
        ],
      };
    },
  },
  {
    name: 'compare_periods',
    description:
      'Compare deux périodes scolaires (numéros 1, 2, 3… dans l’ordre de l’année) : moyenne et réussite ' +
      'de l’établissement, écarts par classe et par matière.',
    parameters: strictObject({
      first: { type: 'integer', minimum: 1, maximum: 12 },
      second: { type: 'integer', minimum: 1, maximum: 12 },
    }),
    parse(args) {
      const a = exactKeys(args, ['first', 'second']);
      const ok = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 12;
      return a && ok(a.first) && ok(a.second) && a.first !== a.second
        ? { first: a.first, second: a.second }
        : null;
    },
    async run(t, args) {
      const d = await t.reporting.pedagogy(t.ctx, { schoolYearId: t.yearId });
      const first = d.periods[Number(args.first) - 1];
      const second = d.periods[Number(args.second) - 1];
      if (!first || !second) {
        return {
          tool: 'compare_periods',
          title: 'Rapport pédagogique — comparaison',
          period: null,
          filters: [],
          data: { periods: d.periods.map((p, i) => ({ number: i + 1, label: p.label })) },
          missing: ['période demandée inexistante dans l’année en cours'],
        };
      }
      const school = (id: string) => d.schoolByPeriod.find((p) => p.periodId === id);
      const diff = (a: number | null | undefined, b: number | null | undefined) =>
        a === null || a === undefined || b === null || b === undefined
          ? null
          : Math.round((b - a) * 100) / 100;
      const s1 = school(first.id);
      const s2 = school(second.id);
      // Réserve d'effectif (moins de 3 élèves notés) d'une période effectivement notée.
      const short = (p: { graded: number; insufficient: boolean } | undefined) =>
        !!p && p.graded > 0 && p.insufficient;
      const reserves: string[] = [];
      const schoolComparable =
        !!s1 &&
        !!s2 &&
        !s1.scaleMixed &&
        !s2.scaleMixed &&
        s1.scale != null &&
        s1.scale === s2.scale;
      return {
        tool: 'compare_periods',
        title: 'Rapport pédagogique — comparaison',
        // Bornes chronologiques quel que soit l'ordre demandé (l'écart suit l'ordre demandé).
        period: {
          label: `${first.label} et ${second.label}`,
          from: first.startsOn < second.startsOn ? first.startsOn : second.startsOn,
          to: first.endsOn > second.endsOn ? first.endsOn : second.endsOn,
        },
        filters: [],
        data: {
          first: {
            period: first.label,
            average: s1?.average ?? null,
            scale: s1?.scale ?? null,
            ...(s1?.scaleMixed ? { scaleMixed: true } : {}),
            passRatePercent: pct(s1?.passRate ?? null),
            gradedStudents: s1?.graded ?? 0,
          },
          second: {
            period: second.label,
            average: s2?.average ?? null,
            scale: s2?.scale ?? null,
            ...(s2?.scaleMixed ? { scaleMixed: true } : {}),
            passRatePercent: pct(s2?.passRate ?? null),
            gradedStudents: s2?.graded ?? 0,
          },
          // Écart d'établissement seulement si les DEUX périodes comparées ont un même barème unique
          // (un barème différent sur une autre période de l'année ne suspend pas cette comparaison).
          averageChange: schoolComparable ? diff(s1?.average, s2?.average) : null,
          ...(schoolComparable || s1?.average == null || s2?.average == null
            ? {}
            : { scaleChanged: true }),
          classes: d.classes.map((c) => {
            const pa = c.periods.find((p) => p.periodId === first.id);
            const pb = c.periods.find((p) => p.periodId === second.id);
            const a = pa?.classAverage ?? null;
            const b = pb?.classAverage ?? null;
            // Barèmes différents : écart non calculé (moyennes non comparables).
            const comparable = pa?.scale === pb?.scale;
            for (const [p, period] of [
              [pa, first],
              [pb, second],
            ] as const) {
              if (short(p)) reserves.push(`effectif insuffisant : ${c.name} (${period.label})`);
            }
            return {
              class: c.name,
              first: a,
              second: b,
              firstScale: pa?.scale ?? null,
              secondScale: pb?.scale ?? null,
              firstGraded: pa?.graded ?? 0,
              secondGraded: pb?.graded ?? 0,
              ...(comparable ? {} : { scaleChanged: true }),
              ...(short(pa) || short(pb) ? { insufficient: true } : {}),
              change: comparable ? diff(a, b) : null,
            };
          }),
          subjects: d.subjects.map((s) => {
            const pa = s.byPeriod.find((p) => p.periodId === first.id);
            const pb = s.byPeriod.find((p) => p.periodId === second.id);
            const a = pa?.average ?? null;
            const b = pb?.average ?? null;
            // Barèmes différents (ou mélangés) entre les deux périodes : écart non calculé.
            // Sans valeur d'un côté, rien à comparer (pas de signalement de barème).
            const comparable =
              !pa?.scaleMixed &&
              !pb?.scaleMixed &&
              (a === null || b === null || pa?.scale === pb?.scale);
            for (const [p, period] of [
              [pa, first],
              [pb, second],
            ] as const) {
              if (short(p)) reserves.push(`effectif insuffisant en ${s.name} (${period.label})`);
            }
            return {
              subject: s.name,
              first: a,
              second: b,
              firstScale: pa?.scaleMixed ? 'barèmes différents' : (pa?.scale ?? null),
              secondScale: pb?.scaleMixed ? 'barèmes différents' : (pb?.scale ?? null),
              firstGraded: pa?.graded ?? 0,
              secondGraded: pb?.graded ?? 0,
              ...(comparable ? {} : { scaleChanged: true }),
              ...(short(pa) || short(pb) ? { insufficient: true } : {}),
              change: comparable ? diff(a, b) : null,
            };
          }),
        },
        missing: [
          // Période sans aucune note : absence de résultats, distincte d'un effectif insuffisant.
          ...(
            [
              [s1, first],
              [s2, second],
            ] as const
          ).flatMap(([p, period]) =>
            !p || p.graded === 0
              ? [`aucun élève noté en ${period.label}`]
              : short(p)
                ? [`effectif insuffisant en ${period.label}`]
                : [],
          ),
          // Par classe et par matière : une baisse fondée sur un seul élève porte sa réserve.
          ...reserves,
        ],
      };
    },
  },
  {
    name: 'attendance_summary',
    description:
      'Assiduité sur une plage : taux de présence, d’absence et de retard de l’établissement, par classe ' +
      '(classe la plus touchée) et par mois.',
    parameters: strictObject({ range: rangeSchema }),
    parse: parseRange,
    async run(t, args) {
      const r = resolveRange(t, args.range as Range);
      const d = await t.reporting.attendance(t.ctx, {
        schoolYearId: t.yearId,
        from: r.from,
        to: r.to,
      });
      return {
        tool: 'attendance_summary',
        title: 'Rapport d’assiduité',
        period: { label: r.label, from: d.from, to: d.to },
        filters: [],
        data: {
          records: d.total.sessions,
          absences: d.total.absent,
          justifiedAbsences: d.total.excused,
          lateArrivals: d.total.late,
          absenceRatePercent: pct(d.total.absenceRate),
          lateRatePercent: pct(d.total.lateRate),
          mostAbsentClass: d.mostAbsent
            ? { class: d.mostAbsent.name, absenceRatePercent: pct(d.mostAbsent.absenceRate) }
            : null,
          byClass: d.byClass.map((c) => ({
            class: c.name,
            absences: c.absent + c.excused,
            absenceRatePercent: pct(c.absenceRate),
          })),
          byMonth: d.byMonth.map((m) => ({
            month: m.month,
            absenceRatePercent: pct(m.absenceRate),
          })),
        },
        missing: d.insufficient ? ['aucun appel enregistré sur la plage'] : [],
      };
    },
  },
  {
    name: 'finance_summary',
    description:
      'Frais scolaires (jamais les abonnements Ocall) : facturé, encaissé, reste dû, échu impayé, élèves ' +
      'en impayé, encaissements sur la plage et par mois.',
    permission: SchoolPermission.FINANCE_REPORTS,
    parameters: strictObject({ range: rangeSchema }),
    parse: parseRange,
    async run(t, args) {
      const r = resolveRange(t, args.range as Range);
      const d = await t.reporting.finance(t.ctx, {
        schoolYearId: t.yearId,
        from: r.from,
        to: r.to,
      });
      const cur = d.currency as SchoolCurrency;
      return {
        tool: 'finance_summary',
        title: 'Rapport financier (frais scolaires)',
        period: { label: r.label, from: d.from, to: d.to },
        filters: [],
        data: {
          currency: d.currency,
          // Montants dans l'unité de la devise (jamais d'unités mineures sous un code de devise).
          invoicedThisYear: toMajorUnits(d.expected, cur),
          collectedThisYear: toMajorUnits(d.collected, cur),
          outstanding: toMajorUnits(d.balance, cur),
          overdueUnpaid: toMajorUnits(d.overdueAmount, cur),
          overdueInstallments: d.overdueCharges,
          studentsInArrears: d.studentsInArrears,
          collectedInRange:
            d.periodCollected === null ? null : toMajorUnits(d.periodCollected, cur),
          collectionsByMonth: d.collectionsByMonth.map((m) => ({
            month: m.month,
            amount: toMajorUnits(m.amount, cur),
          })),
        },
        missing: d.expected === 0 ? ['aucun frais scolaire facturé pour l’année'] : [],
      };
    },
  },
];

/** Outils permis au rôle (le copilote est déjà exigé par le contrôleur). */
export function allowedSchoolTools(ctx: SchoolContext) {
  return SCHOOL_AI_TOOLS.filter(
    (t) => !t.permission || hasSchoolPermission(ctx.role, t.permission),
  );
}
