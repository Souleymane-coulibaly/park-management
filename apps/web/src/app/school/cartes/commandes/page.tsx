'use client';

import { OrdersTable } from '@/components/print/print-orders';
import type { PrintOrderSummaryView } from '@/components/print/print-types';
import { SchoolCardsNav } from '@/components/school/school-cards-nav';
import { SchoolPage } from '@/components/school/school-page';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

function Orders({ schoolId }: { schoolId: string }) {
  const orders = useApi<PrintOrderSummaryView[]>(`/school/card-orders?schoolId=${schoolId}`);
  if (orders.state === 'loading') return <LoadingState />;
  if (orders.state === 'error') return <ErrorState error={orders.error} onRetry={orders.reload} />;
  return (
    <Card>
      <OrdersTable orders={orders.data} hrefFor={(o) => `/school/cartes/commandes/${o.id}`} />
    </Card>
  );
}

export default function SchoolCardOrdersPage() {
  return (
    <SchoolPage
      title={() => 'Commandes de cartes'}
      description={() =>
        'Suivi des commandes envoyées à l’atelier Ocall Print : étapes, montants, règlement.'
      }
    >
      {(page) => (
        <div className="space-y-4">
          <SchoolCardsNav />
          {page.school && <Orders key={page.school.id} schoolId={page.school.id} />}
        </div>
      )}
    </SchoolPage>
  );
}
