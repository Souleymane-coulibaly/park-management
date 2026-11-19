'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { OrderDetail } from '@/components/print/print-orders';
import type { PrintOrderDetailView } from '@/components/print/print-types';
import { SchoolCardsNav } from '@/components/school/school-cards-nav';
import { SchoolPage, type SchoolPageApi } from '@/components/school/school-page';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

function Detail({ id, page }: { id: string; page: SchoolPageApi }) {
  const order = useApi<PrintOrderDetailView>(`/school/card-orders/${id}`);
  const [current, setCurrent] = useState<PrintOrderDetailView | null>(null);
  if (order.state === 'loading') return <LoadingState />;
  if (order.state === 'error') return <ErrorState error={order.error} onRetry={order.reload} />;
  const o = current ?? order.data;
  return (
    <OrderDetail
      order={o}
      cancelPath={
        page.forSchool(o.scopeId).canWrite('school.cards.order')
          ? `/school/card-orders/${id}/cancel`
          : null
      }
      proofHref={`/api/v1/school/card-orders/${id}/proof.pdf`}
      onChange={setCurrent}
    />
  );
}

export default function SchoolCardOrderPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <SchoolPage title={() => 'Suivi de la commande'} needsSchool={false}>
      {(page) => (
        <div className="space-y-4">
          <SchoolCardsNav />
          <Detail id={id} page={page} />
        </div>
      )}
    </SchoolPage>
  );
}
