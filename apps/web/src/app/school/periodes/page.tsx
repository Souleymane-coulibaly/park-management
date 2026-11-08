'use client';

import { SCHOOL_PERIOD_KINDS, type SchoolPeriodKind } from '@ocall/shared';
import { useState } from 'react';
import type { PeriodView, YearWithPeriods } from '@/components/school/school-assessment';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface PeriodRow extends PeriodView {
  evaluations: number;
  inUse: boolean;
}

/** Périodes scolaires (Sprint 4) : trimestres ou semestres de chaque année. */
export default function PeriodesPage() {
  return (
    <SchoolPage title="periods.title" description="periods.desc">
      {({ school, canWrite }) => (
        <Periods
          key={school!.id}
          schoolId={school!.id}
          canManage={canWrite('school.structure.manage')}
        />
      )}
    </SchoolPage>
  );
}

function Periods({ schoolId, canManage }: { schoolId: string; canManage: boolean }) {
  const { t } = useSchoolText();
  const years = useApi<YearWithPeriods[]>(`/school/years?schoolId=${schoolId}`);
  const [yearId, setYearId] = useState('');
  if (years.state === 'loading') return <LoadingState />;
  if (years.state === 'error') return <ErrorState error={years.error} onRetry={years.reload} />;
  const year =
    years.data.find((y) => y.id === yearId) ??
    years.data.find((y) => y.status === 'ACTIVE') ??
    years.data[0];
  if (!year) return <Alert tone="info" title={t('pick.noYear')} />;
  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <SelectField
          label={t('pick.year')}
          value={year.id}
          onChange={(e) => setYearId(e.target.value)}
          options={years.data.map((y) => ({ value: y.id, label: y.label }))}
        />
      </div>
      <YearPeriods
        key={year.id}
        year={year}
        canManage={canManage && year.status !== 'CLOSED'}
        onChange={years.reload}
      />
    </div>
  );
}

function YearPeriods({
  year,
  canManage,
  onChange,
}: {
  year: YearWithPeriods;
  canManage: boolean;
  onChange: () => void;
}) {
  const { t, labels } = useSchoolText();
  const periods = useApi<PeriodRow[]>(`/school/periods?schoolYearId=${year.id}`);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const reload = () => {
    periods.reload();
    onChange();
  };

  async function remove(id: string) {
    setError(null);
    try {
      await api(`/school/periods/${id}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  if (periods.state === 'loading') return <LoadingState />;
  if (periods.state === 'error') {
    return <ErrorState error={periods.error} onRetry={periods.reload} />;
  }
  return (
    <>
      {year.status === 'CLOSED' && <Alert tone="info" title={t('periods.closed')} />}
      <ApiErrorAlert error={error} />
      <Card>
        <ul className="divide-y divide-line/70" data-testid="period-list">
          {periods.data.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted">{t('periods.empty')}</li>
          )}
          {periods.data.map((p) =>
            editing === p.id ? (
              <li key={p.id} className="px-4 py-3">
                <PeriodForm
                  period={p}
                  onDone={() => {
                    setEditing(null);
                    reload();
                  }}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <PeriodLine
                key={p.id}
                period={p}
                kindLabel={labels.periodKind[p.kind]}
                canManage={canManage}
                onEdit={() => setEditing(p.id)}
                onDelete={() => void remove(p.id)}
              />
            ),
          )}
        </ul>
      </Card>
      {canManage && (
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">{t('periods.add')}</h2>
            <PeriodForm yearId={year.id} onDone={reload} />
          </CardBody>
        </Card>
      )}
    </>
  );
}

function PeriodLine({
  period: p,
  kindLabel,
  canManage,
  onEdit,
  onDelete,
}: {
  period: PeriodRow;
  kindLabel: string;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t, date, name } = useSchoolText();
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm" data-testid="period">
      <span className="min-w-0 flex-1">
        <span className="font-medium">{name({ name: p.label, nameAr: p.labelAr })}</span>
        <span className="text-muted">
          {' · '}
          {kindLabel} · {t('years.range', { from: date(p.startsOn), to: date(p.endsOn) })}
        </span>
      </span>
      <Badge tone={p.evaluations ? 'forest' : 'neutral'}>
        {t('periods.evaluations', { n: p.evaluations })}
      </Badge>
      {canManage && (
        <span className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onEdit}>
            {t('periods.edit')}
          </Button>
          {!p.inUse && (
            <Button size="sm" variant="ghost" onClick={onDelete}>
              {t('periods.delete')}
            </Button>
          )}
        </span>
      )}
    </li>
  );
}

/** Création (avec `yearId`) ou modification (avec `period`) d'une période. */
function PeriodForm({
  yearId,
  period,
  onDone,
  onCancel,
}: {
  yearId?: string;
  period?: PeriodRow;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const { t, labels, showArabic } = useSchoolText();
  const [kind, setKind] = useState<SchoolPeriodKind>(period?.kind ?? 'TRIMESTER');
  const [label, setLabel] = useState(period?.label ?? '');
  const [labelAr, setLabelAr] = useState(period?.labelAr ?? '');
  const [startsOn, setStartsOn] = useState(period?.startsOn.slice(0, 10) ?? '');
  const [endsOn, setEndsOn] = useState(period?.endsOn.slice(0, 10) ?? '');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function save() {
    setLoading(true);
    setError(null);
    try {
      const common = {
        label,
        startsOn,
        endsOn,
        ...(showArabic ? { labelAr: labelAr || null } : {}),
      };
      if (period) {
        await api(`/school/periods/${period.id}`, { method: 'PATCH', body: common });
      } else {
        await api('/school/periods', {
          method: 'POST',
          body: { schoolYearId: yearId, kind, ...common },
        });
        setLabel('');
        setLabelAr('');
        setStartsOn('');
        setEndsOn('');
      }
      onDone();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="period-form">
      <ApiErrorAlert error={error} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {!period && (
          <SelectField
            label={t('periods.kind')}
            value={kind}
            onChange={(e) => setKind(e.target.value as SchoolPeriodKind)}
            options={SCHOOL_PERIOD_KINDS.map((k) => ({ value: k, label: labels.periodKind[k] }))}
          />
        )}
        <InputField
          label={t('periods.label')}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        {showArabic && (
          <InputField
            label={t('periods.labelAr')}
            dir="rtl"
            lang="ar"
            value={labelAr}
            onChange={(e) => setLabelAr(e.target.value)}
          />
        )}
        <InputField
          label={t('periods.startsOn')}
          type="date"
          value={startsOn}
          onChange={(e) => setStartsOn(e.target.value)}
        />
        <InputField
          label={t('periods.endsOn')}
          type="date"
          value={endsOn}
          onChange={(e) => setEndsOn(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          loading={loading}
          disabled={!label || !startsOn || !endsOn}
          onClick={() => void save()}
        >
          {period ? t('periods.save') : t('periods.add')}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            {t('periods.cancel')}
          </Button>
        )}
      </div>
    </div>
  );
}
