'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ChildHeader, useChild } from '@/components/parents/parent-shell';
import { downloadPdf } from '@/components/school/school-assessment';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import type { ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface ResultsView {
  periods: {
    publicationId: string;
    publishedAt: string;
    period: { label: string; labelAr: string | null };
  }[];
}

/** Bulletins officiellement publiés ; le PDF est produit à la demande, jamais mis en cache. */
export default function ChildReportCardsPage() {
  const { id } = useParams<{ id: string }>();
  const child = useChild(id);
  const { t, name, date } = useSchoolText();
  const data = useApi<ResultsView>(`/school/portal/children/${id}/results`);
  const [error, setError] = useState<ApiError | null>(null);
  if (!child) return <Alert tone="info" title={t('par.noChildren')} />;

  async function download(publicationId: string) {
    setError(null);
    try {
      await downloadPdf(
        `/school/portal/children/${id}/report-cards/${publicationId}`,
        'bulletin.pdf',
      );
    } catch (e) {
      setError(toApiError(e));
    }
  }

  return (
    <>
      <ChildHeader child={child} />
      <ApiErrorAlert error={error} />
      {data.state === 'loading' ? (
        <LoadingState />
      ) : data.state === 'error' ? (
        <ErrorState error={data.error} onRetry={data.reload} />
      ) : data.data.periods.length === 0 ? (
        <Alert tone="info" title={t('par.cards.none')} />
      ) : (
        <Card>
          <ul className="divide-y divide-line/70" data-testid="report-cards">
            {data.data.periods.map((p) => (
              <li
                key={p.publicationId}
                className="flex flex-wrap items-center justify-between gap-2 p-4"
              >
                <div>
                  <p className="font-medium">
                    {name({ name: p.period.label, nameAr: p.period.labelAr })}
                  </p>
                  <p className="text-xs text-muted">{date(p.publishedAt)}</p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void download(p.publicationId)}
                >
                  {t('par.cards.download')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
