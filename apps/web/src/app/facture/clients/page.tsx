'use client';

import { useState } from 'react';
import { FacturePage } from '@/components/facture/facture-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { SimpleForm, type SimpleField } from '@/components/ui/simple-form';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface ClientView {
  id: string;
  kind: 'COMPANY' | 'INDIVIDUAL';
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  nif: string | null;
  rccm: string | null;
  rib: string | null;
  description: string | null;
  whatsappOptIn: boolean;
  isArchived: boolean;
}

const FIELDS = (c?: ClientView): SimpleField[] => [
  {
    name: 'kind',
    label: 'Type',
    type: 'select',
    defaultValue: c?.kind ?? 'COMPANY',
    options: [
      { value: 'COMPANY', label: 'Entreprise' },
      { value: 'INDIVIDUAL', label: 'Particulier' },
    ],
  },
  { name: 'name', label: 'Raison sociale ou nom', required: true, defaultValue: c?.name },
  {
    name: 'description',
    label: 'Description (sous le nom sur les documents)',
    defaultValue: c?.description ?? '',
  },
  { name: 'contactName', label: 'Contact', defaultValue: c?.contactName ?? '' },
  { name: 'email', label: 'E-mail', type: 'email', defaultValue: c?.email ?? '' },
  { name: 'phone', label: 'Téléphone (+223 …)', defaultValue: c?.phone ?? '' },
  { name: 'address', label: 'Adresse', defaultValue: c?.address ?? '' },
  { name: 'city', label: 'Ville', defaultValue: c?.city ?? '' },
  { name: 'nif', label: 'NIF (client assujetti)', defaultValue: c?.nif ?? '' },
  { name: 'rccm', label: 'RCCM', defaultValue: c?.rccm ?? '' },
  { name: 'rib', label: 'RIB', defaultValue: c?.rib ?? '' },
  {
    name: 'whatsappOptIn',
    label: 'Le client accepte de recevoir ses rendez-vous par WhatsApp',
    type: 'checkbox',
    defaultValue: c?.whatsappOptIn ? 'true' : '',
  },
];

/** Clients d'Ocall Facture : recherche, création, modification, archivage (jamais de suppression). */
export default function FactureClientsPage() {
  return (
    <FacturePage title="Clients" description="Entreprises et particuliers à qui vous vendez.">
      {({ canWrite }) => <Clients canManage={canWrite('facture.clients.manage')} />}
    </FacturePage>
  );
}

function Clients({ canManage }: { canManage: boolean }) {
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<ClientView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const clients = useApi<ClientView[]>(
    `/facture/clients?${new URLSearchParams({ ...(q.trim() ? { q: q.trim() } : {}), archived: String(archived) })}`,
  );

  async function toggleArchive(c: ClientView) {
    setError(null);
    try {
      await api(`/facture/clients/${c.id}`, {
        method: 'PATCH',
        body: { isArchived: !c.isArchived },
      });
      clients.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.'));
    }
  }

  return (
    <>
      <ApiErrorAlert error={error} />
      <Card>
        <CardBody className="flex flex-wrap items-end gap-4">
          <InputField
            label="Rechercher (nom, contact, NIF)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Afficher les clients archivés
          </label>
        </CardBody>
      </Card>
      {clients.state === 'loading' && <LoadingState />}
      {clients.state === 'error' && <ErrorState error={clients.error} onRetry={clients.reload} />}
      {clients.state === 'success' && (
        <Card>
          {clients.data.length === 0 ? (
            <CardBody>
              <p className="text-center text-sm text-muted">Aucun client.</p>
            </CardBody>
          ) : (
            <div data-testid="facture-client-list">
              <Table head={['Client', 'Contact', 'NIF', '']}>
                {clients.data.map((c) => (
                  <tr key={c.id}>
                    <Td>
                      <span className="block font-semibold">{c.name}</span>
                      {c.description && (
                        <span className="block text-xs text-forest">{c.description}</span>
                      )}
                      <span className="block text-xs text-muted">
                        {[c.address, c.city].filter(Boolean).join(', ') || '—'}
                      </span>
                    </Td>
                    <Td>
                      <span className="block">{c.contactName ?? '—'}</span>
                      <span className="block text-xs text-muted">
                        {[c.phone, c.email].filter(Boolean).join(' · ')}
                      </span>
                    </Td>
                    <Td>{c.nif ?? '—'}</Td>
                    <Td className="text-right">
                      <span className="inline-flex flex-wrap justify-end gap-2">
                        {c.isArchived && <Badge>Archivé</Badge>}
                        {canManage && (
                          <>
                            <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                              Modifier
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void toggleArchive(c)}
                            >
                              {c.isArchived ? 'Réactiver' : 'Archiver'}
                            </Button>
                          </>
                        )}
                      </span>
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      )}
      {canManage && editing && (
        <Card>
          <CardHeader title={`Modifier ${editing.name}`} />
          <CardBody>
            <SimpleForm
              key={editing.id}
              path={`/facture/clients/${editing.id}`}
              method="PATCH"
              sendEmpty
              submitLabel="Enregistrer"
              fields={FIELDS(editing)}
              onDone={() => {
                setEditing(null);
                clients.reload();
              }}
            />
          </CardBody>
        </Card>
      )}
      {canManage && (
        <Card>
          <CardHeader title="Nouveau client" />
          <CardBody>
            <SimpleForm
              testId="facture-client-form"
              path="/facture/clients"
              submitLabel="Créer le client"
              fields={FIELDS()}
              onDone={() => clients.reload()}
            />
          </CardBody>
        </Card>
      )}
      {!canManage && (
        <Alert
          tone="info"
          title="Consultation seulement : la gestion des clients est réservée au gérant, aux commerciaux et aux comptables."
        />
      )}
    </>
  );
}
