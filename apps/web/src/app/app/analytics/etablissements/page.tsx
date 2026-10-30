'use client';

import { type EstablishmentsAnalytics, formatXof } from '@ocall/shared';
import { Delta, Section, formatInt } from '@/components/analytics/charts';
import { AnalyticsData, ExportLink } from '@/components/analytics/filters';
import { Table, Td } from '@/components/ui/table';

const orDash = (n: number | null, f: (n: number) => string = formatInt) =>
  n === null ? '—' : f(n);

/** Comparaison des établissements accessibles et consolidation de l'organisation. */
export default function EstablishmentsAnalyticsPage() {
  return (
    <AnalyticsData<EstablishmentsAnalytics> path="/analytics/establishments">
      {(d) => <Comparison data={d} />}
    </AnalyticsData>
  );
}

function Comparison({ data: d }: { data: EstablishmentsAnalytics }) {
  const max = Math.max(1, ...d.rows.map((r) => r.revenue.current));
  const c = d.consolidated;
  return (
    <>
      <Section
        title="Chiffre d’affaires par établissement"
        description={d.meta.period.current.label}
        action={<ExportLink report="establishments" />}
      >
        <ul className="space-y-3">
          {d.rows.map((r) => (
            <li key={r.establishmentId} className="space-y-1" data-testid="establishment-row">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-semibold">{r.establishment}</span>
                <span className="tabular-nums">
                  {formatXof(r.revenue.current)} · <Delta change={r.revenue.change} />
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-ivory-dark/60" aria-hidden>
                <div
                  className="h-full rounded-full bg-forest"
                  style={{ width: `${(r.revenue.current / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Indicateurs comparés"
        description="Une ligne par établissement, puis la consolidation de l’organisation."
      >
        <Table
          head={[
            'Établissement',
            'CA encaissé',
            'Transactions',
            'Panier moyen',
            'Commandes',
            'Articles',
            'Visiteurs',
          ]}
        >
          {d.rows.map((r) => (
            <tr key={r.establishmentId}>
              <Td className="font-medium">{r.establishment}</Td>
              <Td className="tabular-nums">{formatXof(r.revenue.current)}</Td>
              <Td className="tabular-nums">{formatInt(r.paidSales.current)}</Td>
              <Td className="tabular-nums">{orDash(r.averageBasket, formatXof)}</Td>
              <Td className="tabular-nums">{orDash(r.orders)}</Td>
              <Td className="tabular-nums">{orDash(r.itemsSold)}</Td>
              <Td className="tabular-nums">{orDash(r.visitors)}</Td>
            </tr>
          ))}
          <tr className="bg-ivory/60 font-semibold" data-testid="consolidated-row">
            <Td>Total organisation</Td>
            <Td className="tabular-nums">{formatXof(c.revenue.current)}</Td>
            <Td className="tabular-nums">{formatInt(c.paidSales.current)}</Td>
            <Td className="tabular-nums">{orDash(c.averageBasket, formatXof)}</Td>
            <Td className="tabular-nums">{orDash(c.orders)}</Td>
            <Td className="tabular-nums">{orDash(c.itemsSold)}</Td>
            <Td className="tabular-nums">{orDash(c.visitors)}</Td>
          </tr>
        </Table>
      </Section>

      {d.topProducts.length > 0 && (
        <Section
          title="Produits les plus vendus par établissement"
          description="Quantités encaissées sur la période."
        >
          <Table
            head={[
              'Produit',
              ...d.rows.filter((r) => r.itemsSold !== null).map((r) => r.establishment),
              'Total',
            ]}
          >
            {d.topProducts.map((p) => (
              <tr key={p.product}>
                <Td className="font-medium">{p.product}</Td>
                {d.rows
                  .filter((r) => r.itemsSold !== null)
                  .map((r) => (
                    <Td key={r.establishmentId} className="tabular-nums">
                      {formatInt(p.byEstablishment[r.establishmentId] ?? 0)}
                    </Td>
                  ))}
                <Td className="tabular-nums font-semibold">{formatInt(p.total)}</Td>
              </tr>
            ))}
          </Table>
        </Section>
      )}
    </>
  );
}
