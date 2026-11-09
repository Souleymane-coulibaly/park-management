'use client';

import { useState } from 'react';
import { Inbox, Receipt } from 'lucide-react';
import {
  SETUP_FEE_STATUS_LABELS,
  SUITE_REQUEST_KIND_LABELS,
  type SetupFeeStatus,
  type SuiteRequestKind,
  formatXof,
} from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface OrgRef {
  id: string;
  name: string;
  code: string;
}
interface ProductRef {
  code: string;
  name: string;
}
interface Trial {
  id: string;
  startedAt: string;
  endsAt: string;
  startedByOcall: boolean;
  organization: OrgRef;
  product: ProductRef;
}
interface SetupFee {
  id: string;
  amount: number;
  status: SetupFeeStatus;
  paidAt: string | null;
  organization: OrgRef;
  product: ProductRef;
}
interface ActivationRequest {
  id: string;
  kind: SuiteRequestKind;
  quotedSetupFee: number;
  quotedMonthly: number;
  createdAt: string;
  organization: OrgRef;
  product: ProductRef;
}

const toError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.');

/**
 * Socle commercial Ocall Suite (S1) : suivi des essais, des frais de mise en service et des demandes
 * d'activation. L'activation payante elle-même passe par la validation d'un règlement (page
 * Règlements) ; une demande est close une fois le règlement vérifié et l'abonnement activé.
 */
export default function AdminEssaisActivationsPage() {
  const requests = useApi<ActivationRequest[]>('/platform/suite-commercial/activation-requests');
  const trials = useApi<Trial[]>('/platform/suite-commercial/trials');
  const fees = useApi<SetupFee[]>('/platform/suite-commercial/setup-fees');
  return (
    <>
      <PageHeader
        eyebrow="Super Admin"
        title="Essais et activations"
        description="Essais gratuits de 14 jours, demandes d’activation payante et frais de mise en service (facturés une seule fois par organisation et application)."
      />
      <Card className="mb-6">
        <CardHeader
          title="Demandes d’activation en attente"
          description="Vérifiez le règlement hors plateforme, validez-le dans Règlements (activation), puis clôturez la demande."
        />
        {requests.state === 'loading' && <LoadingState />}
        {requests.state === 'error' && (
          <ErrorState error={requests.error} onRetry={requests.reload} />
        )}
        {requests.state === 'success' &&
          (requests.data.length === 0 ? (
            <CardBody>
              <EmptyState
                icon={<Inbox className="h-6 w-6" aria-hidden />}
                title="Aucune demande en attente"
                description="Les demandes envoyées depuis le portail Ocall Suite apparaissent ici."
              />
            </CardBody>
          ) : (
            <Table head={['Organisation', 'Application', 'Montant annoncé', 'Demandée le', '']}>
              {requests.data.map((r) => (
                <RequestRow key={r.id} request={r} onDone={requests.reload} />
              ))}
            </Table>
          ))}
      </Card>
      <Card className="mb-6">
        <CardHeader
          title="Essais gratuits"
          description="Un seul essai par organisation et application. Applications en préproduction (Ocall School) : essai démarré par Ocall uniquement."
        />
        <CardBody>
          <StartTrialForm onDone={trials.reload} />
        </CardBody>
        {trials.state === 'loading' && <LoadingState />}
        {trials.state === 'error' && <ErrorState error={trials.error} onRetry={trials.reload} />}
        {trials.state === 'success' && trials.data.length > 0 && (
          <Table head={['Organisation', 'Application', 'Début', 'Fin', 'État']}>
            {trials.data.map((t) => {
              const active = new Date(t.endsAt).getTime() > Date.now();
              return (
                <tr key={t.id}>
                  <Td>
                    {t.organization.name}
                    <span className="ml-1 text-xs text-muted">{t.organization.code}</span>
                  </Td>
                  <Td>{t.product.name}</Td>
                  <Td>{formatDate(t.startedAt)}</Td>
                  <Td>{formatDate(t.endsAt)}</Td>
                  <Td>
                    <Badge tone={active ? 'forest' : 'neutral'}>
                      {active ? 'En cours' : 'Expiré'}
                    </Badge>
                    {t.startedByOcall && <span className="ml-2 text-xs text-muted">par Ocall</span>}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader
          title="Frais de mise en service"
          description="200 000 FCFA par application : facturés une seule fois, jamais au renouvellement ni au passage à l’offre avec vitrine."
        />
        {fees.state === 'loading' && <LoadingState />}
        {fees.state === 'error' && <ErrorState error={fees.error} onRetry={fees.reload} />}
        {fees.state === 'success' &&
          (fees.data.length === 0 ? (
            <CardBody>
              <EmptyState
                icon={<Receipt className="h-6 w-6" aria-hidden />}
                title="Aucun frais de mise en service enregistré"
                description="Ils apparaissent à la première facture portant une mise en service."
              />
            </CardBody>
          ) : (
            <Table head={['Organisation', 'Application', 'Montant', 'Statut', 'Réglés le']}>
              {fees.data.map((f) => (
                <tr key={f.id}>
                  <Td>{f.organization.name}</Td>
                  <Td>{f.product.name}</Td>
                  <Td>{formatXof(f.amount)}</Td>
                  <Td>
                    <Badge tone={f.status === 'PAID' ? 'forest' : 'savanna'}>
                      {SETUP_FEE_STATUS_LABELS[f.status]}
                    </Badge>
                  </Td>
                  <Td>{f.paidAt ? formatDate(f.paidAt) : '—'}</Td>
                </tr>
              ))}
            </Table>
          ))}
      </Card>
    </>
  );
}

function RequestRow({ request, onDone }: { request: ActivationRequest; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  async function close(outcome: 'HANDLED' | 'CANCELLED') {
    setBusy(true);
    setError(null);
    try {
      await api(`/platform/suite-commercial/activation-requests/${request.id}/close`, {
        method: 'POST',
        body: { outcome, note },
      });
      onDone();
    } catch (e) {
      setError(toError(e));
    } finally {
      setBusy(false);
    }
  }
  const invalid = busy || note.trim().length < 3;
  return (
    <tr>
      <Td>
        {request.organization.name}
        <span className="ml-1 text-xs text-muted">{request.organization.code}</span>
      </Td>
      <Td>
        {request.product.name}
        <span className="block text-xs text-muted">{SUITE_REQUEST_KIND_LABELS[request.kind]}</span>
      </Td>
      <Td>
        {formatXof(request.quotedSetupFee + request.quotedMonthly)}
        <span className="block text-xs text-muted">
          dont mise en service {formatXof(request.quotedSetupFee)}
        </span>
      </Td>
      <Td>{formatDate(request.createdAt)}</Td>
      <Td className="space-y-2">
        <InputField
          label="Motif ou référence du règlement"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex gap-2">
          <Button size="sm" disabled={invalid} onClick={() => close('HANDLED')}>
            Traitée
          </Button>
          <Button size="sm" variant="ghost" disabled={invalid} onClick={() => close('CANCELLED')}>
            Refuser
          </Button>
        </div>
        <ApiErrorAlert error={error} />
      </Td>
    </tr>
  );
}

function StartTrialForm({ onDone }: { onDone: () => void }) {
  const [organizationId, setOrganizationId] = useState('');
  const [productCode, setProductCode] = useState('OCALL_SCHOOL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await api<{ endsAt: string }>('/platform/suite-commercial/trials', {
        method: 'POST',
        body: { organizationId: organizationId.trim(), productCode },
      });
      setDone(`Essai démarré jusqu’au ${formatDate(r.endsAt)}.`);
      onDone();
    } catch (e) {
      setError(toError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
      <InputField
        label="Identifiant de l’organisation"
        value={organizationId}
        onChange={(e) => setOrganizationId(e.target.value)}
        hint="Visible sur la fiche de l’organisation."
      />
      <SelectField
        label="Application"
        value={productCode}
        onChange={(e) => setProductCode(e.target.value)}
        options={[
          { value: 'OCALL_SCHOOL', label: 'Ocall School' },
          { value: 'OCALL_PARK', label: 'Ocall Park' },
        ]}
      />
      <Button onClick={submit} disabled={busy || organizationId.trim().length < 36}>
        Démarrer l’essai
      </Button>
      <div className="sm:col-span-3">
        <ApiErrorAlert error={error} />
        {done && (
          <p className="text-sm text-forest" role="status">
            {done}
          </p>
        )}
      </div>
    </div>
  );
}
