'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatStockQuantity } from '@ocall/shared';
import { StockPage } from '@/components/stock/stock-page';
import type { StockSiteView } from '@/components/stock/stock-types';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { useApi } from '@/lib/use-api';

interface AlertRow {
  variantId: string;
  productId: string;
  sku: string;
  label: string;
  unit: string;
  siteId: string;
  siteName: string;
  available: number;
  onHand: number;
  minStock: number | null;
  lastOutAt: string | null;
}

interface AlertsView {
  slowMovingDays: number;
  counts: { outOfStock: number; low: number; slowMoving: number };
  outOfStock: AlertRow[];
  low: AlertRow[];
  slowMoving: AlertRow[];
  methods: { lowStock: string; slowMoving: string };
}

/**
 * Alertes (S6) : ruptures, stocks sous le seuil d'alerte (réapprovisionnement) et articles à faible
 * rotation, par article et par site. Affichées dans l'application seulement : rien n'est envoyé.
 */
export default function StockAlertsPage() {
  return (
    <StockPage
      title="Alertes"
      description="Ruptures, réapprovisionnement et articles qui ne tournent pas."
    >
      {({ can, canWrite }) =>
        can('stock.levels.read') ? (
          <Alerts canOrder={canWrite('stock.purchases.manage')} />
        ) : (
          <Alert tone="info" title="Les stocks ne vous sont pas accessibles." />
        )
      }
    </StockPage>
  );
}

function Alerts({ canOrder }: { canOrder: boolean }) {
  const [siteId, setSiteId] = useState('');
  const sites = useApi<StockSiteView[]>('/ocall-stock/sites');
  const alerts = useApi<AlertsView>(
    `/ocall-stock/reports/alerts${siteId ? `?${new URLSearchParams({ siteId })}` : ''}`,
  );
  return (
    <>
      <Card>
        <CardBody className="flex flex-wrap items-end gap-4">
          <div className="w-full max-w-xs">
            <SelectField
              label="Site"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              options={[
                { value: '', label: 'Tous les sites' },
                ...(sites.state === 'success' ? sites.data : [])
                  .filter((s) => !s.isArchived)
                  .map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` })),
              ]}
            />
          </div>
          {canOrder && (
            <Link href="/stock/achats" className="text-sm font-medium text-forest underline">
              Passer une commande fournisseur
            </Link>
          )}
        </CardBody>
      </Card>
      {alerts.state === 'loading' && <LoadingState />}
      {alerts.state === 'error' && <ErrorState error={alerts.error} onRetry={alerts.reload} />}
      {alerts.state === 'success' && (
        <>
          <AlertList
            testId="stock-alerts-out"
            title={`Ruptures (${alerts.data.counts.outOfStock})`}
            description="Plus rien en stock sur le site."
            rows={alerts.data.outOfStock}
            empty="Aucune rupture."
          />
          <AlertList
            testId="stock-alerts-low"
            title={`À réapprovisionner (${alerts.data.counts.low})`}
            description={alerts.data.methods.lowStock}
            rows={alerts.data.low}
            empty="Aucun article sous son seuil d’alerte."
            showMin
          />
          <AlertList
            testId="stock-alerts-slow"
            title={`Faible rotation (${alerts.data.counts.slowMoving})`}
            description={`${alerts.data.methods.slowMoving} Réglage actuel : ${alerts.data.slowMovingDays} jours.`}
            rows={alerts.data.slowMoving}
            empty="Aucun article dormant."
            showLastOut
          />
        </>
      )}
    </>
  );
}

function AlertList({
  testId,
  title,
  description,
  rows,
  empty,
  showMin = false,
  showLastOut = false,
}: {
  testId: string;
  title: string;
  description: string;
  rows: AlertRow[];
  empty: string;
  showMin?: boolean;
  showLastOut?: boolean;
}) {
  const head = [
    'Article',
    'Site',
    'Disponible',
    ...(showMin ? ['Seuil'] : []),
    ...(showLastOut ? ['Dernière sortie'] : []),
  ];
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {rows.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">{empty}</p>
        </CardBody>
      ) : (
        <div data-testid={testId}>
          <Table head={head}>
            {rows.map((r) => (
              <tr key={`${r.variantId}:${r.siteId}`}>
                <Td>
                  <Link
                    href={`/stock/articles/${r.productId}`}
                    className="block font-semibold text-forest underline"
                  >
                    {r.label}
                  </Link>
                  <span className="text-xs text-muted">{r.sku}</span>
                </Td>
                <Td>{r.siteName}</Td>
                <Td>
                  {formatStockQuantity(r.available)} {r.unit}
                </Td>
                {showMin && <Td>{r.minStock === null ? '—' : formatStockQuantity(r.minStock)}</Td>}
                {showLastOut && (
                  <Td>
                    {r.lastOutAt
                      ? new Date(r.lastOutAt).toLocaleDateString('fr-FR')
                      : 'Jamais sorti'}
                  </Td>
                )}
              </tr>
            ))}
          </Table>
        </div>
      )}
    </Card>
  );
}
