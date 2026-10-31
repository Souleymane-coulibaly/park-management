'use client';

import { useState } from 'react';
import { AlertTriangle, Banknote, CalendarClock, FileText, TrendingUp } from 'lucide-react';
import { type CommercialDashboard as Dashboard, formatXof } from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { KpiCard } from '@/components/ui/kpi-card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import type { SuiteProduct } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Tableau de bord commercial Ocall Suite. « Encaissé » = règlements VALIDÉS sur la période ;
 * « MRR théorique » = tarifs acceptés des abonnements actifs (contractuel, pas un encaissement).
 */
export function CommercialDashboard() {
  const now = new Date();
  const [product, setProduct] = useState('');
  const [from, setFrom] = useState(isoDay(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(isoDay(now));
  const products = useApi<SuiteProduct[]>('/platform/products');
  const query = new URLSearchParams({ from, to, ...(product ? { product } : {}) });
  const data = useApi<Dashboard>(from && to && from <= to ? `/platform/commercial?${query}` : null);

  return (
    <div className="space-y-6">
      <Card>
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField
              label="Produit"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              options={[
                { value: '', label: 'Tous les produits' },
                ...(products.state === 'success'
                  ? products.data.map((p) => ({ value: p.code, label: p.name }))
                  : []),
              ]}
            />
            <InputField
              label="Du"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <InputField label="Au" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardBody>
      </Card>
      {data.state === 'loading' && <LoadingState />}
      {data.state === 'error' && <ErrorState error={data.error} onRetry={data.reload} />}
      {data.state === 'success' && <DashboardContent d={data.data} />}
    </div>
  );
}

function DashboardContent({ d }: { d: Dashboard }) {
  const s = d.subscriptions;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="commercial-kpis">
        <KpiCard
          label="Encaissé (validé)"
          value={<span className="text-xl sm:text-2xl">{formatXof(d.collected.total)}</span>}
          hint={`Mise en service ${formatXof(d.collected.setup)} · mensualités ${formatXof(d.collected.monthly)}`}
          icon={<Banknote className="h-5 w-5" />}
        />
        <KpiCard
          label="Facturé"
          value={<span className="text-xl sm:text-2xl">{formatXof(d.invoiced)}</span>}
          hint="Factures émises sur la période"
          icon={<FileText className="h-5 w-5" />}
          accent="savanna"
        />
        <KpiCard
          label="MRR théorique"
          value={<span className="text-xl sm:text-2xl">{formatXof(d.theoreticalMrr)}</span>}
          hint="Tarifs acceptés des abonnements actifs — pas un encaissement"
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <KpiCard
          label="Impayés"
          value={<span className="text-xl sm:text-2xl">{formatXof(d.unpaid.amount)}</span>}
          hint={`${d.unpaid.invoices} facture(s) · dont échu ${formatXof(d.unpaid.overdueAmount)}`}
          icon={<AlertTriangle className="h-5 w-5" />}
          accent="terracotta"
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Abonnements"
            description={`${d.organizations.total} organisations · ${d.establishments} établissements`}
          />
          <CardBody>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {(
                [
                  ['Actifs', s.active],
                  ['Non activés', s.notActivated],
                  ['En retard', s.pastDue],
                  ['Expirés', s.expired],
                  ['Résiliés', s.canceled],
                  ['Organisations suspendues', s.suspendedOrganizations],
                ] as const
              ).map(([label, n]) => (
                <div key={label} className="rounded-xl bg-ivory px-3 py-2">
                  <dt className="text-muted">{label}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{n}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 flex items-center gap-2 text-sm text-muted">
              <CalendarClock className="h-4 w-4" aria-hidden />
              {d.renewalsNext30Days} échéance(s) dans les 30 prochains jours — renouvellement
              manuel.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Par produit" />
          <Table head={['Produit', 'Statut', 'Abonnements', 'Actifs']}>
            {d.byProduct.map((p) => (
              <tr key={p.code}>
                <Td className="font-medium">{p.name}</Td>
                <Td>
                  <Badge
                    tone={
                      p.status === 'AVAILABLE'
                        ? 'forest'
                        : p.status === 'UPCOMING'
                          ? 'savanna'
                          : 'neutral'
                    }
                  >
                    {p.status === 'AVAILABLE'
                      ? 'Commercialisé'
                      : p.status === 'UPCOMING'
                        ? 'À venir'
                        : 'Retiré'}
                  </Badge>
                </Td>
                <Td className="tabular-nums">{p.subscriptions}</Td>
                <Td className="tabular-nums">{p.active}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      {d.collected.unallocated > 0 && (
        <p className="text-sm text-muted">
          Dont {formatXof(d.collected.unallocated)} de règlements validés sans facture rattachée
          (registre historique).
        </p>
      )}
    </>
  );
}
