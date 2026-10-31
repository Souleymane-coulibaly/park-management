'use client';

import { useEffect, useState } from 'react';
import { localMoment } from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { ParkEstablishmentScope } from '@/components/park/park-establishment';
import { ParkNav } from '@/components/park/park-nav';
import { ScanHistoryList } from '@/components/park/scan-history';
import { Card } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useConnectivity } from '@/lib/connectivity';
import type { ParkEstablishment, TicketScanView } from '@/lib/types';
import { useApi } from '@/lib/use-api';

/** Historique des entrées d'une journée, en heure locale du parc. */
export default function HistoriquePage() {
  const canScan = useCan('access.scan');
  if (!canScan) return <AccessDenied />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Historique des entrées</h1>
        <ParkNav />
      </div>
      <ParkEstablishmentScope source="/access/establishments">
        {(park) => <History park={park} />}
      </ParkEstablishmentScope>
    </div>
  );
}

function History({ park }: { park: ParkEstablishment }) {
  const online = useConnectivity();
  const [date, setDate] = useState(() => localMoment(new Date(), park.timezone).date);
  const scans = useApi<TicketScanView[]>(
    date ? `/access/scans?establishmentId=${park.id}&date=${date}&limit=200` : null,
  );
  const { reload } = scans;
  useEffect(() => {
    if (online) reload();
  }, [online, reload]);

  return (
    <>
      <div className="max-w-xs">
        <InputField
          type="date"
          label="Journée"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <Card>
        {scans.state === 'loading' && <LoadingState />}
        {scans.state === 'error' && <ErrorState error={scans.error} onRetry={reload} />}
        {scans.state === 'success' && <ScanHistoryList scans={scans.data} />}
      </Card>
    </>
  );
}
