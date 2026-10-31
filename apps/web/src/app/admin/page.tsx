'use client';

import { Building2, CreditCard, TrendingUp, Users } from 'lucide-react';
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  type SubscriptionStatus,
  formatXof,
} from '@ocall/shared';
import { CommercialDashboard } from '@/components/admin/commercial-dashboard';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingState } from '@/components/ui/states';
import type { PlatformOverview } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function AdminOverviewPage() {
  const overview = useApi<PlatformOverview>('/platform/overview');
  return (
    <>
      <PageHeader
        eyebrow="Ocall Suite"
        title="Tableau de bord commercial"
        description="Encaissements validés, facturation et abonnements, calculés sur les données réelles."
      />
      <CommercialDashboard />
      <h2 className="mb-4 mt-10 text-lg font-semibold">Activité de la plateforme</h2>
      {overview.state === 'loading' && <LoadingState />}
      {overview.state === 'error' && (
        <ErrorState error={overview.error} onRetry={overview.reload} />
      )}
      {overview.state === 'success' && <OverviewContent data={overview.data} />}
    </>
  );
}

function Breakdown({ title, entries }: { title: string; entries: [string, number][] }) {
  const total = entries.reduce((s, [, n]) => s + n, 0);
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        {total === 0 ? (
          <p className="text-sm text-muted">Aucune donnée pour le moment.</p>
        ) : (
          <ul className="space-y-3">
            {entries.map(([label, n]) => (
              <li key={label}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{label}</span>
                  <span className="font-semibold">{n}</span>
                </div>
                <div className="h-2 rounded-full bg-ivory-dark/70">
                  <div
                    className="h-2 rounded-full bg-forest"
                    style={{ width: `${(n / total) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function OverviewContent({ data }: { data: PlatformOverview }) {
  const active = data.organizations.byStatus.ACTIVE ?? 0;
  const activeSubs = data.subscriptions.byStatus.ACTIVE ?? 0;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Organisations"
          value={data.organizations.total}
          hint={`${active} actives`}
          icon={<Building2 className="h-5 w-5" />}
        />
        <KpiCard
          label="Comptes actifs"
          value={data.activeAccounts}
          icon={<Users className="h-5 w-5" />}
          accent="savanna"
        />
        <KpiCard
          label="Abonnements actifs"
          value={activeSubs}
          icon={<CreditCard className="h-5 w-5" />}
          accent="terracotta"
        />
        <KpiCard
          label="Revenu mensuel récurrent"
          value={
            <span className="text-xl sm:text-2xl">{formatXof(data.monthlyRecurringRevenue)}</span>
          }
          hint="Abonnements actifs"
          icon={<TrendingUp className="h-5 w-5" />}
        />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Breakdown
          title="Organisations par métier"
          entries={BUSINESS_TYPES.map((t) => [
            BUSINESS_TYPE_LABELS[t],
            data.organizations.byBusinessType[t] ?? 0,
          ])}
        />
        <Breakdown
          title="Abonnements par statut"
          entries={(Object.keys(SUBSCRIPTION_STATUS_LABELS) as SubscriptionStatus[]).map((s) => [
            SUBSCRIPTION_STATUS_LABELS[s],
            data.subscriptions.byStatus[s] ?? 0,
          ])}
        />
      </div>
    </div>
  );
}
