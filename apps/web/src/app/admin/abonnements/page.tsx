'use client';

import { useState } from 'react';
import { CreditCard, Save } from 'lucide-react';
import {
  ACTIVATION_MODES,
  ACTIVATION_MODE_LABELS,
  type ActivationMode,
  BUSINESS_TYPE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  formatXof,
} from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { Plan, PlatformSubscription } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function AdminAbonnementsPage() {
  const plans = useApi<Plan[]>('/platform/plans');
  const subs = useApi<PlatformSubscription[]>('/platform/subscriptions');

  return (
    <>
      <PageHeader
        eyebrow="Super Admin"
        title="Abonnements et offres"
        description="Prix des offres et abonnements des organisations. Aucun paiement réel n’est encore traité."
      />
      <Card className="mb-6">
        <CardHeader
          title="Offres"
          description="Les prix modifiés ici s’appliquent à la page Tarifs et aux nouveaux abonnements."
        />
        <CardBody>
          {plans.state === 'loading' && <LoadingState />}
          {plans.state === 'error' && <ErrorState error={plans.error} onRetry={plans.reload} />}
          {plans.state === 'success' && (
            <div className="grid gap-4 md:grid-cols-3">
              {plans.data.map((p) => (
                <PlanEditor key={p.id} plan={p} onSaved={plans.reload} />
              ))}
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Abonnements" />
        {subs.state === 'loading' && <LoadingState />}
        {subs.state === 'error' && <ErrorState error={subs.error} onRetry={subs.reload} />}
        {subs.state === 'success' && subs.data.length === 0 && (
          <EmptyState
            icon={<CreditCard className="h-7 w-7" />}
            title="Aucun abonnement"
            description="Les abonnements sont créés à l’inscription des organisations."
          />
        )}
        {subs.state === 'success' && subs.data.length > 0 && (
          <Table head={['Organisation', 'Offre', 'Prix', 'Statut', 'Début', 'Échéance']}>
            {subs.data.map((s) => (
              <tr key={s.id}>
                <Td>
                  <p className="font-semibold">{s.organization.name}</p>
                  <p className="text-xs text-muted">
                    {BUSINESS_TYPE_LABELS[s.organization.businessType]}
                  </p>
                </Td>
                <Td>{s.plan.name}</Td>
                <Td>{formatXof(s.plan.monthlyPrice)}</Td>
                <Td>
                  <Badge
                    tone={
                      s.status === 'ACTIVE'
                        ? 'forest'
                        : s.status === 'NOT_ACTIVATED'
                          ? 'savanna'
                          : 'terracotta'
                    }
                  >
                    {SUBSCRIPTION_STATUS_LABELS[s.status]}
                  </Badge>
                </Td>
                <Td className="text-muted">{formatDate(s.startedAt)}</Td>
                <Td className="text-muted">{formatDate(s.expiresAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

function PlanEditor({ plan, onSaved }: { plan: Plan; onSaved: () => void }) {
  const [price, setPrice] = useState(String(plan.monthlyPrice));
  const [setup, setSetup] = useState(String(plan.setupFee));
  const [aiQuota, setAiQuota] = useState(String(plan.aiMonthlyCallQuota ?? ''));
  const [storageQuota, setStorageQuota] = useState(String(plan.storageQuotaMb ?? ''));
  const [mode, setMode] = useState<ActivationMode>(plan.activationMode ?? 'ADMIN_APPROVAL');
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const value = Number(price);
  const setupValue = Number(setup);
  const aiValue = Number(aiQuota);
  const storageValue = Number(storageQuota);
  const valid = [value, setupValue, aiValue, storageValue].every(
    (n) => Number.isInteger(n) && n >= 0,
  );
  const changed =
    value !== plan.monthlyPrice ||
    setupValue !== plan.setupFee ||
    aiValue !== plan.aiMonthlyCallQuota ||
    storageValue !== plan.storageQuotaMb ||
    mode !== plan.activationMode;

  async function save() {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      await api(`/platform/plans/${plan.id}`, {
        method: 'PATCH',
        body: {
          monthlyPrice: value,
          setupFee: setupValue,
          aiMonthlyCallQuota: aiValue,
          storageQuotaMb: storageValue,
          activationMode: mode,
        },
      });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-line p-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold">{plan.name}</p>
        {plan.isActive === false && <Badge>Inactive</Badge>}
      </div>
      <InputField
        label="Prix mensuel (FCFA)"
        type="number"
        min={0}
        step={500}
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        error={valid ? undefined : 'Montant entier positif attendu.'}
      />
      <InputField
        label="Mise en service (FCFA, une fois)"
        type="number"
        min={0}
        step={5000}
        value={setup}
        onChange={(e) => setSetup(e.target.value)}
      />
      <SelectField
        label="Activation après paiement vérifié"
        hint="Figé pour chaque nouvel abonnement : un changement n’est jamais rétroactif."
        value={mode}
        onChange={(e) => setMode(e.target.value as ActivationMode)}
        options={ACTIVATION_MODES.map((m) => ({ value: m, label: ACTIVATION_MODE_LABELS[m] }))}
      />
      <div className="grid grid-cols-2 gap-3">
        <InputField
          label="Appels IA / mois"
          type="number"
          min={0}
          value={aiQuota}
          onChange={(e) => setAiQuota(e.target.value)}
        />
        <InputField
          label="Stockage (Mo)"
          type="number"
          min={0}
          value={storageQuota}
          onChange={(e) => setStorageQuota(e.target.value)}
        />
      </div>
      <ApiErrorAlert error={error} />
      {saved && <Alert tone="success">Offre enregistrée.</Alert>}
      <Button
        size="sm"
        variant="secondary"
        onClick={save}
        loading={loading}
        disabled={!valid || !changed}
        icon={<Save className="h-4 w-4" />}
      >
        Enregistrer
      </Button>
    </div>
  );
}
