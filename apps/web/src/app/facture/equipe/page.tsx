'use client';

import { useState } from 'react';
import { FACTURE_ROLE_LABELS, FACTURE_ROLES, type FactureRole } from '@ocall/shared';
import { FacturePage } from '@/components/facture/facture-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { SimpleForm } from '@/components/ui/simple-form';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface MemberView {
  id: string;
  firstName: string;
  lastName: string;
  loginId: string;
  role: FactureRole;
  isActive: boolean;
}

/**
 * Équipe Ocall Facture : comptes réservés à Facture (aucun droit Park ni School), rôle par membre.
 * Le propriétaire de l'organisation est gérant d'office. Seul le gérant gère l'équipe.
 */
export default function FactureTeamPage() {
  return (
    <FacturePage
      title="Équipe"
      description="Gérants, commerciaux, comptables et techniciens d’Ocall Facture."
    >
      {({ canWrite, context }) =>
        context.permissions.includes('facture.members.read') ? (
          <Team canManage={canWrite('facture.members.manage')} />
        ) : (
          <Alert tone="info" title="Réservé au gérant, aux commerciaux et aux comptables." />
        )
      }
    </FacturePage>
  );
}

function Team({ canManage }: { canManage: boolean }) {
  const members = useApi<MemberView[]>('/facture/members');
  const [created, setCreated] = useState<{ loginId: string; temporaryPassword: string } | null>(
    null,
  );
  const [error, setError] = useState<ApiError | null>(null);

  async function toggle(member: MemberView) {
    setError(null);
    try {
      await api(`/facture/members/${member.id}`, {
        method: 'PATCH',
        body: { isActive: !member.isActive },
      });
      members.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.'));
    }
  }

  if (members.state === 'loading') return <LoadingState />;
  if (members.state === 'error') {
    return <ErrorState error={members.error} onRetry={members.reload} />;
  }
  return (
    <>
      <ApiErrorAlert error={error} />
      {created && (
        <div data-testid="facture-member-created">
          <Alert tone="success" title="Compte créé">
            Identifiant <strong>{created.loginId}</strong>. Mot de passe provisoire, à changer à la
            première connexion :{' '}
            <strong data-testid="facture-temporary-password">{created.temporaryPassword}</strong>
          </Alert>
        </div>
      )}
      <Card>
        <ul className="divide-y divide-line/70 text-sm" data-testid="facture-member-list">
          {members.data.length === 0 && (
            <li className="px-4 py-6 text-center text-muted">
              Aucun membre : le propriétaire de l’organisation est gérant d’office.
            </li>
          )}
          {members.data.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">
                  {m.firstName} {m.lastName}
                </span>
                <span className="block text-muted">{m.loginId}</span>
              </span>
              <Badge tone={m.isActive ? 'forest' : 'neutral'}>{FACTURE_ROLE_LABELS[m.role]}</Badge>
              {canManage && (
                <Button size="sm" variant="secondary" onClick={() => void toggle(m)}>
                  {m.isActive ? 'Désactiver' : 'Réactiver'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {canManage && (
        <Card>
          <CardHeader title="Nouveau membre" />
          <CardBody>
            <SimpleForm<{ member: { loginId: string }; temporaryPassword: string }>
              testId="facture-member-form"
              path="/facture/members"
              submitLabel="Créer le compte"
              onDone={(result) => {
                setCreated({
                  loginId: result.member.loginId,
                  temporaryPassword: result.temporaryPassword,
                });
                members.reload();
              }}
              fields={[
                { name: 'firstName', label: 'Prénom', required: true },
                { name: 'lastName', label: 'Nom', required: true },
                { name: 'email', label: 'E-mail (facultatif)', type: 'email' },
                {
                  name: 'role',
                  label: 'Rôle',
                  type: 'select',
                  required: true,
                  defaultValue: 'TECHNICIAN',
                  options: FACTURE_ROLES.map((r) => ({ value: r, label: FACTURE_ROLE_LABELS[r] })),
                },
              ]}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}
