'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { OrderDetail } from '@/components/print/print-orders';
import type { PrintOrderDetailView } from '@/components/print/print-types';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

export default function PrintOrderPage() {
  const { id } = useParams<{ id: string }>();
  const order = useApi<PrintOrderDetailView>(`/ocall-print/orders/${id}`);
  const [current, setCurrent] = useState<PrintOrderDetailView | null>(null);
  return (
    <>
      <PageHeader eyebrow="Ocall Print" title="Suivi de la commande" />
      {order.state === 'loading' && <LoadingState />}
      {order.state === 'error' && <ErrorState error={order.error} onRetry={order.reload} />}
      {order.state === 'success' && (
        <OrderDetail
          order={current ?? order.data}
          cancelPath={`/ocall-print/orders/${id}/cancel`}
          proofHref={`/api/v1/ocall-print/orders/${id}/proof.pdf`}
          onChange={setCurrent}
        />
      )}
    </>
  );
}
