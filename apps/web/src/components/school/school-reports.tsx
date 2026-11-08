'use client';

import type { SchoolCurrency, TrendDirection } from '@ocall/shared';
import type { ReactNode } from 'react';
import { useSchoolText } from '@/components/school/school-language';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';

/** Formes renvoyées par l'API de reporting (Sprint 8). */
export interface ReportHeaderView {
  school: { id: string; name: string; nameAr: string | null };
  year: { id: string; label: string };
  from: string;
  to: string;
  filters: { classId: string | null; periodId: string | null };
  generatedOn: string;
}

export interface Trend {
  direction: TrendDirection;
  delta: number | null;
}

export interface OverviewView extends ReportHeaderView {
  students: { active: number; unplaced: number };
  classCount: number;
  teachers: number;
  byClass: {
    id: string;
    name: string;
    nameAr: string | null;
    capacity: number | null;
    students: number;
  }[];
  attendance: { sessions: number; presenceRate: number | null; absenceRate: number | null };
  results: {
    period: { id: string; label: string; labelAr: string | null };
    average: number | null;
    scale: number | null;
    scaleMixed: boolean;
    passRate: number | null;
    graded: number;
    insufficient: boolean;
    byClass: {
      id: string;
      name: string;
      nameAr: string | null;
      classAverage: number | null;
      scale: number;
      passRate: number | null;
      graded: number;
      insufficient: boolean;
    }[];
  } | null;
  finance: {
    currency: SchoolCurrency;
    expected: number;
    collected: number;
    balance: number;
    overdueAmount: number;
    overdueCharges: number;
    studentsInArrears: number;
  } | null;
}

export interface PedagogyView extends ReportHeaderView {
  scale: number | null;
  periods: { id: string; label: string; labelAr: string | null }[];
  schoolByPeriod: {
    periodId: string;
    average: number | null;
    scale: number | null;
    scaleMixed: boolean;
    passRate: number | null;
    graded: number;
    insufficient: boolean;
  }[];
  schoolTrend: Trend | null;
  classes: {
    id: string;
    name: string;
    nameAr: string | null;
    trend: Trend;
    periods: {
      periodId: string;
      scale: number;
      classAverage: number | null;
      passRate: number | null;
      graded: number;
      insufficient: boolean;
      validated: boolean;
      distribution: { bins: { from: number; to: number; count: number }[]; missing: number };
    }[];
  }[];
  subjects: {
    subjectId: string;
    name: string;
    nameAr: string | null;
    byPeriod: {
      periodId: string;
      average: number | null;
      scale: number | null;
      scaleMixed: boolean;
      graded: number;
      insufficient: boolean;
    }[];
    trend: Trend | null;
  }[];
}

export interface AttendanceView extends ReportHeaderView {
  total: {
    sessions: number;
    present: number;
    absent: number;
    excused: number;
    late: number;
    absenceRate: number | null;
    lateRate: number | null;
  };
  byClass: {
    id: string;
    name: string;
    nameAr: string | null;
    sessions: number;
    records: number;
    absent: number;
    excused: number;
    late: number;
    absenceRate: number | null;
    minutesLate: number;
  }[];
  byMonth: {
    month: string;
    sessions: number;
    absent: number;
    excused: number;
    late: number;
    absenceRate: number | null;
  }[];
  mostAbsent: { id: string; name: string; absenceRate: number | null } | null;
  insufficient: boolean;
}

/** Points de base → « 66,7 % » ; tiret si inconnu. */
export function percent(bp: number | null): string {
  if (bp === null) return '–';
  return `${(bp / 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
}

export function average(value: number | null): string {
  return value === null ? '–' : value.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

/** Indicateur clé : libellé, valeur, précision facultative. */
export function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card>
      <CardBody>
        <p className="text-xs text-muted">{label}</p>
        <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      </CardBody>
    </Card>
  );
}

/** Barres horizontales : une ligne par élément, valeur lisible à côté (jamais la couleur seule). */
export function BarList({
  rows,
  max,
  testId,
  empty,
}: {
  rows: { key: string; label: string; value: number; display: string }[];
  max?: number;
  testId?: string;
  empty: string;
}) {
  const top = Math.max(1, max ?? 0, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-2 text-sm" data-testid={testId}>
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(5rem,9rem)_1fr_auto] items-center gap-2">
          <span className="truncate text-muted" title={r.label}>
            {r.label}
          </span>
          <span className="h-2 rounded-full bg-ivory-dark">
            <span
              className="block h-2 rounded-full bg-forest"
              style={{ width: `${(Math.max(0, r.value) / top) * 100}%` }}
            />
          </span>
          <span className="tabular-nums" dir="ltr">
            {r.display}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Tendance d'une série : badge texte (hausse, baisse, stable, données insuffisantes). */
export function TrendBadge({ trend }: { trend: Trend | null }) {
  const { t } = useSchoolText();
  if (!trend) return <span className="text-muted">–</span>;
  const tone =
    trend.direction === 'UP'
      ? 'forest'
      : trend.direction === 'DOWN'
        ? 'terracotta'
        : trend.direction === 'STABLE'
          ? 'savanna'
          : 'neutral';
  const delta =
    trend.delta === null ? '' : ` (${trend.delta > 0 ? '+' : ''}${average(trend.delta)})`;
  return (
    <Badge tone={tone}>
      {t(`rep.trend.${trend.direction}`)}
      {delta}
    </Badge>
  );
}

/** Tableau simple, défilant horizontalement sur mobile. */
export function ReportTable({
  headers,
  rows,
  testId,
  minWidth = 480,
}: {
  headers: { label: string; end?: boolean }[];
  rows: { key: string; cells: ReactNode[] }[];
  testId?: string;
  minWidth?: number;
}) {
  const { t } = useSchoolText();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth }} data-testid={testId}>
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            {headers.map((h) => (
              <th
                key={h.label}
                className={`px-3 py-2 font-semibold ${h.end ? 'text-end' : 'text-start'}`}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/70">
          {rows.length === 0 && (
            <tr>
              <td className="px-3 py-3 text-muted" colSpan={headers.length}>
                {t('rep.empty')}
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((c, i) => (
                <td
                  key={i}
                  className={`px-3 py-2 ${headers[i]?.end ? 'text-end tabular-nums' : ''}`}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
