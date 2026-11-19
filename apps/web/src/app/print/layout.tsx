import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppShell, type NavItem } from '@/components/app/app-shell';
import { requireMemberSession } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const NAV: NavItem[] = [
  { key: 'print-home', label: 'Accueil', href: '/print' },
  { key: 'print-persons', label: 'Fiches et cartes', href: '/print/fiches' },
  { key: 'print-templates', label: 'Modèles', href: '/print/modeles' },
  { key: 'print-orders', label: 'Commandes', href: '/print/commandes' },
  { key: 'print-verify', label: 'Vérifier une carte', href: '/print/verifier' },
];

/**
 * Ocall Print en accès autonome, gratuit, pour les écoles et entreprises sans Ocall School : propriétaire
 * et administrateurs de l'organisation. Les droits réels sont décidés par l'API à chaque requête.
 */
export default async function PrintLayout({ children }: { children: ReactNode }) {
  const me = await requireMemberSession();
  return (
    <AppShell
      me={me}
      nav={NAV}
      context={{ title: me.organization!.name, subtitle: 'Ocall Print' }}
      homeHref="/print"
      appsHref="/suite"
      accountHref="/suite"
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
