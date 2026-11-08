'use client';

import { type FormEvent, useState } from 'react';
import { addDays } from '@ocall/shared';
import { YearPicker } from '@/components/school/school-finance';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { BiName, SchoolPage } from '@/components/school/school-page';
import {
  ConflictList,
  type ExamView,
  type Named,
  type TeacherNames,
  TeacherLabel,
  todayIn,
} from '@/components/school/school-planning';
import { useClasses } from '@/components/school/school-students';
import type { AssignmentView } from '@/components/school/school-teaching';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface Period {
  id: string;
  label: string;
  labelAr: string | null;
}

interface Evaluation {
  id: string;
  periodId: string;
  title: string;
  titleAr: string | null;
  heldOn: string;
  subject: Named;
}

const TONE = { DRAFT: 'savanna', PUBLISHED: 'forest', CANCELLED: 'neutral' } as const;

/**
 * Examens (Sprint 7) : programmation des évaluations du Sprint 4 (date, heure, durée, salle,
 * surveillant), publication aux familles, annulation. Les notes restent dans les évaluations.
 */
export default function ExamsPage() {
  return (
    <SchoolPage title="exam.title" description="exam.desc">
      {({ school, context, canWrite }) => (
        <YearPicker key={school!.id} schoolId={school!.id}>
          {(year) => (
            <Exams
              key={year.id}
              schoolId={school!.id}
              yearId={year.id}
              timezone={school!.timezone}
              teacher={context.role === 'TEACHER'}
              canManage={canWrite('school.exams.manage')}
            />
          )}
        </YearPicker>
      )}
    </SchoolPage>
  );
}

function Exams({
  schoolId,
  yearId,
  timezone,
  teacher,
  canManage,
}: {
  schoolId: string;
  yearId: string;
  timezone: string;
  teacher: boolean;
  canManage: boolean;
}) {
  const { t, name, date } = useSchoolText();
  const all = useClasses(yearId);
  const mine = useApi<AssignmentView[]>(teacher ? '/school/teaching/mine' : null);
  const own = mine.state === 'success' ? new Set(mine.data.map((a) => a.class.id)) : null;
  const classes = teacher ? all.filter((c) => own?.has(c.id)) : all;
  const [classId, setClassId] = useState('');
  const [from, setFrom] = useState(() => todayIn(timezone));
  const [to, setTo] = useState(() => addDays(todayIn(timezone), 60));
  const cls = classes.find((c) => c.id === classId);
  const exams = useApi<ExamView[]>(
    `/school/exams?schoolId=${schoolId}&from=${from}&to=${to}${cls ? `&classId=${cls.id}` : ''}`,
  );
  // Nouvelle programmation : la classe cible est figée à l'ouverture (le filtre peut changer ensuite).
  const [editing, setEditing] = useState<ExamView | { newFor: string } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function act(path: string) {
    setError(null);
    try {
      await api(path, { method: 'POST' });
      exams.reload();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          label={t('pick.class')}
          value={cls?.id ?? ''}
          onChange={(e) => setClassId(e.target.value)}
          options={[
            { value: '', label: t('common.all') },
            ...classes.map((c) => ({ value: c.id, label: name(c) })),
          ]}
        />
        <InputField
          label={t('exam.from')}
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <InputField
          label={t('exam.to')}
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      {canManage && cls && (
        <Button size="sm" onClick={() => setEditing({ newFor: cls.id })} data-testid="exam-new">
          {t('exam.new')}
        </Button>
      )}
      <ApiErrorAlert error={error} />
      <ConflictList error={error} />
      {editing && (
        <ExamForm
          key={'newFor' in editing ? `new-${editing.newFor}` : editing.id}
          schoolId={schoolId}
          yearId={yearId}
          classId={'newFor' in editing ? editing.newFor : editing.class.id}
          exam={'newFor' in editing ? null : editing}
          onDone={() => {
            setEditing(null);
            exams.reload();
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      <Card>
        <CardBody>
          {exams.state === 'loading' ? (
            <LoadingState />
          ) : exams.state === 'error' ? (
            <ErrorState error={exams.error} onRetry={exams.reload} />
          ) : exams.data.length === 0 ? (
            <p className="text-sm text-muted">{t('exam.none')}</p>
          ) : (
            <ul className="divide-y divide-line/70 text-sm" data-testid="exams">
              {exams.data.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">
                      <BiName name={e.evaluation.title} nameAr={e.evaluation.titleAr} />
                    </span>
                    {` · ${name(e.subject)} · ${name(e.class)}${e.group ? ` (${name(e.group)})` : ''} · ${date(e.date)} `}
                    <span dir="ltr">
                      {e.start}–{e.end}
                    </span>
                    {e.room ? ` · ${t('pln.room')} ${name(e.room)}` : ''}
                    {e.supervisor && (
                      <>
                        {' · '}
                        <TeacherLabel teacher={e.supervisor} />
                      </>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={TONE[e.status]}>{t(`pln.status.${e.status}`)}</Badge>
                    {canManage && e.status !== 'CANCELLED' && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>
                          {t('exam.edit')}
                        </Button>
                        {e.status === 'DRAFT' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void act(`/school/exams/${e.id}/publish`)}
                          >
                            {t('exam.publish')}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void act(`/school/exams/${e.id}/cancel`)}
                        >
                          {t('exam.cancel')}
                        </Button>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}

function ExamForm({
  schoolId,
  yearId,
  classId,
  exam,
  onDone,
  onCancel,
}: {
  schoolId: string;
  yearId: string;
  classId: string;
  exam: ExamView | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t, name } = useSchoolText();
  const periods = useApi<Period[]>(`/school/periods?schoolYearId=${yearId}`);
  const [periodId, setPeriod] = useState('');
  const period =
    periods.state === 'success'
      ? (periods.data.find((p) => p.id === periodId) ?? periods.data[0])
      : null;
  // Réponse du Sprint 4 : verrou des résultats et liste des évaluations de la classe pour la période.
  const evaluations = useApi<{ locked: boolean; evaluations: Evaluation[] }>(
    !exam && period ? `/school/evaluations?classId=${classId}&periodId=${period.id}` : null,
  );
  const rooms = useApi<Named[]>(`/school/rooms?schoolId=${schoolId}`);
  const members = useApi<(TeacherNames & { isActive: boolean })[]>('/school/members');
  const [evaluationId, setEvaluation] = useState(exam?.evaluation.id ?? '');
  const [dateValue, setDate] = useState(exam?.date ?? '');
  const [start, setStart] = useState(exam?.start ?? '08:00');
  const [duration, setDuration] = useState(String(exam?.durationMinutes ?? 120));
  const [roomId, setRoom] = useState(exam?.room?.id ?? '');
  const [supervisorId, setSupervisor] = useState(exam?.supervisor?.id ?? '');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  // Seules les évaluations de la période affichée (une liste encore en cours de rechargement est écartée).
  const listed =
    evaluations.state === 'success' && period
      ? evaluations.data.evaluations.filter((x) => x.periodId === period.id)
      : [];
  const valid = exam !== null || listed.some((x) => x.id === evaluationId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setLoading(true);
    setError(null);
    const body = {
      evaluationId,
      date: dateValue,
      start,
      durationMinutes: Number(duration),
      roomId: roomId || null,
      supervisorMemberId: supervisorId || null,
    };
    try {
      await api(exam ? `/school/exams/${exam.id}` : '/school/exams', {
        method: exam ? 'PUT' : 'POST',
        body,
      });
      onDone();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <form className="space-y-3" onSubmit={(e) => void submit(e)} data-testid="exam-form">
          <ApiErrorAlert error={error} />
          <ConflictList error={error} />
          {!exam && (
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                label={t('exam.period')}
                value={period?.id ?? ''}
                onChange={(e) => {
                  setPeriod(e.target.value);
                  setEvaluation('');
                  setDate('');
                }}
                options={
                  periods.state === 'success'
                    ? periods.data.map((p) => ({
                        value: p.id,
                        label: name({ name: p.label, nameAr: p.labelAr }),
                      }))
                    : []
                }
              />
              {evaluations.state === 'success' && listed.length === 0 ? (
                <Alert tone="info" title={t('exam.noEvaluation')} />
              ) : (
                <SelectField
                  label={t('exam.evaluation')}
                  required
                  value={evaluationId}
                  onChange={(e) => {
                    setEvaluation(e.target.value);
                    const picked = listed.find((x) => x.id === e.target.value);
                    if (picked && !dateValue) setDate(picked.heldOn.slice(0, 10));
                  }}
                  options={[
                    { value: '', label: '—' },
                    ...listed.map((x) => ({
                      value: x.id,
                      label: `${x.title} · ${name(x.subject)}`,
                    })),
                  ]}
                />
              )}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <InputField
              label={t('pln.date')}
              type="date"
              required
              value={dateValue}
              onChange={(e) => setDate(e.target.value)}
            />
            <InputField
              label={t('exam.start')}
              type="time"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
            <InputField
              label={t('exam.duration')}
              type="number"
              min={5}
              max={480}
              required
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
            <SelectField
              label={t('pln.room')}
              value={roomId}
              onChange={(e) => setRoom(e.target.value)}
              options={[
                { value: '', label: t('tt.noRoom') },
                ...(rooms.state === 'success'
                  ? rooms.data.map((r) => ({ value: r.id, label: name(r) }))
                  : []),
              ]}
            />
            <SelectField
              label={t('exam.supervisor')}
              value={supervisorId}
              onChange={(e) => setSupervisor(e.target.value)}
              options={[
                { value: '', label: t('exam.noSupervisor') },
                ...(members.state === 'success'
                  ? members.data
                      .filter((m) => m.isActive)
                      .map((m) => ({ value: m.id, label: `${m.lastName} ${m.firstName}` }))
                  : []),
              ]}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" loading={loading} disabled={!valid || !dateValue}>
              {t('exam.save')}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
