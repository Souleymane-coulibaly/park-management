'use client';

import {
  AlertTriangle,
  ChefHat,
  Clock,
  QrCode,
  Receipt,
  ShoppingBasket,
  Wallet,
} from 'lucide-react';
import { STOCK_UNIT_LABELS, formatXof } from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { RestaurantNav } from '@/components/restaurant/restaurant-nav';
import { RestaurantScope } from '@/components/restaurant/restaurant-scope';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import type { RestaurantDashboard } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const qty = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 3 });

/**
 * Tableau de bord opérationnel du restaurant (journée en cours). Le CA ne compte que les paiements
 * encaissés. Les analyses par produit, par heure et sur période relèvent du Sprint 9.
 */
export default function RestaurantDashboardPage() {
  const canRead = useCan('sale.read_all');
  if (!canRead) return <AccessDenied />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Tableau de bord restaurant</h1>
        <RestaurantNav />
      </div>
      <RestaurantScope>{(e) => <Dashboard establishmentId={e.id} />}</RestaurantScope>
    </div>
  );
}

function Dashboard({ establishmentId }: { establishmentId: string }) {
  const stats = useApi<RestaurantDashboard>(
    `/restaurant/dashboard?establishmentId=${establishmentId}`,
  );
  if (stats.state === 'loading') return <LoadingState />;
  if (stats.state === 'error') return <ErrorState error={stats.error} onRetry={stats.reload} />;
  const d = stats.data;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Aujourd’hui (
        {new Date(`${d.date}T12:00:00Z`).toLocaleDateString('fr-FR', { dateStyle: 'full' })}). Le
        chiffre d’affaires ne compte que les paiements encaissés ; une commande impayée n’y figure
        pas.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="CA encaissé"
          value={<span data-testid="revenue-collected">{formatXof(d.revenueCollected)}</span>}
          hint={`${d.paidSales} vente(s) encaissée(s)`}
          icon={<Wallet className="h-5 w-5" aria-hidden />}
        />
        <KpiCard
          label="Commandes"
          value={d.orders}
          hint="Du jour, hors annulées"
          icon={<Receipt className="h-5 w-5" aria-hidden />}
          accent="savanna"
        />
        <KpiCard
          label="Panier moyen"
          value={d.averageBasket !== null ? formatXof(d.averageBasket) : '—'}
          hint="CA encaissé / ventes encaissées"
          icon={<ShoppingBasket className="h-5 w-5" aria-hidden />}
        />
        <KpiCard
          label="Temps moyen de préparation"
          value={d.averagePreparationMinutes !== null ? `${d.averagePreparationMinutes} min` : '—'}
          hint="De l’envoi en cuisine à « prête »"
          icon={<Clock className="h-5 w-5" aria-hidden />}
          accent="savanna"
        />
        <KpiCard
          label="En attente en cuisine"
          value={d.waiting}
          hint="Envoyées, pas encore commencées"
          icon={<ChefHat className="h-5 w-5" aria-hidden />}
          accent="terracotta"
        />
        <KpiCard
          label="En préparation"
          value={d.inPreparation}
          icon={<ChefHat className="h-5 w-5" aria-hidden />}
          accent="savanna"
        />
        <KpiCard
          label="Demandes QR à valider"
          value={d.qrPending}
          icon={<QrCode className="h-5 w-5" aria-hidden />}
          accent="terracotta"
        />
        <KpiCard
          label="Alertes de stock"
          value={d.stockAlerts.length}
          icon={<AlertTriangle className="h-5 w-5" aria-hidden />}
          accent={d.stockAlerts.length > 0 ? 'terracotta' : 'forest'}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Produits les plus vendus"
            description="Quantités des ventes encaissées du jour"
          />
          {d.topProducts.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">Aucune vente encaissée aujourd’hui.</p>
            </CardBody>
          ) : (
            <Table head={['Produit', 'Quantité', 'CA']}>
              {d.topProducts.map((p) => (
                <tr key={p.productName}>
                  <Td className="font-medium">{p.productName}</Td>
                  <Td>{p.quantity}</Td>
                  <Td>{formatXof(p.revenue)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Alertes de stock"
            description="Articles au niveau du seuil ou en dessous"
          />
          {d.stockAlerts.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">Aucune alerte.</p>
            </CardBody>
          ) : (
            <Table head={['Article', 'Quantité', 'Seuil']}>
              {d.stockAlerts.map((a) => (
                <tr key={a.id}>
                  <Td className="font-medium text-terracotta-dark">{a.name}</Td>
                  <Td>
                    {qty(a.quantity)} {STOCK_UNIT_LABELS[a.unit]}
                  </Td>
                  <Td>
                    {qty(a.alertThreshold)} {STOCK_UNIT_LABELS[a.unit]}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
