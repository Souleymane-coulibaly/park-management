'use client';

import { Wallet } from 'lucide-react';
import { formatXof } from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import type { CashSession } from '@/lib/types';
import { useApi } from '@/lib/use-api';

function VarianceBadge({ variance }: { variance: number | null }) {
  if (variance === null) return <span className="text-muted">—</span>;
  if (variance === 0) return <Badge tone="forest">Juste</Badge>;
  return variance < 0 ? (
    <Badge tone="terracotta">Manque {formatXof(-variance)}</Badge>
  ) : (
    <Badge tone="savanna">Excédent {formatXof(variance)}</Badge>
  );
}

export default function SessionsPage() {
  const canSell = useCan('pos.sell');
  const supervises = useCan('cash.supervise');
  const sessions = useApi<CashSession[]>(canSell ? '/cash-sessions' : null);

  if (!canSell) return <AccessDenied />;
  return (
    <>
      <PageHeader
        title="Sessions de caisse"
        description={
          supervises
            ? 'Ouvertures, fermetures et écarts de caisse de votre périmètre.'
            : 'Vos sessions de caisse et leurs écarts.'
        }
      />
      <Card>
        {sessions.state === 'loading' && <LoadingState />}
        {sessions.state === 'error' && (
          <ErrorState error={sessions.error} onRetry={sessions.reload} />
        )}
        {sessions.state === 'success' && sessions.data.length === 0 && (
          <EmptyState
            icon={<Wallet className="h-7 w-7" />}
            title="Aucune session"
            description="Les sessions de caisse apparaîtront ici dès la première ouverture."
          />
        )}
        {sessions.state === 'success' && sessions.data.length > 0 && (
          <Table
            head={[
              'Établissement',
              'Caissier',
              'Ouverture',
              'Fermeture',
              'Fond',
              'Attendu',
              'Compté',
              'Écart',
            ]}
          >
            {sessions.data.map((s) => (
              <tr key={s.id}>
                <Td>{s.establishment.name}</Td>
                <Td>{s.openedBy.name}</Td>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(s.openedAt)}</Td>
                <Td className="whitespace-nowrap text-muted">
                  {s.status === 'OPEN' ? (
                    <Badge tone="forest">Ouverte</Badge>
                  ) : (
                    formatDateTime(s.closedAt)
                  )}
                </Td>
                <Td>{formatXof(s.openingFloat)}</Td>
                <Td className="font-semibold">{formatXof(s.expectedCash)}</Td>
                <Td>{s.countedCash === null ? '—' : formatXof(s.countedCash)}</Td>
                <Td>
                  <VarianceBadge variance={s.variance} />
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
