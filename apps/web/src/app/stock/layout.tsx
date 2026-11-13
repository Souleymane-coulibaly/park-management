import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppShell, type NavItem } from '@/components/app/app-shell';
import { requireMemberSession } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const NAV: NavItem[] = [
  { key: 'stock-home', label: 'Tableau de bord', href: '/stock' },
  { key: 'stock-products', label: 'Articles', href: '/stock/articles' },
  { key: 'stock-categories', label: 'Catégories et marques', href: '/stock/categories' },
  { key: 'stock-levels', label: 'Stocks', href: '/stock/stocks' },
  { key: 'stock-movements', label: 'Mouvements', href: '/stock/mouvements' },
  { key: 'stock-transfers', label: 'Transferts', href: '/stock/transferts' },
  { key: 'stock-counts', label: 'Inventaires', href: '/stock/inventaires' },
  { key: 'stock-purchases', label: 'Achats', href: '/stock/achats' },
  { key: 'stock-sites', label: 'Sites et emplacements', href: '/stock/sites' },
  { key: 'stock-suppliers', label: 'Fournisseurs', href: '/stock/fournisseurs' },
  { key: 'stock-labels', label: 'Étiquettes', href: '/stock/etiquettes' },
  { key: 'stock-search', label: 'Recherche', href: '/stock/recherche' },
  { key: 'stock-team', label: 'Équipe', href: '/stock/equipe' },
  { key: 'stock-settings', label: 'Réglages', href: '/stock/parametres' },
];

/** Application Ocall Stock. Le droit d'accès réel est décidé par l'API à chaque requête. */
export default async function StockLayout({ children }: { children: ReactNode }) {
  const me = await requireMemberSession();
  return (
    <AppShell
      me={me}
      nav={NAV}
      context={{ title: me.organization!.name, subtitle: 'Ocall Stock' }}
      homeHref="/stock"
      appsHref="/suite"
      accountHref="/stock/compte"
      headerNote={
        <Link href="/suite" className="font-medium text-forest hover:underline">
          Mes applications
        </Link>
      }
    >
      {children}
    </AppShell>
  );
}
