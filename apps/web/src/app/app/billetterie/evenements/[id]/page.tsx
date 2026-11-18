'use client';

import Link from 'next/link';
import { type FormEvent, use, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  CalendarPlus,
  Coins,
  Pencil,
  Plus,
  Ticket,
  Users,
  UserX,
} from 'lucide-react';
import {
  PARK_EVENT_SESSION_STATUS_LABELS,
  PARK_EVENT_STATUS_LABELS,
  type ParkEventStatus,
  TICKET_KINDS,
  TICKET_KIND_LABELS,
  type TicketKind,
  formatSaleNumber,
  formatXof,
  sessionLabel,
} from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { EVENT_STATUS_TONE } from '@/components/park/event-ui';
import { ParkNav } from '@/components/park/park-nav';
import { toApiError } from '@/components/pos/cash-session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { KpiCard } from '@/components/ui/kpi-card';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type {
  EventDashboard,
  EventSessionBuyers,
  ParkEventDetail,
  TicketCategory,
} from '@/lib/types';
import { useApi } from '@/lib/use-api';

type Session = ParkEventDetail['sessions'][number];

/** Événement : statut, suivi, séances (capacité, annulation, acheteurs) et tarifs. */
export default function EvenementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canSee = useCan('sale.read_all');
  const event = useApi<ParkEventDetail>(canSee ? `/ticketing/events/${id}` : null);
  const dashboard = useApi<EventDashboard>(canSee ? `/ticketing/events/${id}/dashboard` : null);
  if (!canSee) return <AccessDenied />;
  const reload = () => {
    event.reload();
    dashboard.reload();
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/app/billetterie/evenements"
          className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-forest"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Événements
        </Link>
        <ParkNav />
      </div>
      {event.state === 'loading' && <LoadingState />}
      {event.state === 'error' && <ErrorState error={event.error} onRetry={event.reload} />}
      {event.state === 'success' && (
        <>
          <EventHeader event={event.data} onChange={reload} />
          {dashboard.state === 'success' && <EventFollowUp dashboard={dashboard.data} />}
          <Sessions event={event.data} onChange={reload} />
          <Tariffs event={event.data} onChange={reload} />
        </>
      )}
    </div>
  );
}

// ─── En-tête et statut ───

function EventHeader({ event, onChange }: { event: ParkEventDetail; onChange: () => void }) {
  const canManage = useCan('ticketing.manage');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function setStatus(status: ParkEventStatus) {
    setBusy(true);
    setError(null);
    try {
      await api(`/ticketing/events/${event.id}`, { method: 'PATCH', body: { status } });
      onChange();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold" data-testid="event-name">
            {event.name}
          </h1>
          {event.description && <p className="text-sm text-muted">{event.description}</p>}
          {event.conditions && <p className="text-sm text-muted">{event.conditions}</p>}
          <p className="mt-1 text-sm text-muted">
            Entrée de {event.entryOpensBeforeMinutes} min avant le début à{' '}
            {event.entryClosesAfterMinutes} min après la fin de la séance ·{' '}
            {event.showOnSite ? 'affiché sur le site vitrine' : 'non affiché sur le site vitrine'}
          </p>
        </div>
        <Badge tone={EVENT_STATUS_TONE[event.status]}>
          <span data-testid="event-status">{PARK_EVENT_STATUS_LABELS[event.status]}</span>
        </Badge>
      </div>
      {canManage && (
        <div className="flex flex-wrap gap-2">
          {event.status !== 'PUBLISHED' && (
            <Button size="sm" onClick={() => setStatus('PUBLISHED')} loading={busy}>
              Publier (mettre en vente)
            </Button>
          )}
          {event.status === 'PUBLISHED' && (
            <Button size="sm" variant="secondary" onClick={() => setStatus('DRAFT')} loading={busy}>
              Suspendre la vente (brouillon)
            </Button>
          )}
          {event.status !== 'ARCHIVED' && (
            <Button size="sm" variant="ghost" onClick={() => setStatus('ARCHIVED')} loading={busy}>
              Archiver
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditing(true)}
            icon={<Pencil className="h-4 w-4" />}
          >
            Modifier
          </Button>
        </div>
      )}
      <ApiErrorAlert error={error} />
      {editing && (
        <EventDialog
          event={event}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChange();
          }}
        />
      )}
    </Card>
  );
}

function EventDialog({
  event,
  onClose,
  onSaved,
}: {
  event: ParkEventDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: event.name,
    description: event.description,
    conditions: event.conditions,
    entryOpensBeforeMinutes: String(event.entryOpensBeforeMinutes),
    entryClosesAfterMinutes: String(event.entryClosesAfterMinutes),
    showOnSite: event.showOnSite,
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const set =
    (
      key:
        | 'name'
        | 'description'
        | 'conditions'
        | 'entryOpensBeforeMinutes'
        | 'entryClosesAfterMinutes',
    ) =>
    (e: { target: { value: string } }) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api(`/ticketing/events/${event.id}`, {
        method: 'PATCH',
        body: {
          ...form,
          entryOpensBeforeMinutes: Number(form.entryOpensBeforeMinutes),
          entryClosesAfterMinutes: Number(form.entryClosesAfterMinutes),
        },
      });
      onSaved();
    } catch (err) {
      setError(toApiError(err));
      setLoading(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Modifier « ${event.name} »`}
      description="Une nouvelle tolérance d’entrée s’applique aussi aux billets déjà vendus et encore valides."
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
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={form.showOnSite}
            onChange={(e) => setForm((f) => ({ ...f, showOnSite: e.target.checked }))}
            className="h-5 w-5 rounded border-line text-forest"
          />
          Afficher dans l’agenda du site vitrine (une fois publié)
        </label>
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={loading}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Suivi (lot E4) ───

function EventFollowUp({ dashboard }: { dashboard: EventDashboard }) {
  const t = dashboard.totals;
  return (
    <section aria-label="Suivi de l’événement" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Places vendues"
          value={<span data-testid="event-sold">{t.sold}</span>}
          hint={`sur ${t.capacity} place(s) programmée(s)`}
          icon={<Ticket className="h-5 w-5" />}
        />
        <KpiCard
          label="Entrées"
          value={t.entered}
          hint={t.absent > 0 ? `${t.absent} absent(s)` : 'billets scannés'}
          icon={<Users className="h-5 w-5" />}
        />
        <KpiCard
          label="Billets annulés"
          value={t.cancelled}
          icon={<UserX className="h-5 w-5" />}
          accent="terracotta"
        />
        <KpiCard
          label="Chiffre d’affaires"
          value={formatXof(t.revenue)}
          hint="billets non annulés"
          icon={<Coins className="h-5 w-5" />}
          accent="savanna"
        />
      </div>
      {dashboard.sessions.length > 0 && (
        <Card>
          <div className="border-b border-line/70 px-4 py-3">
            <h2 className="font-semibold">Suivi par séance</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm" data-testid="event-follow-up">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2">Séance</th>
                  <th className="px-2 py-2 text-right">Vendues</th>
                  <th className="px-2 py-2 text-right">Remplissage</th>
                  <th className="px-2 py-2 text-right">Entrées</th>
                  <th className="px-2 py-2 text-right">Attendus / absents</th>
                  <th className="px-2 py-2 text-right">Annulés</th>
                  <th className="px-4 py-2 text-right">Chiffre d’affaires</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {dashboard.sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2">
                      <span className="font-semibold">{sessionLabel(s)}</span>
                      {s.status === 'CANCELLED' && (
                        <span className="ml-2">
                          <Badge tone="terracotta">Annulée</Badge>
                        </span>
                      )}
                      {s.byTariff.some((t) => t.sold + t.cancelled > 0) && (
                        <span className="block text-xs text-muted">
                          {s.byTariff
                            .filter((t) => t.sold > 0)
                            .map(
                              (t) =>
                                `${t.name} : ${t.sold}${t.sessionQuota ? `/${t.sessionQuota}` : ''}`,
                            )
                            .join(' · ')}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {s.sold} / {s.capacity}
                    </td>
                    <td className="px-2 py-2 text-right">{s.fillRate} %</td>
                    <td className="px-2 py-2 text-right">{s.entered}</td>
                    <td className="px-2 py-2 text-right">
                      {s.ended ? `${s.absent} absent(s)` : `${s.expected} attendu(s)`}
                    </td>
                    <td className="px-2 py-2 text-right">{s.cancelled}</td>
                    <td className="px-4 py-2 text-right font-semibold">{formatXof(s.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </section>
  );
}

// ─── Séances ───

function Sessions({ event, onChange }: { event: ParkEventDetail; onChange: () => void }) {
  const canManage = useCan('ticketing.manage');
  const [editing, setEditing] = useState<Session | 'new' | null>(null);
  const [cancelling, setCancelling] = useState<Session | null>(null);
  const [buyers, setBuyers] = useState<Session | null>(null);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 px-4 py-3">
        <h2 className="font-semibold">Séances</h2>
        {canManage && (
          <Button
            size="sm"
            onClick={() => setEditing('new')}
            icon={<CalendarPlus className="h-4 w-4" />}
          >
            Nouvelle séance
          </Button>
        )}
      </div>
      {event.sessions.length === 0 ? (
        <EmptyState
          icon={<CalendarPlus className="h-7 w-7" />}
          title="Aucune séance"
          description="Ajoutez une date, des horaires et une capacité."
        />
      ) : (
        <ul className="divide-y divide-line/70" data-testid="event-sessions">
          {event.sessions.map((s) => {
            const fill = s.capacity > 0 ? Math.min(100, (s.sold / s.capacity) * 100) : 0;
            return (
              <li key={s.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 font-semibold">{sessionLabel(s)}</span>
                  {s.status === 'CANCELLED' ? (
                    <Badge tone="terracotta">{PARK_EVENT_SESSION_STATUS_LABELS.CANCELLED}</Badge>
                  ) : s.salesOpen ? (
                    <Badge tone="forest">Vente ouverte</Badge>
                  ) : (
                    <Badge>Vente fermée</Badge>
                  )}
                  <span className="text-sm font-semibold" data-testid="session-places">
                    {s.sold} / {s.capacity} · {s.placesLeft} restante(s)
                  </span>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-ivory-dark"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={s.capacity}
                  aria-valuenow={s.sold}
                  aria-label={`Places vendues : ${s.sold} sur ${s.capacity}`}
                >
                  <div className="h-full bg-forest" style={{ width: `${fill}%` }} />
                </div>
                {s.status === 'CANCELLED' && s.cancelReason && (
                  <p className="text-sm text-terracotta-dark">Annulée : {s.cancelReason}</p>
                )}
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setBuyers(s)}
                    icon={<Users className="h-4 w-4" />}
                  >
                    Acheteurs
                  </Button>
                  {canManage && s.status === 'SCHEDULED' && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(s)}
                        icon={<Pencil className="h-4 w-4" />}
                      >
                        Modifier
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setCancelling(s)}
                        icon={<Ban className="h-4 w-4" />}
                      >
                        Annuler la séance
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing && (
        <SessionDialog
          eventId={event.id}
          session={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChange();
          }}
        />
      )}
      {cancelling && (
        <CancelSessionDialog
          eventId={event.id}
          session={cancelling}
          onClose={() => setCancelling(null)}
          onCancelled={() => {
            setCancelling(null);
            onChange();
            // Liste des acheteurs concernés, pour le remboursement ou la prise de contact.
            setBuyers({ ...cancelling, status: 'CANCELLED' });
          }}
        />
      )}
      {buyers && (
        <BuyersDialog eventId={event.id} session={buyers} onClose={() => setBuyers(null)} />
      )}
    </Card>
  );
}

function SessionDialog({
  eventId,
  session,
  onClose,
  onSaved,
}: {
  eventId: string;
  session: Session | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    date: session?.date ?? '',
    startTime: session?.startTime ?? '20:00',
    endTime: session?.endTime ?? '23:00',
    capacity: session ? String(session.capacity) : '',
    salesOpen: session?.salesOpen ?? true,
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const set =
    (key: 'date' | 'startTime' | 'endTime' | 'capacity') => (e: { target: { value: string } }) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const body = { ...form, capacity: Number(form.capacity) };
    try {
      await api(
        session
          ? `/ticketing/events/${eventId}/sessions/${session.id}`
          : `/ticketing/events/${eventId}/sessions`,
        { method: session ? 'PATCH' : 'POST', body },
      );
      onSaved();
    } catch (err) {
      setError(toApiError(err));
      setLoading(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={session ? `Modifier la séance du ${sessionLabel(session)}` : 'Nouvelle séance'}
      description="Une fin antérieure au début désigne le lendemain (séance de nuit). De nouveaux horaires s’appliquent aussi aux billets déjà vendus."
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InputField label="Date" type="date" value={form.date} onChange={set('date')} required />
          <InputField
            label="Capacité (places)"
            type="number"
            min={1}
            max={100000}
            value={form.capacity}
            onChange={set('capacity')}
            required
          />
          <InputField
            label="Début"
            type="time"
            value={form.startTime}
            onChange={set('startTime')}
            required
          />
          <InputField
            label="Fin"
            type="time"
            value={form.endTime}
            onChange={set('endTime')}
            required
          />
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={form.salesOpen}
            onChange={(e) => setForm((f) => ({ ...f, salesOpen: e.target.checked }))}
            className="h-5 w-5 rounded border-line text-forest"
          />
          Vente ouverte au guichet
        </label>
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={loading}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function CancelSessionDialog({
  eventId,
  session,
  onClose,
  onCancelled,
}: {
  eventId: string;
  session: Session;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api<EventSessionBuyers>(`/ticketing/events/${eventId}/sessions/${session.id}/cancel`, {
        method: 'POST',
        body: { reason },
      });
      onCancelled();
    } catch (err) {
      setError(toApiError(err));
      setLoading(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={`Annuler la séance du ${sessionLabel(session)}`}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Alert tone="error" title="Action définitive">
          La vente est fermée et les {session.sold} billet(s) encore valides sont annulés : ils
          seront refusés à l’entrée. Ocall Parc ne rembourse pas automatiquement : la liste des
          acheteurs s’affiche ensuite pour organiser le remboursement.
        </Alert>
        <InputField
          label="Motif"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          minLength={3}
          maxLength={200}
        />
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Retour
          </Button>
          <Button type="submit" loading={loading} disabled={reason.trim().length < 3}>
            Annuler la séance
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Acheteurs d'une séance, par vente : contact éventuel, prénoms, billets et montant payé. */
function BuyersDialog({
  eventId,
  session,
  onClose,
}: {
  eventId: string;
  session: Session;
  onClose: () => void;
}) {
  const buyers = useApi<EventSessionBuyers>(
    `/ticketing/events/${eventId}/sessions/${session.id}/buyers`,
  );
  return (
    <Dialog open onClose={onClose} title={`Acheteurs — séance du ${sessionLabel(session)}`}>
      {buyers.state === 'loading' && <LoadingState />}
      {buyers.state === 'error' && <ErrorState error={buyers.error} onRetry={buyers.reload} />}
      {buyers.state === 'success' && (
        <div className="space-y-3">
          {buyers.data.session.status === 'CANCELLED' && (
            <Alert tone="info" title="Séance annulée">
              {buyers.data.totals.cancelled} billet(s) annulé(s) ·{' '}
              {formatXof(buyers.data.totals.amount)} encaissé(s) au total pour cette séance.
            </Alert>
          )}
          <p className="text-sm text-muted" data-testid="buyers-total">
            {buyers.data.totals.sales} vente(s) · {buyers.data.totals.tickets} billet(s) ·{' '}
            {formatXof(buyers.data.totals.amount)}
          </p>
          {buyers.data.sales.length === 0 ? (
            <p className="text-sm text-muted">Aucun billet vendu pour cette séance.</p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-line/70 overflow-y-auto rounded-xl border border-line">
              {buyers.data.sales.map((s) => (
                <li key={s.saleId} className="space-y-0.5 px-3 py-2 text-sm">
                  <p className="flex flex-wrap justify-between gap-2">
                    <span className="font-semibold">Vente n° {formatSaleNumber(s.saleNumber)}</span>
                    <span className="font-semibold">{formatXof(s.amount)}</span>
                  </p>
                  <p className="text-muted">
                    {formatDateTime(s.soldAt)} · caisse : {s.cashier}
                  </p>
                  {s.customer && (
                    <p>
                      Client : {s.customer.name || 'Sans nom'}
                      {s.customer.phone ? ` · ${s.customer.phone}` : ''}
                    </p>
                  )}
                  <p className="text-muted">
                    {Object.entries(s.tariffs)
                      .map(([name, n]) => `${n} × ${name}`)
                      .join(', ')}
                    {s.visitorNames.length > 0 ? ` · ${s.visitorNames.join(', ')}` : ''}
                  </p>
                  <p className="text-xs text-muted">
                    {s.valid} valide(s) · {s.used} utilisé(s) · {s.cancelled} annulé(s)
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
}

// ─── Tarifs ───

function Tariffs({ event, onChange }: { event: ParkEventDetail; onChange: () => void }) {
  const canManage = useCan('ticketing.manage');
  const [editing, setEditing] = useState<TicketCategory | 'new' | null>(null);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 px-4 py-3">
        <h2 className="font-semibold">Tarifs</h2>
        {canManage && (
          <Button size="sm" onClick={() => setEditing('new')} icon={<Plus className="h-4 w-4" />}>
            Nouveau tarif
          </Button>
        )}
      </div>
      {event.tariffs.length === 0 ? (
        <EmptyState
          icon={<Ticket className="h-7 w-7" />}
          title="Aucun tarif"
          description="Ajoutez au moins un tarif (Standard, VIP, Enfant…)."
        />
      ) : (
        <ul className="divide-y divide-line/70" data-testid="event-tariffs">
          {event.tariffs.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {t.name}{' '}
                  <span className="text-sm font-normal text-muted">
                    · {TICKET_KIND_LABELS[t.kind]}
                  </span>
                </p>
                <p className="text-sm text-muted">
                  {t.peopleIncluded > 1 ? `${t.peopleIncluded} personnes · ` : ''}
                  {t.sessionQuota ? `${t.sessionQuota} place(s) max. par séance · ` : ''}
                  {t.requiresVisitorName ? 'nominatif' : 'prénom facultatif'}
                  {t.conditions ? ` · ${t.conditions}` : ''}
                </p>
              </div>
              <span className="font-display text-lg font-bold">{formatXof(t.price)}</span>
              {t.isActive ? <Badge tone="forest">Actif</Badge> : <Badge>Désactivé</Badge>}
              {canManage && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(t)}
                  icon={<Pencil className="h-4 w-4" />}
                >
                  Modifier
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <TariffDialog
          eventId={event.id}
          tariff={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChange();
          }}
        />
      )}
    </Card>
  );
}

function TariffDialog({
  eventId,
  tariff,
  onClose,
  onSaved,
}: {
  eventId: string;
  tariff: TicketCategory | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    kind: (tariff?.kind ?? 'CUSTOM') as TicketKind,
    name: tariff?.name ?? '',
    price: tariff ? String(tariff.price) : '',
    peopleIncluded: String(tariff?.peopleIncluded ?? 1),
    sessionQuota: tariff?.sessionQuota ? String(tariff.sessionQuota) : '',
    conditions: tariff?.conditions ?? '',
    requiresVisitorName: tariff?.requiresVisitorName ?? false,
    isActive: tariff?.isActive ?? true,
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const set =
    (key: 'kind' | 'name' | 'price' | 'peopleIncluded' | 'sessionQuota' | 'conditions') =>
    (e: { target: { value: string } }) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const body = {
      kind: form.kind,
      name: form.name,
      price: Number(form.price),
      peopleIncluded: Number(form.peopleIncluded),
      sessionQuota: form.sessionQuota ? Number(form.sessionQuota) : tariff ? null : undefined,
      conditions: form.conditions || (tariff ? null : undefined),
      requiresVisitorName: form.requiresVisitorName,
    };
    try {
      if (tariff) {
        await api(`/ticketing/events/${eventId}/tariffs/${tariff.id}`, {
          method: 'PATCH',
          body: { ...body, isActive: form.isActive },
        });
      } else {
        await api(`/ticketing/events/${eventId}/tariffs`, { method: 'POST', body });
      }
      onSaved();
    } catch (err) {
      setError(toApiError(err));
      setLoading(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={tariff ? `Modifier « ${tariff.name} »` : 'Nouveau tarif'}
      description="Un nouveau prix ne s’applique qu’aux ventes suivantes."
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SelectField
            label="Type"
            value={form.kind}
            onChange={set('kind')}
            options={TICKET_KINDS.map((k) => ({ value: k, label: TICKET_KIND_LABELS[k] }))}
          />
          <InputField
            label="Nom"
            value={form.name}
            onChange={set('name')}
            required
            maxLength={60}
          />
          <InputField
            label="Prix (FCFA)"
            inputMode="numeric"
            value={form.price}
            onChange={set('price')}
            required
            pattern="[0-9]+"
          />
          <InputField
            label="Personnes incluses"
            type="number"
            min={1}
            max={50}
            value={form.peopleIncluded}
            onChange={set('peopleIncluded')}
          />
          <InputField
            label="Quota par séance (facultatif)"
            hint="Ex. 50 places VIP ; vide = capacité de la séance"
            type="number"
            min={1}
            value={form.sessionQuota}
            onChange={set('sessionQuota')}
          />
          <InputField
            label="Conditions"
            value={form.conditions}
            onChange={set('conditions')}
            maxLength={300}
          />
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={form.requiresVisitorName}
            onChange={(e) => setForm((f) => ({ ...f, requiresVisitorName: e.target.checked }))}
            className="h-5 w-5 rounded border-line text-forest"
          />
          Billet nominatif (prénom obligatoire au guichet)
        </label>
        {tariff && (
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              className="h-5 w-5 rounded border-line text-forest"
            />
            Tarif actif (en vente)
          </label>
        )}
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={loading}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
