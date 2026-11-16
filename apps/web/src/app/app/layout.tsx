import Link from 'next/link';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { BUSINESS_TYPE_LABELS } from '@ocall/shared';
import { AppShell, type NavItem } from '@/components/app/app-shell';
import { ParkMobileNav } from '@/components/park/park-mobile-nav';
import { PwaRuntime } from '@/components/pwa/pwa-runtime';
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
  if (org.businessType === 'NONE' || me.role === 'PRODUCT_USER') redirect('/suite');
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
      appsHref="/suite"
      homeHref="/app"
      accountHref="/app/compte"
      wideRoutes={['/app/caisse']}
      mobileExtras={
        <>
          <ParkMobileNav moduleHrefs={nav.filter((n) => !n.upcoming).map((n) => n.href)} />
          <PwaRuntime />
        </>
      }
      headerNote={
        <>
          Fuseau : <span className="font-medium text-charcoal">{org.timezone}</span>
          {' · '}
          <Link href="/suite" className="font-medium text-forest hover:underline">
            Mes applications
          </Link>
        </>
      }
    >
      <ActivityAccessNotice access={me.activityAccess ?? {}} />
      {children}
    </AppShell>
  );
}

/**
 * Sprint 7 : Ocall Parc et Ocall Restaurant ont des droits distincts ; une partie en lecture seule (essai
 * échu, abonnement absent ou suspendu) n'empêche pas d'écrire dans l'autre. Données toujours conservées.
 */
function ActivityAccessNotice({
  access,
}: {
  access: Partial<Record<'PARK' | 'RESTAURANT', 'full' | 'read_only' | 'none'>>;
}) {
  const readOnly = (['PARK', 'RESTAURANT'] as const).filter((a) => access[a] === 'read_only');
  if (readOnly.length === 0) return null;
  const names = readOnly.map((a) => (a === 'PARK' ? 'Ocall Parc' : 'Ocall Restaurant'));
  return (
    <div
      className="mb-4 rounded-xl border border-savanna/40 bg-savanna/10 px-4 py-3 text-sm text-charcoal"
      role="status"
      data-testid="activity-read-only"
    >
      {names.join(' et ')} : consultation seule (essai échu ou abonnement inactif). Vos données sont
      conservées ;{' '}
      <Link href="/suite" className="font-semibold text-forest hover:underline">
        activez l’abonnement depuis le portail
      </Link>
      .
    </div>
  );
}
