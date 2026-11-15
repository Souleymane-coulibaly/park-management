import type { MemberRole } from '@ocall/shared';
import { requireMemberSession } from '@/lib/server-api';
import { InvitationsManager } from './invitations-manager';

export const dynamic = 'force-dynamic';

/** Ocall Suite Sprint 2C : inviter une personne qui a déjà un compte Ocall dans l'organisation. */
export default async function SuiteInvitationsPage() {
  const me = await requireMemberSession();
  return (
    <InvitationsManager
      canManage={me.permissions.includes('employee.manage')}
      role={me.role as MemberRole}
    />
  );
}
