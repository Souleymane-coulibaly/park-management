import type { BusinessType } from '@ocall/shared';
import { requireMemberSession } from '@/lib/server-api';
import { SitesRegistry } from './sites-registry';

export const dynamic = 'force-dynamic';

/**
 * Ocall Suite Sprint 2B : sites de l'organisation (référentiel commun). Chaque lieu physique est enregistré
 * une seule fois ; la page montre les applications qui utilisent chacun.
 */
export default async function SuiteSitesPage() {
  const me = await requireMemberSession();
  return (
    <SitesRegistry
      canRead={me.permissions.includes('establishment.read')}
      canManage={me.permissions.includes('establishment.manage')}
      businessType={me.organization!.businessType as BusinessType}
    />
  );
}
