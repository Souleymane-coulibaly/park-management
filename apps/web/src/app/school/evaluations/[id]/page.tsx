'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { SCHOOL_GRADE_STATUSES, type SchoolGradeStatus } from '@ocall/shared';
import { useState } from 'react';
import {
  type EvaluationView,
  GradeStatusBadge,
  type RosterStudentView,
  useScore,
} from '@/components/school/school-assessment';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import {
  SchoolPage,
  type SchoolPageApi,
  SchoolReadOnlyNotice,
} from '@/components/school/school-page';
import { StudentName } from '@/components/school/school-students';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface SheetStudent extends RosterStudentView {
  status: SchoolGradeStatus | null;
  score: number | null;
  comment: string | null;
}

interface Sheet {
  evaluation: EvaluationView;
  locked: boolean;
  students: SheetStudent[];
}

interface Draft {
  status: SchoolGradeStatus | '';
  score: string;
  comment: string;
}

interface HistoryEntry {
  id: string;
  action: 'created' | 'updated' | 'deleted';
  before: { status: SchoolGradeStatus; score: number | null } | null;
  after: { status: SchoolGradeStatus; score: number | null } | null;
  reason: string | null;
  createdAt: string;
}

/** Saisie des notes en tableau (Sprint 4) : seules les lignes modifiées sont envoyées et journalisées. */
export default function GradeSheetPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <SchoolPage title="grades.title" description="grades.desc" needsSchool={false}>
      {(page) => <GradeSheet id={id} page={page} />}
    </SchoolPage>
  );
}

const toDraft = (s: SheetStudent): Draft => ({
  status: s.status ?? '',
  score: s.score === null ? '' : String(s.score),
  comment: s.comment ?? '',
});

function GradeSheet({ id, page }: { id: string; page: SchoolPageApi }) {
  const { t, name, date } = useSchoolText();
  const score = useScore();
  const sheet = useApi<Sheet>(`/school/evaluations/${id}`);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string | null>(null);

  if (sheet.state === 'loading') return <LoadingState />;
  if (sheet.state === 'error') return <ErrorState error={sheet.error} onRetry={sheet.reload} />;
  const { evaluation: e, locked, students } = sheet.data;
  const own = page.forSchool(e.schoolId);
  const canManage = own.canWrite('school.assessment.manage');
  const editable = canManage && !locked;
  const draftOf = (s: SheetStudent) => drafts[s.id] ?? toDraft(s);
  const changed = students.filter((s) => JSON.stringify(draftOf(s)) !== JSON.stringify(toDraft(s)));
  const update = (s: SheetStudent, patch: Partial<Draft>) => {
    setSaved(null);
    setDrafts((d) => {
      const next = { ...draftOf(s), ...patch };
      if (next.status !== 'SCORED') next.score = '';
      return { ...d, [s.id]: next };
    });
  };

  async function save() {
    // Une note vide n'est jamais un zéro : la saisie est refusée avant tout envoi.
    if (changed.some((s) => draftOf(s).status === 'SCORED' && !draftOf(s).score.trim())) {
      setError(new ApiError(400, 'GRADE_REQUIRED', 'La note est obligatoire.'));
      return;
    }
    // Brouillons envoyés, pour ne retirer après succès que ceux restés identiques (une frappe pendant
    // l'envoi est conservée).
    const sent = Object.fromEntries(changed.map((s) => [s.id, JSON.stringify(draftOf(s))]));
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ changed: number }>(`/school/evaluations/${id}/grades`, {
        method: 'PUT',
        body: {
          reason: reason || null,
          grades: changed.map((s) => {
            const d = draftOf(s);
            return {
              studentId: s.id,
              status: d.status || null,
              score: d.status === 'SCORED' ? Number(d.score.replace(',', '.')) : null,
              comment: d.comment || null,
            };
          }),
        },
      });
      setDrafts((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([id, draft]) => sent[id] !== JSON.stringify(draft)),
        ),
      );
      setReason('');
      setSaved(res.changed);
      sheet.reload();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <SchoolReadOnlyNotice page={own} />
      <Link href="/school/evaluations" className="text-sm font-medium text-forest hover:underline">
        {t('grades.back')}
      </Link>
      <Card>
        <CardBody>
          <h2 className="font-semibold">{name({ name: e.title, nameAr: e.titleAr })}</h2>
          <p className="text-sm text-muted">
            {t(`kind.${e.kind}`)} · {name(e.subject)} ·{' '}
            {e.group ? name(e.group) : t('evals.wholeClass')} · {date(e.heldOn)} ·{' '}
            {t('evals.summary', {
              max: score(e.maxScore, e.maxScore % 1 ? 2 : 0),
              coef: score(e.coefficient, e.coefficient % 1 ? 2 : 0),
            })}
          </p>
        </CardBody>
      </Card>
      {locked && <Alert tone="info" title={t('evals.locked')} />}
      <ApiErrorAlert error={error} />
      {saved !== null && <Alert tone="success" title={t('grades.saved', { n: saved })} />}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-start text-sm" data-testid="grade-sheet">
            <thead>
              <tr className="border-b border-line bg-ivory/60 text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 text-start font-semibold">{t('grades.student')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t('grades.status')}</th>
                <th className="px-4 py-3 text-start font-semibold">
                  {t('grades.score')} (
                  {t('grades.outOf', { max: score(e.maxScore, e.maxScore % 1 ? 2 : 0) })})
                </th>
                <th className="px-4 py-3 text-start font-semibold">{t('grades.comment')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {students.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted">
                    {t('grades.noStudent')}
                  </td>
                </tr>
              )}
              {students.map((s) => {
                const d = draftOf(s);
                return (
                  <tr key={s.id} data-testid="grade-row">
                    <td className="px-4 py-2">
                      <StudentName student={s} />
                      <span className="block text-xs text-muted">{s.matricule}</span>
                    </td>
                    <td className="px-4 py-2">
                      {editable ? (
                        <select
                          aria-label={t('grades.status')}
                          className="rounded-lg border border-line bg-surface px-2 py-1.5"
                          value={d.status}
                          onChange={(ev) =>
                            update(s, { status: ev.target.value as Draft['status'] })
                          }
                        >
                          <option value="">{t('grade.NONE')}</option>
                          {SCHOOL_GRADE_STATUSES.map((st) => (
                            <option key={st} value={st}>
                              {t(`grade.${st}`)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <GradeStatusBadge status={s.status} />
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {editable ? (
                        <input
                          aria-label={t('grades.score')}
                          inputMode="decimal"
                          dir="ltr"
                          className="w-24 rounded-lg border border-line bg-surface px-2 py-1.5 disabled:bg-ivory-dark/40"
                          disabled={d.status !== 'SCORED'}
                          value={d.score}
                          onChange={(ev) => update(s, { score: ev.target.value })}
                        />
                      ) : (
                        <span dir="ltr">{score(s.score)}</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {editable ? (
                        <input
                          aria-label={t('grades.comment')}
                          className="w-full min-w-40 rounded-lg border border-line bg-surface px-2 py-1.5"
                          maxLength={200}
                          value={d.comment}
                          onChange={(ev) => update(s, { comment: ev.target.value })}
                        />
                      ) : (
                        <span className="text-muted">{s.comment}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setHistory(history === s.id ? null : s.id)}
                      >
                        {t('grades.history')}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {history && <GradeHistory evaluationId={id} studentId={history} />}
      {editable && students.length > 0 && (
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-60 flex-1">
                <InputField
                  label={t('grades.reason')}
                  value={reason}
                  maxLength={200}
                  onChange={(ev) => setReason(ev.target.value)}
                />
              </div>
              <Button loading={loading} disabled={changed.length === 0} onClick={() => void save()}>
                {t('grades.save')}
              </Button>
            </div>
            {changed.length > 0 && (
              <p className="mt-2 text-sm text-muted">{t('grades.dirty', { n: changed.length })}</p>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function GradeHistory({ evaluationId, studentId }: { evaluationId: string; studentId: string }) {
  const { t, date } = useSchoolText();
  const score = useScore();
  const entries = useApi<HistoryEntry[]>(
    `/school/evaluations/${evaluationId}/grades/${studentId}/history`,
  );
  const value = (v: HistoryEntry['before']) =>
    v ? (v.status === 'SCORED' ? score(v.score) : t(`grade.${v.status}`)) : '–';
  if (entries.state === 'loading') return <LoadingState />;
  if (entries.state === 'error')
    return <ErrorState error={entries.error} onRetry={entries.reload} />;
  return (
    <Card>
      <CardBody>
        <h3 className="mb-2 font-semibold">{t('grades.history')}</h3>
        <ul className="space-y-1 text-sm" data-testid="grade-history">
          {entries.data.length === 0 && <li className="text-muted">{t('grades.historyEmpty')}</li>}
          {entries.data.map((h) => (
            <li key={h.id}>
              <span className="font-medium">{t(`grades.action.${h.action}`)}</span>
              <span className="text-muted"> · {date(h.createdAt)} · </span>
              <span dir="ltr">
                {value(h.before)} → {value(h.after)}
              </span>
              {h.reason && <span className="text-muted"> · {h.reason}</span>}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
