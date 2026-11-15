import { requireMemberSession } from '@/lib/server-api';
import { SuitePortal } from './suite-portal';

export const dynamic = 'force-dynamic';

/** Portail Ocall Suite : les applications autorisées par les contrats et abonnements du client. */
export default async function SuitePage() {
  const me = await requireMemberSession();
  return (
    <SuitePortal
      organizationName={me.organization!.name}
      firstName={me.user.firstName}
      canSites={me.permissions.includes('establishment.read')}
      canInvite={me.permissions.includes('employee.manage')}
    />
  );
}
