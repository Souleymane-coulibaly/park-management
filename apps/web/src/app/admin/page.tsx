import { redirect } from 'next/navigation';
import { requireSuperAdminSession } from '@/lib/server-api';
import { AdminOverviewClient } from './overview-client';

export const dynamic = 'force-dynamic';

/**
 * Accueil de l'administration. Un compte sans accès au tableau de bord (imprimeur de l'atelier Ocall
 * Print) est conduit directement à son espace de travail.
 */
export default async function AdminOverviewPage() {
  const me = await requireSuperAdminSession();
  if (!me.platformPermissions.includes('platform.dashboard')) {
    redirect(
      me.platformPermissions.includes('platform.print.production')
        ? '/admin/impression'
        : '/admin/securite',
    );
  }
  return <AdminOverviewClient />;
}
