import { requireMemberSession } from '@/lib/server-api';
import { OrganizationDashboard } from './organization-dashboard';

export const dynamic = 'force-dynamic';

/**
 * Ocall Suite étape 5 : tableau de bord de l'organisation (propriétaire, administrateurs). Les droits de
 * chaque application sont appliqués par l'API, bloc par bloc.
 */
export default async function OrganizationDashboardPage() {
  const me = await requireMemberSession();
  return <OrganizationDashboard allowed={me.permissions.includes('organization.reports.read')} />;
}
