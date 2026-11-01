'use client';

import { useState } from 'react';
import { SCHOOL_ROLE_LABELS, assignableSchoolRoles, type SchoolRole } from '@ocall/shared';
import { SchoolPage, type SchoolSummary } from '@/components/school/school-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { SimpleForm } from '@/components/ui/simple-form';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface MemberView {
  id: string;
  firstName: string;
  lastName: string;
  loginId: string;
  role: SchoolRole;
  isActive: boolean;
  schoolIds: string[];
}

export default function EquipePage() {
  return (
    <SchoolPage
      title="Équipe"
      description="Comptes nominatifs : chacun ne voit que les établissements qui lui sont affectés."
    >
      {({ school, context, canWrite }) => (
        <Team
          school={school!}
          schools={context.schools}
          role={context.role}
          canManage={canWrite('school.members.manage')}
        />
      )}
    </SchoolPage>
  );
}

function Team({
  school,
  schools,
  role,
  canManage,
}: {
  school: SchoolSummary;
  schools: SchoolSummary[];
  role: SchoolRole;
  canManage: boolean;
}) {
  const members = useApi<MemberView[]>('/school/members');
  const [created, setCreated] = useState<{ loginId: string; temporaryPassword: string } | null>(
    null,
  );
  const [error, setError] = useState<ApiError | null>(null);

  async function toggle(member: MemberView) {
    setError(null);
    try {
      await api(`/school/members/${member.id}`, {
        method: 'PATCH',
        body: { isActive: !member.isActive },
      });
      members.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion impossible.'));
    }
  }

  if (members.state === 'loading') return <LoadingState />;
  if (members.state === 'error') {
    return <ErrorState error={members.error} onRetry={members.reload} />;
  }
  const names = new Map(schools.map((s) => [s.id, s.name]));
  return (
    <>
      <ApiErrorAlert error={error} />
      {created && (
        <div data-testid="member-created">
          <Alert tone="success" title="Compte créé">
            Identifiant : <strong>{created.loginId}</strong>. Mot de passe temporaire, affiché une
            seule fois :{' '}
            <strong data-testid="temporary-password">{created.temporaryPassword}</strong>
          </Alert>
        </div>
      )}
      <Card>
        <ul className="divide-y divide-line/70 text-sm" data-testid="member-list">
          {members.data.length === 0 && (
            <li className="px-4 py-6 text-center text-muted">Aucun membre.</li>
          )}
          {members.data.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">
                  {m.firstName} {m.lastName}
                </span>
                <span className="block text-muted">
                  {m.loginId} · {m.schoolIds.map((id) => names.get(id) ?? '—').join(', ')}
                </span>
              </span>
              <Badge tone={m.isActive ? 'forest' : 'neutral'}>{SCHOOL_ROLE_LABELS[m.role]}</Badge>
              {canManage && assignableSchoolRoles(role).includes(m.role) && (
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
          <CardBody>
            <h2 className="mb-3 font-semibold">Nouveau membre · {school.name}</h2>
            <SimpleForm<{ member: { loginId: string }; temporaryPassword: string }>
              testId="member-form"
              path="/school/members"
              extra={{ schoolIds: [school.id] }}
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
                { name: 'email', label: 'E-mail', type: 'email' },
                {
                  name: 'role',
                  label: 'Rôle',
                  type: 'select',
                  options: assignableSchoolRoles(role).map((r) => ({
                    value: r,
                    label: SCHOOL_ROLE_LABELS[r],
                  })),
                },
              ]}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}
