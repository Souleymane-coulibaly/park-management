'use client';

import { useParams } from 'next/navigation';
import type { QuranStatus } from '@ocall/shared';
import { ChildHeader, useChild } from '@/components/parents/parent-shell';
import { useSchoolText } from '@/components/school/school-language';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

interface QuranView {
  summary: { counts: Record<QuranStatus, number>; memorizedVerses: number; totalVerses: number };
  surahs: { number: number; nameAr: string; transliteration: string; status: QuranStatus }[];
  evaluations: {
    id: string;
    surah: number;
    status: QuranStatus;
    evaluatedOn: string;
    remark: string | null;
  }[];
}

const TONE: Record<QuranStatus, 'neutral' | 'savanna' | 'forest' | 'terracotta'> = {
  NOT_STARTED: 'neutral',
  IN_PROGRESS: 'savanna',
  MEMORIZED: 'forest',
  TO_REVIEW: 'terracotta',
};

/**
 * Mémorisation du Coran : seulement pour un établissement où le module est actif (sinon l'API répond
 * introuvable). Observations des enseignants : seulement celles qu'ils ont autorisées.
 */
export default function ChildQuranPage() {
  const { id } = useParams<{ id: string }>();
  const child = useChild(id);
  const { t, date, language } = useSchoolText();
  const data = useApi<QuranView>(`/school/portal/children/${id}/quran`);
  if (!child) return <Alert tone="info" title={t('par.noChildren')} />;
  const surahName = (n: number) => {
    const s = data.state === 'success' ? data.data.surahs.find((x) => x.number === n) : undefined;
    return s ? (language === 'ar' ? s.nameAr : `${n}. ${s.transliteration}`) : String(n);
  };
  return (
    <>
      <ChildHeader child={child} />
      {data.state === 'loading' ? (
        <LoadingState />
      ) : data.state === 'error' ? (
        <ErrorState error={data.error} onRetry={data.reload} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="quran-summary">
            {(['MEMORIZED', 'TO_REVIEW', 'IN_PROGRESS', 'NOT_STARTED'] as const).map((s) => (
              <Card key={s}>
                <CardBody>
                  <p className="text-xs text-muted">{t(`qstatus.${s}`)}</p>
                  <p className="text-xl font-semibold">{data.data.summary.counts[s]}</p>
                </CardBody>
              </Card>
            ))}
          </div>
          <p className="text-sm text-muted">
            {t('quran.verses', {
              n: data.data.summary.memorizedVerses,
              total: data.data.summary.totalVerses,
            })}
          </p>
          <Card>
            <CardBody>
              <h3 className="mb-2 font-semibold">{t('par.quran.evaluations')}</h3>
              {data.data.evaluations.length === 0 ? (
                <p className="text-sm text-muted">{t('par.att.none')}</p>
              ) : (
                <ul className="divide-y divide-line/70 text-sm">
                  {data.data.evaluations.map((e) => (
                    <li key={e.id} className="space-y-1 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          {surahName(e.surah)} · {date(e.evaluatedOn)}
                        </span>
                        <Badge tone={TONE[e.status]}>{t(`qstatus.${e.status}`)}</Badge>
                      </div>
                      {e.remark && <p className="text-muted">{e.remark}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <h3 className="mb-2 font-semibold">{t('par.quran.surahs')}</h3>
              <ul className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-4 lg:grid-cols-6">
                {data.data.surahs
                  .filter((s) => s.status !== 'NOT_STARTED')
                  .map((s) => (
                    <li key={s.number} className="flex items-center justify-between gap-1">
                      <span className="truncate">{surahName(s.number)}</span>
                      <Badge tone={TONE[s.status]}>{t(`qstatus.${s.status}`)}</Badge>
                    </li>
                  ))}
              </ul>
            </CardBody>
          </Card>
        </>
      )}
    </>
  );
}
