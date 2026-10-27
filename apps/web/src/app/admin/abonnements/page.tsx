'use client';

import { useState } from 'react';
import { CreditCard, Save } from 'lucide-react';
import { BUSINESS_TYPE_LABELS, SUBSCRIPTION_STATUS_LABELS, formatXof } from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
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
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const value = Number(price);
  const valid = Number.isInteger(value) && value >= 0;

  async function save() {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      await api(`/platform/plans/${plan.id}`, { method: 'PATCH', body: { monthlyPrice: value } });
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
      <ApiErrorAlert error={error} />
      {saved && <Alert tone="success">Prix enregistré.</Alert>}
      <Button
        size="sm"
        variant="secondary"
        onClick={save}
        loading={loading}
        disabled={!valid || value === plan.monthlyPrice}
        icon={<Save className="h-4 w-4" />}
      >
        Enregistrer
      </Button>
    </div>
  );
}
