'use client';

import { type FormEvent, useState } from 'react';
import Link from 'next/link';
import { Search, Settings2, UserPlus, Users } from 'lucide-react';
import {
  CUSTOMER_SEARCH_MIN_LENGTH,
  LOYALTY_ACTIVITY_LABELS,
  customerDisplayName,
  formatXof,
} from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { CustomerFormDialog } from '@/components/crm/customer-form';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import type { CustomerSummary } from '@/lib/types';
import { useApi } from '@/lib/use-api';

/** Clients et fidélité : recherche (caissier) ou liste filtrée (responsables). */
export default function ClientsPage() {
  const canRead = useCan('customer.read');
  const full = useCan('customer.history');
  const canCreate = useCan('customer.manage');
  const canConfigure = useCan('loyalty.configure');
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const params = new URLSearchParams();
  if (submitted) params.set('q', submitted);
  if (full && filter !== 'all') params.set('filter', filter);
  const canQuery = full || submitted.length >= CUSTOMER_SEARCH_MIN_LENGTH;
  const customers = useApi<CustomerSummary[]>(
    canRead && canQuery ? `/customers?${params.toString()}` : null,
  );

  if (!canRead) return <AccessDenied />;

  function onSearch(event: FormEvent) {
    event.preventDefault();
    setSubmitted(q.trim());
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Clients et fidélité</h1>
        <div className="flex gap-2">
          {canConfigure && (
            <ButtonLink href="/app/clients/fidelite" variant="secondary" size="sm">
              <Settings2 className="h-4 w-4" aria-hidden /> Programmes de fidélité
            </ButtonLink>
          )}
          {canCreate && (
            <Button
              size="sm"
              icon={<UserPlus className="h-4 w-4" />}
              onClick={() => setCreating(true)}
            >
              Nouveau client
            </Button>
          )}
        </div>
      </div>
      <form onSubmit={onSearch} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
          <InputField
            label="Rechercher (nom ou téléphone)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Awa, 70 11…"
          />
        </div>
        {full && (
          <div className="w-52">
            <SelectField
              label="Filtre"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              options={[
                { value: 'all', label: 'Tous' },
                { value: 'withPoints', label: 'Avec des points' },
                { value: 'marketing', label: 'Accepte les offres' },
                { value: 'inactive', label: 'Sans visite depuis 90 jours' },
              ]}
            />
          </div>
        )}
        <Button type="submit" icon={<Search className="h-4 w-4" />}>
          Rechercher
        </Button>
      </form>
      {!full && (
        <Alert tone="info">
          Saisissez au moins {CUSTOMER_SEARCH_MIN_LENGTH} caractères du nom ou du téléphone : la
          liste complète des clients est réservée aux responsables.
        </Alert>
      )}
      {canQuery && customers.state === 'loading' && <LoadingState />}
      {canQuery && customers.state === 'error' && (
        <ErrorState error={customers.error} onRetry={customers.reload} />
      )}
      {canQuery && customers.state === 'success' && customers.data.length === 0 && (
        <Card>
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title="Aucun client"
            description="Aucune fiche ne correspond."
          />
        </Card>
      )}
      {canQuery && customers.state === 'success' && customers.data.length > 0 && (
        <Card>
          <Table
            head={[
              'Client',
              'Téléphone',
              'Points',
              ...(full ? ['Visites', 'Dépenses', 'Dernière visite'] : []),
            ]}
          >
            {customers.data.map((c) => (
              <tr key={c.id} data-testid="customer-row">
                <Td className="font-medium">
                  <Link href={`/app/clients/${c.id}`} className="text-forest hover:underline">
                    {customerDisplayName(c)}
                  </Link>
                  {c.marketingConsent && (
                    <span className="ml-2">
                      <Badge tone="savanna">Offres</Badge>
                    </span>
                  )}
                </Td>
                <Td>{c.phone ?? '—'}</Td>
                <Td>
                  {c.wallets.map((w) => (
                    <span key={w.activity} className="mr-2 whitespace-nowrap">
                      {LOYALTY_ACTIVITY_LABELS[w.activity].replace('Fidélité ', '')} :{' '}
                      <strong>{w.balance}</strong>
                    </span>
                  ))}
                </Td>
                {full && (
                  <>
                    <Td>{c.visits ?? 0}</Td>
                    <Td>{formatXof(c.totalSpent ?? 0)}</Td>
                    <Td>{formatDate(c.lastVisitAt)}</Td>
                  </>
                )}
              </tr>
            ))}
          </Table>
        </Card>
      )}
      {creating && (
        <CustomerFormDialog
          initialPhone={/^\+?[0-9 ]+$/.test(q) ? q : undefined}
          onClose={() => setCreating(false)}
          onSaved={(c) => {
            setCreating(false);
            window.location.assign(`/app/clients/${c.id}`);
          }}
        />
      )}
    </div>
  );
}
