'use client';

import { useState } from 'react';
import {
  SCHOOL_PERIOD_KINDS,
  SCHOOL_PERIOD_KIND_LABELS,
  SCHOOL_YEAR_STATUS_LABELS,
  type SchoolPeriodKind,
  type SchoolYearStatus,
} from '@ocall/shared';
import { BiName, SchoolPage } from '@/components/school/school-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { SimpleForm } from '@/components/ui/simple-form';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
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
    <SchoolPage
      title="Années et périodes"
      description="Trimestres, semestres ou périodes personnalisées, par établissement."
    >
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
  const years = useApi<SchoolYearView[]>(`/school/years?schoolId=${schoolId}`);
  const [error, setError] = useState<ApiError | null>(null);

  async function setStatus(id: string, status: 'ACTIVE' | 'CLOSED') {
    setError(null);
    try {
      await api(`/school/years/${id}/status`, { method: 'POST', body: { status } });
      years.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion impossible.'));
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
                {SCHOOL_YEAR_STATUS_LABELS[y.status]}
              </Badge>
              {canManage && y.status === 'PLANNED' && (
                <Button size="sm" onClick={() => void setStatus(y.id, 'ACTIVE')}>
                  Ouvrir l’année
                </Button>
              )}
              {canManage && y.status === 'ACTIVE' && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void setStatus(y.id, 'CLOSED')}
                >
                  Clôturer
                </Button>
              )}
            </div>
            <p className="text-sm text-muted">
              Du {formatDate(y.startsOn)} au {formatDate(y.endsOn)}
            </p>
            <ul className="mt-3 divide-y divide-line/70 text-sm">
              {y.periods.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="flex-1 font-medium">
                    <BiName name={p.label} nameAr={p.labelAr} />
                  </span>
                  <span className="text-muted">
                    {SCHOOL_PERIOD_KIND_LABELS[p.kind]} · {formatDate(p.startsOn)} –{' '}
                    {formatDate(p.endsOn)}
                  </span>
                </li>
              ))}
            </ul>
            {canManage && y.status !== 'CLOSED' && (
              <div className="mt-4 border-t border-line/70 pt-4">
                <h3 className="mb-2 text-sm font-semibold">Ajouter une période</h3>
                <SimpleForm
                  path="/school/periods"
                  extra={{ schoolYearId: y.id }}
                  submitLabel="Ajouter la période"
                  onDone={years.reload}
                  fields={[
                    {
                      name: 'kind',
                      label: 'Type',
                      type: 'select',
                      options: SCHOOL_PERIOD_KINDS.map((k) => ({
                        value: k,
                        label: SCHOOL_PERIOD_KIND_LABELS[k],
                      })),
                    },
                    { name: 'label', label: 'Libellé', required: true },
                    { name: 'labelAr', label: 'Libellé en arabe', rtl: true },
                    { name: 'startsOn', label: 'Début', type: 'date', required: true },
                    { name: 'endsOn', label: 'Fin', type: 'date', required: true },
                  ]}
                />
              </div>
            )}
          </CardBody>
        </Card>
      ))}
      {canManage && (
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">Nouvelle année scolaire</h2>
            <SimpleForm
              testId="year-form"
              path="/school/years"
              extra={{ schoolId }}
              submitLabel="Créer l’année"
              onDone={years.reload}
              fields={[
                { name: 'label', label: 'Libellé (ex. 2026-2027)', required: true },
                { name: 'startsOn', label: 'Début', type: 'date', required: true },
                { name: 'endsOn', label: 'Fin', type: 'date', required: true },
              ]}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}
