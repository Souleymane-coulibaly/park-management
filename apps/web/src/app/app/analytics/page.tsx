'use client';

import { type AnalyticsOverview, formatXof } from '@ocall/shared';
import {
  CompareLineChart,
  Delta,
  Section,
  StatTile,
  formatInt,
} from '@/components/analytics/charts';
import { AnalyticsData, ExportLink } from '@/components/analytics/filters';

const ACTIVITY = { RESTAURANT: 'Restaurant', PARK: 'Parc' } as const;

/** Vue globale : CA encaissé, transactions, panier moyen, commandes, visiteurs, Parc / Restaurant. */
export default function AnalyticsOverviewPage() {
  return (
    <AnalyticsData<AnalyticsOverview> path="/analytics/overview">
      {(d) => <Overview data={d} />}
    </AnalyticsData>
  );
}

function Overview({ data: d }: { data: AnalyticsOverview }) {
  const activities = Object.entries(d.byActivity) as [
    keyof typeof ACTIVITY,
    NonNullable<AnalyticsOverview['byActivity']['PARK']>,
  ][];
  const total = d.revenue.current;
  return (
    <>
      <p className="text-sm text-muted" data-testid="analytics-period">
        {d.meta.period.current.label} · comparé à : {d.meta.period.previous.label}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label="CA encaissé"
          value={d.revenue.current}
          compared={d.revenue}
          format={formatXof}
          testId="kpi-revenue"
        />
        <StatTile label="Transactions payées" value={d.paidSales.current} compared={d.paidSales} />
        <StatTile
          label="Panier moyen"
          value={d.averageBasket.current}
          format={formatXof}
          hint={
            d.averageBasket.previous !== null
              ? `précédent : ${formatXof(d.averageBasket.previous)}`
              : undefined
          }
        />
        {d.orders && (
          <StatTile
            label="Commandes restaurant"
            value={d.orders.current}
            compared={d.orders}
            hint="payées ou non, hors annulées"
          />
        )}
        {d.visitors && (
          <StatTile
            label="Visiteurs entrés"
            value={d.visitors.current}
            compared={d.visitors}
            hint="scans acceptés uniquement"
            testId="kpi-visitors"
          />
        )}
      </div>

      <Section
        title="Évolution du chiffre d’affaires"
        description="CA encaissé par jour, comparé à la période précédente."
        action={<ExportLink report="overview" />}
      >
        <CompareLineChart
          current={d.daily.current}
          previous={d.daily.previous}
          label="Chiffre d’affaires encaissé par jour"
        />
      </Section>

      {activities.length > 1 && (
        <Section
          title="Répartition Parc / Restaurant"
          description="Les deux activités ne sont jamais mélangées : chacune a ses propres recettes."
        >
          <div className="space-y-4">
            <div className="flex h-3 overflow-hidden rounded-full bg-ivory-dark/60" aria-hidden>
              {activities.map(([a, t]) => (
                <span
                  key={a}
                  className={`${a === 'RESTAURANT' ? 'bg-forest' : 'bg-terracotta'} border-r-2 border-surface last:border-r-0`}
                  style={{ width: total > 0 ? `${(t.revenue.current / total) * 100}%` : '0%' }}
                />
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {activities.map(([a, t]) => (
                <div
                  key={a}
                  className="flex items-start gap-3 rounded-xl bg-ivory/60 p-3"
                  data-testid={`activity-${a}`}
                >
                  <span
                    className={`mt-1.5 h-3 w-3 shrink-0 rounded-sm ${a === 'RESTAURANT' ? 'bg-forest' : 'bg-terracotta'}`}
                    aria-hidden
                  />
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold">{ACTIVITY[a]}</p>
                    <p className="font-display text-xl font-bold">{formatXof(t.revenue.current)}</p>
                    <p className="text-muted">
                      {total > 0
                        ? `${Math.round((t.revenue.current / total) * 1000) / 10} % du CA`
                        : '—'}{' '}
                      · {formatInt(t.paidSales.current)} transaction(s) ·{' '}
                      <Delta change={t.revenue.change} />
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>
      )}
    </>
  );
}
