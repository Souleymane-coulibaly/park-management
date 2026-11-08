'use client';

import { type FormEvent, useState } from 'react';
import { SCHOOL_WEEKDAYS, type SchoolTextKey } from '@ocall/shared';
import { YearPicker } from '@/components/school/school-finance';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import {
  ConflictItems,
  ConflictList,
  type ConflictView,
  type LessonView,
  type Named,
  type TeacherNames,
  TeacherLabel,
  type WeekView,
  WeekNav,
  WeekSchedule,
  useWeek,
  useWeekday,
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

interface Version {
  id: string;
  label: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  validFrom: string;
  validTo: string;
  slots: number;
}

interface VersionDetail extends Omit<Version, 'slots'> {
  class: Named;
  slots: LessonView[];
  events: { id: string; action: string; actor: string | null; createdAt: string }[];
}

/** Année choisie ; ses dates (si l'API les fournit) proposent la validité par défaut. */
interface Year {
  id: string;
  startsOn?: string;
  endsOn?: string;
}

const TONE = { DRAFT: 'savanna', PUBLISHED: 'forest', ARCHIVED: 'neutral' } as const;

/**
 * Emplois du temps (Sprint 7) : semaine type par classe, en brouillon puis publiée par la direction ;
 * conflits refusés par l'API (classe, enseignant, salle, indisponibilité), affichés en français ou en
 * arabe. L'enseignant consulte les semaines publiées de ses classes.
 */
export default function TimetablesPage() {
  return (
    <SchoolPage title="tt.title" description="tt.desc">
      {({ school, context, canWrite }) => (
        <YearPicker key={school!.id} schoolId={school!.id}>
          {(year) => (
            <>
              <ClassTimetables
                key={year.id}
                year={year}
                schoolId={school!.id}
                timezone={school!.timezone}
                teacher={context.role === 'TEACHER'}
                canManage={canWrite('school.planning.manage')}
                canPublish={canWrite('school.planning.publish')}
              />
              {canWrite('school.planning.manage') && <Unavailability schoolId={school!.id} />}
            </>
          )}
        </YearPicker>
      )}
    </SchoolPage>
  );
}

function ClassTimetables({
  year,
  schoolId,
  timezone,
  teacher,
  canManage,
  canPublish,
}: {
  year: Year;
  schoolId: string;
  timezone: string;
  teacher: boolean;
  canManage: boolean;
  canPublish: boolean;
}) {
  const { t, name } = useSchoolText();
  const all = useClasses(year.id);
  const mine = useApi<AssignmentView[]>(teacher ? '/school/teaching/mine' : null);
  const own = mine.state === 'success' ? new Set(mine.data.map((a) => a.class.id)) : null;
  const classes = teacher ? all.filter((c) => own?.has(c.id)) : all;
  const [classId, setClassId] = useState('');
  const cls = classes.find((c) => c.id === classId) ?? classes[0];
  if (!cls) return <Alert tone="info" title={t('pick.noClass')} />;
  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <SelectField
          label={t('pick.class')}
          value={cls.id}
          onChange={(e) => setClassId(e.target.value)}
          options={classes.map((c) => ({ value: c.id, label: name(c) }))}
        />
      </div>
      <ClassView
        key={cls.id}
        classId={cls.id}
        year={year}
        schoolId={schoolId}
        timezone={timezone}
        canManage={canManage}
        canPublish={canPublish}
      />
    </div>
  );
}

function ClassView({
  classId,
  year,
  schoolId,
  timezone,
  canManage,
  canPublish,
}: {
  classId: string;
  year: Year;
  schoolId: string;
  timezone: string;
  canManage: boolean;
  canPublish: boolean;
}) {
  const { t, date } = useSchoolText();
  const week = useWeek(timezone);
  const weekView = useApi<WeekView>(
    `/school/planning/class-week?classId=${classId}&date=${week.monday}`,
  );
  const versions = useApi<Version[]>(`/school/timetables?classId=${classId}`);
  const [selected, setSelected] = useState<string | null>(null);
  const reloadAll = () => {
    versions.reload();
    weekView.reload();
  };
  return (
    <>
      <Card>
        <CardBody>
          <h2 className="mb-3 font-semibold">{t('tt.weekView')}</h2>
          <WeekNav week={week} />
          <div className="mt-3">
            {weekView.state === 'loading' ? (
              <LoadingState />
            ) : weekView.state === 'error' ? (
              <ErrorState error={weekView.error} onRetry={weekView.reload} />
            ) : (
              <WeekSchedule
                week={weekView.data}
                actions={
                  canManage
                    ? (lesson, day) => (
                        <LessonActions lesson={lesson} date={day} onDone={weekView.reload} />
                      )
                    : undefined
                }
              />
            )}
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <h2 className="mb-3 font-semibold">{t('tt.versions')}</h2>
          {versions.state === 'loading' ? (
            <LoadingState />
          ) : versions.state === 'error' ? (
            <ErrorState error={versions.error} onRetry={versions.reload} />
          ) : (
            <>
              {versions.data.length === 0 && <p className="text-sm text-muted">{t('tt.none')}</p>}
              <ul className="divide-y divide-line/70 text-sm" data-testid="versions">
                {versions.data.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      {v.label ? `${v.label} · ` : ''}
                      {t('tt.validity', { from: date(v.validFrom), to: date(v.validTo) })} ·{' '}
                      {t('tt.slotCount', { n: v.slots })}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge tone={TONE[v.status]}>{t(`pln.status.${v.status}`)}</Badge>
                      <Button size="sm" variant="ghost" onClick={() => setSelected(v.id)}>
                        {t('tt.editSlot')}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
              {canManage && !versions.data.some((v) => v.status === 'DRAFT') && (
                <NewVersion
                  classId={classId}
                  year={year}
                  versions={versions.data}
                  onCreated={(id) => {
                    reloadAll();
                    setSelected(id);
                  }}
                />
              )}
            </>
          )}
        </CardBody>
      </Card>
      {selected && (
        <VersionEditor
          key={selected}
          id={selected}
          classId={classId}
          schoolId={schoolId}
          canManage={canManage}
          canPublish={canPublish}
          onChanged={reloadAll}
          onRemoved={() => {
            setSelected(null);
            reloadAll();
          }}
        />
      )}
    </>
  );
}

function NewVersion({
  classId,
  year,
  versions,
  onCreated,
}: {
  classId: string;
  year: Year;
  versions: Version[];
  onCreated: (id: string) => void;
}) {
  const { t, date } = useSchoolText();
  const [validFrom, setFrom] = useState(year.startsOn?.slice(0, 10) ?? '');
  const [validTo, setTo] = useState(year.endsOn?.slice(0, 10) ?? '');
  const [label, setLabel] = useState('');
  const [sourceId, setSource] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const created = await api<{ id: string }>('/school/timetables', {
        method: 'POST',
        body: {
          classId,
          validFrom,
          validTo,
          label: label || null,
          ...(sourceId ? { sourceId } : {}),
        },
      });
      onCreated(created.id);
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      className="mt-4 space-y-3 border-t border-line pt-4"
      onSubmit={(e) => void submit(e)}
      data-testid="new-version"
    >
      <h3 className="font-medium">{t('tt.new')}</h3>
      <ApiErrorAlert error={error} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <InputField
          label={t('tt.validFrom')}
          type="date"
          required
          value={validFrom}
          onChange={(e) => setFrom(e.target.value)}
        />
        <InputField
          label={t('tt.validTo')}
          type="date"
          required
          value={validTo}
          onChange={(e) => setTo(e.target.value)}
        />
        <InputField
          label={t('tt.label')}
          maxLength={80}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <SelectField
          label={t('tt.copyFrom')}
          value={sourceId}
          onChange={(e) => setSource(e.target.value)}
          options={[
            { value: '', label: t('tt.copyNone') },
            ...versions.map((v) => ({
              value: v.id,
              label: `${t(`pln.status.${v.status}`)} · ${date(v.validFrom)}`,
            })),
          ]}
        />
      </div>
      <Button type="submit" loading={loading}>
        {t('tt.create')}
      </Button>
    </form>
  );
}

function VersionEditor({
  id,
  classId,
  schoolId,
  canManage,
  canPublish,
  onChanged,
  onRemoved,
}: {
  id: string;
  classId: string;
  schoolId: string;
  canManage: boolean;
  canPublish: boolean;
  onChanged: () => void;
  onRemoved: () => void;
}) {
  const { t, date, name } = useSchoolText();
  const weekday = useWeekday();
  const detail = useApi<VersionDetail>(`/school/timetables/${id}`);
  const [editing, setEditing] = useState<LessonView | 'new' | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [checked, setChecked] = useState<ConflictView[] | null>(null);
  if (detail.state === 'loading') return <LoadingState />;
  if (detail.state === 'error') return <ErrorState error={detail.error} onRetry={detail.reload} />;
  const v = detail.data;
  const editable = canManage && v.status !== 'ARCHIVED';

  async function act(path: string, method = 'POST') {
    setError(null);
    setChecked(null);
    try {
      await api(path, { method });
      if (method === 'DELETE' && path === `/school/timetables/${id}`) onRemoved();
      else {
        detail.reload();
        onChanged();
      }
    } catch (e) {
      setError(toApiError(e));
    }
  }

  async function check() {
    setError(null);
    try {
      const res = await api<{ conflicts: ConflictView[] }>(`/school/timetables/${id}/check`, {
        method: 'POST',
      });
      setChecked(res.conflicts);
    } catch (e) {
      setError(toApiError(e));
    }
  }

  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">
            {name(v.class)} · {t('tt.validity', { from: date(v.validFrom), to: date(v.validTo) })}
          </h2>
          <Badge tone={TONE[v.status]}>{t(`pln.status.${v.status}`)}</Badge>
        </div>
        <ApiErrorAlert error={error} />
        <ConflictList error={error} />
        {checked &&
          (checked.length === 0 ? (
            <Alert tone="success" title={t('tt.noConflict')} />
          ) : (
            <CheckedConflicts conflicts={checked} />
          ))}
        <div className="my-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="slots">
          {SCHOOL_WEEKDAYS.filter((d) => d <= 6 || v.slots.some((s) => s.weekday === d)).map(
            (d) => (
              <div key={d} className="rounded-lg border border-line p-2 text-sm">
                <p className="mb-1 font-medium">{weekday(d)}</p>
                {v.slots.filter((s) => s.weekday === d).length === 0 ? (
                  <p className="text-muted">{t('pln.noLesson')}</p>
                ) : (
                  <ul className="space-y-1">
                    {v.slots
                      .filter((s) => s.weekday === d)
                      .map((s) => (
                        <li
                          key={s.id}
                          className="flex flex-wrap items-center justify-between gap-1"
                          data-testid="slot"
                        >
                          <span>
                            <span dir="ltr">
                              {s.start}–{s.end}
                            </span>{' '}
                            {s.kind === 'BREAK'
                              ? s.label
                                ? name({ name: s.label, nameAr: s.labelAr })
                                : t('pln.kind.BREAK')
                              : `${s.subject ? name(s.subject) : ''}${s.group ? ` · ${name(s.group)}` : ''}`}
                            {s.teacher && (
                              <span className="text-xs text-muted">
                                {' · '}
                                <TeacherLabel teacher={s.teacher} />
                              </span>
                            )}
                            {s.room && (
                              <span className="text-xs text-muted">{` · ${name(s.room)}`}</span>
                            )}
                          </span>
                          {editable && (
                            <span className="flex gap-1">
                              <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                                {t('tt.editSlot')}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  void act(`/school/timetables/${id}/slots/${s.id}`, 'DELETE')
                                }
                              >
                                {t('tt.deleteSlot')}
                              </Button>
                            </span>
                          )}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            ),
          )}
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setEditing('new')} data-testid="slot-add">
              {t('tt.addSlot')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void check()}
              data-testid="slot-check"
            >
              {t('tt.check')}
            </Button>
            {v.status === 'DRAFT' && canPublish && (
              <Button
                size="sm"
                onClick={() => void act(`/school/timetables/${id}/publish`)}
                data-testid="publish"
              >
                {t('tt.publish')}
              </Button>
            )}
            {v.status === 'PUBLISHED' && canPublish && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void act(`/school/timetables/${id}/archive`)}
              >
                {t('tt.archive')}
              </Button>
            )}
            {v.status === 'DRAFT' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void act(`/school/timetables/${id}`, 'DELETE')}
              >
                {t('tt.deleteDraft')}
              </Button>
            )}
          </div>
        )}
        {editing && (
          <SlotForm
            key={editing === 'new' ? 'new' : editing.id}
            timetableId={id}
            classId={classId}
            schoolId={schoolId}
            slot={editing === 'new' ? null : editing}
            onDone={() => {
              setEditing(null);
              detail.reload();
              onChanged();
            }}
            onCancel={() => setEditing(null)}
          />
        )}
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium">{t('tt.history')}</summary>
          <ul className="mt-2 space-y-1" data-testid="history">
            {v.events.map((e) => (
              <li key={e.id}>
                {date(e.createdAt)} · {t(`tt.event.${e.action}` as SchoolTextKey)}
                {e.actor ? ` · ${e.actor}` : ''}
              </li>
            ))}
          </ul>
        </details>
      </CardBody>
    </Card>
  );
}

function CheckedConflicts({ conflicts }: { conflicts: ConflictView[] }) {
  const { t, name } = useSchoolText();
  const weekday = useWeekday();
  return (
    <ConflictItems
      conflicts={conflicts}
      label={(c) =>
        t(`pln.conflict.${c.code}` as SchoolTextKey, {
          day: c.weekday ? weekday(c.weekday) : '',
          start: c.start,
          end: c.end,
          class: c.class ? name(c.class) : '—',
        })
      }
    />
  );
}

function SlotForm({
  timetableId,
  classId,
  schoolId,
  slot,
  onDone,
  onCancel,
}: {
  timetableId: string;
  classId: string;
  schoolId: string;
  slot: LessonView | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t, name, showArabic } = useSchoolText();
  const weekday = useWeekday();
  const assignments = useApi<AssignmentView[]>(`/school/teaching-assignments?classId=${classId}`);
  const rooms = useApi<(Named & { isActive: boolean })[]>(`/school/rooms?schoolId=${schoolId}`);
  const key = (s: { subject: Named | null; teacher: TeacherNames | null; group: Named | null }) =>
    s.subject && s.teacher ? `${s.subject.id}|${s.teacher.id}|${s.group?.id ?? ''}` : '';
  const [kind, setKind] = useState<'LESSON' | 'BREAK'>(slot?.kind ?? 'LESSON');
  const [day, setDay] = useState(String(slot?.weekday ?? 1));
  const [start, setStart] = useState(slot?.start ?? '08:00');
  const [end, setEnd] = useState(slot?.end ?? '09:00');
  const [lesson, setLesson] = useState(slot ? key(slot) : '');
  // Groupe d'un cours donné par un enseignant affecté à toute la classe (vide : toute la classe).
  const [groupChoice, setGroupChoice] = useState(slot?.group?.id ?? '');
  const groups = useApi<(Named & { isActive: boolean })[]>(`/school/classes/${classId}/groups`);
  const [roomId, setRoom] = useState(slot?.room?.id ?? '');
  const [label, setLabel] = useState(slot?.label ?? '');
  const [labelAr, setLabelAr] = useState(slot?.labelAr ?? '');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const options =
    assignments.state === 'success'
      ? assignments.data
          .filter((a) => !a.endedAt)
          .map((a) => ({
            value: `${a.subject.id}|${a.member.id}|${a.group?.id ?? ''}`,
            label: `${name(a.subject)}${a.group ? ` (${name(a.group)})` : ''} · ${a.member.lastName} ${a.member.firstName}`,
          }))
      : [];
  // Créneau d'un groupe rattaché à une affectation de toute la classe : on retrouve cette affectation.
  const known = new Set(options.map((o) => o.value));
  const fallback = lesson.replace(/\|[^|]*$/, '|');
  const effective = !lesson || known.has(lesson) ? lesson : known.has(fallback) ? fallback : '';
  const wholeClass = Boolean(effective) && effective.endsWith('|');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const [subjectId, memberId, assignmentGroup] = effective.split('|');
    const groupId = assignmentGroup || (wholeClass ? groupChoice : '');
    const body =
      kind === 'BREAK'
        ? { kind, weekday: Number(day), start, end, label: label || null, labelAr: labelAr || null }
        : {
            kind,
            weekday: Number(day),
            start,
            end,
            subjectId,
            memberId,
            groupId: groupId || null,
            roomId: roomId || null,
          };
    try {
      await api(
        slot
          ? `/school/timetables/${timetableId}/slots/${slot.id}`
          : `/school/timetables/${timetableId}/slots`,
        { method: slot ? 'PUT' : 'POST', body },
      );
      onDone();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      className="mt-4 space-y-3 border-t border-line pt-4"
      onSubmit={(e) => void submit(e)}
      data-testid="slot-form"
    >
      <ApiErrorAlert error={error} />
      <ConflictList error={error} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField
          label={t('pln.kind')}
          value={kind}
          onChange={(e) => setKind(e.target.value as 'LESSON' | 'BREAK')}
          options={[
            { value: 'LESSON', label: t('pln.kind.LESSON') },
            { value: 'BREAK', label: t('pln.kind.BREAK') },
          ]}
        />
        <SelectField
          label={t('pln.weekday')}
          value={day}
          onChange={(e) => setDay(e.target.value)}
          options={SCHOOL_WEEKDAYS.map((d) => ({ value: String(d), label: weekday(d) }))}
        />
        <InputField
          label={t('pln.start')}
          type="time"
          required
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
        <InputField
          label={t('pln.end')}
          type="time"
          required
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
      </div>
      {kind === 'LESSON' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {options.length === 0 && assignments.state === 'success' ? (
            <Alert tone="info" title={t('tt.noAssignment')} />
          ) : (
            <SelectField
              label={t('tt.assignment')}
              required
              value={effective}
              onChange={(e) => setLesson(e.target.value)}
              options={[{ value: '', label: '—' }, ...options]}
            />
          )}
          {wholeClass && groups.state === 'success' && groups.data.some((g) => g.isActive) && (
            <SelectField
              label={t('pln.group')}
              value={groupChoice}
              onChange={(e) => setGroupChoice(e.target.value)}
              options={[
                { value: '', label: t('pln.wholeClass') },
                ...groups.data
                  .filter((g) => g.isActive)
                  .map((g) => ({ value: g.id, label: name(g) })),
              ]}
            />
          )}
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
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField
            label={t('tt.breakLabel')}
            maxLength={60}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          {showArabic && (
            <InputField
              label={`${t('tt.breakLabel')} (ar)`}
              dir="rtl"
              lang="ar"
              maxLength={60}
              value={labelAr}
              onChange={(e) => setLabelAr(e.target.value)}
            />
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" loading={loading} disabled={kind === 'LESSON' && !effective}>
          {t('tt.saveSlot')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** Annuler un cours publié à cette date (motif obligatoire), ou le rétablir. */
function LessonActions({
  lesson,
  date,
  onDone,
}: {
  lesson: LessonView;
  date: string;
  onDone: () => void;
}) {
  const { t } = useSchoolText();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  if (lesson.kind !== 'LESSON' || lesson.closed) return null;

  async function run(method: 'POST' | 'DELETE') {
    setError(null);
    try {
      await api(
        method === 'POST'
          ? `/school/timetable-slots/${lesson.id}/cancellations`
          : `/school/timetable-slots/${lesson.id}/cancellations/${date}`,
        { method, ...(method === 'POST' ? { body: { date, reason } } : {}) },
      );
      setOpen(false);
      setReason('');
      onDone();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  if (lesson.cancelled) {
    return (
      <Button size="sm" variant="ghost" onClick={() => void run('DELETE')}>
        {t('tt.restoreLesson')}
      </Button>
    );
  }
  return open ? (
    <div className="mt-2 space-y-2">
      <ApiErrorAlert error={error} />
      <InputField
        label={t('tt.cancelReason')}
        value={reason}
        maxLength={300}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button size="sm" disabled={reason.trim().length < 3} onClick={() => void run('POST')}>
        {t('tt.cancelLesson')}
      </Button>
    </div>
  ) : (
    <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="lesson-cancel">
      {t('tt.cancelLesson')}
    </Button>
  );
}

interface UnavailabilityRow {
  id: string;
  weekday: number;
  start: string;
  end: string;
  reason: string | null;
  member: TeacherNames;
}

/** Indisponibilités hebdomadaires des enseignants de l'établissement. */
function Unavailability({ schoolId }: { schoolId: string }) {
  const { t } = useSchoolText();
  const weekday = useWeekday();
  const list = useApi<UnavailabilityRow[]>(`/school/teacher-unavailability?schoolId=${schoolId}`);
  const teachers = useApi<TeacherNames[]>(`/school/teachers?schoolId=${schoolId}`);
  const [memberId, setMember] = useState('');
  const [day, setDay] = useState('1');
  const [start, setStart] = useState('14:00');
  const [end, setEnd] = useState('18:00');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api('/school/teacher-unavailability', {
        method: 'POST',
        body: { schoolId, memberId, weekday: Number(day), start, end, reason: reason || null },
      });
      setReason('');
      list.reload();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api(`/school/teacher-unavailability/${id}`, { method: 'DELETE' });
      list.reload();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 font-semibold">{t('tt.unavailability')}</h2>
        <ApiErrorAlert error={error} />
        <ConflictList error={error} />
        {list.state === 'success' && list.data.length === 0 && (
          <p className="text-sm text-muted">{t('tt.unavailabilityNone')}</p>
        )}
        {list.state === 'success' && list.data.length > 0 && (
          <ul className="mb-3 divide-y divide-line/70 text-sm" data-testid="unavailability">
            {list.data.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <TeacherLabel teacher={u.member} /> · {weekday(u.weekday)}{' '}
                  <span dir="ltr">
                    {u.start}–{u.end}
                  </span>
                  {u.reason ? ` · ${u.reason}` : ''}
                </span>
                <Button size="sm" variant="ghost" onClick={() => void remove(u.id)}>
                  {t('tt.deleteSlot')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => void add(e)}>
          <SelectField
            label={t('pln.teacher')}
            required
            value={memberId}
            onChange={(e) => setMember(e.target.value)}
            options={[
              { value: '', label: '—' },
              ...(teachers.state === 'success'
                ? teachers.data.map((m) => ({ value: m.id, label: `${m.lastName} ${m.firstName}` }))
                : []),
            ]}
          />
          <SelectField
            label={t('pln.weekday')}
            value={day}
            onChange={(e) => setDay(e.target.value)}
            options={SCHOOL_WEEKDAYS.map((d) => ({ value: String(d), label: weekday(d) }))}
          />
          <InputField
            label={t('pln.start')}
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <InputField
            label={t('pln.end')}
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
          <InputField
            label={t('tt.reason')}
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="sm:col-span-2 lg:col-span-5">
            <Button type="submit" size="sm" disabled={!memberId}>
              {t('tt.addUnavailability')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
