import type { ReactNode } from 'react';
import { AppShell, type NavItem } from '@/components/app/app-shell';
import { requireSuperAdminSession } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const NAV: NavItem[] = [
  { key: 'platform-overview', label: 'Vue d’ensemble', href: '/admin' },
  { key: 'platform-organizations', label: 'Organisations', href: '/admin/organisations' },
  { key: 'platform-subscriptions', label: 'Abonnements et offres', href: '/admin/abonnements' },
  { key: 'platform-payments', label: 'Règlements', href: '/admin/reglements' },
  { key: 'platform-stats', label: 'Statistiques SaaS', href: '/admin/statistiques' },
];

/** Espace Super Admin : administration du SaaS, sans accès aux données métier des clients. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const me = await requireSuperAdminSession();
  return (
    <AppShell
      me={me}
      nav={NAV}
      context={{ title: 'Plateforme Ocall Park', subtitle: 'Super administration' }}
      homeHref="/admin"
      headerNote="Données agrégées uniquement"
    >
      {children}
    </AppShell>
  );
}
