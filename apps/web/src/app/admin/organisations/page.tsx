'use client';

import { type FormEvent, useState } from 'react';
import { Building2, Plus, Power } from 'lucide-react';
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  type BusinessType,
  SUBSCRIPTION_STATUS_LABELS,
  SUPPORTED_COUNTRIES,
} from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { PlatformOrganization } from '@/lib/types';
import { useApi } from '@/lib/use-api';

interface CreatedOrganization {
  ownerEmail: string;
  ownerLoginId: string;
  temporaryPassword: string;
}

export default function AdminOrganisationsPage() {
  const orgs = useApi<PlatformOrganization[]>('/platform/organizations');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedOrganization | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function toggle(o: PlatformOrganization) {
    const next = o.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    if (
      next === 'SUSPENDED' &&
      !window.confirm(`Suspendre ${o.name} ? Tous ses utilisateurs seront déconnectés.`)
    )
      return;
    setError(null);
    try {
      await api(`/platform/organizations/${o.id}/status`, {
        method: 'PATCH',
        body: { status: next },
      });
      orgs.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    }
  }

  const addButton = (
    <Button onClick={() => setCreating(true)} icon={<Plus className="h-4 w-4" />}>
      Nouvelle organisation
    </Button>
  );

  return (
    <>
      <PageHeader
        eyebrow="Super Admin"
        title="Organisations"
        description="Organisations clientes, statut et abonnement. Les données métier des clients ne sont pas accessibles ici."
        action={addButton}
      />
      <div className="mb-4">
        <ApiErrorAlert error={error} />
      </div>
      <Card>
        {orgs.state === 'loading' && <LoadingState />}
        {orgs.state === 'error' && <ErrorState error={orgs.error} onRetry={orgs.reload} />}
        {orgs.state === 'success' && orgs.data.length === 0 && (
          <EmptyState
            icon={<Building2 className="h-7 w-7" />}
            title="Aucune organisation"
            description="Les organisations inscrites ou créées ici apparaîtront dans cette liste."
            action={addButton}
          />
        )}
        {orgs.state === 'success' && orgs.data.length > 0 && (
          <Table
            head={['Organisation', 'Métier', 'Pays', 'Sites / comptes', 'Abonnement', 'Statut', '']}
          >
            {orgs.data.map((o) => (
              <tr key={o.id}>
                <Td>
                  <p className="font-semibold">{o.name}</p>
                  <p className="text-xs text-muted">
                    <span className="font-mono">{o.code}</span> · créée le {formatDate(o.createdAt)}
                  </p>
                </Td>
                <Td>{BUSINESS_TYPE_LABELS[o.businessType]}</Td>
                <Td>{o.countryCode}</Td>
                <Td>
                  {o.establishmentsCount} / {o.accountsCount}
                </Td>
                <Td>
                  {o.subscription
                    ? `${o.subscription.plan.name} · ${SUBSCRIPTION_STATUS_LABELS[o.subscription.status]}`
                    : '—'}
                </Td>
                <Td>
                  {o.status === 'ACTIVE' ? (
                    <Badge tone="forest">Active</Badge>
                  ) : (
                    <Badge tone="terracotta">Suspendue</Badge>
                  )}
                </Td>
                <Td>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggle(o)}
                    icon={<Power className="h-4 w-4" />}
                  >
                    {o.status === 'ACTIVE' ? 'Suspendre' : 'Activer'}
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {creating && (
        <CreateOrganizationDialog
          onClose={() => setCreating(false)}
          onCreated={(result) => {
            setCreating(false);
            setCreated(result);
            orgs.reload();
          }}
        />
      )}
      {created && (
        <Dialog
          open
          onClose={() => setCreated(null)}
          title="Organisation créée"
          description="Identifiants du propriétaire, affichés une seule fois."
        >
          <div className="space-y-4">
            <Alert tone="info">
              Transmettez ces identifiants de façon sécurisée. Le propriétaire devra changer son mot
              de passe à la première connexion.
            </Alert>
            <dl className="space-y-2 rounded-xl border border-line bg-ivory/60 p-4 font-mono text-sm">
              <div>E-mail : {created.ownerEmail}</div>
              <div>Identifiant : {created.ownerLoginId}</div>
              <div className="break-all">Mot de passe temporaire : {created.temporaryPassword}</div>
            </dl>
            <div className="flex justify-end">
              <Button onClick={() => setCreated(null)}>Fermer</Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

function CreateOrganizationDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (r: CreatedOrganization) => void;
}) {
  const [form, setForm] = useState({
    organizationName: '',
    businessType: 'PARK' as BusinessType,
    countryCode: 'ML',
    establishmentName: '',
    ownerFirstName: '',
    ownerLastName: '',
    ownerEmail: '',
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      onCreated(
        await api<CreatedOrganization>('/platform/organizations', { method: 'POST', body: form }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
      setLoading(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Nouvelle organisation">
      <form onSubmit={onSubmit} className="space-y-4">
        <ApiErrorAlert error={error} />
        <InputField
          label="Nom commercial"
          value={form.organizationName}
          onChange={set('organizationName')}
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Métier"
            value={form.businessType}
            onChange={set('businessType')}
            options={BUSINESS_TYPES.map((t) => ({ value: t, label: BUSINESS_TYPE_LABELS[t] }))}
          />
          <SelectField
            label="Pays"
            value={form.countryCode}
            onChange={set('countryCode')}
            options={SUPPORTED_COUNTRIES.map((c) => ({ value: c.code, label: c.label }))}
          />
        </div>
        <InputField
          label="Premier établissement"
          value={form.establishmentName}
          onChange={set('establishmentName')}
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField
            label="Prénom du propriétaire"
            value={form.ownerFirstName}
            onChange={set('ownerFirstName')}
            required
          />
          <InputField
            label="Nom du propriétaire"
            value={form.ownerLastName}
            onChange={set('ownerLastName')}
            required
          />
        </div>
        <InputField
          label="E-mail du propriétaire"
          type="email"
          value={form.ownerEmail}
          onChange={set('ownerEmail')}
          required
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={loading}>
            Créer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
