'use client';

import { useState } from 'react';
import {
  ISO_WEEKDAY_LABELS,
  type RestaurantAnalytics,
  type RestaurantHourly,
  formatXof,
} from '@ocall/shared';
import {
  BarChart,
  Section,
  StatTile,
  formatInt,
  hourLabel,
  shortDate,
} from '@/components/analytics/charts';
import { AnalyticsData, ExportLink } from '@/components/analytics/filters';
import { HeatmapSection } from '@/components/analytics/heatmap-section';
import { InputField, SelectField } from '@/components/ui/field';
import { Table, Td } from '@/components/ui/table';

type HourMetric = 'orders' | 'quantity' | 'revenue';
const HOUR_METRICS: Record<HourMetric, string> = {
  orders: 'Commandes',
  quantity: 'Quantités vendues',
  revenue: 'CA encaissé',
};

/** Statistiques restaurant : produits, catégories, heures, jours, carte thermique. */
export default function RestaurantAnalyticsPage() {
  return (
    <>
      <AnalyticsData<RestaurantAnalytics> path="/analytics/restaurant">
        {(d) => <Restaurant data={d} />}
      </AnalyticsData>
      <ProductHours />
      <RestaurantHeatmap />
    </>
  );
}

function Restaurant({ data: d }: { data: RestaurantAnalytics }) {
  const [metric, setMetric] = useState<HourMetric>('orders');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'revenue' | 'quantity'>('revenue');
  const products = d.products
    .filter((p) => `${p.product} ${p.category}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b[sort] - a[sort]);
  const ranked = [...d.products].sort((a, b) => b.quantity - a.quantity);
  const fmt = metric === 'revenue' ? formatXof : formatInt;
  return (
    <>
      <p className="text-sm text-muted">{d.meta.period.current.label}</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label="CA restaurant encaissé"
          value={d.totals.revenue.current}
          compared={d.totals.revenue}
          format={formatXof}
          testId="kpi-restaurant-revenue"
        />
        <StatTile
          label="Commandes"
          value={d.totals.orders.current}
          compared={d.totals.orders}
          hint="payées ou non, hors annulées"
        />
        <StatTile
          label="Articles vendus"
          value={d.totals.itemsSold.current}
          compared={d.totals.itemsSold}
        />
        <StatTile label="Panier moyen" value={d.totals.averageBasket.current} format={formatXof} />
        <StatTile
          label="Remises fidélité"
          value={d.totals.loyaltyDiscount}
          format={formatXof}
          hint="déjà déduites du CA encaissé"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Les plus vendus" description="Par quantité sur la période.">
          <RankList items={ranked.slice(0, 5)} empty="Aucune vente encaissée." />
        </Section>
        <Section
          title="Les moins vendus"
          description="Produits vendus en plus faible quantité, puis jamais vendus."
        >
          <RankList items={[...ranked].reverse().slice(0, 5)} empty="Aucune vente encaissée." />
          {d.unsold.length > 0 && (
            <p className="mt-3 text-sm text-muted" data-testid="unsold">
              Jamais vendus sur la période : {d.unsold.map((u) => u.product).join(', ')}
            </p>
          )}
        </Section>
      </div>

      <Section
        title="Ventes par heure"
        description="Heure locale de l’établissement : création pour les commandes, encaissement pour les quantités et le CA."
        action={
          <div className="w-44">
            <SelectField
              label="Indicateur"
              value={metric}
              onChange={(e) => setMetric(e.target.value as HourMetric)}
              options={Object.entries(HOUR_METRICS).map(([value, label]) => ({ value, label }))}
            />
          </div>
        }
      >
        <BarChart
          label={`${HOUR_METRICS[metric]} par heure`}
          data={d.hourly.map((h) => ({ key: h.hour, label: hourLabel(h.hour), value: h[metric] }))}
          format={fmt}
          labelEvery={3}
        />
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Évolution des ventes" description="CA encaissé par jour.">
          <BarChart
            label="CA encaissé par jour"
            data={d.daily.map((p) => ({ key: p.date, label: shortDate(p.date), value: p.revenue }))}
            format={formatXof}
            labelEvery={Math.max(1, Math.ceil(d.daily.length / 8))}
          />
        </Section>
        <Section title="Par jour de la semaine" description="CA encaissé, du lundi au dimanche.">
          <BarChart
            label="CA par jour de la semaine"
            data={d.weekdays.map((w) => ({
              key: w.weekday,
              label: ISO_WEEKDAY_LABELS[w.weekday - 1]!.slice(0, 3),
              value: w.revenue,
            }))}
            format={formatXof}
          />
        </Section>
      </div>

      <Section
        title="Ventes par produit"
        description="Prix des lignes, avant remises fidélité."
        action={<ExportLink report="restaurant-products" />}
      >
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <InputField
            label="Filtrer"
            placeholder="Produit ou catégorie"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <SelectField
            label="Trier par"
            value={sort}
            onChange={(e) => setSort(e.target.value as 'revenue' | 'quantity')}
            options={[
              { value: 'revenue', label: 'CA' },
              { value: 'quantity', label: 'Quantité' },
            ]}
          />
        </div>
        <Table head={['Produit', 'Catégorie', 'Quantité', 'CA']}>
          {products.map((p) => (
            <tr key={p.productId ?? p.product} data-testid="product-row">
              <Td className="font-medium">{p.product}</Td>
              <Td>{p.category}</Td>
              <Td className="tabular-nums">{formatInt(p.quantity)}</Td>
              <Td className="tabular-nums">{formatXof(p.revenue)}</Td>
            </tr>
          ))}
        </Table>
        {products.length === 0 && <p className="px-2 py-4 text-sm text-muted">Aucun produit.</p>}
        {d.categories.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-2 text-sm font-semibold">CA par catégorie</h3>
            <ul className="space-y-2">
              {d.categories.map((c) => {
                const max = d.categories[0]!.revenue || 1;
                return (
                  <li
                    key={c.category}
                    className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 text-sm"
                  >
                    <span className="truncate">{c.category}</span>
                    <span className="h-2.5 rounded-full bg-ivory-dark/60">
                      <span
                        className="block h-full rounded-full bg-forest"
                        style={{ width: `${(c.revenue / max) * 100}%` }}
                      />
                    </span>
                    <span className="tabular-nums">{formatXof(c.revenue)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Section>
    </>
  );
}

function RankList({ items, empty }: { items: RestaurantAnalytics['products']; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ol className="space-y-2">
      {items.map((p, i) => (
        <li
          key={p.productId ?? p.product}
          className="flex items-center justify-between gap-3 text-sm"
        >
          <span className="min-w-0 truncate">
            <span className="mr-2 text-muted">{i + 1}.</span>
            {p.product}
          </span>
          <span className="shrink-0 tabular-nums text-muted">
            {formatInt(p.quantity)} · {formatXof(p.revenue)}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Ventes par produit et par heure (« combien de poulets braisés entre 12 h et 13 h ? »), filtrables
 * par produit, plage horaire et jour de la semaine, avec comparaison à une autre journée.
 */
function ProductHours() {
  const [hourFrom, setHourFrom] = useState(0);
  const [hourTo, setHourTo] = useState(24);
  const [weekday, setWeekday] = useState('');
  const [productId, setProductId] = useState('');
  const [compareDay, setCompareDay] = useState('');
  const extra = { hourFrom, hourTo, weekday, productId };
  const hours = Array.from({ length: 25 }, (_, h) => h);
  return (
    <Section
      title="Ventes par produit et par heure"
      description="Heure locale d’encaissement. Exemple : quantités d’un produit entre 12 h et 13 h."
      action={<ExportLink report="restaurant-hourly" extra={extra} />}
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SelectField
          label="De"
          value={String(hourFrom)}
          onChange={(e) => setHourFrom(Number(e.target.value))}
          options={hours.slice(0, 24).map((h) => ({ value: String(h), label: hourLabel(h) }))}
        />
        <SelectField
          label="À"
          value={String(hourTo)}
          onChange={(e) => setHourTo(Number(e.target.value))}
          options={hours.slice(1).map((h) => ({ value: String(h), label: hourLabel(h) }))}
        />
        <SelectField
          label="Jour"
          value={weekday}
          onChange={(e) => setWeekday(e.target.value)}
          options={[
            { value: '', label: 'Tous les jours' },
            ...ISO_WEEKDAY_LABELS.map((l, i) => ({ value: String(i + 1), label: l })),
          ]}
        />
        <AnalyticsData<RestaurantAnalytics> path="/analytics/restaurant">
          {(d) => (
            <SelectField
              label="Produit"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              options={[
                { value: '', label: 'Tous les produits' },
                ...d.products.flatMap((p) =>
                  p.productId ? [{ value: p.productId, label: p.product }] : [],
                ),
              ]}
            />
          )}
        </AnalyticsData>
        <InputField
          label="Comparer avec le"
          type="date"
          value={compareDay}
          onChange={(e) => setCompareDay(e.target.value)}
        />
      </div>
      {hourTo <= hourFrom ? (
        <p className="text-sm text-terracotta-dark">L’heure de fin doit suivre l’heure de début.</p>
      ) : (
        <div className={`grid gap-5 ${compareDay ? 'lg:grid-cols-2' : ''}`}>
          <AnalyticsData<RestaurantHourly> path="/analytics/restaurant/hourly" extra={extra}>
            {(d) => <HourlyResult data={d} title={d.meta.period.current.label} />}
          </AnalyticsData>
          {compareDay && (
            <AnalyticsData<RestaurantHourly>
              path="/analytics/restaurant/hourly"
              extra={{ ...extra, period: 'custom', from: compareDay, to: compareDay }}
            >
              {(d) => (
                <HourlyResult data={d} title={`Comparaison : ${d.meta.period.current.label}`} />
              )}
            </AnalyticsData>
          )}
        </div>
      )}
    </Section>
  );
}

function HourlyResult({ data: d, title }: { data: RestaurantHourly; title: string }) {
  const totalQty = d.hours.reduce((s, h) => s + h.quantity, 0);
  const totalRevenue = d.hours.reduce((s, h) => s + h.revenue, 0);
  return (
    <div className="min-w-0 space-y-3" data-testid="hourly-result">
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-sm">
        <span data-testid="hourly-quantity">{formatInt(totalQty)}</span> article(s) ·{' '}
        {formatXof(totalRevenue)}
      </p>
      <BarChart
        label="Quantités par heure"
        data={d.hours.map((h) => ({ key: h.hour, label: hourLabel(h.hour), value: h.quantity }))}
        labelEvery={d.hours.length > 12 ? 3 : 1}
        height={120}
      />
      <Table head={['Heure', 'Produit', 'Quantité', 'CA']}>
        {d.rows.map((r) => (
          <tr key={`${r.hour}-${r.productId ?? r.product}`} data-testid="hourly-row">
            <Td>{hourLabel(r.hour)}</Td>
            <Td className="font-medium">{r.product}</Td>
            <Td className="tabular-nums">{formatInt(r.quantity)}</Td>
            <Td className="tabular-nums">{formatXof(r.revenue)}</Td>
          </tr>
        ))}
      </Table>
      {d.rows.length === 0 && <p className="text-sm text-muted">Aucune vente sur ces heures.</p>}
    </div>
  );
}

/** Carte thermique du restaurant : commandes, quantités ou CA — jamais mélangés aux entrées du parc. */
function RestaurantHeatmap() {
  const [metric, setMetric] = useState<HourMetric>('orders');
  return (
    <HeatmapSection
      metric={metric}
      onMetric={(m) => setMetric(m as HourMetric)}
      metrics={HOUR_METRICS}
    />
  );
}
