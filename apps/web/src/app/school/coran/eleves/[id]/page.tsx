'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  QURAN_STATUSES,
  type QuranProgressSummary,
  type QuranStatus,
  type QuranSurahState,
  findSurah,
} from '@ocall/shared';
import { useState } from 'react';
import { QuranStatusBadge, type RosterStudentView } from '@/components/school/school-assessment';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import { StudentName } from '@/components/school/school-students';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface StudentProgress {
  student: RosterStudentView;
  surahs: QuranSurahState[];
  summary: QuranProgressSummary;
  history: {
    id: string;
    surah: number;
    status: QuranStatus;
    evaluatedOn: string;
    remark: string | null;
  }[];
  canEvaluate: boolean;
}

/** Progression coranique d'un élève (Sprint 4) : 114 sourates, saisie par l'enseignant, historique. */
export default function QuranStudentPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <SchoolPage title="quranStudent.title" description="quran.desc">
      {({ canWrite }) => <Progress id={id} canManage={canWrite('school.quran.manage')} />}
    </SchoolPage>
  );
}

/** Nom d'une sourate : translittération en français, nom arabe en Arabe, les deux en Bilingue. */
function SurahName({
  surah,
}: {
  surah: { number: number; nameAr: string; transliteration: string };
}) {
  const { locale } = useSchoolText();
  return (
    <span>
      <span className="text-muted">{surah.number}. </span>
      {locale !== 'AR' && <span>{surah.transliteration}</span>}
      {locale !== 'FR' && (
        <span dir="rtl" lang="ar" className="mx-2 inline-block">
          {surah.nameAr}
        </span>
      )}
    </span>
  );
}

function Progress({ id, canManage }: { id: string; canManage: boolean }) {
  const { t, date } = useSchoolText();
  const progress = useApi<StudentProgress>(`/school/quran/students/${id}`);
  const [filter, setFilter] = useState<QuranStatus | ''>('');
  if (progress.state === 'loading') return <LoadingState />;
  if (progress.state === 'error')
    return <ErrorState error={progress.error} onRetry={progress.reload} />;
  const { student, surahs, summary, history, canEvaluate } = progress.data;
  const shown = filter ? surahs.filter((s) => s.status === filter) : surahs;
  return (
    <div className="space-y-4">
      <Link href="/school/coran" className="text-sm font-medium text-forest hover:underline">
        {t('quranStudent.back')}
      </Link>
      <Card>
        <CardBody>
          <h2 className="text-lg font-semibold">
            <StudentName student={student} />
          </h2>
          <div className="mt-2 flex flex-wrap gap-2 text-sm" data-testid="quran-summary">
            {QURAN_STATUSES.map((st) => (
              <span key={st} className="flex items-center gap-1">
                <QuranStatusBadge status={st} /> {summary.counts[st]}
              </span>
            ))}
            <span className="text-muted">
              {t('quran.verses', { n: summary.memorizedVerses, total: summary.totalVerses })}
            </span>
          </div>
        </CardBody>
      </Card>
      {canManage && canEvaluate && <Evaluate studentId={id} onSaved={progress.reload} />}
      <Card>
        <CardBody>
          <div className="mb-3 max-w-xs">
            <SelectField
              label={t('quranStudent.show')}
              value={filter}
              onChange={(e) => setFilter(e.target.value as QuranStatus | '')}
              options={[
                { value: '', label: t('quranStudent.all') },
                ...QURAN_STATUSES.map((st) => ({ value: st, label: t(`qstatus.${st}`) })),
              ]}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm" data-testid="surah-table">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th className="px-3 py-2 text-start font-semibold">{t('quranStudent.surah')}</th>
                  <th className="px-3 py-2 text-start font-semibold">{t('quranStudent.status')}</th>
                  <th className="px-3 py-2 text-start font-semibold">
                    {t('quranStudent.memorizedOn')}
                  </th>
                  <th className="px-3 py-2 text-start font-semibold">
                    {t('quranStudent.reviewedOn')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {shown.map((s) => (
                  <tr key={s.number} data-testid="surah-row">
                    <td className="px-3 py-1.5">
                      <SurahName surah={s} />
                      <span className="ms-1 text-xs text-muted">
                        {t('quranStudent.versesCount', { n: s.verses })}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <QuranStatusBadge status={s.status} />
                    </td>
                    <td className="px-3 py-1.5">{s.memorizedOn ? date(s.memorizedOn) : '–'}</td>
                    <td className="px-3 py-1.5">
                      {s.lastReviewedOn ? date(s.lastReviewedOn) : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <h2 className="mb-2 font-semibold">{t('quranStudent.history')}</h2>
          <ul className="space-y-1 text-sm" data-testid="quran-history">
            {history.length === 0 && (
              <li className="text-muted">{t('quranStudent.historyEmpty')}</li>
            )}
            {history.map((h) => {
              const surah = findSurah(h.surah);
              return (
                <li key={h.id} className="flex flex-wrap items-center gap-2">
                  <span className="text-muted">{date(h.evaluatedOn)}</span>
                  {surah && <SurahName surah={surah} />}
                  <QuranStatusBadge status={h.status} />
                  {h.remark && <span className="text-muted">{h.remark}</span>}
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

function Evaluate({ studentId, onSaved }: { studentId: string; onSaved: () => void }) {
  const { t, locale } = useSchoolText();
  const today = new Date().toISOString().slice(0, 10);
  const [surah, setSurah] = useState('1');
  const [status, setStatus] = useState<QuranStatus>('IN_PROGRESS');
  const [evaluatedOn, setEvaluatedOn] = useState(today);
  const [remark, setRemark] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function save() {
    setLoading(true);
    setError(null);
    try {
      await api(`/school/quran/students/${studentId}/evaluations`, {
        method: 'POST',
        body: { surah: Number(surah), status, evaluatedOn, remark: remark || null },
      });
      setRemark('');
      onSaved();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 font-semibold">{t('quranStudent.evaluate')}</h2>
        <div className="space-y-3" data-testid="quran-evaluate">
          <ApiErrorAlert error={error} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SelectField
              label={t('quranStudent.surah')}
              value={surah}
              onChange={(e) => setSurah(e.target.value)}
              options={Array.from({ length: 114 }, (_, i) => {
                const s = findSurah(i + 1)!;
                const label =
                  locale === 'AR'
                    ? s.nameAr
                    : locale === 'FR'
                      ? s.transliteration
                      : `${s.transliteration} · ${s.nameAr}`;
                return { value: String(s.number), label: `${s.number}. ${label}` };
              })}
            />
            <SelectField
              label={t('quranStudent.status')}
              value={status}
              onChange={(e) => setStatus(e.target.value as QuranStatus)}
              options={QURAN_STATUSES.map((st) => ({ value: st, label: t(`qstatus.${st}`) }))}
            />
            <InputField
              label={t('quranStudent.date')}
              type="date"
              max={today}
              value={evaluatedOn}
              onChange={(e) => setEvaluatedOn(e.target.value)}
            />
            <InputField
              label={t('quranStudent.remark')}
              maxLength={300}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
            />
          </div>
          <Button loading={loading} disabled={!evaluatedOn} onClick={() => void save()}>
            {t('quranStudent.save')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
