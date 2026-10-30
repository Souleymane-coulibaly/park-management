'use client';

import {
  ISO_WEEKDAY_LABELS,
  type ParkAnalytics,
  SCAN_REFUSAL_LABELS,
  type ScanRefusalReason,
  formatXof,
} from '@ocall/shared';
import {
  BarChart,
  CompareLineChart,
  Section,
  StatTile,
  formatInt,
  formatPct,
  hourLabel,
} from '@/components/analytics/charts';
import { AnalyticsData, ExportLink } from '@/components/analytics/filters';
import { HeatmapSection } from '@/components/analytics/heatmap-section';
import { Table, Td } from '@/components/ui/table';

/**
 * Statistiques du parc. Billet vendu ≠ payé ≠ émis ≠ scanné : chaque notion a son indicateur, et
 * une tentative de scan refusée n'est jamais une entrée.
 */
export default function ParkAnalyticsPage() {
  return (
    <>
      <AnalyticsData<ParkAnalytics> path="/analytics/park">
        {(d) => <Park data={d} />}
      </AnalyticsData>
      <HeatmapSection
        metric="entries"
        onMetric={() => undefined}
        metrics={{ entries: 'Entrées du parc (scans acceptés)' }}
      />
    </>
  );
}

function Park({ data: d }: { data: ParkAnalytics }) {
  const t = d.totals;
  return (
    <>
      <p className="text-sm text-muted">{d.meta.period.current.label}</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Recettes de billetterie"
          value={t.revenue.current}
          compared={t.revenue}
          format={formatXof}
          testId="kpi-park-revenue"
        />
        <StatTile
          label="Billets vendus"
          value={t.soldUnits.current}
          compared={t.soldUnits}
          hint="unités, payées ou non"
          testId="kpi-sold"
        />
        <StatTile
          label="Billets payés"
          value={t.paidUnits.current}
          compared={t.paidUnits}
          hint="unités encaissées"
          testId="kpi-paid"
        />
        <StatTile
          label="Billets émis"
          value={t.issued.current}
          compared={t.issued}
          hint={`un par personne · ${formatInt(t.cancelledTickets)} annulé(s)`}
          testId="kpi-issued"
        />
        <StatTile
          label="Billets scannés (entrées)"
          value={t.scanned.current}
          compared={t.scanned}
          hint="scans acceptés uniquement"
          testId="kpi-scanned"
        />
        <StatTile
          label="Taux de billets utilisés"
          value={t.usageRate}
          format={(n) => formatPct(n)}
          hint="billets émis sur la période déjà utilisés"
        />
        <StatTile
          label="Scans refusés"
          value={t.refusedScans.total}
          testId="kpi-refused"
          hint={
            t.refusedScans.total > 0
              ? Object.entries(t.refusedScans.byReason)
                  .map(([r, n]) => `${SCAN_REFUSAL_LABELS[r as ScanRefusalReason] ?? r} : ${n}`)
                  .join(' · ')
              : 'jamais comptés comme entrées'
          }
        />
      </div>

      <Section
        title="Fréquentation par jour"
        description="Entrées réelles (scans acceptés), comparées à la période précédente."
      >
        <CompareLineChart
          current={d.daily.map((p) => ({ date: p.date, value: p.entries }))}
          previous={d.previousDaily.map((p) => ({ date: p.date, value: p.entries }))}
          format={formatInt}
          label="Entrées par jour"
        />
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Fréquentation par heure" description="Heure locale du scan accepté.">
          <BarChart
            color="terracotta"
            label="Entrées par heure"
            data={d.hourly.map((h) => ({
              key: h.hour,
              label: hourLabel(h.hour),
              value: h.entries,
            }))}
            labelEvery={3}
          />
        </Section>
        <Section title="Par jour de la semaine" description="Entrées, du lundi au dimanche.">
          <BarChart
            color="terracotta"
            label="Entrées par jour de la semaine"
            data={d.weekdays.map((w) => ({
              key: w.weekday,
              label: ISO_WEEKDAY_LABELS[w.weekday - 1]!.slice(0, 3),
              value: w.entries,
            }))}
          />
        </Section>
      </div>

      <Section
        title="Catégories de billets"
        description="Une formule famille compte pour une unité vendue et émet un billet par personne."
        action={<ExportLink report="park" />}
      >
        <Table head={['Catégorie', 'Vendus', 'Payés', 'Émis', 'Scannés', 'Recettes']}>
          {d.categories.map((c) => (
            <tr key={c.categoryId} data-testid="ticket-category-row">
              <Td className="font-medium">{c.category}</Td>
              <Td className="tabular-nums">{formatInt(c.soldUnits)}</Td>
              <Td className="tabular-nums">{formatInt(c.paidUnits)}</Td>
              <Td className="tabular-nums">{formatInt(c.issued)}</Td>
              <Td className="tabular-nums">{formatInt(c.scanned)}</Td>
              <Td className="tabular-nums">{formatXof(c.revenue)}</Td>
            </tr>
          ))}
        </Table>
        {d.categories.length === 0 && (
          <p className="px-2 py-4 text-sm text-muted">Aucune vente de billets sur la période.</p>
        )}
      </Section>
    </>
  );
}
