'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import {
  type AnalyticsPeriod,
  ORG_REPORT_UNASSIGNED,
  ORG_REPORT_UNASSIGNED_LABEL,
  type OrgReportBlock,
  type OrgReportMetric,
  type OrganizationReport,
  formatMoneyLabel,
  orgReportChange,
} from '@ocall/shared';
import { PeriodFields } from '@/components/analytics/filters';
import { StatTile, formatInt } from '@/components/analytics/charts';
import { SuiteShell } from '@/components/suite/suite-shell';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

interface Filters {
  period: AnalyticsPeriod;
  from: string;
  to: string;
  establishmentId: string;
}

/** Valeur lisible d'un indicateur : montant dans sa devise, ou nombre. */
function formatMetric(metric: Pick<OrgReportMetric, 'currency'>, value: number): string {
  return metric.currency ? formatMoneyLabel(value, metric.currency) : formatInt(value);
}

/** Paramètres de la période et du filtre, pour l'API et les liens vers les rapports détaillés. */
function queryOf(f: Filters): string {
  const params = new URLSearchParams({ period: f.period });
  if (f.period === 'custom') {
    if (f.from) params.set('from', f.from);
    if (f.to) params.set('to', f.to);
  }
  if (f.establishmentId) params.set('establishmentId', f.establishmentId);
  return params.toString();
}

/**
 * Tableau de bord de l'organisation (Ocall Suite, étape 5) : un bloc par application ouverte où la
 * personne a les droits de consultation, calculé par l'application elle-même. Aucun total entre
 * applications : un montant encaissé, un montant facturé et une valeur de stock ne s'additionnent pas.
 */
export function OrganizationDashboard({ allowed }: { allowed: boolean }) {
  const [filters, setFilters] = useState<Filters>({
    period: 'this_month',
    from: '',
    to: '',
    establishmentId: '',
  });
  const ready = filters.period !== 'custom' || (Boolean(filters.from) && Boolean(filters.to));
  const report = useApi<OrganizationReport>(
    allowed && ready ? `/dashboard/organization?${queryOf(filters)}` : null,
  );
  const update = (next: Partial<Filters>) => setFilters((prev) => ({ ...prev, ...next }));
  const establishments = report.state === 'success' ? report.data.meta.establishments : [];

  return (
    <SuiteShell>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6" data-testid="org-dashboard">
        <div>
          <Link
            href="/suite"
            className="inline-flex items-center gap-1 text-sm font-semibold text-suite-green hover:underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Portail
          </Link>
          <h1 className="mt-2 font-display text-2xl font-extrabold text-suite-green sm:text-3xl">
            Tableau de bord de l’organisation
          </h1>
          <p className="mt-1 text-sm text-suite-ink-soft">
            Chaque application présente ses propres indicateurs, selon vos droits dans celle-ci. Les
            montants de natures différentes (encaissé, facturé, valeur du stock) ne sont jamais
            additionnés.
          </p>
        </div>

        {!allowed ? (
          <Alert tone="info">
            Le tableau de bord de l’organisation est réservé au propriétaire et aux administrateurs.
          </Alert>
        ) : (
          <>
            <div
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
              data-testid="org-dashboard-filters"
            >
              <PeriodFields value={filters} onChange={update} />
              <SelectField
                label="Établissement"
                value={filters.establishmentId}
                onChange={(e) => update({ establishmentId: e.target.value })}
                options={[
                  { value: '', label: 'Tous les établissements' },
                  ...establishments.map((e) => ({
                    value: e.id,
                    label: `${e.name}${e.city ? ` — ${e.city}` : ''}${e.isActive ? '' : ' (désactivé)'}`,
                  })),
                  { value: ORG_REPORT_UNASSIGNED, label: ORG_REPORT_UNASSIGNED_LABEL },
                ]}
              />
            </div>
            {!ready && <Alert tone="info">Choisissez la date de début et la date de fin.</Alert>}
            {ready && report.state === 'loading' && <LoadingState />}
            {ready && report.state === 'error' && (
              <ErrorState error={report.error} onRetry={report.reload} />
            )}
            {ready && report.state === 'success' && <Report data={report.data} />}
          </>
        )}
      </main>
    </SuiteShell>
  );
}

function Report({ data }: { data: OrganizationReport }) {
  if (data.blocks.length === 0) {
    return (
      <Alert tone="info">
        Aucune application ouverte où vous pouvez consulter des indicateurs.
      </Alert>
    );
  }
  return (
    <div className="space-y-6">
      <p className="text-sm text-suite-ink-soft" data-testid="org-dashboard-period">
        {data.meta.period.current.label} · fuseau {data.meta.timezone} · devise {data.meta.currency}
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        {data.blocks.map((block) => (
          <BlockCard key={block.product} block={block} />
        ))}
      </div>
      <SiteComparison data={data} />
    </div>
  );
}

function BlockCard({ block }: { block: OrgReportBlock }) {
  return (
    <Card className="min-w-0">
      <div data-testid={`org-block-${block.product}`}>
        <CardHeader
          title={block.label}
          action={
            block.status === 'unavailable' ? (
              <Badge tone="terracotta">Indisponible</Badge>
            ) : (
              <Link
                href={block.href}
                className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-semibold text-suite-green hover:underline"
              >
                Détail <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            )
          }
        />
        <CardBody className="space-y-3">
          {block.message && <p className="text-sm text-muted">{block.message}</p>}
          {block.metrics.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {block.metrics.map((m) => (
                <StatTile
                  key={m.id}
                  label={m.label}
                  value={m.value}
                  format={(n) => formatMetric(m, n)}
                  compared={
                    m.previous === null
                      ? undefined
                      : { current: m.value, previous: m.previous, change: orgReportChange(m) }
                  }
                  hint={m.hint ?? undefined}
                  testId={`org-metric-${block.product}-${m.id}`}
                />
              ))}
            </div>
          )}
          {block.notes.map((n) => (
            <p key={n} className="text-xs text-muted">
              {n}
            </p>
          ))}
        </CardBody>
      </div>
    </Card>
  );
}

/**
 * Comparaison par établissement : une ligne par établissement (puis « Non rattaché »), les indicateurs
 * clés de chaque application en colonnes. Jamais de colonne « total » entre applications.
 */
function SiteComparison({ data }: { data: OrganizationReport }) {
  const blocks = data.blocks.filter((b) => b.status === 'ok' && b.siteMetrics.length > 0);
  if (blocks.length === 0) return null;
  const ids = new Set<string | null>(blocks.flatMap((b) => b.bySite.map((r) => r.establishmentId)));
  const rows: { id: string | null; name: string }[] = [
    ...data.meta.establishments
      .filter((e) => ids.has(e.id))
      .map((e) => ({ id: e.id, name: e.name })),
    ...(ids.has(null) ? [{ id: null, name: ORG_REPORT_UNASSIGNED_LABEL }] : []),
  ];
  if (rows.length === 0) return null;
  const columns = blocks.flatMap((b) =>
    b.siteMetrics.map((id) => ({
      block: b,
      metric: b.metrics.find((m) => m.id === id),
      id,
    })),
  );
  return (
    <Card className="min-w-0">
      <CardHeader
        title="Par établissement"
        description="Indicateurs clés de chaque application ; « Non rattaché » regroupe ce qui n’est lié à aucun établissement."
      />
      <CardBody>
        <div className="overflow-x-auto" data-testid="org-site-table">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="py-2 pr-4 font-medium">Établissement</th>
                {columns.map((c) => (
                  <th
                    key={`${c.block.product}-${c.id}`}
                    className="whitespace-nowrap py-2 pr-4 font-medium"
                  >
                    {c.block.label} · {c.metric?.label ?? c.id}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id ?? 'none'} className="border-b border-line/60">
                  <th scope="row" className="whitespace-nowrap py-2 pr-4 text-left font-semibold">
                    {row.name}
                  </th>
                  {columns.map((c) => {
                    const value = c.block.bySite.find((r) => r.establishmentId === row.id)?.values[
                      c.id
                    ];
                    return (
                      <td
                        key={`${c.block.product}-${c.id}`}
                        className="whitespace-nowrap py-2 pr-4"
                      >
                        {value === undefined
                          ? '—'
                          : formatMetric(c.metric ?? { currency: null }, value)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
