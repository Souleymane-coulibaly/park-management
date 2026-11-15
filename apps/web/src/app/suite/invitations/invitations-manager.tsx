'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  INVITATION_ROLE_LABELS,
  type MemberRole,
  invitableRolesFor,
  invitationNeedsEstablishments,
} from '@ocall/shared';
import { SuiteShell } from '@/components/suite/suite-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface InvitationView {
  id: string;
  identifier: string;
  role: MemberRole;
  state: 'PENDING' | 'EXPIRED' | 'ACCEPTED' | 'DECLINED' | 'REVOKED';
  expiresAt: string;
}

interface EstablishmentRef {
  id: string;
  name: string;
  businessType: string;
  isActive: boolean;
}

const STATE_LABELS: Record<InvitationView['state'], string> = {
  PENDING: 'En attente',
  EXPIRED: 'Échue',
  ACCEPTED: 'Acceptée',
  DECLINED: 'Refusée',
  REVOKED: 'Révoquée',
};

/**
 * Ocall Suite Sprint 2C : invitations envoyées par l'organisation. La personne accepte depuis son propre
 * compte ; la page ne dit jamais si un compte existe.
 */
export function InvitationsManager({ canManage, role }: { canManage: boolean; role: MemberRole }) {
  return (
    <SuiteShell>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-10 sm:px-6">
        <Link
          href="/suite"
          className="inline-flex items-center gap-1 text-sm font-semibold text-suite-green"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Mes applications
        </Link>
        <div>
          <h1 className="font-display text-3xl font-extrabold text-suite-green">
            Inviter une personne
          </h1>
          <p className="mt-1 text-suite-ink-soft">
            Une personne qui a déjà un compte Ocall (dans une autre organisation) rejoint la vôtre
            avec son compte, après avoir accepté l’invitation.
          </p>
        </div>
        {canManage ? (
          <Manager role={role} />
        ) : (
          <Alert tone="info" title="Accès réservé">
            Les invitations sont gérées par le propriétaire et les administrateurs.
          </Alert>
        )}
      </main>
    </SuiteShell>
  );
}

function Manager({ role }: { role: MemberRole }) {
  const invitations = useApi<InvitationView[]>('/organization/invitations');
  const establishments = useApi<EstablishmentRef[]>('/establishments');
  const roles = invitableRolesFor(role);
  const [form, setForm] = useState({ identifier: '', role: roles[roles.length - 1] ?? '' });
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const needs = form.role ? invitationNeedsEstablishments(form.role as MemberRole) : false;
  const parkSites =
    establishments.state === 'success'
      ? establishments.data.filter((e) => e.isActive && e.businessType !== 'NONE')
      : [];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      await api('/organization/invitations', {
        method: 'POST',
        body: { ...form, ...(needs ? { establishmentIds: chosen } : {}) },
      });
      setSent(true);
      setForm((f) => ({ ...f, identifier: '' }));
      invitations.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      await api(`/organization/invitations/${id}/revoke`, { method: 'POST' });
      invitations.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader title="Nouvelle invitation" />
        <CardBody>
          <form onSubmit={submit} className="space-y-4" data-testid="suite-invitation-form">
            <ApiErrorAlert error={error} />
            {sent && (
              <Alert tone="success" title="Invitation enregistrée">
                Si un compte Ocall correspond, la personne la verra dans son portail.
              </Alert>
            )}
            <InputField
              label="E-mail ou identifiant de la personne"
              value={form.identifier}
              onChange={(e) => setForm((f) => ({ ...f, identifier: e.target.value }))}
              required
            />
            <SelectField
              label="Rôle dans votre organisation"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              options={roles.map((r) => ({ value: r, label: INVITATION_ROLE_LABELS[r] ?? r }))}
            />
            {needs && (
              <fieldset className="space-y-2" data-testid="suite-invitation-establishments">
                <legend className="text-sm font-semibold">Établissements</legend>
                {parkSites.map((e) => (
                  <label key={e.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={chosen.includes(e.id)}
                      onChange={(ev) =>
                        setChosen((c) =>
                          ev.target.checked ? [...c, e.id] : c.filter((x) => x !== e.id),
                        )
                      }
                    />
                    {e.name}
                  </label>
                ))}
              </fieldset>
            )}
            <Button type="submit" loading={busy}>
              Inviter
            </Button>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Invitations envoyées" />
        <CardBody>
          {invitations.state === 'loading' && <LoadingState />}
          {invitations.state === 'error' && (
            <ErrorState error={invitations.error} onRetry={invitations.reload} />
          )}
          {invitations.state === 'success' && (
            <ul className="divide-y divide-suite-ink/5" data-testid="suite-invitation-list">
              {invitations.data.length === 0 && (
                <li className="py-3 text-sm text-suite-ink-soft">Aucune invitation.</li>
              )}
              {invitations.data.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <span className="min-w-0 flex-1 break-all">{i.identifier}</span>
                  <span className="text-suite-ink-soft">{INVITATION_ROLE_LABELS[i.role]}</span>
                  <Badge tone={i.state === 'ACCEPTED' ? 'forest' : 'neutral'}>
                    {STATE_LABELS[i.state]}
                  </Badge>
                  {i.state === 'PENDING' && (
                    <Button size="sm" variant="ghost" onClick={() => void revoke(i.id)}>
                      Révoquer
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
