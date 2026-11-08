'use client';

import { type ReactNode, useState } from 'react';
import { type SchoolTextKey, addDays, weekStart } from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import type { ApiError } from '@/lib/api';
import { BiName } from './school-page';
import { useSchoolText } from './school-language';

export interface Named {
  id: string;
  name: string;
  nameAr: string | null;
}

export interface TeacherNames {
  id: string;
  firstName: string;
  lastName: string;
  firstNameAr: string | null;
  lastNameAr: string | null;
}

export interface LessonView {
  id: string;
  weekday: number;
  start: string;
  end: string;
  kind: 'LESSON' | 'BREAK';
  label: string | null;
  labelAr: string | null;
  subject: Named | null;
  teacher: TeacherNames | null;
  room: Named | null;
  group: Named | null;
  class?: Named;
  /** Fermeture du jour ; sans titre pour une famille si elle est réservée au personnel. */
  closed?: { title: string | null; titleAr: string | null; category: string | null } | null;
  cancelled?: { reason: string } | null;
}

export interface ExamView {
  id: string;
  date: string;
  start: string;
  end: string;
  durationMinutes: number;
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
  room: Named | null;
  supervisor: TeacherNames | null;
  evaluation: { id: string; title: string; titleAr: string | null; kind: string };
  class: Named;
  group: Named | null;
  subject: Named;
}

export interface WeekView {
  weekStart: string | null;
  days: {
    date: string;
    weekday: number;
    closures: {
      id: string | null;
      title: string | null;
      titleAr: string | null;
      category: string | null;
    }[];
    lessons: LessonView[];
    exams: ExamView[];
  }[];
}

export interface ConflictView {
  code: string;
  weekday?: number;
  /** Date d'un examen en conflit avec une fermeture. */
  date?: string;
  start: string;
  end: string;
  class?: Named | null;
}

/** Date du jour AAAA-MM-JJ dans le fuseau de l'établissement. */
export function todayIn(timezone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Semaine affichée (lundi) et navigation : précédente, cette semaine, suivante. */
export function useWeek(timezone?: string) {
  const [monday, setMonday] = useState(() => weekStart(todayIn(timezone)));
  return {
    monday,
    previous: () => setMonday((m) => addDays(m, -7)),
    next: () => setMonday((m) => addDays(m, 7)),
    current: () => setMonday(weekStart(todayIn(timezone))),
  };
}

export function WeekNav({ week }: { week: ReturnType<typeof useWeek> }) {
  const { t, date } = useSchoolText();
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="week-nav">
      <Button size="sm" variant="secondary" onClick={week.previous}>
        {t('pln.prevWeek')}
      </Button>
      <span className="text-sm font-medium" data-testid="week-label">
        {t('pln.week', { date: date(week.monday) })}
      </span>
      <Button size="sm" variant="secondary" onClick={week.next}>
        {t('pln.nextWeek')}
      </Button>
      <Button size="sm" variant="ghost" onClick={week.current}>
        {t('pln.thisWeek')}
      </Button>
    </div>
  );
}

/** Nom d'un jour ISO (1 = lundi) dans la langue de l'établissement. */
export function useWeekday() {
  const { t } = useSchoolText();
  return (weekday: number) => t(`pln.day.${weekday}` as SchoolTextKey);
}

/**
 * Semaine du lundi au dimanche : cours et pauses, cours annulés ou suspendus par une fermeture, examens.
 * Les jours sans rien (dimanche, en général) sont repliés. `actions` : boutons propres à l'écran (annuler
 * un cours…), `showClass` : classe de chaque cours (planning d'un enseignant, d'une salle).
 */
export function WeekSchedule({
  week,
  showClass = false,
  actions,
}: {
  week: WeekView;
  showClass?: boolean;
  actions?: (lesson: LessonView, date: string) => ReactNode;
}) {
  const { t, name, date } = useSchoolText();
  const weekday = useWeekday();
  const days = week.days.filter(
    (d) => d.lessons.length > 0 || d.exams.length > 0 || d.closures.length > 0 || d.weekday <= 5,
  );
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="week-schedule">
      {days.map((d) => (
        <Card key={d.date}>
          <CardBody>
            <h3 className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">{weekday(d.weekday)}</span>
              <span className="text-xs text-muted">{date(d.date)}</span>
            </h3>
            {d.closures.map((c, i) => (
              <p
                key={c.id ?? `closure-${i}`}
                className="mb-2 rounded-lg bg-savanna/15 px-2 py-1 text-sm"
                data-testid="closure"
              >
                {c.title
                  ? t('pln.closed', { title: name({ name: c.title, nameAr: c.titleAr }) })
                  : t('cal.closure')}
              </p>
            ))}
            {d.lessons.length === 0 && d.exams.length === 0 ? (
              <p className="text-sm text-muted">{t('pln.noLesson')}</p>
            ) : (
              <ul className="space-y-2 text-sm" data-testid="day-lessons">
                {d.lessons.map((l) => (
                  <li
                    key={l.id}
                    className={`rounded-lg border border-line p-2 ${
                      l.kind === 'BREAK' ? 'bg-ivory/70' : ''
                    } ${l.cancelled || l.closed ? 'opacity-60' : ''}`}
                    data-testid="lesson"
                  >
                    <p className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium" dir="ltr">
                        {l.start} – {l.end}
                      </span>
                      {l.cancelled && <Badge tone="terracotta">{t('pln.cancelled')}</Badge>}
                    </p>
                    {l.kind === 'BREAK' ? (
                      <p>
                        {l.label ? name({ name: l.label, nameAr: l.labelAr }) : t('pln.kind.BREAK')}
                      </p>
                    ) : (
                      <>
                        <p className={l.cancelled ? 'line-through' : ''}>
                          {l.subject && <BiName name={l.subject.name} nameAr={l.subject.nameAr} />}
                          {showClass && l.class ? ` · ${name(l.class)}` : ''}
                          {l.group ? ` · ${name(l.group)}` : ''}
                        </p>
                        <p className="text-xs text-muted">
                          {l.teacher && <TeacherLabel teacher={l.teacher} />}
                          {l.room ? ` · ${t('pln.room')} ${name(l.room)}` : ''}
                        </p>
                      </>
                    )}
                    {l.cancelled && <p className="text-xs text-terracotta">{l.cancelled.reason}</p>}
                    {actions?.(l, d.date)}
                  </li>
                ))}
                {d.exams.map((e) => (
                  <li
                    key={e.id}
                    className="rounded-lg border border-forest/40 bg-forest-light/40 p-2"
                    data-testid="exam"
                  >
                    <p className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium" dir="ltr">
                        {e.start} – {e.end}
                      </span>
                      <Badge tone="forest">{t('pln.exams')}</Badge>
                    </p>
                    <p>
                      <BiName name={e.evaluation.title} nameAr={e.evaluation.titleAr} /> ·{' '}
                      {name(e.subject)}
                      {showClass ? ` · ${name(e.class)}` : ''}
                    </p>
                    {e.room && (
                      <p className="text-xs text-muted">{`${t('pln.room')} ${name(e.room)}`}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

/** Nom d'un enseignant selon la langue de l'établissement (comme les autres noms). */
export function TeacherLabel({ teacher }: { teacher: TeacherNames }) {
  const arabic = [teacher.lastNameAr, teacher.firstNameAr].filter(Boolean).join(' ');
  return <BiName name={`${teacher.lastName} ${teacher.firstName}`} nameAr={arabic || null} />;
}

/** Conflits renvoyés par l'API (créneau, publication, examen, indisponibilité), dans la langue de l'écran. */
export function ConflictList({ error }: { error: ApiError | null }) {
  const { t, name, date } = useSchoolText();
  const weekday = useWeekday();
  const conflicts = Array.isArray(error?.details)
    ? (error.details as unknown[]).filter(
        (d): d is ConflictView => typeof d === 'object' && d !== null && 'code' in d,
      )
    : [];
  if (conflicts.length === 0) return null;
  return (
    <ConflictItems
      conflicts={conflicts}
      label={(c) =>
        t(`pln.conflict.${c.code}` as SchoolTextKey, {
          day: c.weekday ? weekday(c.weekday) : '',
          date: c.date ? date(c.date) : '',
          start: c.start,
          end: c.end,
          class: c.class ? name(c.class) : '—',
        })
      }
    />
  );
}

export function ConflictItems({
  conflicts,
  label,
}: {
  conflicts: ConflictView[];
  label: (c: ConflictView) => string;
}) {
  const { t } = useSchoolText();
  return (
    <div
      className="rounded-lg border border-terracotta/40 bg-terracotta-light/40 p-3 text-sm"
      data-testid="conflicts"
    >
      <p className="mb-1 font-semibold">{t('tt.conflicts')}</p>
      <ul className="list-inside list-disc space-y-1">
        {conflicts.map((c, i) => (
          <li key={`${c.code}-${i}`}>{label(c)}</li>
        ))}
      </ul>
    </div>
  );
}
