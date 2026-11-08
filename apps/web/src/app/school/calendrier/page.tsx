'use client';

import { type FormEvent, useState } from 'react';
import {
  SCHOOL_EVENT_CATEGORIES,
  type SchoolEventAudience,
  type SchoolEventCategory,
  type SchoolEventVisibility,
  addDays,
  isClosure,
  weekStart,
} from '@ocall/shared';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import { ConflictList, type Named, todayIn, useWeekday } from '@/components/school/school-planning';
import { useClasses, useYears } from '@/components/school/school-students';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface CalendarEvent {
  id: string;
  category: SchoolEventCategory;
  title: string;
  titleAr: string | null;
  description: string | null;
  descriptionAr: string | null;
  startsOn: string;
  endsOn: string;
  start: string | null;
  end: string | null;
  audience: SchoolEventAudience;
  visibility: SchoolEventVisibility;
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
  important: boolean;
  targets: string[];
}

interface CalendarView {
  years: {
    id: string;
    label: string;
    startsOn: string;
    endsOn: string;
    periods: {
      id: string;
      label: string;
      labelAr: string | null;
      startsOn: string;
      endsOn: string;
    }[];
  }[];
  events: CalendarEvent[];
}

const STATUS_TONE = { DRAFT: 'savanna', PUBLISHED: 'forest', CANCELLED: 'neutral' } as const;
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const monthEnd = (first: string) => {
  const [y, m] = first.split('-').map(Number) as [number, number];
  return addDays(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10), -1);
};
const shiftMonth = (first: string, delta: number) => {
  const [y, m] = first.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 10);
};

/**
 * Calendrier scolaire (Sprint 7) : vue mensuelle de l'année, des périodes et des événements de
 * l'établissement ; création, publication et annulation par qui gère le calendrier.
 */
export default function SchoolCalendarPage() {
  return (
    <SchoolPage title="cal.title" description="cal.desc">
      {({ school, canWrite }) => (
        <Calendar
          key={school!.id}
          schoolId={school!.id}
          timezone={school!.timezone}
          canManage={canWrite('school.calendar.manage')}
        />
      )}
    </SchoolPage>
  );
}

function Calendar({
  schoolId,
  timezone,
  canManage,
}: {
  schoolId: string;
  timezone: string;
  canManage: boolean;
}) {
  const { t, name, date } = useSchoolText();
  const weekday = useWeekday();
  const [first, setFirst] = useState(() => monthStart(todayIn(timezone)));
  const last = monthEnd(first);
  const view = useApi<CalendarView>(
    `/school/calendar?schoolId=${schoolId}&from=${first}&to=${last}`,
  );
  const [editing, setEditing] = useState<CalendarEvent | 'new' | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const gridStart = weekStart(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)).filter(
    (d, i) => i < 35 || d <= last,
  );
  const eventsOn = (d: string) =>
    view.state === 'success'
      ? view.data.events.filter((e) => e.startsOn <= d && e.endsOn >= d)
      : [];

  async function act(path: string) {
    setError(null);
    try {
      await api(path, { method: 'POST' });
      view.reload();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setFirst(shiftMonth(first, -1))}>
          {t('cal.prevMonth')}
        </Button>
        <span className="font-medium" data-testid="month-label">
          {date(first)} – {date(last)}
        </span>
        <Button size="sm" variant="secondary" onClick={() => setFirst(shiftMonth(first, 1))}>
          {t('cal.nextMonth')}
        </Button>
        {canManage && (
          <Button size="sm" onClick={() => setEditing('new')} data-testid="event-new">
            {t('cal.new')}
          </Button>
        )}
      </div>
      <ApiErrorAlert error={error} />
      <ConflictList error={error} />
      {editing && (
        <EventForm
          key={editing === 'new' ? 'new' : editing.id}
          schoolId={schoolId}
          event={editing === 'new' ? null : editing}
          defaultDate={first}
          onDone={() => {
            setEditing(null);
            view.reload();
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {view.state === 'loading' ? (
        <LoadingState />
      ) : view.state === 'error' ? (
        <ErrorState error={view.error} onRetry={view.reload} />
      ) : (
        <>
          <Card>
            <CardBody>
              <ul className="space-y-1 text-sm" data-testid="calendar-periods">
                {view.data.years.flatMap((y) => [
                  y.startsOn >= first && y.startsOn <= last ? (
                    <li
                      key={`${y.id}-start`}
                    >{`${date(y.startsOn)} · ${t('cal.yearStart', { label: y.label })}`}</li>
                  ) : null,
                  y.endsOn >= first && y.endsOn <= last ? (
                    <li
                      key={`${y.id}-end`}
                    >{`${date(y.endsOn)} · ${t('cal.yearEnd', { label: y.label })}`}</li>
                  ) : null,
                  ...y.periods.map((p) => (
                    <li key={p.id}>
                      {t('cal.periodRange', {
                        label: name({ name: p.label, nameAr: p.labelAr }),
                        from: date(p.startsOn),
                        to: date(p.endsOn),
                      })}
                    </li>
                  )),
                ])}
              </ul>
            </CardBody>
          </Card>
          {/* Grille du mois sur grand écran ; liste des jours chargés sur mobile. */}
          <div className="hidden grid-cols-7 gap-1 md:grid" data-testid="month-grid">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <p key={d} className="px-1 text-xs font-semibold text-muted">
                {weekday(d)}
              </p>
            ))}
            {cells.map((d) => (
              <div
                key={d}
                className={`min-h-24 rounded-lg border border-line p-1 text-xs ${
                  d.slice(0, 7) === first.slice(0, 7) ? 'bg-white' : 'bg-ivory/60 text-muted'
                }`}
              >
                <p className="font-medium">{Number(d.slice(8, 10))}</p>
                {eventsOn(d).map((e) => (
                  <p
                    key={e.id}
                    className={`mt-1 truncate rounded px-1 ${
                      isClosure(e.category) ? 'bg-savanna/25' : 'bg-forest-light'
                    } ${e.status === 'CANCELLED' ? 'line-through' : ''}`}
                    title={e.title}
                  >
                    {name({ name: e.title, nameAr: e.titleAr })}
                  </p>
                ))}
              </div>
            ))}
          </div>
          <Card>
            <CardBody>
              {view.data.events.length === 0 ? (
                <p className="text-sm text-muted">{t('cal.none')}</p>
              ) : (
                <ul className="divide-y divide-line/70 text-sm" data-testid="calendar-events">
                  {view.data.events.map((e) => (
                    <li
                      key={e.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <span>
                        <span className="font-medium">
                          {name({ name: e.title, nameAr: e.titleAr })}
                        </span>
                        {' · '}
                        {t(`cal.cat.${e.category}`)} · {date(e.startsOn)}
                        {e.endsOn !== e.startsOn ? ` → ${date(e.endsOn)}` : ''}
                        {e.start ? <span dir="ltr">{` · ${e.start}–${e.end}`}</span> : null}
                        {' · '}
                        {t(`cal.vis.${e.visibility}`)}
                      </span>
                      <span className="flex items-center gap-2">
                        {isClosure(e.category) && <Badge tone="savanna">{t('cal.closure')}</Badge>}
                        <Badge tone={STATUS_TONE[e.status]}>{t(`pln.status.${e.status}`)}</Badge>
                        {canManage && e.status !== 'CANCELLED' && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>
                              {t('cal.edit')}
                            </Button>
                            {e.status === 'DRAFT' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void act(`/school/calendar/events/${e.id}/publish`)}
                              >
                                {t('cal.publish')}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void act(`/school/calendar/events/${e.id}/cancel`)}
                            >
                              {t('cal.cancel')}
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
      )}
    </>
  );
}

function EventForm({
  schoolId,
  event,
  defaultDate,
  onDone,
  onCancel,
}: {
  schoolId: string;
  event: CalendarEvent | null;
  defaultDate: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t, name, showArabic } = useSchoolText();
  const years = useYears(schoolId);
  const year =
    years.state === 'success'
      ? (years.data.find((y) => y.status === 'ACTIVE') ?? years.data[0])
      : undefined;
  const classes = useClasses(year?.id ?? null);
  const [form, setForm] = useState({
    category: event?.category ?? ('SCHOOL_EVENT' as SchoolEventCategory),
    title: event?.title ?? '',
    titleAr: event?.titleAr ?? '',
    description: event?.description ?? '',
    // Conservée même si l'écran ne l'affiche pas (établissement en Français) : jamais effacée.
    descriptionAr: event?.descriptionAr ?? '',
    startsOn: event?.startsOn ?? defaultDate,
    endsOn: event?.endsOn ?? defaultDate,
    start: event?.start ?? '',
    end: event?.end ?? '',
    audience: event?.audience ?? ('SCHOOL' as SchoolEventAudience),
    visibility: event?.visibility ?? ('FAMILIES' as SchoolEventVisibility),
    important: event?.important ?? false,
    targets: event?.targets ?? [],
  });
  const [groupClass, setGroupClass] = useState('');
  const groups = useApi<Named[]>(
    form.audience === 'GROUPS' && groupClass ? `/school/classes/${groupClass}/groups` : null,
  );
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const toggle = (id: string) =>
    setForm((f) => ({
      ...f,
      targets: f.targets.includes(id) ? f.targets.filter((x) => x !== id) : [...f.targets, id],
    }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const body = {
      schoolId,
      category: form.category,
      title: form.title,
      titleAr: form.titleAr || null,
      description: form.description || null,
      descriptionAr: form.descriptionAr || null,
      startsOn: form.startsOn,
      endsOn: form.endsOn,
      start: form.start || null,
      end: form.end || null,
      audience: form.audience,
      targetIds: form.audience === 'SCHOOL' ? [] : form.targets,
      visibility: form.visibility,
      important: form.important,
    };
    try {
      await api(event ? `/school/calendar/events/${event.id}` : '/school/calendar/events', {
        method: event ? 'PUT' : 'POST',
        body,
      });
      onDone();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <form className="space-y-3" onSubmit={(e) => void submit(e)} data-testid="event-form">
          <ApiErrorAlert error={error} />
          <ConflictList error={error} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SelectField
              label={t('cal.category')}
              value={form.category}
              onChange={(e) =>
                setForm({ ...form, category: e.target.value as SchoolEventCategory })
              }
              options={SCHOOL_EVENT_CATEGORIES.map((c) => ({ value: c, label: t(`cal.cat.${c}`) }))}
            />
            <InputField
              label={t('cal.eventTitle')}
              required
              maxLength={160}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            {showArabic && (
              <InputField
                label={t('cal.eventTitleAr')}
                dir="rtl"
                lang="ar"
                maxLength={160}
                value={form.titleAr}
                onChange={(e) => setForm({ ...form, titleAr: e.target.value })}
              />
            )}
            <InputField
              label={t('cal.startsOn')}
              type="date"
              required
              value={form.startsOn}
              onChange={(e) => setForm({ ...form, startsOn: e.target.value })}
            />
            <InputField
              label={t('cal.endsOn')}
              type="date"
              required
              value={form.endsOn}
              onChange={(e) => setForm({ ...form, endsOn: e.target.value })}
            />
            <InputField
              label={t('cal.startTime')}
              type="time"
              value={form.start}
              onChange={(e) => setForm({ ...form, start: e.target.value })}
            />
            <InputField
              label={t('cal.endTime')}
              type="time"
              value={form.end}
              onChange={(e) => setForm({ ...form, end: e.target.value })}
            />
            <SelectField
              label={t('cal.audience')}
              value={form.audience}
              onChange={(e) =>
                setForm({ ...form, audience: e.target.value as SchoolEventAudience, targets: [] })
              }
              options={(['SCHOOL', 'CLASSES', 'GROUPS'] as const).map((a) => ({
                value: a,
                label: t(`cal.aud.${a}`),
              }))}
            />
            <SelectField
              label={t('cal.visibility')}
              value={form.visibility}
              onChange={(e) =>
                setForm({ ...form, visibility: e.target.value as SchoolEventVisibility })
              }
              options={(['STAFF', 'FAMILIES'] as const).map((v) => ({
                value: v,
                label: t(`cal.vis.${v}`),
              }))}
            />
          </div>
          <InputField
            label={t('cal.description')}
            maxLength={2000}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          {showArabic && (
            <InputField
              label={t('cal.descriptionAr')}
              dir="rtl"
              lang="ar"
              maxLength={2000}
              value={form.descriptionAr}
              onChange={(e) => setForm({ ...form, descriptionAr: e.target.value })}
            />
          )}
          {form.audience === 'CLASSES' && (
            <fieldset className="text-sm">
              <legend className="mb-1 font-medium">{t('cal.targets')}</legend>
              <div className="grid gap-1 sm:grid-cols-3">
                {classes.map((c) => (
                  <label key={c.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.targets.includes(c.id)}
                      onChange={() => toggle(c.id)}
                    />
                    {name(c)}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {form.audience === 'GROUPS' && (
            <fieldset className="space-y-2 text-sm">
              <legend className="mb-1 font-medium">{t('cal.targets')}</legend>
              <div className="max-w-xs">
                <SelectField
                  label={t('pick.class')}
                  value={groupClass}
                  onChange={(e) => setGroupClass(e.target.value)}
                  options={[
                    { value: '', label: '—' },
                    ...classes.map((c) => ({ value: c.id, label: name(c) })),
                  ]}
                />
              </div>
              <div className="grid gap-1 sm:grid-cols-3">
                {groups.state === 'success' &&
                  groups.data.map((g) => (
                    <label key={g.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.targets.includes(g.id)}
                        onChange={() => toggle(g.id)}
                      />
                      {name(g)}
                    </label>
                  ))}
              </div>
            </fieldset>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.important}
              onChange={(e) => setForm({ ...form, important: e.target.checked })}
            />
            {t('cal.important')}
          </label>
          <div className="flex gap-2">
            <Button type="submit" loading={loading} disabled={!form.title.trim()}>
              {t('cal.save')}
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
