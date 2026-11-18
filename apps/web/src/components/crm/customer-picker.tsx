'use client';

import { useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { CUSTOMER_SEARCH_MIN_LENGTH } from '@ocall/shared';
import { CustomerFormDialog } from '@/components/crm/customer-form';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { ErrorState, LoadingState } from '@/components/ui/states';
import type { CustomerSummary } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export const fullName = (c: { firstName: string | null; lastName: string | null }) =>
  [c.firstName, c.lastName].filter(Boolean).join(' ').trim();

/** Recherche d'une fiche client (nom ou téléphone), ou création sur place. */
export function CustomerPicker({
  value,
  onChange,
  label = 'Fiche client (nom ou téléphone)',
  testId = 'pass-holder',
}: {
  value: CustomerSummary | null;
  onChange: (c: CustomerSummary | null) => void;
  label?: string;
  testId?: string;
}) {
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [creating, setCreating] = useState(false);
  const searching = submitted.length >= CUSTOMER_SEARCH_MIN_LENGTH;
  const results = useApi<CustomerSummary[]>(
    searching ? `/customers?q=${encodeURIComponent(submitted)}` : null,
  );

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-forest/40 bg-forest-light/40 p-3">
        <div className="min-w-0">
          <p className="truncate font-semibold" data-testid={testId}>
            {fullName(value) || 'Sans nom'}
          </p>
          {value.phone && <p className="text-sm text-muted">{value.phone}</p>}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          Changer
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <InputField
            label={label}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setSubmitted(q.trim());
              }
            }}
            autoComplete="off"
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setSubmitted(q.trim())}
          disabled={q.trim().length < CUSTOMER_SEARCH_MIN_LENGTH}
          icon={<Search className="h-4 w-4" />}
          aria-label="Rechercher le client"
        >
          <span className="sr-only sm:not-sr-only">Rechercher</span>
        </Button>
      </div>
      {searching && results.state === 'loading' && <LoadingState />}
      {searching && results.state === 'error' && (
        <ErrorState error={results.error} onRetry={results.reload} />
      )}
      {searching && results.state === 'success' && (
        <ul className="max-h-56 divide-y divide-line/70 overflow-y-auto rounded-xl border border-line">
          {results.data.length === 0 && (
            <li className="p-3 text-sm text-muted">Aucun client trouvé.</li>
          )}
          {results.data
            .filter((c) => !c.anonymizedAt)
            .map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onChange(c)}
                  className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-forest-light/40"
                >
                  <span className="truncate font-medium">{fullName(c) || 'Sans nom'}</span>
                  <span className="text-sm text-muted">{c.phone}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setCreating(true)}
        icon={<UserPlus className="h-4 w-4" />}
      >
        Nouveau client
      </Button>
      {creating && (
        <CustomerFormDialog
          initialPhone={/^[\d+\s]+$/.test(q) ? q.trim() : undefined}
          onClose={() => setCreating(false)}
          onSaved={(c) => {
            setCreating(false);
            onChange(c);
          }}
        />
      )}
    </div>
  );
}
