import type { ReactNode } from 'react';
import { AppShell, type NavItem } from '@/components/app/app-shell';
import { requirePartnerSession } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const NAV: NavItem[] = [
  { key: 'partner-dashboard', label: 'Tableau de bord', href: '/partenaire' },
  { key: 'partner-prospects', label: 'Prospects', href: '/partenaire/prospects' },
  { key: 'partner-clients', label: 'Clients apportés', href: '/partenaire/clients' },
  { key: 'partner-commissions', label: 'Commissions', href: '/partenaire/commissions' },
  { key: 'partner-cash', label: 'Espèces', href: '/partenaire/especes' },
  { key: 'partner-products', label: 'Produits et ressources', href: '/partenaire/produits' },
];

/**
 * Portail des partenaires commerciaux (Sprint 12B). Aucun accès à l'espace client ni au Super
 * Admin ; l'API filtre toujours sur le partenaire de la session.
 */
export default async function PartnerLayout({ children }: { children: ReactNode }) {
  const me = await requirePartnerSession();
  return (
    <AppShell
      me={me}
      nav={me.partner?.status === 'ACTIVE' ? NAV : NAV.slice(0, 1)}
      context={{
        title: me.partner?.companyName ?? 'Partenaire',
        subtitle: 'Partenaire Ocall Suite',
      }}
      homeHref="/partenaire"
      headerNote="Portail partenaire"
    >
      {children}
    </AppShell>
  );
}
