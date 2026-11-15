'use client';

import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { announceOrganizationChange } from '@/lib/organization-change';
import { useApi } from '@/lib/use-api';

interface MyOrganization {
  organizationId: string;
  name: string;
  role: string;
  current: boolean;
}

/**
 * Ocall Suite Sprint 2C : changement d'organisation pour un compte membre de plusieurs organisations.
 * Le serveur ouvre une nouvelle session sur l'organisation choisie et ferme la précédente ; la page est
 * entièrement rechargée, pour qu'aucun écran ne garde les données de l'organisation quittée.
 */
export function OrganizationSwitcher() {
  const orgs = useApi<MyOrganization[]>('/auth/organizations');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (orgs.state !== 'success' || orgs.data.length < 2) return null;
  const current = orgs.data.find((o) => o.current);

  async function choose(organizationId: string) {
    if (!organizationId || organizationId === current?.organizationId) return;
    setBusy(true);
    setError(null);
    try {
      await api('/auth/switch-organization', { method: 'POST', body: { organizationId } });
      announceOrganizationChange(organizationId);
      window.location.assign('/suite');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Changement impossible.');
      setBusy(false);
    }
  }

  return (
    <label className="flex min-w-0 items-center gap-2 text-sm" data-testid="organization-switcher">
      <span className="sr-only">Organisation</span>
      <select
        aria-label="Organisation"
        className="max-w-[11rem] truncate rounded-lg border border-suite-ink/10 bg-white px-2 py-1 text-sm sm:max-w-xs"
        value={current?.organizationId ?? ''}
        disabled={busy}
        onChange={(e) => void choose(e.target.value)}
      >
        {orgs.data.map((o) => (
          <option key={o.organizationId} value={o.organizationId}>
            {o.name}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="text-xs text-suite-clay">
          {error}
        </span>
      )}
    </label>
  );
}
