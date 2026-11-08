'use client';

import { useParams } from 'next/navigation';
import { ChildHeader, useChild } from '@/components/parents/parent-shell';
import { useSchoolText } from '@/components/school/school-language';
import { Card, CardBody } from '@/components/ui/card';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

interface ResultsView {
  periods: {
    publicationId: string;
    period: { id: string; label: string; labelAr: string | null };
    scale: number;
    decimals: number;
    generalAverage: number | null;
    classAverage: number | null;
    rank: number | null;
    rankedCount: number | null;
    subjects: {
      id: string;
      name: string;
      nameAr: string | null;
      coefficient: number;
      average: number | null;
      classAverage: number | null;
      evaluations: {
        id: string;
        title: string;
        titleAr: string | null;
        heldOn: string;
        maxScore: number;
        status: 'SCORED' | 'ABSENT' | 'EXEMPT';
        score: number | null;
      }[];
    }[];
  }[];
}

const num = (v: number | null, decimals = 2) =>
  v === null ? '—' : v.toLocaleString('fr-FR', { maximumFractionDigits: decimals });

/** Résultats publiés par l'établissement : jamais un brouillon ni des résultats non validés. */
export default function ChildResultsPage() {
  const { id } = useParams<{ id: string }>();
  const child = useChild(id);
  const { t, name, date } = useSchoolText();
  const data = useApi<ResultsView>(`/school/portal/children/${id}/results`);
  if (!child) return <Alert tone="info" title={t('par.noChildren')} />;
  return (
    <>
      <ChildHeader child={child} />
      {data.state === 'loading' ? (
        <LoadingState />
      ) : data.state === 'error' ? (
        <ErrorState error={data.error} onRetry={data.reload} />
      ) : data.data.periods.length === 0 ? (
        <Alert tone="info" title={t('par.res.none')} />
      ) : (
        data.data.periods.map((p) => (
          <Card key={p.publicationId}>
            <CardBody>
              <h3 className="text-lg font-semibold">
                {name({ name: p.period.label, nameAr: p.period.labelAr })}
              </h3>
              <dl
                className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3"
                data-testid="general-average"
              >
                <div>
                  <dt className="text-xs text-muted">{t('par.res.general')}</dt>
                  <dd className="text-xl font-bold">
                    {num(p.generalAverage, p.decimals)} / {p.scale}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{t('par.res.classAverage')}</dt>
                  <dd className="font-semibold">{num(p.classAverage, p.decimals)}</dd>
                </div>
                {p.rank !== null && (
                  <div>
                    <dt className="text-xs text-muted">{t('par.res.rank')}</dt>
                    <dd className="font-semibold">
                      {p.rank} / {p.rankedCount}
                    </dd>
                  </div>
                )}
              </dl>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs text-muted">
                      <th className="px-2 py-1 text-start">{t('par.res.subject')}</th>
                      <th className="px-2 py-1 text-end">{t('par.res.coefficient')}</th>
                      <th className="px-2 py-1 text-end">{t('par.res.average')}</th>
                      <th className="px-2 py-1 text-end">{t('par.res.classAverage')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/70">
                    {p.subjects.map((s) => (
                      <tr key={s.id} className="align-top">
                        <td className="px-2 py-2">
                          <span className="font-medium">{name(s)}</span>
                          {s.evaluations.length > 0 && (
                            <ul className="mt-1 space-y-0.5 text-xs text-muted">
                              {s.evaluations.map((e) => (
                                <li key={e.id}>
                                  {name({ name: e.title, nameAr: e.titleAr })} · {date(e.heldOn)} ·{' '}
                                  {e.status === 'SCORED'
                                    ? `${num(e.score)} / ${num(e.maxScore)}`
                                    : e.status === 'ABSENT'
                                      ? t('par.res.absent')
                                      : t('par.res.exempt')}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="px-2 py-2 text-end">{num(s.coefficient)}</td>
                        <td className="px-2 py-2 text-end font-semibold">
                          {num(s.average, p.decimals)}
                        </td>
                        <td className="px-2 py-2 text-end text-muted">
                          {num(s.classAverage, p.decimals)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        ))
      )}
    </>
  );
}
