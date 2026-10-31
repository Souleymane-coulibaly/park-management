'use client';

import { Building2 } from 'lucide-react';
import { formatXof } from '@ocall/shared';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface ClientRow {
  name: string;
  products: string[];
  attributedAt: string | null;
  collected: number;
}

/** Clients apportés : nom et montants encaissés uniquement (aucune donnée métier du client). */
export default function PartnerClientsPage() {
  const clients = useApi<ClientRow[]>('/partner/clients');
  return (
    <>
      <PageHeader
        eyebrow="Portail partenaire"
        title="Clients apportés"
        description="Organisations qui vous sont attribuées, après confirmation par Ocall. Seuls le nom et les montants encaissés sont visibles."
      />
      <Card>
        <CardHeader title="Clients" />
        {clients.state === 'loading' && <LoadingState />}
        {clients.state === 'error' && <ErrorState error={clients.error} onRetry={clients.reload} />}
        {clients.state === 'success' &&
          (clients.data.length === 0 ? (
            <EmptyState
              icon={<Building2 className="h-7 w-7" />}
              title="Aucun client pour le moment"
              description="Vos prospects convertis apparaîtront ici."
            />
          ) : (
            <Table head={['Client', 'Produits', 'Attribué le', 'Encaissé']}>
              {clients.data.map((c) => (
                <tr key={c.name}>
                  <Td className="font-medium">{c.name}</Td>
                  <Td>{c.products.join(', ')}</Td>
                  <Td>{formatDate(c.attributedAt)}</Td>
                  <Td className="tabular-nums">{formatXof(c.collected)}</Td>
                </tr>
              ))}
            </Table>
          ))}
      </Card>
    </>
  );
}
