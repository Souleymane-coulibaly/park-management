'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import {
  FACTURE_CREATABLE_TYPES,
  FACTURE_DOCUMENT_STATUSES,
  FACTURE_DOCUMENT_STATUS_LABELS,
  FACTURE_DOCUMENT_TYPE_LABELS,
  type FactureDocumentStatus,
  type FactureDocumentType,
  formatXof,
} from '@ocall/shared';
import { DocumentStatusBadge } from '@/components/facture/document-status-badge';
import { FacturePage } from '@/components/facture/facture-page';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface DocumentRow {
  id: string;
  type: FactureDocumentType;
  status: FactureDocumentStatus;
  number: string | null;
  issueDate: string | null;
  subject: string | null;
  totalTtc: number;
  createdAt: string;
  client: { id: string; name: string };
}

/** Devis, pro forma, bons de commande et factures : liste filtrée et création d'un brouillon. */
export default function FactureDocumentsPage() {
  return (
    <FacturePage
      title="Documents"
      description="Devis, factures pro forma, bons de commande et factures."
    >
      {({ canWrite, context }) =>
        context.permissions.includes('facture.documents.read') ? (
          <Documents canManage={canWrite('facture.documents.manage')} />
        ) : (
          <Alert
            tone="info"
            title="Les documents commerciaux ne sont pas accessibles à votre rôle."
          />
        )
      }
    </FacturePage>
  );
}

function Documents({ canManage }: { canManage: boolean }) {
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const query = new URLSearchParams({
    ...(type ? { type } : {}),
    ...(status ? { status } : {}),
  });
  const documents = useApi<DocumentRow[]>(`/facture/documents?${query}`);

  return (
    <>
      {canManage && <NewDocument />}
      <Card>
        <CardBody className="flex flex-wrap gap-4">
          <SelectField
            label="Type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            options={[
              { value: '', label: 'Tous' },
              ...FACTURE_CREATABLE_TYPES.map((t) => ({
                value: t,
                label: FACTURE_DOCUMENT_TYPE_LABELS[t],
              })),
            ]}
          />
          <SelectField
            label="Statut"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={[
              { value: '', label: 'Tous' },
              ...FACTURE_DOCUMENT_STATUSES.map((s) => ({
                value: s,
                label: FACTURE_DOCUMENT_STATUS_LABELS[s],
              })),
            ]}
          />
        </CardBody>
      </Card>
      {documents.state === 'loading' && <LoadingState />}
      {documents.state === 'error' && (
        <ErrorState error={documents.error} onRetry={documents.reload} />
      )}
      {documents.state === 'success' && (
        <Card>
          {documents.data.length === 0 ? (
            <CardBody>
              <p className="text-center text-sm text-muted">Aucun document.</p>
            </CardBody>
          ) : (
            <div data-testid="facture-document-list">
              <Table head={['Document', 'Client', 'Montant TTC', 'Statut']}>
                {documents.data.map((d) => (
                  <tr key={d.id}>
                    <Td>
                      <Link
                        href={`/facture/documents/${d.id}`}
                        className="block font-semibold text-forest hover:underline"
                      >
                        {FACTURE_DOCUMENT_TYPE_LABELS[d.type]} {d.number ?? '(brouillon)'}
                      </Link>
                      <span className="block text-xs text-muted">{d.subject ?? ''}</span>
                    </Td>
                    <Td>{d.client.name}</Td>
                    <Td>{formatXof(d.totalTtc)}</Td>
                    <Td>
                      <DocumentStatusBadge status={d.status} />
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

/** Nouveau brouillon : type et client, puis édition des lignes sur la page du document. */
function NewDocument() {
  const router = useRouter();
  const clients = useApi<{ id: string; name: string }[]>('/facture/clients');
  const [type, setType] = useState<string>('QUOTE');
  const [clientId, setClientId] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const doc = await api<{ id: string }>('/facture/documents', {
        method: 'POST',
        body: { type, clientId, lines: [] },
      });
      router.push(`/facture/documents/${doc.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.'));
      setLoading(false);
    }
  }

  const list = clients.state === 'success' ? clients.data : [];
  return (
    <Card>
      <CardHeader title="Nouveau document" />
      <CardBody>
        <ApiErrorAlert error={error} />
        {clients.state === 'success' && list.length === 0 ? (
          <p className="text-sm text-muted">
            Créez d’abord un client dans{' '}
            <Link href="/facture/clients" className="font-semibold text-forest underline">
              Clients
            </Link>
            .
          </p>
        ) : (
          <form
            onSubmit={create}
            className="flex flex-wrap items-end gap-4"
            data-testid="facture-new-document"
          >
            <SelectField
              label="Type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              options={FACTURE_CREATABLE_TYPES.map((t) => ({
                value: t,
                label: FACTURE_DOCUMENT_TYPE_LABELS[t],
              }))}
            />
            <SelectField
              label="Client"
              required
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              options={[
                { value: '', label: 'Choisir un client' },
                ...list.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <Button type="submit" loading={loading} disabled={!clientId}>
              Créer le brouillon
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
