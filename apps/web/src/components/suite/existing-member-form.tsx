'use client';

import { SimpleForm } from '@/components/ui/simple-form';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

/** Membre de l'organisation qu'une application peut ajouter à son équipe (Sprint Suite 2A). */
export interface OrganizationCandidate {
  userId: string;
  firstName: string;
  lastName: string;
  loginId: string;
  suiteRole: string;
}

/**
 * Ajout à l'équipe d'une application d'une personne qui a déjà un compte dans l'organisation (employé
 * Park, membre d'une autre application) : aucun nouveau compte ni mot de passe ; ses autres rôles restent
 * inchangés. Commun à Stock, Facture et School.
 */
export function ExistingMemberForm({
  candidatesPath,
  attachPath,
  roleOptions,
  defaultRole,
  extra,
  labels,
  testId,
  onDone,
}: {
  candidatesPath: string;
  attachPath: string;
  roleOptions: { value: string; label: string }[];
  defaultRole?: string;
  extra?: Record<string, unknown>;
  labels: { person: string; role: string; submit: string; empty: string };
  testId: string;
  onDone: () => void;
}) {
  const candidates = useApi<OrganizationCandidate[]>(candidatesPath);
  if (candidates.state === 'loading') return <LoadingState />;
  if (candidates.state === 'error') {
    return <ErrorState error={candidates.error} onRetry={candidates.reload} />;
  }
  if (candidates.data.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid={`${testId}-empty`}>
        {labels.empty}
      </p>
    );
  }
  return (
    <SimpleForm<unknown>
      // Liste rechargée après chaque ajout : le formulaire repart de la première personne restante.
      key={candidates.data.map((c) => c.userId).join()}
      testId={testId}
      path={attachPath}
      extra={extra}
      submitLabel={labels.submit}
      onDone={() => {
        candidates.reload();
        onDone();
      }}
      fields={[
        {
          name: 'userId',
          label: labels.person,
          type: 'select',
          required: true,
          options: candidates.data.map((c) => ({
            value: c.userId,
            label: `${c.firstName} ${c.lastName} · ${c.loginId}`,
          })),
        },
        {
          name: 'role',
          label: labels.role,
          type: 'select',
          required: true,
          defaultValue: defaultRole,
          options: roleOptions,
        },
      ]}
    />
  );
}
