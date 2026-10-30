'use client';

import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { CashSessionGate } from '@/components/pos/cash-session';
import { ParkEstablishmentScope } from '@/components/park/park-establishment';
import { ParkNav } from '@/components/park/park-nav';
import { TicketCounter } from './ticket-counter';

/** Billetterie du parc : choix du parc, session de caisse, puis guichet de vente. */
export default function BilletteriePage() {
  const canSell = useCan('pos.sell');
  if (!canSell) return <AccessDenied />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Billetterie</h1>
        <ParkNav />
      </div>
      <ParkEstablishmentScope source="/ticketing/establishments">
        {(park) => (
          <CashSessionGate establishmentId={park.id}>
            {(session, reload) => (
              <TicketCounter establishmentId={park.id} session={session} onSessionChange={reload} />
            )}
          </CashSessionGate>
        )}
      </ParkEstablishmentScope>
    </div>
  );
}
