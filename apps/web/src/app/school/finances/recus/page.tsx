'use client';

import { YearPicker } from '@/components/school/school-finance';
import { Payments } from '@/components/school/school-finance-payments';
import { SchoolPage } from '@/components/school/school-page';

/**
 * Reçus (Sprint 5) : un reçu par encaissement confirmé, toujours consultable, au statut annulé si
 * l'encaissement a été contrepassé. Produit à la demande : aucune adresse directe.
 */
export default function ReceiptsPage() {
  return (
    <SchoolPage title="fin.receipts.title" description="fin.receipts.desc">
      {({ school }) => (
        <YearPicker key={school!.id} schoolId={school!.id}>
          {(year) => (
            <Payments
              key={year.id}
              schoolId={school!.id}
              yearId={year.id}
              canCancel={false}
              receiptsOnly
            />
          )}
        </YearPicker>
      )}
    </SchoolPage>
  );
}
