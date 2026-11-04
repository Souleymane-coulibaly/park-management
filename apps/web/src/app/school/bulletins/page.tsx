'use client';

import { useState } from 'react';
import {
  ClassPeriodPicker,
  type Selection,
  downloadPdf,
  useScore,
} from '@/components/school/school-assessment';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import type { ReportCardsOverview } from '@/components/school/school-report-cards';
import { StudentName } from '@/components/school/school-students';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

/**
 * Bulletins scolaires (Sprint 4) : appréciation générale de la direction, puis bulletin PDF d'un élève ou
 * de toute la classe, produit par l'API dans la langue de l'établissement.
 */
export default function BulletinsPage() {
  return (
    <SchoolPage title="cards.title" description="cards.desc">
      {({ school, canWrite }) => (
        <ClassPeriodPicker key={school!.id} schoolId={school!.id}>
          {(selection) => (
            <ReportCards
              key={`${selection.classId}:${selection.periodId}`}
              selection={selection}
              canComment={canWrite('school.results.validate')}
            />
          )}
        </ClassPeriodPicker>
      )}
    </SchoolPage>
  );
}

function ReportCards({ selection, canComment }: { selection: Selection; canComment: boolean }) {
  const { t, date, showArabic } = useSchoolText();
  const score = useScore();
  const query = `classId=${selection.classId}&periodId=${selection.periodId}`;
  const overview = useApi<ReportCardsOverview>(`/school/report-cards?${query}`);
  const [comments, setComments] = useState<Record<string, { text: string; textAr: string }>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (overview.state === 'loading') return <LoadingState />;
  if (overview.state === 'error')
    return <ErrorState error={overview.error} onRetry={overview.reload} />;
  const { students, rules, validation, rankingEnabled } = overview.data;
  const valueOf = (s: ReportCardsOverview['students'][number]) =>
    comments[s.id] ?? { text: s.comment?.text ?? '', textAr: s.comment?.textAr ?? '' };

  async function download(studentId?: string) {
    setBusy(studentId ?? 'class');
    setError(null);
    try {
      await downloadPdf(
        `/school/report-cards/pdf?${query}${studentId ? `&studentId=${studentId}` : ''}`,
        'bulletin.pdf',
      );
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveComments() {
    // Commentaires envoyés : seuls ceux restés identiques sont retirés des brouillons après succès.
    const sent = Object.fromEntries(
      Object.entries(comments).map(([id, c]) => [id, JSON.stringify(c)]),
    );
    setBusy('comments');
    setError(null);
    try {
      await api('/school/results/comments', {
        method: 'PUT',
        body: {
          classId: selection.classId,
          periodId: selection.periodId,
          items: Object.entries(comments).map(([studentId, c]) => ({
            studentId,
            text: c.text,
            ...(showArabic ? { textAr: c.textAr || null } : {}),
          })),
        },
      });
      setComments((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([id, c]) => sent[id] !== JSON.stringify(c)),
        ),
      );
      setSaved(true);
      overview.reload();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={validation ? 'forest' : 'savanna'}>
          {validation
            ? t('results.validated', { date: date(validation.validatedAt) })
            : t('results.notValidated')}
        </Badge>
        <Button
          loading={busy === 'class'}
          disabled={students.length === 0}
          onClick={() => void download()}
          data-testid="download-class"
        >
          {t('cards.downloadClass')}
        </Button>
      </div>
      {!validation && <Alert tone="info" title={t('cards.provisional')} />}
      <ApiErrorAlert error={error} />
      {saved && <Alert tone="success" title={t('results.saved')} />}
      <Card>
        <ul className="divide-y divide-line/70" data-testid="report-cards">
          {students.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted">{t('quran.empty')}</li>
          )}
          {students.map((s) => (
            <li key={s.id} className="space-y-2 px-4 py-3 text-sm" data-testid="report-card">
              <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1">
                  <StudentName student={s} />
                  <span className="ms-2 text-xs text-muted">{s.matricule}</span>
                </span>
                <span dir="ltr" className="font-semibold">
                  {score(s.generalAverage, rules.decimals)} / {rules.scale}
                </span>
                {rankingEnabled && (
                  <span className="text-muted">
                    {t('results.rank')} {s.rank ?? '–'}
                  </span>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy === s.id}
                  onClick={() => void download(s.id)}
                >
                  {t('cards.download')}
                </Button>
              </div>
              {canComment ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    aria-label={t('cards.comment')}
                    placeholder={t('cards.comment')}
                    className="rounded-lg border border-line bg-surface px-2 py-1.5"
                    maxLength={600}
                    value={valueOf(s).text}
                    onChange={(e) => {
                      setSaved(false);
                      setComments((c) => ({
                        ...c,
                        [s.id]: { ...valueOf(s), text: e.target.value },
                      }));
                    }}
                  />
                  {showArabic && (
                    <input
                      aria-label={t('cards.commentAr')}
                      placeholder={t('cards.commentAr')}
                      dir="rtl"
                      lang="ar"
                      className="rounded-lg border border-line bg-surface px-2 py-1.5"
                      maxLength={600}
                      value={valueOf(s).textAr}
                      onChange={(e) => {
                        setSaved(false);
                        setComments((c) => ({
                          ...c,
                          [s.id]: { ...valueOf(s), textAr: e.target.value },
                        }));
                      }}
                    />
                  )}
                </div>
              ) : (
                s.comment && <p className="text-muted">{s.comment.text}</p>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {canComment && students.length > 0 && (
        <Card>
          <CardBody>
            <Button
              loading={busy === 'comments'}
              disabled={Object.keys(comments).length === 0}
              onClick={() => void saveComments()}
            >
              {t('cards.saveComments')}
            </Button>
          </CardBody>
        </Card>
      )}
    </>
  );
}
