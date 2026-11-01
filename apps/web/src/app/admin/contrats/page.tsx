'use client';

import { useState } from 'react';
import {
  SUITE_CONTRACT_STATUS_LABELS,
  SUITE_CONTRACT_TRANSITIONS,
  SUPPORTED_COUNTRIES,
  type SuiteContractStatus,
} from '@ocall/shared';
import { useCanPlatform } from '@/components/app/session-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { SimpleForm } from '@/components/ui/simple-form';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface ContractView {
  id: string;
  reference: string;
  status: SuiteContractStatus;
  startsOn: string;
  endsOn: string;
  organization: { name: string };
  product: { code: string; name: string };
  limits: { maxSchools?: number };
}

const TONE: Record<SuiteContractStatus, 'forest' | 'neutral' | 'savanna' | 'terracotta'> = {
  DRAFT: 'neutral',
  ACTIVE: 'forest',
  SUSPENDED: 'savanna',
  EXPIRED: 'savanna',
  TERMINATED: 'terracotta',
};

const TERMS = [
  { name: 'reference', label: 'Référence du contrat', required: true },
  { name: 'startsOn', label: 'Début', type: 'date' as const, required: true },
  { name: 'endsOn', label: 'Fin', type: 'date' as const, required: true },
];

/** Contrats Ocall School : aucun tarif ici, et aucune action ne supprime les données d'un client. */
export default function ContratsPage() {
  const contracts = useApi<ContractView[]>('/platform/contracts');
  const canManage = useCanPlatform('platform.contracts.manage');
  const [created, setCreated] = useState<{ loginId: string; temporaryPassword: string } | null>(
    null,
  );
  return (
    <>
      <PageHeader
        eyebrow="Ocall Suite"
        title="Contrats"
        description="Ocall School est commercialisé uniquement sur contrat. Suspendre ou laisser expirer un contrat met le client en consultation seule, sans suppression."
      />
      <div className="space-y-4">
        {created && (
          <Alert tone="success" title="Client créé">
            Identifiant : <strong>{created.loginId}</strong>. Mot de passe temporaire, affiché une
            seule fois : <strong>{created.temporaryPassword}</strong>
          </Alert>
        )}
        {contracts.state === 'loading' && <LoadingState />}
        {contracts.state === 'error' && (
          <ErrorState error={contracts.error} onRetry={contracts.reload} />
        )}
        {contracts.state === 'success' && (
          <Card>
            <ul className="divide-y divide-line/70" data-testid="contract-list">
              {contracts.data.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-muted">Aucun contrat.</li>
              )}
              {contracts.data.map((c) => (
                <ContractRow
                  key={c.id}
                  contract={c}
                  canManage={canManage}
                  onChange={contracts.reload}
                />
              ))}
            </ul>
          </Card>
        )}
        {canManage && (
          <Card>
            <CardBody>
              <h2 className="mb-3 font-semibold">Nouveau client Ocall School</h2>
              <SimpleForm<{
                loginId: string;
                temporaryPassword: string;
              }>
                testId="contract-client-form"
                path="/platform/contracts/clients"
                submitLabel="Créer le client et le contrat"
                onDone={(result) => {
                  setCreated({
                    loginId: result.loginId,
                    temporaryPassword: result.temporaryPassword,
                  });
                  contracts.reload();
                }}
                fields={[
                  { name: 'organizationName', label: 'Client contractant', required: true },
                  {
                    name: 'countryCode',
                    label: 'Pays',
                    type: 'select',
                    options: SUPPORTED_COUNTRIES.map((c) => ({ value: c.code, label: c.label })),
                  },
                  { name: 'ownerFirstName', label: 'Prénom du responsable', required: true },
                  { name: 'ownerLastName', label: 'Nom du responsable', required: true },
                  {
                    name: 'ownerEmail',
                    label: 'E-mail du responsable',
                    type: 'email',
                    required: true,
                  },
                  ...TERMS,
                ]}
              />
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}

function ContractRow({
  contract,
  canManage,
  onChange,
}: {
  contract: ContractView;
  canManage: boolean;
  onChange: () => void;
}) {
  const [reason, setReason] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api(`/platform/contracts/${contract.id}/${path}`, { method: 'POST', body });
      setReason('');
      setEndsOn('');
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion impossible.'));
    } finally {
      setBusy(false);
    }
  }

  const renewable = contract.status === 'ACTIVE' || contract.status === 'EXPIRED';
  const next = SUITE_CONTRACT_TRANSITIONS[contract.status];
  return (
    <li className="space-y-3 px-4 py-4" data-testid="contract-row">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{contract.organization.name}</span>
          <span className="block text-sm text-muted">
            {contract.product.name} · {contract.reference} · du {formatDate(contract.startsOn)} au{' '}
            {formatDate(contract.endsOn)}
          </span>
        </span>
        <Badge tone={TONE[contract.status]}>{SUITE_CONTRACT_STATUS_LABELS[contract.status]}</Badge>
      </div>
      {canManage && next.length > 0 && (
        <div className="space-y-2">
          <ApiErrorAlert error={error} />
          <div className="grid gap-2 sm:grid-cols-2">
            <InputField
              label="Motif (obligatoire)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {renewable && (
              <InputField
                label="Nouvelle échéance"
                type="date"
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
              />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {next.map((status) => (
              <Button
                key={status}
                size="sm"
                variant={status === 'ACTIVE' ? 'primary' : 'secondary'}
                loading={busy}
                disabled={reason.trim().length < 3}
                onClick={() => void run('status', { status, reason })}
              >
                {SUITE_CONTRACT_STATUS_LABELS[status]}
              </Button>
            ))}
            {renewable && (
              <Button
                size="sm"
                variant="secondary"
                loading={busy}
                disabled={reason.trim().length < 3 || !endsOn}
                onClick={() => void run('renew', { endsOn, reason })}
              >
                Renouveler
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
