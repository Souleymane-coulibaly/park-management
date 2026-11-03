'use client';

import { useState } from 'react';
import { assignableSchoolRoles, schoolDisplayName, type SchoolRole } from '@ocall/shared';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage, type SchoolSummary } from '@/components/school/school-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { SimpleForm } from '@/components/ui/simple-form';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
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
    <SchoolPage title="team.title" description="team.desc">
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
  const { t, labels, name, join } = useSchoolText();
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
      setError(toApiError(e));
    }
  }

  if (members.state === 'loading') return <LoadingState />;
  if (members.state === 'error') {
    return <ErrorState error={members.error} onRetry={members.reload} />;
  }
  // Chaque établissement nommé selon sa propre langue, pas celle de l'établissement choisi.
  const names = new Map(schools.map((s) => [s.id, schoolDisplayName(s.defaultLocale, s)]));
  return (
    <>
      <ApiErrorAlert error={error} />
      {created && (
        <div data-testid="member-created">
          <Alert tone="success" title={t('team.createdTitle')}>
            {t('team.login')} <strong dir="ltr">{created.loginId}</strong>. {t('team.tempPassword')}{' '}
            <strong data-testid="temporary-password" dir="ltr">
              {created.temporaryPassword}
            </strong>
          </Alert>
        </div>
      )}
      <Card>
        <ul className="divide-y divide-line/70 text-sm" data-testid="member-list">
          {members.data.length === 0 && (
            <li className="px-4 py-6 text-center text-muted">{t('team.empty')}</li>
          )}
          {members.data.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold" dir="auto">
                  {m.firstName} {m.lastName}
                </span>
                <span className="block text-muted">
                  <span dir="ltr">{m.loginId}</span> ·{' '}
                  {join(m.schoolIds.map((id) => names.get(id) ?? '—'))}
                </span>
              </span>
              <Badge tone={m.isActive ? 'forest' : 'neutral'}>{labels.role[m.role]}</Badge>
              {canManage && assignableSchoolRoles(role).includes(m.role) && (
                <Button size="sm" variant="secondary" onClick={() => void toggle(m)}>
                  {m.isActive ? t('team.deactivate') : t('team.reactivate')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {canManage && (
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">{t('team.new', { school: name(school) })}</h2>
            <SimpleForm<{ member: { loginId: string }; temporaryPassword: string }>
              testId="member-form"
              path="/school/members"
              extra={{ schoolIds: [school.id] }}
              submitLabel={t('team.create')}
              onDone={(result) => {
                setCreated({
                  loginId: result.member.loginId,
                  temporaryPassword: result.temporaryPassword,
                });
                members.reload();
              }}
              fields={[
                { name: 'firstName', label: t('field.firstName'), required: true },
                { name: 'lastName', label: t('field.lastName'), required: true },
                { name: 'email', label: t('field.email'), type: 'email' },
                {
                  name: 'role',
                  label: t('field.role'),
                  type: 'select',
                  options: assignableSchoolRoles(role).map((r) => ({
                    value: r,
                    label: labels.role[r],
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
