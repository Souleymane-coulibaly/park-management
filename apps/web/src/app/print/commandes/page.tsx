'use client';

import { OrdersTable } from '@/components/print/print-orders';
import type { PrintOrderSummaryView } from '@/components/print/print-types';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

export default function PrintOrdersPage() {
  const orders = useApi<PrintOrderSummaryView[]>('/ocall-print/orders');
  return (
    <>
      <PageHeader
        eyebrow="Ocall Print"
        title="Commandes"
        description="Suivi jusqu’à la livraison ; règlement en espèces à la réception."
      />
      {orders.state === 'loading' && <LoadingState />}
      {orders.state === 'error' && <ErrorState error={orders.error} onRetry={orders.reload} />}
      {orders.state === 'success' && (
        <Card>
          <OrdersTable orders={orders.data} hrefFor={(o) => `/print/commandes/${o.id}`} />
        </Card>
      )}
    </>
  );
}
