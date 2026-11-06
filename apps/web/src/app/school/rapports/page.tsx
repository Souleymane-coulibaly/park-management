'use client';

import {
  SCHOOL_REPORT_FILTERS,
  SCHOOL_REPORT_FORMATS,
  type SchoolCurrency,
  SchoolPermission,
  type SchoolReportFormat,
  type SchoolReportKind,
  type SchoolRole,
  hasSchoolPermission,
} from '@ocall/shared';
import Link from 'next/link';
import { useState } from 'react';
import { downloadPdf } from '@/components/school/school-assessment';
import { Money, YearPicker } from '@/components/school/school-finance';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import {
  type AttendanceView,
  BarList,
  Kpi,
  type OverviewView,
  type PedagogyView,
  ReportTable,
  TrendBadge,
  average,
  percent,
} from '@/components/school/school-reports';
import type { ClassOption } from '@/components/school/school-students';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface Period {
  id: string;
  label: string;
  labelAr: string | null;
}

interface SavedView {
  id: string;
  name: string;
  kind: SchoolReportKind;
  filters: { classId?: string; periodId?: string; from?: string; to?: string };
}

interface FinanceView {
  currency: SchoolCurrency;
  expected: number;
  collected: number;
  /** Encaissé entre les dates filtrées ; null sans filtre de dates. */
  periodCollected: number | null;
  balance: number;
  overdueAmount: number;
  overdueCharges: number;
  studentsInArrears: number;
  byClass: {
    classId: string | null;
    className: string;
    expected: number;
    collected: number;
    periodCollected: number | null;
    balance: number;
  }[];
}

/**
 * Rapports du Sprint 8 : tableau de bord de direction, pédagogie, assiduité, finances (frais scolaires).
 * Filtres actifs, exports PDF, XLSX et CSV, vues enregistrées. Les droits sont vérifiés par l'API ; l'écran
 * ne propose que ce que le rôle permet.
 */
export default function ReportsPage() {
  return (
    <SchoolPage title="rep.title" description="rep.desc">
      {({ school, context }) => (
        <YearPicker key={school!.id} schoolId={school!.id}>
          {(year) => (
            <Reports key={year.id} schoolId={school!.id} yearId={year.id} role={context.role} />
          )}
        </YearPicker>
      )}
    </SchoolPage>
  );
}

function Reports({
  schoolId,
  yearId,
  role,
}: {
  schoolId: string;
  yearId: string;
  role: SchoolRole;
}) {
  const { t, name } = useSchoolText();
  const canRead = hasSchoolPermission(role, SchoolPermission.REPORTS_READ);
  const canFinance = hasSchoolPermission(role, SchoolPermission.FINANCE_REPORTS);
  const canExport = hasSchoolPermission(role, SchoolPermission.REPORTS_EXPORT);
  const kinds = (['overview', 'pedagogy', 'attendance', 'finance'] as const).filter((k) =>
    k === 'finance' ? canFinance : canRead,
  );
  const [kind, setKind] = useState<SchoolReportKind>(kinds[0] ?? 'overview');
  const [classId, setClassId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [viewName, setViewName] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const classes = useApi<ClassOption[]>(`/school/classes?schoolYearId=${yearId}`);
  const periods = useApi<Period[]>(`/school/periods?schoolYearId=${yearId}`);
  const views = useApi<SavedView[]>(canRead ? `/school/reports/views?schoolId=${schoolId}` : null);

  if (kinds.length === 0) return <Alert tone="info" title={t('rep.forbidden')} />;

  // Seuls les filtres que ce rapport applique réellement (l'API refuse les autres).
  const applies = (key: 'classId' | 'periodId' | 'from' | 'to') =>
    SCHOOL_REPORT_FILTERS[kind].includes(key);
  const filters = {
    ...(applies('classId') && classId ? { classId } : {}),
    ...(applies('periodId') && periodId ? { periodId } : {}),
    ...(applies('from') && from ? { from } : {}),
    ...(applies('to') && to ? { to } : {}),
  };
  const query = new URLSearchParams({ schoolYearId: yearId, ...filters }).toString();

  async function exportAs(format: SchoolReportFormat) {
    setError(null);
    try {
      await downloadPdf(
        `/school/reports/export?${query}&kind=${kind}&format=${format}`,
        `rapport.${format}`,
      );
    } catch (e) {
      setError(toApiError(e));
    }
  }

  async function saveView() {
    setError(null);
    try {
      await api('/school/reports/views', {
        method: 'POST',
        body: { name: viewName, kind, schoolId, filters },
      });
      setViewName('');
      views.reload();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  async function deleteView(id: string) {
    setError(null);
    try {
      await api(`/school/reports/views/${id}`, { method: 'DELETE' });
      views.reload();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  function openView(v: SavedView) {
    setKind(v.kind);
    setClassId(v.filters.classId ?? '');
    setPeriodId(v.filters.periodId ?? '');
    setFrom(v.filters.from ?? '');
    setTo(v.filters.to ?? '');
  }

  return (
    <>
      <div className="flex flex-wrap gap-2" role="tablist" data-testid="report-tabs">
        {kinds.map((k) => (
          <Button
            key={k}
            size="sm"
            variant={k === kind ? 'primary' : 'secondary'}
            role="tab"
            aria-selected={k === kind}
            onClick={() => setKind(k)}
            data-testid={`report-tab-${k}`}
          >
            {t(`rep.kind.${k}`)}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="report-filters">
        {applies('classId') && (
          <SelectField
            label={t('pick.class')}
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            options={[
              { value: '', label: t('rep.allClasses') },
              ...(classes.state === 'success' ? classes.data : []).map((c) => ({
                value: c.id,
                label: name(c),
              })),
            ]}
          />
        )}
        {kind === 'overview' ? (
          <p className="text-sm text-muted sm:col-span-2" data-testid="overview-scope-note">
            {t('rep.overviewScope')}
          </p>
        ) : kind === 'pedagogy' ? (
          <SelectField
            label={t('rep.period')}
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
            options={[
              { value: '', label: t('rep.allPeriods') },
              ...(periods.state === 'success' ? periods.data : []).map((p) => ({
                value: p.id,
                label: name({ name: p.label, nameAr: p.labelAr }),
              })),
            ]}
          />
        ) : (
          <>
            <InputField
              label={t('rep.from')}
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <InputField
              label={t('rep.to')}
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {canExport &&
          SCHOOL_REPORT_FORMATS.map((f) => (
            <Button
              key={f}
              size="sm"
              variant="secondary"
              onClick={() => void exportAs(f)}
              data-testid={`export-${f}`}
            >
              {t(`rep.export.${f}`)}
            </Button>
          ))}
        {canRead && (
          <>
            <div className="w-48">
              <InputField
                label={t('rep.viewName')}
                value={viewName}
                maxLength={80}
                onChange={(e) => setViewName(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              disabled={!viewName.trim()}
              onClick={() => void saveView()}
              data-testid="save-view"
            >
              {t('rep.saveView')}
            </Button>
          </>
        )}
      </div>
      {views.state === 'success' && views.data.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-sm" data-testid="saved-views">
          {views.data.map((v) => (
            <li
              key={v.id}
              className="flex items-center gap-1 rounded-full border border-line px-3 py-1"
            >
              <button
                type="button"
                className="font-medium hover:underline"
                onClick={() => openView(v)}
              >
                {v.name}
              </button>
              <span className="text-xs text-muted">· {t(`rep.kind.${v.kind}`)}</span>
              <button
                type="button"
                className="ms-1 text-xs text-terracotta-dark"
                aria-label={t('rep.deleteView')}
                onClick={() => void deleteView(v.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <ApiErrorAlert error={error} />
      {kind === 'overview' && <OverviewBody query={query} />}
      {kind === 'pedagogy' && <PedagogyBody query={query} />}
      {kind === 'attendance' && <AttendanceBody query={query} />}
      {kind === 'finance' && <FinanceBody query={query} />}
    </>
  );
}

function Scope({
  d,
}: {
  d: {
    year: { label: string };
    from: string;
    to: string;
    generatedOn: string;
    yearNotStarted?: boolean;
  };
}) {
  const { t, date } = useSchoolText();
  return (
    <>
      {d.yearNotStarted && <Alert tone="info" title={t('rep.yearNotStarted')} />}
      <p className="text-xs text-muted" data-testid="report-scope">
        {t('rep.scope', {
          year: d.year.label,
          from: date(d.from),
          to: date(d.to),
          on: date(d.generatedOn),
        })}
      </p>
    </>
  );
}

function useReport<T>(path: string) {
  return useApi<T>(path);
}

function OverviewBody({ query }: { query: string }) {
  const { t, name } = useSchoolText();
  const data = useReport<OverviewView>(`/school/reports/overview?${query}`);
  if (data.state === 'loading') return <LoadingState />;
  if (data.state === 'error') return <ErrorState error={data.error} onRetry={data.reload} />;
  const d = data.data;
  return (
    <>
      <Scope d={d} />
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="overview-kpis">
        <Kpi
          label={t('rep.kpi.students')}
          value={d.students.active}
          hint={t('rep.kpi.unplaced', { n: d.students.unplaced })}
        />
        <Kpi label={t('rep.kpi.classes')} value={d.classCount} />
        <Kpi label={t('rep.kpi.teachers')} value={d.teachers} />
        <Kpi
          label={t('rep.kpi.presence')}
          value={percent(d.attendance.presenceRate)}
          hint={t('rep.kpi.absence', { rate: percent(d.attendance.absenceRate) })}
        />
        {d.results && (
          <>
            <Kpi
              label={t('rep.kpi.average')}
              value={
                d.results.scaleMixed
                  ? t('rep.scaleMixed')
                  : d.results.average === null
                    ? average(null)
                    : `${average(d.results.average)} / ${d.results.scale}${d.results.insufficient ? ' *' : ''}`
              }
              hint={name({ name: d.results.period.label, nameAr: d.results.period.labelAr })}
            />
            <Kpi label={t('rep.kpi.passRate')} value={percent(d.results.passRate)} />
          </>
        )}
        {d.finance && (
          <>
            <Kpi
              label={t('rep.kpi.expected')}
              value={<Money value={d.finance.expected} currency={d.finance.currency} />}
            />
            <Kpi
              label={t('rep.kpi.collected')}
              value={<Money value={d.finance.collected} currency={d.finance.currency} />}
            />
            <Kpi
              label={t('rep.kpi.balance')}
              value={<Money value={d.finance.balance} currency={d.finance.currency} />}
            />
            <Kpi
              label={t('rep.kpi.overdue')}
              value={<Money value={d.finance.overdueAmount} currency={d.finance.currency} />}
              hint={t('rep.kpi.arrears', { n: d.finance.studentsInArrears })}
            />
          </>
        )}
      </div>
      {!d.results && <Alert tone="info" title={t('rep.noResults')} />}
      {d.results && (d.results.insufficient || d.results.byClass.some((c) => c.insufficient)) && (
        <p className="text-xs text-muted">{t('ai.ana.insufficientNote')}</p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">{t('rep.byClass')}</h2>
            <BarList
              testId="overview-by-class"
              empty={t('rep.empty')}
              rows={d.byClass.map((c) => ({
                key: c.id,
                label: name(c),
                value: c.students,
                display: c.capacity ? `${c.students} / ${c.capacity}` : String(c.students),
              }))}
            />
          </CardBody>
        </Card>
        {d.results && (
          <Card>
            <CardBody>
              <h2 className="mb-3 font-semibold">{t('rep.resultsByClass')}</h2>
              <ReportTable
                testId="overview-results"
                headers={[
                  { label: t('pick.class') },
                  { label: t('rep.average'), end: true },
                  { label: t('rep.passRate'), end: true },
                  { label: t('rep.graded'), end: true },
                ]}
                rows={d.results.byClass.map((c) => ({
                  key: c.id,
                  cells: [
                    name(c),
                    c.classAverage === null
                      ? average(null)
                      : `${average(c.classAverage)} / ${c.scale}${c.insufficient ? ' *' : ''}`,
                    percent(c.passRate),
                    c.graded,
                  ],
                }))}
              />
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}

function PedagogyBody({ query }: { query: string }) {
  const { t, name } = useSchoolText();
  const data = useReport<PedagogyView>(`/school/reports/pedagogy?${query}`);
  if (data.state === 'loading') return <LoadingState />;
  if (data.state === 'error') return <ErrorState error={data.error} onRetry={data.reload} />;
  const d = data.data;
  const periodName = new Map(
    d.periods.map((p) => [p.id, name({ name: p.label, nameAr: p.labelAr })]),
  );
  if (d.periods.length === 0) return <Alert tone="info" title={t('rep.noPeriods')} />;
  return (
    <>
      <Scope d={d} />
      <Card>
        <CardBody>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{t('rep.schoolByPeriod')}</h2>
            <TrendBadge trend={d.schoolTrend} />
          </div>
          <BarList
            testId="pedagogy-school"
            empty={t('rep.empty')}
            max={d.scale ?? undefined}
            rows={d.schoolByPeriod.map((p) => ({
              key: p.periodId,
              label: periodName.get(p.periodId) ?? '',
              value: p.average ?? 0,
              // Barème affiché avec chaque moyenne ; « barèmes différents » quand il n'y a pas de moyenne commune.
              display: p.scaleMixed
                ? `${t('rep.scaleMixed')} · ${percent(p.passRate)}`
                : `${average(p.average)}${p.scale ? ` / ${p.scale}` : ''} · ${percent(p.passRate)}`,
            }))}
          />
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <h2 className="mb-3 font-semibold">{t('rep.classesByPeriod')}</h2>
          <ReportTable
            testId="pedagogy-classes"
            minWidth={640}
            headers={[
              { label: t('pick.class') },
              { label: t('rep.period') },
              { label: t('rep.average'), end: true },
              { label: t('rep.passRate'), end: true },
              { label: t('rep.graded'), end: true },
              { label: t('rep.distribution') },
              { label: t('rep.trend') },
            ]}
            rows={d.classes.flatMap((c) =>
              c.periods.map((p, i) => ({
                key: `${c.id}-${p.periodId}`,
                cells: [
                  name(c),
                  <span key="p" className="flex flex-wrap items-center gap-1">
                    {periodName.get(p.periodId)}
                    {p.validated && <Badge tone="forest">{t('rep.validated')}</Badge>}
                    {p.insufficient && <Badge tone="savanna">{t('rep.insufficient')}</Badge>}
                  </span>,
                  p.classAverage === null
                    ? average(null)
                    : `${average(p.classAverage)} / ${p.scale}`,
                  percent(p.passRate),
                  p.graded,
                  <span key="d" className="text-xs text-muted" dir="ltr">
                    {p.distribution.bins.map((b) => b.count).join(' · ')}
                  </span>,
                  i === 0 ? <TrendBadge key="t" trend={c.trend} /> : '',
                ],
              })),
            )}
          />
          <p className="mt-2 text-xs text-muted">{t('rep.distributionNote')}</p>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <h2 className="mb-3 font-semibold">{t('rep.subjects')}</h2>
          <ReportTable
            testId="pedagogy-subjects"
            headers={[
              { label: t('rep.subject') },
              ...d.periods.map((p) => ({ label: periodName.get(p.id) ?? '', end: true })),
              { label: t('rep.trend') },
            ]}
            rows={d.subjects.map((s) => ({
              key: s.subjectId,
              cells: [
                name(s),
                ...d.periods.map((p) => {
                  const x = s.byPeriod.find((v) => v.periodId === p.id);
                  // Barème de chaque moyenne ; astérisque : moins de 3 élèves notés dans la matière.
                  if (x?.scaleMixed) return t('rep.scaleMixed');
                  if (!x || x.average === null) return average(null);
                  return `${average(x.average)} / ${x.scale}${x.graded > 0 && x.insufficient ? ' *' : ''}`;
                }),
                <TrendBadge key="t" trend={s.trend} />,
              ],
            }))}
          />
          {d.subjects.some((s) => s.byPeriod.some((x) => x.graded > 0 && x.insufficient)) && (
            <p className="mt-2 text-xs text-muted">{t('ai.ana.insufficientNote')}</p>
          )}
        </CardBody>
      </Card>
    </>
  );
}

function AttendanceBody({ query }: { query: string }) {
  const { t, name } = useSchoolText();
  const data = useReport<AttendanceView>(`/school/reports/attendance?${query}`);
  if (data.state === 'loading') return <LoadingState />;
  if (data.state === 'error') return <ErrorState error={data.error} onRetry={data.reload} />;
  const d = data.data;
  return (
    <>
      <Scope d={d} />
      {d.insufficient && <Alert tone="info" title={t('rep.noAttendance')} />}
      <div className="grid gap-3 sm:grid-cols-4" data-testid="attendance-kpis">
        <Kpi label={t('rep.kpi.records')} value={d.total.sessions} />
        <Kpi label={t('rep.kpi.absenceRate')} value={percent(d.total.absenceRate)} />
        <Kpi label={t('rep.kpi.lateRate')} value={percent(d.total.lateRate)} />
        <Kpi
          label={t('rep.kpi.mostAbsent')}
          value={d.mostAbsent ? d.mostAbsent.name : '–'}
          hint={d.mostAbsent ? percent(d.mostAbsent.absenceRate) : undefined}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">{t('rep.absenceByClass')}</h2>
            <BarList
              testId="attendance-by-class"
              empty={t('rep.empty')}
              max={10_000}
              rows={d.byClass.map((c) => ({
                key: c.id,
                label: name(c),
                value: c.absenceRate ?? 0,
                display: `${percent(c.absenceRate)} · ${c.late} ${t('rep.lates')}`,
              }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">{t('rep.absenceByMonth')}</h2>
            <BarList
              testId="attendance-by-month"
              empty={t('rep.empty')}
              max={10_000}
              rows={d.byMonth.map((m) => ({
                key: m.month,
                label: m.month,
                value: m.absenceRate ?? 0,
                display: percent(m.absenceRate),
              }))}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function FinanceBody({ query }: { query: string }) {
  const { t } = useSchoolText();
  const data = useReport<
    FinanceView & { year: { label: string }; from: string; to: string; generatedOn: string }
  >(`/school/reports/finance?${query}`);
  if (data.state === 'loading') return <LoadingState />;
  if (data.state === 'error') return <ErrorState error={data.error} onRetry={data.reload} />;
  const d = data.data;
  return (
    <>
      <Scope d={d} />
      <div className="grid gap-3 sm:grid-cols-3" data-testid="finance-report-kpis">
        <Kpi
          label={t('rep.kpi.expected')}
          value={<Money value={d.expected} currency={d.currency} />}
        />
        <Kpi
          label={t('rep.kpi.collectedYear')}
          value={<Money value={d.collected} currency={d.currency} />}
        />
        {d.periodCollected !== null && (
          <Kpi
            label={t('rep.kpi.periodCollected')}
            value={<Money value={d.periodCollected} currency={d.currency} />}
            hint={t('rep.kpi.periodCollectedHint')}
          />
        )}
        <Kpi
          label={t('rep.kpi.balance')}
          value={<Money value={d.balance} currency={d.currency} />}
        />
        <Kpi
          label={t('rep.kpi.overdue')}
          value={<Money value={d.overdueAmount} currency={d.currency} />}
        />
        <Kpi label={t('rep.kpi.overdueCharges')} value={d.overdueCharges} />
        <Kpi label={t('rep.kpi.arrearsTitle')} value={d.studentsInArrears} />
      </div>
      <Card>
        <CardBody>
          <h2 className="mb-3 font-semibold">{t('rep.financeByClass')}</h2>
          <ReportTable
            testId="finance-report-classes"
            headers={[
              { label: t('pick.class') },
              { label: t('rep.kpi.expected'), end: true },
              { label: t('rep.kpi.collectedYear'), end: true },
              ...(d.periodCollected !== null
                ? [{ label: t('rep.kpi.periodCollected'), end: true }]
                : []),
              { label: t('rep.kpi.balance'), end: true },
            ]}
            rows={d.byClass.map((c) => ({
              key: c.classId ?? 'none',
              cells: [
                c.className,
                <Money key="e" value={c.expected} currency={d.currency} />,
                <Money key="c" value={c.collected} currency={d.currency} />,
                ...(d.periodCollected !== null
                  ? [<Money key="p" value={c.periodCollected ?? 0} currency={d.currency} />]
                  : []),
                <Money key="b" value={c.balance} currency={d.currency} />,
              ],
            }))}
          />
          <p className="mt-3 text-sm">
            <Link className="text-forest underline" href="/school/finances">
              {t('rep.financeDetail')}
            </Link>
          </p>
        </CardBody>
      </Card>
    </>
  );
}
