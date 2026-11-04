'use client';

import Link from 'next/link';
import { SCHOOL_EVALUATION_KINDS, type SchoolEvaluationKind } from '@ocall/shared';
import { useState } from 'react';
import {
  ClassPeriodPicker,
  type EvaluationView,
  type Selection,
  useScore,
} from '@/components/school/school-assessment';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import type { NamedView } from '@/components/school/school-students';
import type { AssignmentView } from '@/components/school/school-teaching';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface SubjectOption extends NamedView {
  isActive: boolean;
  levels: { levelId: string }[];
}

/**
 * Évaluations (Sprint 4) : devoirs, interrogations, compositions, examens d'une classe ou d'un groupe.
 * L'enseignant ne voit et ne crée que pour ses affectations ; l'API le vérifie de toute façon.
 */
export default function EvaluationsPage() {
  return (
    <SchoolPage title="evals.title" description="evals.desc">
      {({ school, context, canWrite }) => (
        <ClassPeriodPicker key={school!.id} schoolId={school!.id}>
          {(selection) => (
            <Evaluations
              key={`${selection.classId}:${selection.periodId}`}
              schoolId={school!.id}
              selection={selection}
              teacher={context.role === 'TEACHER'}
              canManage={canWrite('school.assessment.manage')}
            />
          )}
        </ClassPeriodPicker>
      )}
    </SchoolPage>
  );
}

function Evaluations({
  schoolId,
  selection,
  teacher,
  canManage,
}: {
  schoolId: string;
  selection: Selection;
  teacher: boolean;
  canManage: boolean;
}) {
  const { t, name, date } = useSchoolText();
  const score = useScore();
  const list = useApi<{ locked: boolean; evaluations: EvaluationView[] }>(
    `/school/evaluations?classId=${selection.classId}&periodId=${selection.periodId}`,
  );
  const [error, setError] = useState<ApiError | null>(null);

  async function remove(id: string) {
    setError(null);
    try {
      await api(`/school/evaluations/${id}`, { method: 'DELETE' });
      list.reload();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  if (list.state === 'loading') return <LoadingState />;
  if (list.state === 'error') return <ErrorState error={list.error} onRetry={list.reload} />;
  const { locked, evaluations } = list.data;
  return (
    <>
      {locked && <Alert tone="info" title={t('evals.locked')} />}
      <ApiErrorAlert error={error} />
      <Card>
        <ul className="divide-y divide-line/70" data-testid="evaluation-list">
          {evaluations.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted">{t('evals.empty')}</li>
          )}
          {evaluations.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
              data-testid="evaluation"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{name({ name: e.title, nameAr: e.titleAr })}</span>
                  <Badge tone="neutral">{t(`kind.${e.kind}`)}</Badge>
                </p>
                <p className="text-muted">
                  {name(e.subject)} · {e.group ? name(e.group) : t('evals.wholeClass')} ·{' '}
                  {date(e.heldOn)}
                  {' · '}
                  {t('evals.summary', {
                    max: score(e.maxScore, e.maxScore % 1 ? 2 : 0),
                    coef: score(e.coefficient, e.coefficient % 1 ? 2 : 0),
                  })}
                </p>
              </div>
              <Badge tone={e.graded ? 'forest' : 'neutral'}>
                {t('evals.graded', { n: e.graded ?? 0 })}
              </Badge>
              <Link
                href={`/school/evaluations/${e.id}`}
                className="font-medium text-forest hover:underline"
              >
                {t('evals.open')}
              </Link>
              {canManage && !locked && !e.graded && (
                <Button size="sm" variant="ghost" onClick={() => void remove(e.id)}>
                  {t('evals.delete')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {canManage && !locked && (
        <NewEvaluation
          schoolId={schoolId}
          selection={selection}
          teacher={teacher}
          onCreated={list.reload}
        />
      )}
    </>
  );
}

/** Places où l'utilisateur peut évaluer : ses affectations (enseignant) ou toutes les matières du niveau. */
function useSlots(schoolId: string, selection: Selection, teacher: boolean) {
  const mine = useApi<AssignmentView[]>(teacher ? '/school/teaching/mine' : null);
  const subjects = useApi<SubjectOption[]>(
    teacher ? null : `/school/subjects?schoolId=${schoolId}`,
  );
  const groups = useApi<(NamedView & { isActive: boolean })[]>(
    teacher ? null : `/school/classes/${selection.classId}/groups`,
  );
  if (teacher) {
    if (mine.state !== 'success') return null;
    const slots = mine.data.filter((a) => a.class.id === selection.classId);
    return slots.map((a) => ({ subject: a.subject, groups: a.group ? [a.group] : null }));
  }
  if (subjects.state !== 'success' || groups.state !== 'success') return null;
  const active = groups.data.filter((g) => g.isActive);
  return subjects.data
    .filter((s) => s.isActive && s.levels.some((l) => l.levelId === selection.levelId))
    .map((s) => ({
      subject: s as NamedView,
      groups: active.length ? (active as NamedView[]) : null,
    }));
}

function NewEvaluation({
  schoolId,
  selection,
  teacher,
  onCreated,
}: {
  schoolId: string;
  selection: Selection;
  teacher: boolean;
  onCreated: () => void;
}) {
  const { t, name, showArabic } = useSchoolText();
  const slots = useSlots(schoolId, selection, teacher);
  const [slotKey, setSlotKey] = useState('');
  const [kind, setKind] = useState<SchoolEvaluationKind>('HOMEWORK');
  const [title, setTitle] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [heldOn, setHeldOn] = useState('');
  const [maxScore, setMaxScore] = useState('20');
  const [coefficient, setCoefficient] = useState('1');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  if (!slots) return <LoadingState />;
  // Une option par place : matière seule (toute la classe) ou matière et groupe.
  const options = slots.flatMap((slot) => {
    const whole = !teacher || slot.groups === null;
    return [
      ...(whole
        ? [
            {
              value: `${slot.subject.id}:`,
              label: `${name(slot.subject)} · ${t('evals.wholeClass')}`,
            },
          ]
        : []),
      ...(slot.groups ?? []).map((g) => ({
        value: `${slot.subject.id}:${g.id}`,
        label: `${name(slot.subject)} · ${name(g)}`,
      })),
    ];
  });
  if (options.length === 0) return <Alert tone="info" title={t('evals.noSubject')} />;
  const chosen = options.find((o) => o.value === slotKey) ?? options[0]!;

  async function create() {
    const [subjectId, groupId] = chosen.value.split(':');
    setLoading(true);
    setError(null);
    try {
      await api('/school/evaluations', {
        method: 'POST',
        body: {
          classId: selection.classId,
          periodId: selection.periodId,
          subjectId,
          groupId: groupId || null,
          kind,
          title,
          ...(showArabic ? { titleAr: titleAr || null } : {}),
          heldOn,
          maxScore: Number(maxScore),
          coefficient: Number(coefficient),
        },
      });
      setTitle('');
      setTitleAr('');
      onCreated();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 font-semibold">{t('evals.new')}</h2>
        <div className="space-y-3" data-testid="evaluation-form">
          <ApiErrorAlert error={error} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SelectField
              label={`${t('evals.subject')} · ${t('evals.group')}`}
              value={chosen.value}
              onChange={(e) => setSlotKey(e.target.value)}
              options={options}
            />
            <SelectField
              label={t('evals.kind')}
              value={kind}
              onChange={(e) => setKind(e.target.value as SchoolEvaluationKind)}
              options={SCHOOL_EVALUATION_KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
            />
            <InputField
              label={t('evals.titleField')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            {showArabic && (
              <InputField
                label={t('evals.titleAr')}
                dir="rtl"
                lang="ar"
                value={titleAr}
                onChange={(e) => setTitleAr(e.target.value)}
              />
            )}
            <InputField
              label={t('evals.heldOn')}
              type="date"
              value={heldOn}
              onChange={(e) => setHeldOn(e.target.value)}
            />
            <InputField
              label={t('evals.maxScore')}
              type="number"
              step="any"
              min="0"
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
            />
            <InputField
              label={t('evals.coefficient')}
              type="number"
              step="any"
              min="0"
              value={coefficient}
              onChange={(e) => setCoefficient(e.target.value)}
            />
          </div>
          <Button loading={loading} disabled={!title || !heldOn} onClick={() => void create()}>
            {t('evals.create')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
