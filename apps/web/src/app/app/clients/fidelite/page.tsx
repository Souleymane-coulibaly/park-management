'use client';

import { type FormEvent, useState } from 'react';
import { ArrowLeft, Eraser } from 'lucide-react';
import { CUSTOMER_RETENTION_MONTHS, LOYALTY_ACTIVITY_LABELS, formatXof } from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import type { LoyaltyRule } from '@/lib/types';
import { useApi } from '@/lib/use-api';

/** Programmes de fidélité (Parc, Restaurant) et règle de conservation des données clients. */
export default function LoyaltySettingsPage() {
  const canConfigure = useCan('loyalty.configure');
  const canErase = useCan('customer.erase');
  const rules = useApi<LoyaltyRule[]>(canConfigure ? '/loyalty/rules' : null);
  if (!canConfigure) return <AccessDenied />;
  return (
    <div className="space-y-4">
      <ButtonLink href="/app/clients" variant="ghost" size="sm">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Clients
      </ButtonLink>
      <h1 className="text-2xl font-bold">Programmes de fidélité</h1>
      <Alert tone="info">
        Les points sont attribués uniquement quand une vente est payée, une seule fois, sur le
        montant réellement payé. Parc et Restaurant ont des soldes séparés, sans transfert. Une
        utilisation de points est une remise calculée par le serveur, jamais supérieure au total.
      </Alert>
      {rules.state === 'loading' && <LoadingState />}
      {rules.state === 'error' && <ErrorState error={rules.error} onRetry={rules.reload} />}
      {rules.state === 'success' && (
        <div className="grid gap-3 lg:grid-cols-2">
          {rules.data.map((r) => (
            <RuleCard key={r.activity} rule={r} onSaved={rules.reload} />
          ))}
        </div>
      )}
      {canErase && <RetentionCard />}
    </div>
  );
}

function RuleCard({ rule, onSaved }: { rule: LoyaltyRule; onSaved: () => void }) {
  const [form, setForm] = useState({
    isActive: rule.isActive,
    earnAmountStep: String(rule.earnAmountStep),
    redeemValue: String(rule.redeemValue),
    minRedeemPoints: String(rule.minRedeemPoints),
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      await api(`/loyalty/rules/${rule.activity}`, {
        method: 'PUT',
        body: {
          isActive: form.isActive,
          earnAmountStep: Number(form.earnAmountStep),
          redeemValue: Number(form.redeemValue),
          minRedeemPoints: Number(form.minRedeemPoints),
        },
      });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }
  const example = Math.floor(10_000 / Math.max(1, Number(form.earnAmountStep) || 1));
  return (
    <Card>
      <CardHeader title={LOYALTY_ACTIVITY_LABELS[rule.activity]} />
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-3" data-testid={`rule-${rule.activity}`}>
          <ApiErrorAlert error={error} />
          {saved && <Alert tone="success">Règle enregistrée.</Alert>}
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              className="h-4 w-4 accent-forest"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            Programme actif
          </label>
          <InputField
            label="Montant payé pour 1 point (FCFA)"
            type="number"
            min={1}
            required
            value={form.earnAmountStep}
            onChange={(e) => setForm({ ...form, earnAmountStep: e.target.value })}
          />
          <InputField
            label="Valeur d’un point utilisé (FCFA de remise)"
            type="number"
            min={1}
            required
            value={form.redeemValue}
            onChange={(e) => setForm({ ...form, redeemValue: e.target.value })}
          />
          <InputField
            label="Points minimum pour une utilisation"
            type="number"
            min={1}
            required
            value={form.minRedeemPoints}
            onChange={(e) => setForm({ ...form, minRedeemPoints: e.target.value })}
          />
          <p className="text-sm text-muted">
            Exemple : un achat payé de {formatXof(10_000)} rapporte {example} point(s).
          </p>
          <Button type="submit" loading={loading}>
            Enregistrer
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function RetentionCard() {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  return (
    <Card>
      <CardHeader
        title="Conservation des données clients"
        description={`Les fiches sans visite depuis ${CUSTOMER_RETENTION_MONTHS} mois sont anonymisées.`}
      />
      <CardBody className="space-y-3">
        <ApiErrorAlert error={error} />
        {result !== null && <Alert tone="success">{result} fiche(s) anonymisée(s).</Alert>}
        <Button
          variant="secondary"
          icon={<Eraser className="h-4 w-4" />}
          onClick={() => setConfirming(true)}
        >
          Appliquer la règle de conservation
        </Button>
      </CardBody>
      {confirming && (
        <Dialog
          open
          onClose={() => setConfirming(false)}
          title="Appliquer la règle de conservation ?"
        >
          <div className="space-y-4">
            <Alert tone="error">
              Irréversible : les fiches sans visite depuis {CUSTOMER_RETENTION_MONTHS} mois sont
              anonymisées et leurs points annulés.
            </Alert>
            <Button
              variant="danger"
              className="w-full"
              loading={loading}
              onClick={async () => {
                setLoading(true);
                setError(null);
                try {
                  const res = await api<{ anonymized: number }>('/customers/retention/apply', {
                    method: 'POST',
                  });
                  setResult(res.anonymized);
                } catch (e) {
                  setError(e as ApiError);
                }
                setLoading(false);
                setConfirming(false);
              }}
            >
              Appliquer
            </Button>
          </div>
        </Dialog>
      )}
    </Card>
  );
}
