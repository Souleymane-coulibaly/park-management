'use client';

import { useState } from 'react';
import { AiMaintenance } from '@/components/facture/ai-maintenance';
import { FacturePage } from '@/components/facture/facture-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { SimpleForm, type SimpleField } from '@/components/ui/simple-form';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface EquipmentView {
  id: string;
  clientId: string;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  location: string | null;
  installedAt: string | null;
  maintenanceIntervalMonths: number | null;
  notes: string | null;
  isArchived: boolean;
  client: { id: string; name: string };
}

const FIELDS = (e?: EquipmentView): SimpleField[] => [
  { name: 'name', label: 'Désignation', required: true, defaultValue: e?.name },
  { name: 'brand', label: 'Marque', defaultValue: e?.brand ?? '' },
  { name: 'model', label: 'Modèle', defaultValue: e?.model ?? '' },
  { name: 'serialNumber', label: 'Numéro de série', defaultValue: e?.serialNumber ?? '' },
  { name: 'location', label: 'Emplacement chez le client', defaultValue: e?.location ?? '' },
  {
    name: 'installedAt',
    label: 'Mise en service',
    type: 'date',
    defaultValue: e?.installedAt?.slice(0, 10) ?? '',
  },
  {
    name: 'maintenanceIntervalMonths',
    label: 'Entretien conseillé tous les (mois)',
    type: 'number',
    defaultValue: e?.maintenanceIntervalMonths ? String(e.maintenanceIntervalMonths) : '',
  },
  { name: 'notes', label: 'Notes', defaultValue: e?.notes ?? '' },
];

/** Parc d'équipements des clients : ce que les techniciens entretiennent et dépannent. */
export default function FactureEquipmentPage() {
  return (
    <FacturePage
      title="Équipements"
      description="Parc installé chez vos clients : climatiseurs, groupes électrogènes, onduleurs…"
    >
      {({ canWrite, context }) =>
        context.permissions.includes('facture.interventions.read') ? (
          <>
            <Equipment canManage={canWrite('facture.interventions.manage')} />
            {canWrite('facture.ai.maintenance') && <MaintenanceGate />}
          </>
        ) : (
          <Alert tone="info" title="Le parc d’équipements n’est pas accessible à votre rôle." />
        )
      }
    </FacturePage>
  );
}

function Equipment({ canManage }: { canManage: boolean }) {
  const clients = useApi<{ id: string; name: string }[]>('/facture/clients');
  const [clientId, setClientId] = useState('');
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<EquipmentView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const list = useApi<EquipmentView[]>(
    `/facture/equipment?${new URLSearchParams({ ...(clientId ? { clientId } : {}), archived: String(archived) })}`,
  );
  const clientOptions = clients.state === 'success' ? clients.data : [];

  async function toggleArchive(e: EquipmentView) {
    setError(null);
    try {
      await api(`/facture/equipment/${e.id}`, {
        method: 'PATCH',
        body: { isArchived: !e.isArchived },
      });
      list.reload();
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.'),
      );
    }
  }

  return (
    <>
      <ApiErrorAlert error={error} />
      <Card>
        <CardBody className="flex flex-wrap items-end gap-4">
          <SelectField
            label="Client"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            options={[
              { value: '', label: 'Tous les clients' },
              ...clientOptions.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Afficher les équipements archivés
          </label>
        </CardBody>
      </Card>
      {list.state === 'loading' && <LoadingState />}
      {list.state === 'error' && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.state === 'success' && (
        <Card>
          {list.data.length === 0 ? (
            <CardBody>
              <p className="text-center text-sm text-muted">Aucun équipement.</p>
            </CardBody>
          ) : (
            <div data-testid="facture-equipment-list">
              <Table head={['Équipement', 'Client', 'Emplacement', '']}>
                {list.data.map((e) => (
                  <tr key={e.id}>
                    <Td>
                      <span className="block font-semibold">{e.name}</span>
                      <span className="block text-xs text-muted">
                        {[e.brand, e.model, e.serialNumber ? `N° ${e.serialNumber}` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </Td>
                    <Td>{e.client.name}</Td>
                    <Td>{e.location ?? '—'}</Td>
                    <Td className="text-right">
                      <span className="inline-flex flex-wrap justify-end gap-2">
                        {e.isArchived && <Badge>Archivé</Badge>}
                        {canManage && (
                          <>
                            <Button size="sm" variant="secondary" onClick={() => setEditing(e)}>
                              Modifier
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void toggleArchive(e)}
                            >
                              {e.isArchived ? 'Réactiver' : 'Archiver'}
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
          <CardHeader title={`Modifier ${editing.name}`} description={editing.client.name} />
          <CardBody>
            <SimpleForm
              key={editing.id}
              path={`/facture/equipment/${editing.id}`}
              method="PATCH"
              sendEmpty
              submitLabel="Enregistrer"
              fields={FIELDS(editing)}
              onDone={() => {
                setEditing(null);
                list.reload();
              }}
            />
          </CardBody>
        </Card>
      )}
      {canManage && clients.state === 'success' && (
        <Card>
          <CardHeader title="Nouvel équipement" />
          <CardBody>
            <SimpleForm
              testId="facture-equipment-form"
              path="/facture/equipment"
              submitLabel="Ajouter l’équipement"
              fields={[
                {
                  name: 'clientId',
                  label: 'Client',
                  type: 'select',
                  required: true,
                  defaultValue: clientId || clientOptions[0]?.id || '',
                  options: clientOptions.map((c) => ({ value: c.id, label: c.name })),
                },
                ...FIELDS(),
              ]}
              onDone={() => list.reload()}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}

/** Maintenance préventive proposée seulement si l'IA et la fonctionnalité sont activées (F6B). */
function MaintenanceGate() {
  const ai = useApi<{ configured: boolean; enabled: boolean; maintenanceEnabled: boolean }>(
    '/facture/ai/settings',
  );
  if (
    ai.state !== 'success' ||
    !ai.data.configured ||
    !ai.data.enabled ||
    !ai.data.maintenanceEnabled
  ) {
    return null;
  }
  return <AiMaintenance />;
}
