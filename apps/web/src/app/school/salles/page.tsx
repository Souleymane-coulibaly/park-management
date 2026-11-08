'use client';

import { type FormEvent, useState } from 'react';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import { type WeekView, WeekNav, WeekSchedule, useWeek } from '@/components/school/school-planning';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface Room {
  id: string;
  name: string;
  nameAr: string | null;
  capacity: number | null;
  isActive: boolean;
}

/** Salles (Sprint 7) : nom, capacité, activation et occupation de la semaine. Gestion facultative. */
export default function RoomsPage() {
  return (
    <SchoolPage title="room.title" description="room.desc">
      {({ school, canWrite }) => (
        <Rooms
          key={school!.id}
          schoolId={school!.id}
          timezone={school!.timezone}
          canManage={canWrite('school.planning.manage')}
        />
      )}
    </SchoolPage>
  );
}

function Rooms({
  schoolId,
  timezone,
  canManage,
}: {
  schoolId: string;
  timezone: string;
  canManage: boolean;
}) {
  const { t, name, showArabic } = useSchoolText();
  const [showInactive, setShowInactive] = useState(false);
  const rooms = useApi<Room[]>(
    `/school/rooms?schoolId=${schoolId}${showInactive ? '&includeInactive=true' : ''}`,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [form, setForm] = useState({ name: '', nameAr: '', capacity: '' });

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api('/school/rooms', {
        method: 'POST',
        body: {
          schoolId,
          name: form.name,
          nameAr: form.nameAr || null,
          capacity: form.capacity ? Number(form.capacity) : null,
        },
      });
      setForm({ name: '', nameAr: '', capacity: '' });
      rooms.reload();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  async function toggle(room: Room) {
    setError(null);
    try {
      await api(`/school/rooms/${room.id}`, {
        method: 'PATCH',
        body: { isActive: !room.isActive },
      });
      rooms.reload();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  return (
    <>
      <Card>
        <CardBody>
          <ApiErrorAlert error={error} />
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            {t('room.showInactive')}
          </label>
          {rooms.state === 'loading' ? (
            <LoadingState />
          ) : rooms.state === 'error' ? (
            <ErrorState error={rooms.error} onRetry={rooms.reload} />
          ) : rooms.data.length === 0 ? (
            <p className="text-sm text-muted">{t('room.none')}</p>
          ) : (
            <ul className="divide-y divide-line/70 text-sm" data-testid="rooms">
              {rooms.data.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {name(r)}
                    {r.capacity ? ` · ${t('room.capacityValue', { n: r.capacity })}` : ''}
                  </span>
                  <span className="flex items-center gap-2">
                    {!r.isActive && <Badge tone="neutral">{t('room.inactive')}</Badge>}
                    <Button size="sm" variant="ghost" onClick={() => setSelected(r.id)}>
                      {t('room.week')}
                    </Button>
                    {canManage && (
                      <Button size="sm" variant="ghost" onClick={() => void toggle(r)}>
                        {r.isActive ? t('room.deactivate') : t('room.activate')}
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canManage && (
            <form
              className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-4"
              onSubmit={(e) => void create(e)}
            >
              <InputField
                label={t('room.name')}
                required
                maxLength={80}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              {showArabic && (
                <InputField
                  label={t('room.nameAr')}
                  dir="rtl"
                  lang="ar"
                  maxLength={80}
                  value={form.nameAr}
                  onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
                />
              )}
              <InputField
                label={t('room.capacity')}
                type="number"
                min={1}
                max={5000}
                value={form.capacity}
                onChange={(e) => setForm({ ...form, capacity: e.target.value })}
              />
              <div className="flex items-end">
                <Button type="submit" disabled={!form.name.trim()} data-testid="room-add">
                  {t('room.add')}
                </Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>
      {selected && <RoomWeek key={selected} roomId={selected} timezone={timezone} />}
    </>
  );
}

function RoomWeek({ roomId, timezone }: { roomId: string; timezone: string }) {
  const { t, name } = useSchoolText();
  const week = useWeek(timezone);
  const view = useApi<WeekView & { room: Room }>(
    `/school/rooms/${roomId}/week?date=${week.monday}`,
  );
  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 font-semibold">
          {t('room.week')}
          {view.state === 'success' ? ` · ${name(view.data.room)}` : ''}
        </h2>
        <WeekNav week={week} />
        <div className="mt-3">
          {view.state === 'loading' ? (
            <LoadingState />
          ) : view.state === 'error' ? (
            <ErrorState error={view.error} onRetry={view.reload} />
          ) : (
            <WeekSchedule week={view.data} showClass />
          )}
        </div>
      </CardBody>
    </Card>
  );
}
