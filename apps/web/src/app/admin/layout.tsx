import type { ReactNode } from 'react';
import {
  PLATFORM_ROLE_LABELS,
  type PlatformPermission,
  effectivePlatformRole,
} from '@ocall/shared';
import { AppShell, type NavItem } from '@/components/app/app-shell';
import { requireSuperAdminSession } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/** Navigation Ocall Suite : chaque entrée n'est affichée qu'avec la permission plateforme requise (l'API la vérifie aussi). */
const NAV: (NavItem & { permission: PlatformPermission | null })[] = [
  {
    key: 'platform-overview',
    label: 'Tableau de bord',
    href: '/admin',
    permission: 'platform.dashboard',
  },
  {
    key: 'platform-organizations',
    label: 'Organisations',
    href: '/admin/organisations',
    permission: 'platform.orgs.read',
  },
  {
    key: 'platform-products',
    label: 'Produits',
    href: '/admin/produits',
    permission: 'platform.orgs.read',
  },
  {
    key: 'platform-subscriptions',
    label: 'Abonnements et offres',
    href: '/admin/abonnements',
    permission: 'platform.billing.read',
  },
  {
    key: 'platform-invoices',
    label: 'Factures',
    href: '/admin/factures',
    permission: 'platform.billing.read',
  },
  {
    key: 'platform-payments',
    label: 'Règlements',
    href: '/admin/reglements',
    permission: 'platform.billing.read',
  },
  {
    key: 'platform-online-payments',
    label: 'Paiements en ligne',
    href: '/admin/paiements-en-ligne',
    permission: 'platform.billing.read',
  },
  {
    key: 'platform-cash',
    label: 'Caisse et remises',
    href: '/admin/caisse',
    permission: 'platform.billing.read',
  },
  {
    key: 'platform-demo-requests',
    label: 'Demandes de démo',
    href: '/admin/demandes-demo',
    permission: 'platform.demo.manage',
  },
  {
    key: 'platform-domains',
    label: 'Domaines',
    href: '/admin/domaines',
    permission: 'platform.domains.manage',
  },
  {
    key: 'platform-stats',
    label: 'Statistiques SaaS',
    href: '/admin/statistiques',
    permission: 'platform.dashboard',
  },
  {
    key: 'platform-ai',
    label: 'Consommation IA',
    href: '/admin/consommation-ia',
    permission: 'platform.dashboard',
  },
  {
    key: 'platform-storage',
    label: 'Stockage',
    href: '/admin/stockage',
    permission: 'platform.dashboard',
  },
  {
    key: 'platform-support',
    label: 'Support',
    href: '/admin/support',
    permission: 'platform.support.manage',
  },
  {
    key: 'platform-users',
    label: 'Comptes internes',
    href: '/admin/utilisateurs',
    permission: 'platform.users.manage',
  },
  {
    key: 'platform-audit',
    label: 'Journal d’audit',
    href: '/admin/audit',
    permission: 'platform.audit.read',
  },
  {
    key: 'platform-settings',
    label: 'Paramètres généraux',
    href: '/admin/parametres',
    permission: 'platform.settings.read',
  },
  {
    key: 'platform-security',
    label: 'Sécurité du compte',
    href: '/admin/securite',
    permission: null,
  },
];

/** Espace Ocall Suite : administration centrale, sans accès aux données métier des clients. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const me = await requireSuperAdminSession();
  const role = effectivePlatformRole(me.user.platformRole);
  const nav = NAV.filter((i) => !i.permission || me.platformPermissions.includes(i.permission)).map(
    ({ permission: _permission, ...item }) => item,
  );
  return (
    <AppShell
      me={me}
      nav={nav}
      context={{
        title: 'Ocall Suite',
        subtitle: role ? PLATFORM_ROLE_LABELS[role] : 'Administration',
      }}
      homeHref="/admin"
      headerNote="Données agrégées uniquement"
    >
      {children}
    </AppShell>
  );
}
