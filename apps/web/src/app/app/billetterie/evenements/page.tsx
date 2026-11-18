'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, Plus } from 'lucide-react';
import { PARK_EVENT_STATUS_LABELS, sessionLabel } from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { EVENT_STATUS_TONE } from '@/components/park/event-ui';
import { ParkEstablishmentScope } from '@/components/park/park-establishment';
import { ParkNav } from '@/components/park/park-nav';
import { toApiError } from '@/components/pos/cash-session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField } from '@/components/ui/field';
import { ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import type { ParkEstablishment, ParkEventDetail, ParkEventSummary } from '@/lib/types';
import { useApi } from '@/lib/use-api';

/** Événements du parc : liste, places vendues, création (responsables). */
export default function EvenementsPage() {
  const canSee = useCan('sale.read_all');
  if (!canSee) return <AccessDenied />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Événements</h1>
        <ParkNav />
      </div>
      <ParkEstablishmentScope source="/ticketing/establishments">
        {(park) => <EventList park={park} />}
      </ParkEstablishmentScope>
    </div>
  );
}

function EventList({ park }: { park: ParkEstablishment }) {
  const canManage = useCan('ticketing.manage');
  const [archived, setArchived] = useState(false);
  const events = useApi<ParkEventSummary[]>(
    `/ticketing/events?establishmentId=${park.id}${archived ? '&includeArchived=true' : ''}`,
  );
  const [creating, setCreating] = useState(false);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 px-4 py-3">
        <h2 className="font-semibold">Événements de {park.name}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
              className="h-5 w-5 rounded border-line text-forest"
            />
            Afficher les archivés
          </label>
          {canManage && (
            <Button size="sm" onClick={() => setCreating(true)} icon={<Plus className="h-4 w-4" />}>
              Nouvel événement
            </Button>
          )}
        </div>
      </div>
      {events.state === 'loading' && <LoadingState />}
      {events.state === 'error' && <ErrorState error={events.error} onRetry={events.reload} />}
      {events.state === 'success' &&
        (events.data.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="h-7 w-7" />}
            title="Aucun événement"
            description="Créez un événement (concert, spectacle, festival…), ses séances et ses tarifs, puis publiez-le pour le vendre au guichet."
          />
        ) : (
          <ul className="divide-y divide-line/70" data-testid="event-list">
            {events.data.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/app/billetterie/evenements/${e.id}`}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-forest-light/30"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{e.name}</span>
                    <span className="block text-sm text-muted">
                      {e.nextSession
                        ? `Prochaine séance : ${sessionLabel(e.nextSession)}`
                        : 'Aucune séance à venir'}
                      {` · ${e.sessionCount} séance(s) · ${e.activeTariffs} tarif(s)`}
                    </span>
                  </span>
                  <span className="text-sm font-semibold">
                    {e.sold} / {e.capacity} places
                  </span>
                  <Badge tone={EVENT_STATUS_TONE[e.status]}>
                    {PARK_EVENT_STATUS_LABELS[e.status]}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        ))}
      {creating && <CreateEventDialog park={park} onClose={() => setCreating(false)} />}
    </Card>
  );
}

function CreateEventDialog({ park, onClose }: { park: ParkEstablishment; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    description: '',
    conditions: '',
    entryOpensBeforeMinutes: '60',
    entryClosesAfterMinutes: '0',
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const created = await api<ParkEventDetail>('/ticketing/events', {
        method: 'POST',
        body: {
          establishmentId: park.id,
          name: form.name,
          description: form.description || undefined,
          conditions: form.conditions || undefined,
          entryOpensBeforeMinutes: Number(form.entryOpensBeforeMinutes),
          entryClosesAfterMinutes: Number(form.entryClosesAfterMinutes),
        },
      });
      router.push(`/app/billetterie/evenements/${created.id}`);
    } catch (e) {
      setError(toApiError(e));
      setLoading(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Nouvel événement"
      description="L’événement est créé en brouillon : ajoutez ses séances et ses tarifs, puis publiez-le."
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <InputField label="Nom" value={form.name} onChange={set('name')} required maxLength={80} />
        <InputField
          label="Description"
          value={form.description}
          onChange={set('description')}
          maxLength={1000}
        />
        <InputField
          label="Conditions"
          hint="Ex. interdit aux moins de 6 ans"
          value={form.conditions}
          onChange={set('conditions')}
          maxLength={300}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InputField
            label="Entrée à partir de (min avant le début)"
            type="number"
            min={0}
            max={720}
            value={form.entryOpensBeforeMinutes}
            onChange={set('entryOpensBeforeMinutes')}
          />
          <InputField
            label="Entrée jusqu’à (min après la fin)"
            type="number"
            min={0}
            max={720}
            value={form.entryClosesAfterMinutes}
            onChange={set('entryClosesAfterMinutes')}
          />
        </div>
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={loading}>
            Créer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
