'use client';

import { History } from 'lucide-react';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { actionLabel, formatDateTime } from '@/lib/format';
import type { AuditEntry } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function JournalPage() {
  const canRead = useCan('audit.read');
  const logs = useApi<AuditEntry[]>(canRead ? '/audit-logs?limit=100' : null);

  if (!canRead) return <AccessDenied />;
  return (
    <>
      <PageHeader
        title="Journal d’audit"
        description="Les 100 dernières actions sensibles de votre organisation."
      />
      <Card>
        {logs.state === 'loading' && <LoadingState />}
        {logs.state === 'error' && <ErrorState error={logs.error} onRetry={logs.reload} />}
        {logs.state === 'success' && logs.data.length === 0 && (
          <EmptyState
            icon={<History className="h-7 w-7" />}
            title="Journal vide"
            description="Aucune action n’a encore été enregistrée."
          />
        )}
        {logs.state === 'success' && logs.data.length > 0 && (
          <Table head={['Date', 'Action', 'Auteur', 'Objet']}>
            {logs.data.map((l) => (
              <tr key={l.id}>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(l.createdAt)}</Td>
                <Td className="font-medium">{actionLabel(l.action)}</Td>
                <Td>{l.actor}</Td>
                <Td className="text-muted">{l.targetType}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
