'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { AnalyticsScopeInfo } from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { AnalyticsFilters, AnalyticsProvider } from '@/components/analytics/filters';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

/** Analyses : onglets et filtres communs (période, établissement, activité). */
export default function AnalyticsLayout({ children }: { children: ReactNode }) {
  const canRead = useCan('analytics.read');
  if (!canRead) return <AccessDenied />;
  return <AnalyticsShell>{children}</AnalyticsShell>;
}

function AnalyticsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const scope = useApi<AnalyticsScopeInfo>('/analytics/scope');
  if (scope.state === 'loading') return <LoadingState />;
  if (scope.state === 'error') return <ErrorState error={scope.error} onRetry={scope.reload} />;
  const s = scope.data;
  const tabs = [
    { href: '/app/analytics', label: 'Vue globale', show: true },
    {
      href: '/app/analytics/restaurant',
      label: 'Restaurant',
      show: s.activities.includes('RESTAURANT'),
    },
    { href: '/app/analytics/parc', label: 'Parc', show: s.activities.includes('PARK') },
    {
      href: '/app/analytics/marges',
      label: 'Coûts et marges',
      show: s.canSeeMargins && s.activities.includes('RESTAURANT'),
    },
    {
      href: '/app/analytics/etablissements',
      label: 'Établissements',
      show: s.establishments.length > 1,
    },
  ].filter((t) => t.show);
  // L'activité est implicite sur les onglets Restaurant, Parc et Marges.
  const showActivity =
    pathname === '/app/analytics' || pathname === '/app/analytics/etablissements';

  return (
    <AnalyticsProvider scope={s}>
      <PageHeader
        eyebrow="Analyses"
        title="Statistiques et rentabilité"
        description={`Chiffres calculés uniquement sur vos ventes, paiements et entrées enregistrés. Heures locales de chaque établissement · montants en FCFA TTC.`}
      />
      <nav className="-mx-1 mb-4 flex gap-1 overflow-x-auto pb-1" aria-label="Analyses">
        {tabs.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                active
                  ? 'bg-forest text-white'
                  : 'bg-surface text-charcoal ring-1 ring-line hover:bg-ivory'
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <div className="mb-5">
        <AnalyticsFilters showActivity={showActivity} />
      </div>
      <div className="space-y-5">{children}</div>
    </AnalyticsProvider>
  );
}
