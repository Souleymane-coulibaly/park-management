'use client';

import { useState } from 'react';
import { CreditCard, Save } from 'lucide-react';
import {
  ACTIVATION_MODES,
  ACTIVATION_MODE_LABELS,
  type ActivationMode,
  BUSINESS_TYPE_LABELS,
  PRICING_MODE_LABELS,
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
import type { ParkRestaurantSplit, Plan, PlatformSubscription } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function AdminAbonnementsPage() {
  const plans = useApi<Plan[]>('/platform/plans');
  const subs = useApi<PlatformSubscription[]>('/platform/subscriptions');
  const split = useApi<ParkRestaurantSplit[]>('/platform/subscriptions/park-restaurant-split');

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
      <div data-testid="park-restaurant-split">
        <Card className="mt-6">
          <CardHeader
            title="Séparation Parc / Restaurant — aperçu"
            description="Contrats Ocall Park en cours et ce qu’ils deviendraient avec deux applications indépendantes. Aperçu seulement : aucun contrat ni prix n’est modifié ; la bascule se fera au sprint de retrait de l’offre « Parc + Restaurant », contrat par contrat."
          />
          {split.state === 'loading' && <LoadingState />}
          {split.state === 'error' && <ErrorState error={split.error} onRetry={split.reload} />}
          {split.state === 'success' && split.data.filter((c) => c.combined).length === 0 && (
            <CardBody>
              <p className="text-sm text-muted">
                Aucun contrat ne couvre à la fois parc et restaurant.
              </p>
            </CardBody>
          )}
          {split.state === 'success' && split.data.some((c) => c.combined) && (
            <div className="overflow-x-auto">
              <Table
                head={[
                  'Organisation',
                  'Contrat actuel (conservé)',
                  'Sites parc',
                  'Sites restaurant',
                  'Cible indicative',
                ]}
              >
                {split.data
                  .filter((c) => c.combined)
                  .map((c) => (
                    <tr key={c.subscriptionId}>
                      <Td className="font-semibold">{c.organizationName}</Td>
                      <Td>
                        <p>{c.planName}</p>
                        <p className="text-xs text-muted">{formatXof(c.monthlyAmount)} / mois</p>
                      </Td>
                      <Td>{c.parkSites}</Td>
                      <Td>{c.restaurantSites}</Td>
                      <Td className="text-xs">
                        {c.targets.map((t) => (
                          <p key={t.productCode}>
                            {t.productCode === 'OCALL_PARK' ? 'Ocall Parc' : 'Ocall Restaurant'} :{' '}
                            {t.sites} site(s), {formatXof(t.indicativeMonthly)} / mois
                          </p>
                        ))}
                      </Td>
                    </tr>
                  ))}
              </Table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function PlanEditor({ plan, onSaved }: { plan: Plan; onSaved: () => void }) {
  const [price, setPrice] = useState(String(plan.monthlyPrice));
  const [setup, setSetup] = useState(String(plan.setupFee));
  const [aiQuota, setAiQuota] = useState(String(plan.aiMonthlyCallQuota ?? ''));
  const [storageQuota, setStorageQuota] = useState(String(plan.storageQuotaMb ?? ''));
  const [mode, setMode] = useState<ActivationMode>(plan.activationMode ?? 'ADMIN_APPROVAL');
  const perSite = plan.pricingMode === 'PER_SITE';
  const [extraSite, setExtraSite] = useState(String(plan.extraSiteMonthlyPrice ?? ''));
  const [showcase, setShowcase] = useState(String(plan.showcaseMonthlyPrice ?? ''));
  const [extraApp, setExtraApp] = useState(String(plan.extraAppSetupFee ?? ''));
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const value = Number(price);
  const setupValue = Number(setup);
  const aiValue = Number(aiQuota);
  const storageValue = Number(storageQuota);
  // Étape 6 : prix par site (offre par site seulement ; vitrine si l'offre l'inclut).
  const perSiteBody: Record<string, number> = perSite
    ? {
        extraSiteMonthlyPrice: Number(extraSite),
        extraAppSetupFee: Number(extraApp),
        ...(plan.includesShowcase ? { showcaseMonthlyPrice: Number(showcase) } : {}),
      }
    : {};
  const valid = [value, setupValue, aiValue, storageValue, ...Object.values(perSiteBody)].every(
    (n) => Number.isInteger(n) && n >= 0,
  );
  const changed =
    value !== plan.monthlyPrice ||
    setupValue !== plan.setupFee ||
    aiValue !== plan.aiMonthlyCallQuota ||
    storageValue !== plan.storageQuotaMb ||
    mode !== plan.activationMode ||
    (perSite &&
      (Number(extraSite) !== plan.extraSiteMonthlyPrice ||
        Number(extraApp) !== plan.extraAppSetupFee ||
        (plan.includesShowcase === true && Number(showcase) !== plan.showcaseMonthlyPrice)));

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
          ...perSiteBody,
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
        <div className="flex gap-1.5">
          {perSite && <Badge tone="forest">{PRICING_MODE_LABELS.PER_SITE}</Badge>}
          {plan.isActive === false && <Badge>Inactive</Badge>}
        </div>
      </div>
      <InputField
        label={perSite ? 'Premier site (FCFA / mois)' : 'Prix mensuel (FCFA)'}
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
        hint={perSite ? 'Première application installée de l’organisation.' : undefined}
      />
      {perSite && (
        <>
          <InputField
            label="Site supplémentaire (FCFA / mois)"
            type="number"
            min={0}
            step={500}
            value={extraSite}
            onChange={(e) => setExtraSite(e.target.value)}
          />
          {plan.includesShowcase && (
            <InputField
              label="Supplément vitrine (FCFA / mois)"
              type="number"
              min={0}
              step={500}
              value={showcase}
              onChange={(e) => setShowcase(e.target.value)}
            />
          )}
          <InputField
            label="Mise en service d’une application supplémentaire (FCFA)"
            type="number"
            min={0}
            step={2500}
            value={extraApp}
            onChange={(e) => setExtraApp(e.target.value)}
          />
        </>
      )}
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
