'use client';

import { useState } from 'react';
import { INVITATION_ROLE_LABELS, type MemberRole } from '@ocall/shared';
import { Button } from '@/components/ui/button';
import { ApiErrorAlert } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface PendingInvitation {
  id: string;
  organizationName: string;
  role: MemberRole;
  expiresAt: string;
}

/**
 * Ocall Suite Sprint 2C : invitations reçues par ce compte. Accepter crée l'adhésion dans l'autre
 * organisation (rien avant) ; la personne y passe ensuite quand elle le souhaite.
 */
export function PendingInvitations() {
  const invitations = useApi<PendingInvitation[]>('/auth/invitations');
  const [joined, setJoined] = useState<{ organizationId: string; name: string } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function decide(invitation: PendingInvitation, accept: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ organizationId: string }>(
        `/auth/invitations/${invitation.id}/${accept ? 'accept' : 'decline'}`,
        { method: 'POST' },
      );
      if (accept)
        setJoined({ organizationId: result.organizationId, name: invitation.organizationName });
      invitations.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setBusy(false);
    }
  }

  async function go(organizationId: string) {
    setBusy(true);
    try {
      await api('/auth/switch-organization', { method: 'POST', body: { organizationId } });
      window.location.assign('/suite');
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
      setBusy(false);
    }
  }

  if (invitations.state !== 'success') return null;
  if (invitations.data.length === 0 && !joined) return null;
  return (
    <section
      aria-label="Invitations"
      className="space-y-3 rounded-2xl border border-suite-gold/40 bg-white p-5"
      data-testid="suite-invitations"
    >
      <ApiErrorAlert error={error} />
      {joined && (
        <div className="flex flex-wrap items-center gap-3" data-testid="suite-invitation-joined">
          <p className="text-sm">
            Vous faites maintenant partie de <strong>{joined.name}</strong>.
          </p>
          <Button size="sm" loading={busy} onClick={() => void go(joined.organizationId)}>
            Passer à cette organisation
          </Button>
        </div>
      )}
      {invitations.data.map((i) => (
        <div
          key={i.id}
          className="flex flex-wrap items-center gap-3"
          data-testid="suite-invitation"
        >
          <p className="min-w-0 flex-1 text-sm">
            <strong>{i.organizationName}</strong> vous invite à rejoindre son organisation
            {INVITATION_ROLE_LABELS[i.role] ? ` (${INVITATION_ROLE_LABELS[i.role]})` : ''}.
          </p>
          <Button size="sm" loading={busy} onClick={() => void decide(i, true)}>
            Accepter
          </Button>
          <Button size="sm" variant="ghost" loading={busy} onClick={() => void decide(i, false)}>
            Refuser
          </Button>
        </div>
      ))}
    </section>
  );
}
