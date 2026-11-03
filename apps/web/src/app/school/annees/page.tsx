'use client';

import { useState } from 'react';
import { SCHOOL_PERIOD_KINDS, type SchoolPeriodKind, type SchoolYearStatus } from '@ocall/shared';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { BiName, SchoolPage } from '@/components/school/school-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { SimpleForm } from '@/components/ui/simple-form';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

export interface SchoolYearView {
  id: string;
  label: string;
  startsOn: string;
  endsOn: string;
  status: SchoolYearStatus;
  periods: {
    id: string;
    kind: SchoolPeriodKind;
    label: string;
    labelAr: string | null;
    startsOn: string;
    endsOn: string;
  }[];
}

export default function AnneesPage() {
  return (
    <SchoolPage title="years.title" description="years.desc">
      {({ school, canWrite }) => (
        <Years
          key={school!.id}
          schoolId={school!.id}
          canManage={canWrite('school.structure.manage')}
        />
      )}
    </SchoolPage>
  );
}

function Years({ schoolId, canManage }: { schoolId: string; canManage: boolean }) {
  const { t, labels, date, fields } = useSchoolText();
  const years = useApi<SchoolYearView[]>(`/school/years?schoolId=${schoolId}`);
  const [error, setError] = useState<ApiError | null>(null);

  async function setStatus(id: string, status: 'ACTIVE' | 'CLOSED') {
    setError(null);
    try {
      await api(`/school/years/${id}/status`, { method: 'POST', body: { status } });
      years.reload();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  if (years.state === 'loading') return <LoadingState />;
  if (years.state === 'error') return <ErrorState error={years.error} onRetry={years.reload} />;
  return (
    <>
      <ApiErrorAlert error={error} />
      {years.data.map((y) => (
        <Card key={y.id}>
          <CardBody>
            <div className="flex flex-wrap items-center gap-3" data-testid="school-year">
              <h2 className="flex-1 font-display text-lg font-bold">{y.label}</h2>
              <Badge tone={y.status === 'ACTIVE' ? 'forest' : 'neutral'}>
                {labels.yearStatus[y.status]}
              </Badge>
              {canManage && y.status === 'PLANNED' && (
                <Button size="sm" onClick={() => void setStatus(y.id, 'ACTIVE')}>
                  {t('years.open')}
                </Button>
              )}
              {canManage && y.status === 'ACTIVE' && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void setStatus(y.id, 'CLOSED')}
                >
                  {t('years.close')}
                </Button>
              )}
            </div>
            <p className="text-sm text-muted">
              {t('years.range', { from: date(y.startsOn), to: date(y.endsOn) })}
            </p>
            <ul className="mt-3 divide-y divide-line/70 text-sm">
              {y.periods.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="flex-1 font-medium">
                    <BiName name={p.label} nameAr={p.labelAr} />
                  </span>
                  <span className="text-muted">
                    {labels.periodKind[p.kind]} · {date(p.startsOn)} – {date(p.endsOn)}
                  </span>
                </li>
              ))}
            </ul>
            {canManage && y.status !== 'CLOSED' && (
              <div className="mt-4 border-t border-line/70 pt-4">
                <h3 className="mb-2 text-sm font-semibold">{t('years.addPeriod')}</h3>
                <SimpleForm
                  path="/school/periods"
                  extra={{ schoolYearId: y.id }}
                  submitLabel={t('years.addPeriodSubmit')}
                  onDone={years.reload}
                  fields={fields([
                    {
                      name: 'kind',
                      label: t('field.type'),
                      type: 'select',
                      options: SCHOOL_PERIOD_KINDS.map((k) => ({
                        value: k,
                        label: labels.periodKind[k],
                      })),
                    },
                    { name: 'label', label: t('field.label'), required: true },
                    { name: 'labelAr', label: t('field.labelAr'), rtl: true },
                    { name: 'startsOn', label: t('field.start'), type: 'date', required: true },
                    { name: 'endsOn', label: t('field.end'), type: 'date', required: true },
                  ])}
                />
              </div>
            )}
          </CardBody>
        </Card>
      ))}
      {canManage && (
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">{t('years.new')}</h2>
            <SimpleForm
              testId="year-form"
              path="/school/years"
              extra={{ schoolId }}
              submitLabel={t('years.create')}
              onDone={years.reload}
              fields={[
                { name: 'label', label: t('years.labelExample'), required: true },
                { name: 'startsOn', label: t('field.start'), type: 'date', required: true },
                { name: 'endsOn', label: t('field.end'), type: 'date', required: true },
              ]}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}
