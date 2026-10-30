'use client';

import { type FormEvent, useMemo, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
  DEFAULT_RESERVATION_MINUTES,
  RESERVATION_STATUS_LABELS,
  type ReservationStatus,
} from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { RestaurantNav } from '@/components/restaurant/restaurant-nav';
import { RestaurantScope } from '@/components/restaurant/restaurant-scope';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import type { DiningOverview, Reservation } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const STATUS_TONE: Record<ReservationStatus, 'savanna' | 'forest' | 'neutral' | 'terracotta'> = {
  PENDING: 'savanna',
  CONFIRMED: 'forest',
  CANCELLED: 'neutral',
  COMPLETED: 'neutral',
  NO_SHOW: 'terracotta',
};

const DAY_MS = 86_400_000;
/** Lundi 00:00 (heure de l'appareil) de la semaine contenant `date`. */
function weekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Réservations du restaurant : vue liste et vue calendrier, sans double réservation de table. */
export default function ReservationsPage() {
  const canBook = useCan('reservation.manage');
  if (!canBook) return <AccessDenied />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Réservations</h1>
        <RestaurantNav />
      </div>
      <RestaurantScope>{(e) => <Reservations establishmentId={e.id} />}</RestaurantScope>
    </div>
  );
}

function Reservations({ establishmentId }: { establishmentId: string }) {
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [start, setStart] = useState(() => weekStart(new Date()));
  const end = useMemo(() => new Date(start.getTime() + 7 * DAY_MS), [start]);
  const reservations = useApi<Reservation[]>(
    `/reservations?establishmentId=${establishmentId}&from=${start.toISOString()}&to=${end.toISOString()}`,
  );
  const dining = useApi<DiningOverview>(`/restaurant/dining?establishmentId=${establishmentId}`);
  const [editing, setEditing] = useState<Reservation | 'new' | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function setStatus(r: Reservation, status: ReservationStatus) {
    setError(null);
    try {
      await api(`/reservations/${r.id}`, { method: 'PATCH', body: { status } });
      reservations.reload();
    } catch (e) {
      setError(e as ApiError);
    }
  }

  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
  const list = reservations.state === 'success' ? reservations.data : [];
  const where = (r: Reservation) =>
    [r.zone?.name, r.table?.name].filter(Boolean).join(' · ') || 'Sans table';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-label="Semaine précédente"
            icon={<ChevronLeft className="h-4 w-4" />}
            onClick={() => setStart(new Date(start.getTime() - 7 * DAY_MS))}
          />
          <p className="font-semibold">
            Semaine du {start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
          </p>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Semaine suivante"
            icon={<ChevronRight className="h-4 w-4" />}
            onClick={() => setStart(new Date(start.getTime() + 7 * DAY_MS))}
          />
        </div>
        <div className="flex gap-2">
          <div role="tablist" aria-label="Affichage" className="flex gap-1">
            {(['list', 'calendar'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`min-h-11 rounded-xl px-3 text-sm font-semibold ${view === v ? 'bg-forest text-white' : 'border border-line bg-surface'}`}
              >
                {v === 'list' ? 'Liste' : 'Calendrier'}
              </button>
            ))}
          </div>
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            Nouvelle réservation
          </Button>
        </div>
      </div>
      <ApiErrorAlert error={error} />
      {reservations.state === 'loading' && <LoadingState />}
      {reservations.state === 'error' && (
        <ErrorState error={reservations.error} onRetry={reservations.reload} />
      )}
      {reservations.state === 'success' && list.length === 0 && (
        <Card>
          <EmptyState
            icon={<CalendarClock className="h-7 w-7" />}
            title="Aucune réservation cette semaine"
            description="Les réservations confirmées bloquent la table sur leur créneau."
          />
        </Card>
      )}
      {list.length > 0 && view === 'list' && (
        <Card>
          <CardHeader title={`${list.length} réservation(s)`} />
          <ul className="divide-y divide-line/70">
            {list.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-6"
                data-testid="reservation"
              >
                <div className="min-w-0">
                  <p className="font-semibold">
                    {new Date(r.startsAt).toLocaleDateString('fr-FR', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}{' '}
                    · {time(r.startsAt)}–{time(r.endsAt)} · {r.customerName}
                  </p>
                  <p className="text-sm text-muted">
                    {r.partySize} pers. · {where(r)}
                    {r.customerPhone && ` · ${r.customerPhone}`}
                    {r.notes && ` · ${r.notes}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[r.status]}>{RESERVATION_STATUS_LABELS[r.status]}</Badge>
                  <StatusActions
                    reservation={r}
                    onStatus={setStatus}
                    onEdit={() => setEditing(r)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {list.length > 0 && view === 'calendar' && (
        <div className="overflow-x-auto">
          <div className="grid min-w-[840px] grid-cols-7 gap-2">
            {days.map((d) => {
              const items = list.filter((r) => dayKey(new Date(r.startsAt)) === dayKey(d));
              return (
                <section
                  key={dayKey(d)}
                  className="min-h-40 rounded-2xl border border-line bg-surface p-2"
                  aria-label={d.toLocaleDateString('fr-FR')}
                >
                  <h3 className="mb-2 text-center text-sm font-semibold capitalize">
                    {d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })}
                  </h3>
                  <ul className="space-y-1.5">
                    {items.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => setEditing(r)}
                          className={`w-full rounded-lg border px-2 py-1 text-left text-xs ${r.status === 'CONFIRMED' ? 'border-forest/40 bg-forest-light' : r.status === 'PENDING' ? 'border-savanna/60 bg-savanna-light' : 'border-line bg-ivory-dark/40 text-muted line-through'}`}
                        >
                          <span className="font-semibold">{time(r.startsAt)}</span> {r.customerName}
                          <span className="block">
                            {r.partySize} p. · {r.table?.name ?? r.zone?.name ?? '—'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}
      {editing && (
        <ReservationDialog
          establishmentId={establishmentId}
          reservation={editing === 'new' ? null : editing}
          dining={dining.state === 'success' ? dining.data : null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reservations.reload();
          }}
        />
      )}
    </div>
  );
}

function StatusActions({
  reservation,
  onStatus,
  onEdit,
}: {
  reservation: Reservation;
  onStatus: (r: Reservation, s: ReservationStatus) => void;
  onEdit: () => void;
}) {
  const active = reservation.status === 'PENDING' || reservation.status === 'CONFIRMED';
  return (
    <>
      {reservation.status === 'PENDING' && (
        <Button size="sm" onClick={() => onStatus(reservation, 'CONFIRMED')}>
          Confirmer
        </Button>
      )}
      {active && (
        <>
          <Button size="sm" variant="secondary" onClick={() => onStatus(reservation, 'COMPLETED')}>
            Terminée
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onStatus(reservation, 'NO_SHOW')}>
            Non présentée
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onStatus(reservation, 'CANCELLED')}>
            Annuler
          </Button>
        </>
      )}
      <Button size="sm" variant="ghost" onClick={onEdit}>
        Modifier
      </Button>
    </>
  );
}

function ReservationDialog({
  establishmentId,
  reservation,
  dining,
  onClose,
  onSaved,
}: {
  establishmentId: string;
  reservation: Reservation | null;
  dining: DiningOverview | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const startsAt = reservation ? new Date(reservation.startsAt) : null;
  const [form, setForm] = useState({
    customerName: reservation?.customerName ?? '',
    customerPhone: reservation?.customerPhone ?? '',
    date: startsAt ? dayKey(startsAt) : dayKey(new Date()),
    time: startsAt ? time(reservation!.startsAt) : '19:30',
    duration: String(
      reservation
        ? (new Date(reservation.endsAt).getTime() - new Date(reservation.startsAt).getTime()) /
            60_000
        : DEFAULT_RESERVATION_MINUTES,
    ),
    partySize: String(reservation?.partySize ?? 2),
    place: reservation?.table
      ? `t:${reservation.table.id}`
      : reservation?.zone
        ? `z:${reservation.zone.id}`
        : '',
    status: (reservation?.status ?? 'CONFIRMED') as ReservationStatus,
    notes: reservation?.notes ?? '',
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const zoneName = (id: string | null) => dining?.zones.find((z) => z.id === id)?.name;
  const places = [
    { value: '', label: 'Sans table ni zone' },
    ...(dining?.tables
      .filter((t) => t.isActive)
      .map((t) => ({
        value: `t:${t.id}`,
        label: `${[zoneName(t.zoneId), t.name].filter(Boolean).join(' · ')} (${t.seats} couverts)`,
      })) ?? []),
    ...(dining?.zones
      .filter((z) => z.isActive)
      .map((z) => ({ value: `z:${z.id}`, label: `Zone : ${z.name}` })) ?? []),
  ];

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const tableId = form.place.startsWith('t:') ? form.place.slice(2) : null;
    const zoneId = form.place.startsWith('z:') ? form.place.slice(2) : null;
    const body = {
      customerName: form.customerName,
      customerPhone: form.customerPhone.trim() || null,
      partySize: Number(form.partySize),
      // Heure saisie sur l'appareil, convertie en instant UTC.
      startsAt: new Date(`${form.date}T${form.time}`).toISOString(),
      durationMinutes: Number(form.duration),
      notes: form.notes.trim() || null,
    };
    try {
      if (reservation) {
        await api(`/reservations/${reservation.id}`, {
          method: 'PATCH',
          body: { ...body, tableId, zoneId: tableId ? undefined : zoneId, status: form.status },
        });
      } else {
        await api('/reservations', {
          method: 'POST',
          body: {
            ...body,
            establishmentId,
            ...(tableId ? { tableId } : {}),
            ...(zoneId ? { zoneId } : {}),
            status: form.status === 'PENDING' ? 'PENDING' : 'CONFIRMED',
            customerPhone: body.customerPhone ?? undefined,
            notes: body.notes ?? undefined,
          },
        });
      }
      onSaved();
    } catch (e) {
      setError(e as ApiError);
      setLoading(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={reservation ? 'Modifier la réservation' : 'Nouvelle réservation'}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <ApiErrorAlert error={error} />
        <InputField
          label="Nom du client"
          required
          minLength={2}
          maxLength={80}
          value={form.customerName}
          onChange={(e) => set({ customerName: e.target.value })}
        />
        <InputField
          label="Téléphone (facultatif)"
          type="tel"
          value={form.customerPhone}
          onChange={(e) => set({ customerPhone: e.target.value })}
        />
        <div className="grid grid-cols-2 gap-3">
          <InputField
            label="Date"
            type="date"
            required
            value={form.date}
            onChange={(e) => set({ date: e.target.value })}
          />
          <InputField
            label="Heure"
            type="time"
            required
            value={form.time}
            onChange={(e) => set({ time: e.target.value })}
          />
          <InputField
            label="Durée (minutes)"
            type="number"
            min={15}
            max={720}
            step={15}
            required
            value={form.duration}
            onChange={(e) => set({ duration: e.target.value })}
          />
          <InputField
            label="Personnes"
            type="number"
            min={1}
            max={200}
            required
            value={form.partySize}
            onChange={(e) => set({ partySize: e.target.value })}
          />
        </div>
        <SelectField
          label="Table ou zone"
          value={form.place}
          onChange={(e) => set({ place: e.target.value })}
          options={places}
        />
        <SelectField
          label="Statut"
          value={form.status}
          onChange={(e) => set({ status: e.target.value as ReservationStatus })}
          options={(reservation
            ? (Object.keys(RESERVATION_STATUS_LABELS) as ReservationStatus[])
            : (['PENDING', 'CONFIRMED'] as ReservationStatus[])
          ).map((s) => ({ value: s, label: RESERVATION_STATUS_LABELS[s] }))}
        />
        <InputField
          label="Remarque"
          maxLength={200}
          value={form.notes}
          onChange={(e) => set({ notes: e.target.value })}
        />
        <Button type="submit" className="w-full" loading={loading}>
          Enregistrer
        </Button>
      </form>
    </Dialog>
  );
}
