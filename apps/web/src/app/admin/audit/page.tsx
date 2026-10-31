'use client';

import { useState } from 'react';
import { History } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { actionLabel, formatDateTime } from '@/lib/format';
import type { PlatformAuditEntry } from '@/lib/types';
import { useApi } from '@/lib/use-api';

/** Journal des actions de la plateforme et des événements de sécurité des comptes internes. */
export default function PlatformAuditPage() {
  const [limit, setLimit] = useState('100');
  const entries = useApi<PlatformAuditEntry[]>(`/platform/audit?limit=${limit}`);
  return (
    <>
      <PageHeader
        eyebrow="Ocall Suite"
        title="Journal d’audit"
        description="Actions de la plateforme (produits, abonnements, factures, règlements, comptes internes) et événements de sécurité."
      />
      <Card>
        <div className="flex justify-end border-b border-line/70 px-5 py-3">
          <div className="w-40">
            <SelectField
              label="Entrées"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              options={['100', '250', '500'].map((v) => ({ value: v, label: `${v} dernières` }))}
            />
          </div>
        </div>
        {entries.state === 'loading' && <LoadingState />}
        {entries.state === 'error' && <ErrorState error={entries.error} onRetry={entries.reload} />}
        {entries.state === 'success' &&
          (entries.data.length === 0 ? (
            <EmptyState
              icon={<History className="h-7 w-7" />}
              title="Aucune entrée"
              description="Les actions de la plateforme apparaîtront ici."
            />
          ) : (
            <Table head={['Date', 'Action', 'Auteur', 'Cible', 'Adresse IP']}>
              {entries.data.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(e.createdAt)}</Td>
                  <Td>
                    {actionLabel(e.action)}
                    <span className="block font-mono text-xs text-muted">{e.action}</span>
                  </Td>
                  <Td>{e.actor ?? 'Système'}</Td>
                  <Td className="text-xs text-muted">
                    {e.targetType ? `${e.targetType} ${e.targetId?.slice(0, 8) ?? ''}` : '—'}
                  </Td>
                  <Td className="text-xs text-muted">{e.ipAddress ?? '—'}</Td>
                </tr>
              ))}
            </Table>
          ))}
      </Card>
    </>
  );
}
