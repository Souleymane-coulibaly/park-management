import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppShell, type NavItem } from '@/components/app/app-shell';
import { requireMemberSession } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const NAV: NavItem[] = [
  { key: 'facture-home', label: 'Tableau de bord', href: '/facture' },
  { key: 'facture-documents', label: 'Documents', href: '/facture/documents' },
  { key: 'facture-clients', label: 'Clients', href: '/facture/clients' },
  { key: 'facture-catalog', label: 'Catalogue', href: '/facture/catalogue' },
  { key: 'facture-settings', label: 'Entreprise et mentions', href: '/facture/parametres' },
  { key: 'facture-team', label: 'Équipe', href: '/facture/equipe' },
];

/** Application Ocall Facture. Le droit d'accès réel est décidé par l'API à chaque requête. */
export default async function FactureLayout({ children }: { children: ReactNode }) {
  const me = await requireMemberSession();
  return (
    <AppShell
      me={me}
      nav={NAV}
      context={{ title: me.organization!.name, subtitle: 'Ocall Facture' }}
      homeHref="/facture"
      accountHref="/facture/compte"
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
