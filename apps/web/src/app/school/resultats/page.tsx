'use client';

import { useState } from 'react';
import {
  ClassPeriodPicker,
  type ResultsView,
  type Selection,
  useScore,
} from '@/components/school/school-assessment';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import { StudentName } from '@/components/school/school-students';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface ValidationEntry {
  id: string;
  validatedAt: string;
  unlockedAt: string | null;
  unlockReason: string | null;
}

/**
 * Résultats et moyennes (Sprint 4). Direction : toutes les matières, moyenne générale, rang, validation.
 * Enseignant : ses matières seulement, et ses appréciations.
 */
export default function ResultatsPage() {
  return (
    <SchoolPage title="results.title" description="results.desc">
      {({ school, canWrite }) => (
        <ClassPeriodPicker key={school!.id} schoolId={school!.id}>
          {(selection) => (
            <Results
              key={`${selection.classId}:${selection.periodId}`}
              selection={selection}
              canValidate={canWrite('school.results.validate')}
              canAppreciate={canWrite('school.assessment.manage')}
            />
          )}
        </ClassPeriodPicker>
      )}
    </SchoolPage>
  );
}

function Results({
  selection,
  canValidate,
  canAppreciate,
}: {
  selection: Selection;
  canValidate: boolean;
  canAppreciate: boolean;
}) {
  const { t, name, date } = useSchoolText();
  const score = useScore();
  const query = `classId=${selection.classId}&periodId=${selection.periodId}`;
  const res = useApi<ResultsView>(`/school/results?${query}`);
  if (res.state === 'loading') return <LoadingState />;
  if (res.state === 'error') return <ErrorState error={res.error} onRetry={res.reload} />;
  const { rules, subjects, students, results, validation, restricted } = res.data;
  const byStudent = new Map(results.students.map((r) => [r.studentId, r]));
  const summary = new Map(results.subjects.map((s) => [s.subjectId, s]));
  const decimals = rules.decimals;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={validation ? 'forest' : 'savanna'}>
          {validation
            ? t('results.validated', { date: date(validation.validatedAt) })
            : t('results.notValidated')}
        </Badge>
        <span className="text-muted">
          {t('results.rules', { scale: rules.scale, passMark: score(rules.passMark, 0) })}
        </span>
      </div>
      {restricted && <Alert tone="info" title={t('results.restricted')} />}
      {subjects.length === 0 ? (
        <Alert tone="info" title={t('results.noSubject')} />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm" data-testid="results-table">
              <thead>
                <tr className="border-b border-line bg-ivory/60 text-xs text-muted">
                  <th className="px-4 py-3 text-start font-semibold">{t('grades.student')}</th>
                  {subjects.map((s) => (
                    <th key={s.id} className="px-3 py-3 text-center font-semibold">
                      {name(s)}
                      <span className="block font-normal">
                        ×{score(s.coefficient, s.coefficient % 1 ? 2 : 0)}
                      </span>
                    </th>
                  ))}
                  {!restricted && (
                    <>
                      <th className="px-3 py-3 text-center font-semibold">
                        {t('results.general')}
                      </th>
                      {results.rankingEnabled && (
                        <th className="px-3 py-3 text-center font-semibold">{t('results.rank')}</th>
                      )}
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {students.map((st) => {
                  const r = byStudent.get(st.id);
                  return (
                    <tr key={st.id} data-testid="results-row">
                      <td className="px-4 py-2">
                        <StudentName student={st} />
                      </td>
                      {subjects.map((s) => {
                        const cell = r?.subjects.find((x) => x.subjectId === s.id);
                        return (
                          <td key={s.id} className="px-3 py-2 text-center" dir="ltr">
                            {score(cell?.average, decimals)}
                            {cell && cell.missing > 0 && (
                              <span className="block text-xs text-terracotta-dark">
                                {t('results.missing', { n: cell.missing })}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      {!restricted && (
                        <>
                          <td className="px-3 py-2 text-center font-semibold" dir="ltr">
                            {score(r?.generalAverage, decimals)}
                          </td>
                          {results.rankingEnabled && (
                            <td className="px-3 py-2 text-center">
                              {r?.rank ?? '–'}
                              {r?.tied && (
                                <span className="ms-1 text-xs text-muted">{t('results.tied')}</span>
                              )}
                            </td>
                          )}
                        </>
                      )}
                    </tr>
                  );
                })}
                <tr className="bg-ivory/40 text-muted">
                  <td className="px-4 py-2 font-medium">{t('results.classAverage')}</td>
                  {subjects.map((s) => (
                    <td key={s.id} className="px-3 py-2 text-center" dir="ltr">
                      {score(summary.get(s.id)?.classAverage, decimals)}
                    </td>
                  ))}
                  {!restricted && (
                    <>
                      <td className="px-3 py-2 text-center font-semibold" dir="ltr">
                        {score(results.classAverage, decimals)}
                      </td>
                      {results.rankingEnabled && <td />}
                    </>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {canValidate && !restricted && (
        <ValidationPanel
          query={query}
          selection={selection}
          validated={Boolean(validation)}
          onChange={res.reload}
        />
      )}
      {canAppreciate && !validation && subjects.length > 0 && (
        <Appreciations data={res.data} selection={selection} onSaved={res.reload} />
      )}
    </>
  );
}

function ValidationPanel({
  query,
  selection,
  validated,
  onChange,
}: {
  query: string;
  selection: Selection;
  validated: boolean;
  onChange: () => void;
}) {
  const { t, date } = useSchoolText();
  const history = useApi<ValidationEntry[]>(`/school/results/validations?${query}`);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const body = { classId: selection.classId, periodId: selection.periodId };

  async function run(path: string, extra: Record<string, string> = {}) {
    setLoading(true);
    setError(null);
    try {
      await api(path, { method: 'POST', body: { ...body, ...extra } });
      setReason('');
      history.reload();
      onChange();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <div className="space-y-3" data-testid="validation-panel">
          <ApiErrorAlert error={error} />
          {validated ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-60 flex-1">
                <InputField
                  label={t('results.unlockReason')}
                  value={reason}
                  maxLength={200}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <Button
                variant="secondary"
                loading={loading}
                disabled={reason.trim().length < 3}
                onClick={() => void run('/school/results/unlock', { reason })}
              >
                {t('results.unlock')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button loading={loading} onClick={() => void run('/school/results/validate')}>
                {t('results.validate')}
              </Button>
              <p className="text-sm text-muted">{t('results.validateHint')}</p>
            </div>
          )}
          {history.state === 'success' && history.data.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">{t('results.history')}</h3>
              <ul className="mt-1 space-y-0.5 text-sm text-muted">
                {history.data.map((v) => (
                  <li key={v.id}>
                    {t('results.validated', { date: date(v.validatedAt) })}
                    {v.unlockedAt &&
                      ` · ${t('results.unlocked', { date: date(v.unlockedAt), reason: v.unlockReason ?? '' })}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

/** Appréciations d'une matière : une ligne par élève, en français et (si affiché) en arabe. */
function Appreciations({
  data,
  selection,
  onSaved,
}: {
  data: ResultsView;
  selection: Selection;
  onSaved: () => void;
}) {
  const { t, name, showArabic } = useSchoolText();
  const [subjectId, setSubjectId] = useState(data.subjects[0]?.id ?? '');
  const [texts, setTexts] = useState<Record<string, { text: string; textAr: string }>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  // Seuls les élèves autorisés pour la matière choisie (enseignant de groupe : ceux de son groupe).
  const allowed = new Set(data.appreciationStudents[subjectId] ?? []);
  const students = data.students.filter((st) => allowed.has(st.id));
  const existing = (studentId: string) =>
    data.appreciations.find((a) => a.subjectId === subjectId && a.studentId === studentId);
  const valueOf = (studentId: string) =>
    texts[`${subjectId}:${studentId}`] ?? {
      text: existing(studentId)?.text ?? '',
      textAr: existing(studentId)?.textAr ?? '',
    };
  const set = (studentId: string, patch: Partial<{ text: string; textAr: string }>) => {
    setSaved(false);
    setTexts((v) => ({ ...v, [`${subjectId}:${studentId}`]: { ...valueOf(studentId), ...patch } }));
  };

  async function save() {
    setLoading(true);
    setError(null);
    try {
      const items = students
        .filter((s) => texts[`${subjectId}:${s.id}`])
        .map((s) => ({
          studentId: s.id,
          text: valueOf(s.id).text,
          ...(showArabic ? { textAr: valueOf(s.id).textAr || null } : {}),
        }));
      await api('/school/results/appreciations', {
        method: 'PUT',
        body: { classId: selection.classId, periodId: selection.periodId, subjectId, items },
      });
      // Seuls les brouillons envoyés et confirmés sont retirés : les autres matières, et une frappe
      // survenue pendant l'envoi, sont conservées.
      setTexts((current) => {
        const next = { ...current };
        for (const item of items) {
          const key = `${subjectId}:${item.studentId}`;
          const draft = next[key];
          if (
            draft &&
            draft.text === item.text &&
            (!showArabic || (draft.textAr || null) === item.textAr)
          ) {
            delete next[key];
          }
        }
        return next;
      });
      setSaved(true);
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
        <h2 className="mb-3 font-semibold">{t('results.appreciations')}</h2>
        <div className="space-y-3" data-testid="appreciations">
          <div className="max-w-sm">
            <SelectField
              label={t('evals.subject')}
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              options={data.subjects.map((s) => ({ value: s.id, label: name(s) }))}
            />
          </div>
          <ApiErrorAlert error={error} />
          {saved && <Alert tone="success" title={t('results.saved')} />}
          <ul className="divide-y divide-line/70">
            {students.map((s) => (
              <li key={s.id} className="grid gap-2 py-2 sm:grid-cols-[12rem_1fr]">
                <span className="text-sm font-medium">
                  <StudentName student={s} />
                </span>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    aria-label={t('results.appreciationText')}
                    className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                    maxLength={600}
                    value={valueOf(s.id).text}
                    onChange={(e) => set(s.id, { text: e.target.value })}
                  />
                  {showArabic && (
                    <input
                      aria-label={t('results.appreciationTextAr')}
                      dir="rtl"
                      lang="ar"
                      className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                      maxLength={600}
                      value={valueOf(s.id).textAr}
                      onChange={(e) => set(s.id, { textAr: e.target.value })}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Button
            loading={loading}
            disabled={!Object.keys(texts).some((k) => k.startsWith(`${subjectId}:`))}
            onClick={() => void save()}
          >
            {t('results.saveAppreciations')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
