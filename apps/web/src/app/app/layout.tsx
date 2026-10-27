import type { ReactNode } from 'react';
import { BUSINESS_TYPE_LABELS } from '@ocall/shared';
import { AppShell, type NavItem } from '@/components/app/app-shell';
import { requireMemberSession } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/**
 * Espace client : la session est vérifiée côté serveur avant tout rendu, et la navigation
 * vient de l'API (calculée selon le métier et le rôle). Un module « à venir » ouvre sa page
 * dédiée, dont l'accès est lui aussi vérifié par l'API.
 */
export default async function MemberLayout({ children }: { children: ReactNode }) {
  const me = await requireMemberSession();
  const org = me.organization!;
  const nav: NavItem[] = me.navigation.map((item) => ({
    key: item.key,
    label: item.label,
    href: item.href ?? `/app/modules/${item.key}`,
    upcoming: item.status === 'upcoming',
  }));
  return (
    <AppShell
      me={me}
      nav={nav}
      context={{ title: org.name, subtitle: BUSINESS_TYPE_LABELS[org.businessType] }}
      homeHref="/app"
      accountHref="/app/compte"
      headerNote={
        <>
          Fuseau : <span className="font-medium text-charcoal">{org.timezone}</span>
        </>
      }
    >
      {children}
    </AppShell>
  );
}
