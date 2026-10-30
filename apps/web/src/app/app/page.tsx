'use client';

import Link from 'next/link';
import {
  Building2,
  CalendarClock,
  CreditCard,
  Layers,
  TrendingUp,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  BUSINESS_TYPE_LABELS,
  ROLE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  formatXof,
  type MemberRole,
} from '@ocall/shared';
import { useSession } from '@/components/app/session-context';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { actionLabel, formatDateTime } from '@/lib/format';
import type { DashboardSummary } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const REVENUE_SOURCES = {
  PARK: { label: 'Revenus Parc' },
  RESTAURANT: { label: 'Revenus Restaurant' },
} as const;

export default function DashboardPage() {
  const me = useSession();
  const summary = useApi<DashboardSummary>('/dashboard');

  return (
    <>
      <PageHeader
        eyebrow={me.organization ? BUSINESS_TYPE_LABELS[me.organization.businessType] : undefined}
        title={`Bonjour ${me.user.firstName}`}
        description={`Vue d’ensemble de ${me.organization?.name ?? 'votre organisation'}.`}
      />
      {summary.state === 'loading' && <LoadingState />}
      {summary.state === 'error' && <ErrorState error={summary.error} onRetry={summary.reload} />}
      {summary.state === 'success' && <DashboardContent data={summary.data} />}
    </>
  );
}

function DashboardContent({ data }: { data: DashboardSummary }) {
  const me = useSession();
  const sub = data.subscription;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Établissements actifs"
          value={data.establishments.active}
          hint={`${data.establishments.total} au total`}
          icon={<Building2 className="h-5 w-5" />}
        />
        {data.employees && (
          <KpiCard
            label="Comptes actifs"
            value={data.employees.active}
            hint={`${data.employees.total} au total`}
            icon={<Users className="h-5 w-5" />}
            accent="savanna"
          />
        )}
        {sub && (
          <KpiCard
            label="Abonnement"
            value={
              <span className="text-xl sm:text-2xl">{SUBSCRIPTION_STATUS_LABELS[sub.status]}</span>
            }
            hint={`Offre ${sub.plan.name} · ${formatXof(sub.plan.monthlyPrice)}/mois`}
            icon={<CreditCard className="h-5 w-5" />}
            accent="terracotta"
          />
        )}
        <KpiCard
          label="Métier"
          value={
            <span className="text-xl sm:text-2xl">
              {me.organization && BUSINESS_TYPE_LABELS[me.organization.businessType]}
            </span>
          }
          hint={`${me.navigation.filter((n) => n.status === 'upcoming').length} modules à venir`}
          icon={<Layers className="h-5 w-5" />}
        />
      </div>

      <div className={`grid gap-4 ${data.activities.length > 1 ? 'md:grid-cols-2' : ''}`}>
        {data.activities.map((activity) => {
          const source = REVENUE_SOURCES[activity];
          const revenue = data.revenue[activity];
          if (revenue) {
            return (
              <Card key={activity}>
                <CardHeader
                  title={source.label}
                  description="Ventes encaissées (hors ventes annulées ou non payées)."
                />
                <CardBody className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted">Aujourd’hui</p>
                    <p
                      className="font-display text-2xl font-bold"
                      data-testid={`revenue-${activity}-today`}
                    >
                      {formatXof(revenue.today)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted">30 derniers jours</p>
                    <p className="font-display text-2xl font-bold">
                      {formatXof(revenue.last30Days)}
                    </p>
                    <p className="text-xs text-muted">
                      {revenue.paidSalesLast30Days} vente(s) payée(s)
                    </p>
                  </div>
                </CardBody>
              </Card>
            );
          }
          // Revenus absents : le membre n'a pas la permission de consulter toutes les ventes.
          return (
            <Card key={activity}>
              <CardHeader
                title={source.label}
                description="Chiffre d’affaires par jour et sur 30 jours."
              />
              <EmptyState
                icon={<TrendingUp className="h-7 w-7" />}
                title="Revenus réservés aux responsables"
                description="Le chiffre d’affaires est visible par les propriétaires, administrateurs et superviseurs."
              />
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {data.recentActivity && (
          <Card>
            <CardHeader
              title="Activité récente"
              action={
                <Link
                  href="/app/journal"
                  className="text-sm font-semibold text-forest hover:underline"
                >
                  Tout voir
                </Link>
              }
            />
            {data.recentActivity.length === 0 ? (
              <EmptyState
                icon={<CalendarClock className="h-7 w-7" />}
                title="Aucune activité"
                description="Les actions de votre équipe apparaîtront ici."
              />
            ) : (
              <ul className="divide-y divide-line/70">
                {data.recentActivity.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-3 px-6 py-3 text-sm"
                  >
                    <span className="font-medium">{actionLabel(a.action)}</span>
                    <span className="text-muted">{formatDateTime(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {data.employees && (
          <Card>
            <CardHeader title="Équipe par rôle" />
            <CardBody>
              {Object.keys(data.employees.byRole).length === 0 ? (
                <p className="text-sm text-muted">Aucun compte actif.</p>
              ) : (
                <ul className="space-y-3">
                  {(Object.entries(data.employees.byRole) as [MemberRole, number][]).map(
                    ([role, count]) => (
                      <li key={role} className="flex items-center justify-between text-sm">
                        <span>{ROLE_LABELS[role]}</span>
                        <span className="rounded-full bg-forest-light px-2.5 py-0.5 font-semibold text-forest-dark">
                          {count}
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              )}
              {me.permissions.includes('employee.manage') && (
                <ButtonLink
                  href="/app/employes"
                  variant="secondary"
                  size="sm"
                  className="mt-5 w-full"
                >
                  <UserPlus className="h-4 w-4" /> Gérer les employés
                </ButtonLink>
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
