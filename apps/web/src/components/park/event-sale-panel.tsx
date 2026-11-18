'use client';

import { useState } from 'react';
import { CalendarDays, Users } from 'lucide-react';
import { TICKET_KIND_LABELS, formatXof, sessionLabel } from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import type { EventCatalogEntry, TicketCategory } from '@/lib/types';
import type { Loadable } from '@/lib/use-api';

export interface EventSessionChoice {
  id: string;
  eventName: string;
  label: string;
}

/**
 * Guichet — événements : choix de l'événement, de la séance (places restantes) puis des tarifs.
 * Les places affichées sont indicatives ; la réservation définitive a lieu à l'encaissement.
 */
export function EventSalePanel({
  catalog,
  inCart,
  onAdd,
}: {
  catalog: Loadable<EventCatalogEntry[]> & { reload: () => void };
  /** Places déjà dans la commande pour une séance (par tarif). */
  inCart: (sessionId: string, categoryId?: string) => number;
  onAdd: (category: TicketCategory, session: EventSessionChoice) => void;
}) {
  const [eventId, setEventId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  if (catalog.state === 'loading') return <LoadingState label="Chargement des événements…" />;
  if (catalog.state === 'error')
    return <ErrorState error={catalog.error} onRetry={catalog.reload} />;
  if (catalog.state !== 'success') return null;
  if (catalog.data.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<CalendarDays className="h-7 w-7" />}
          title="Aucun événement en vente"
          description="Un responsable peut créer et publier les événements dans la billetterie."
        />
      </Card>
    );
  }

  const event = catalog.data.find((e) => e.id === eventId) ?? catalog.data[0]!;
  const session = event.sessions.find((s) => s.id === sessionId) ?? event.sessions[0]!;
  const choice: EventSessionChoice = {
    id: session.id,
    eventName: event.name,
    label: sessionLabel(session),
  };
  const sessionLeft = session.placesLeft - inCart(session.id);

  return (
    <div className="space-y-3" data-testid="event-sale-panel">
      {catalog.data.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Événement">
          {catalog.data.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => {
                setEventId(e.id);
                setSessionId(null);
              }}
              aria-pressed={e.id === event.id}
              className={`min-h-11 rounded-xl px-3 text-sm font-semibold ${e.id === event.id ? 'bg-forest text-white' : 'border border-line bg-surface hover:border-forest'}`}
            >
              {e.name}
            </button>
          ))}
        </div>
      )}
      <div className="rounded-2xl border border-line bg-surface p-3">
        <p className="font-display text-lg font-bold">{event.name}</p>
        {event.conditions && <p className="text-sm text-muted">{event.conditions}</p>}
        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">Séance</p>
        <div className="mt-1 grid gap-2 sm:grid-cols-2" role="group" aria-label="Séance">
          {event.sessions.map((s) => {
            const left = s.placesLeft - inCart(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSessionId(s.id)}
                aria-pressed={s.id === session.id}
                className={`flex min-h-11 items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm ${s.id === session.id ? 'bg-forest text-white' : 'border border-line bg-surface hover:border-forest'}`}
              >
                <span className="font-semibold">{sessionLabel(s)}</span>
                <span className={s.id === session.id ? 'text-white/85' : 'text-muted'}>
                  {left > 0 ? `${left} place(s)` : 'Complet'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {event.tariffs.map((t) => {
          const quota = session.tariffs.find((x) => x.ticketCategoryId === t.id)?.placesLeft;
          const tariffLeft =
            quota === null || quota === undefined ? null : quota - inCart(session.id, t.id);
          const full =
            sessionLeft < t.peopleIncluded ||
            (tariffLeft !== null && tariffLeft < t.peopleIncluded);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onAdd(t, choice)}
              disabled={full}
              className="flex min-h-32 flex-col justify-between rounded-2xl border border-line bg-surface p-4 text-left shadow-card transition active:scale-[0.98] hover:border-forest disabled:opacity-50"
            >
              <span>
                <span className="block text-lg font-bold leading-tight">{t.name}</span>
                <span className="text-xs uppercase tracking-wide text-muted">
                  {TICKET_KIND_LABELS[t.kind]}
                </span>
              </span>
              <span className="space-y-0.5">
                <span className="block font-display text-xl font-bold text-forest">
                  {formatXof(t.price)}
                </span>
                {t.peopleIncluded > 1 && (
                  <span className="flex items-center gap-1 text-xs text-muted">
                    <Users className="h-3.5 w-3.5" aria-hidden /> {t.peopleIncluded} personnes
                  </span>
                )}
                {full ? (
                  <Badge tone="terracotta">Complet</Badge>
                ) : (
                  tariffLeft !== null && (
                    <span className="block text-xs text-muted">
                      {tariffLeft} place(s) à ce tarif
                    </span>
                  )
                )}
                {t.requiresVisitorName && (
                  <span className="block text-xs text-muted">Billet nominatif</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
