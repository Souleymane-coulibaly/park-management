'use client';

import { YearPicker } from '@/components/school/school-finance';
import { Payments } from '@/components/school/school-finance-payments';
import { SchoolPage } from '@/components/school/school-page';

/**
 * Historique des paiements (Sprint 5) : encaissements et contrepassations, jamais supprimés. La direction
 * annule un encaissement avec un motif ; l'original reste consultable, au statut annulé.
 */
export default function PaymentsPage() {
  return (
    <SchoolPage title="fin.payments.title" description="fin.payments.desc">
      {({ school, canWrite }) => (
        <YearPicker key={school!.id} schoolId={school!.id}>
          {(year) => (
            <Payments
              key={year.id}
              schoolId={school!.id}
              yearId={year.id}
              canCancel={canWrite('school.finance.cancel')}
              receiptsOnly={false}
            />
          )}
        </YearPicker>
      )}
    </SchoolPage>
  );
}
