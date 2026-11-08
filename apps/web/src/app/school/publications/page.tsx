'use client';

import { useState } from 'react';
import { YearPicker } from '@/components/school/school-finance';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import { useClasses } from '@/components/school/school-students';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface Publication {
  id: string;
  periodId: string;
  publishedAt: string;
  withdrawnAt: string | null;
  visible: boolean;
  period: { label: string; labelAr: string | null };
}

/**
 * Résultats publiés aux familles (Sprint 6) : seuls des résultats validés se publient ; s'ils sont
 * rouverts, la publication cesse d'être visible jusqu'à une nouvelle validation et publication.
 */
export default function PublicationsPage() {
  return (
    <SchoolPage title="pub.title" description="pub.desc">
      {({ school, canWrite }) => (
        <YearPicker key={school!.id} schoolId={school!.id}>
          {(year) => (
            <Publications
              key={year.id}
              yearId={year.id}
              canPublish={canWrite('school.results.publish')}
            />
          )}
        </YearPicker>
      )}
    </SchoolPage>
  );
}

function Publications({ yearId, canPublish }: { yearId: string; canPublish: boolean }) {
  const { t, name, date } = useSchoolText();
  const classes = useClasses(yearId);
  const periods = useApi<{ id: string; label: string; labelAr: string | null }[]>(
    `/school/periods?schoolYearId=${yearId}`,
  );
  const [classId, setClassId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const cls = classes.find((c) => c.id === classId) ?? classes[0];
  const periodList = periods.state === 'success' ? periods.data : [];
  const period = periodList.find((p) => p.id === periodId) ?? periodList[0];
  const list = useApi<Publication[]>(cls ? `/school/results/publications?classId=${cls.id}` : null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function run(work: () => Promise<unknown>) {
    setLoading(true);
    setError(null);
    try {
      await work();
      list.reload();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  if (!cls) return <Alert tone="info" title={t('pick.noClass')} />;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label={t('pick.class')}
          value={cls.id}
          onChange={(e) => setClassId(e.target.value)}
          options={classes.map((c) => ({ value: c.id, label: name(c) }))}
        />
        <SelectField
          label={t('pub.period')}
          value={period?.id ?? ''}
          onChange={(e) => setPeriodId(e.target.value)}
          options={periodList.map((p) => ({
            value: p.id,
            label: name({ name: p.label, nameAr: p.labelAr }),
          }))}
        />
      </div>
      <p className="text-sm text-muted">{t('pub.hint')}</p>
      <ApiErrorAlert error={error} />
      {canPublish && period && (
        <Button
          loading={loading}
          onClick={() =>
            void run(() =>
              api('/school/results/publications', {
                method: 'POST',
                body: { classId: cls.id, periodId: period.id },
              }),
            )
          }
          data-testid="publish-results"
        >
          {t('pub.publish')}
        </Button>
      )}
      {list.state === 'loading' ? (
        <LoadingState />
      ) : list.state === 'error' ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : list.data.length === 0 ? (
        <Alert tone="info" title={t('pub.none')} />
      ) : (
        <Card>
          <ul className="divide-y divide-line/70" data-testid="publications">
            {list.data.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {name({ name: p.period.label, nameAr: p.period.labelAr })}
                  </p>
                  <p className="text-xs text-muted">{date(p.publishedAt)}</p>
                </div>
                <span className="flex items-center gap-2">
                  <Badge tone={p.visible ? 'forest' : 'neutral'}>
                    {p.visible ? t('pub.visible') : t('pub.hidden')}
                  </Badge>
                  {canPublish && p.withdrawnAt === null && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void run(() =>
                          api(`/school/results/publications/${p.id}/withdraw`, { method: 'POST' }),
                        )
                      }
                    >
                      {t('pub.withdraw')}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
