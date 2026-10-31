'use client';

import { useEffect, useState } from 'react';
import {
  localMoment,
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
  type TicketStatus,
} from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { ParkEstablishmentScope } from '@/components/park/park-establishment';
import { ParkNav } from '@/components/park/park-nav';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useConnectivity } from '@/lib/connectivity';
import { formatDateTime } from '@/lib/format';
import type { ParkEstablishment, ParkVisitors } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const SEARCH_DELAY_MS = 300;

const STATUS_TONE: Record<TicketStatus, 'forest' | 'neutral' | 'terracotta'> = {
  VALID: 'forest',
  USED: 'neutral',
  EXPIRED: 'terracotta',
  CANCELLED: 'terracotta',
};

/** Visiteurs d'une journée de vente, réservés aux responsables (aucun QR n'est affiché ici). */
export default function VisiteursPage() {
  const allowed = useCan('sale.read_all');
  if (!allowed) return <AccessDenied />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Visiteurs</h1>
        <ParkNav />
      </div>
      <ParkEstablishmentScope source="/ticketing/establishments">
        {(park) => <Visitors park={park} />}
      </ParkEstablishmentScope>
    </div>
  );
}

function Visitors({ park }: { park: ParkEstablishment }) {
  const online = useConnectivity();
  const [date, setDate] = useState(() => localMoment(new Date(), park.timezone).date);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const params = new URLSearchParams({ establishmentId: park.id });
  if (date) params.set('date', date);
  if (query) params.set('q', query);
  if (status) params.set('status', status);
  const visitors = useApi<ParkVisitors>(`/tickets/search?${params.toString()}`);
  const { reload } = visitors;
  useEffect(() => {
    if (online) reload();
  }, [online, reload]);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <InputField
          label="Prénom ou n° de vente"
          value={search}
          onChange={(e) => setSearch(e.target.value.slice(0, 60))}
          autoComplete="off"
        />
        <InputField
          type="date"
          label="Journée de vente"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <SelectField
          label="Statut"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: '', label: 'Tous' },
            ...TICKET_STATUSES.map((s) => ({ value: s, label: TICKET_STATUS_LABELS[s] })),
          ]}
        />
      </div>
      <Card>
        {visitors.state === 'loading' && <LoadingState />}
        {visitors.state === 'error' && <ErrorState error={visitors.error} onRetry={reload} />}
        {visitors.state === 'success' &&
          (visitors.data.items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">Aucun visiteur trouvé.</p>
          ) : (
            <>
              <p className="border-b border-line/70 px-4 py-2.5 text-sm text-muted">
                <span data-testid="visitors-total">{visitors.data.total}</span> billet(s)
                {visitors.data.total > visitors.data.items.length &&
                  ` · ${visitors.data.items.length} affichés, précisez la recherche`}
              </p>
              <ul className="divide-y divide-line/70" data-testid="visitors-list">
                {visitors.data.items.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{t.visitorName}</span>
                      <span className="block truncate text-muted">
                        {t.categoryName} · vente n° {t.saleNumber}
                      </span>
                    </span>
                    <span className="text-right">
                      <Badge tone={STATUS_TONE[t.status]}>{TICKET_STATUS_LABELS[t.status]}</Badge>
                      {t.usedAt && (
                        <span className="mt-1 block text-xs text-muted">
                          Entré : {formatDateTime(t.usedAt)}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ))}
      </Card>
    </>
  );
}
