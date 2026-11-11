'use client';

import { type FormEvent, useEffect, useState } from 'react';
import {
  FACTURE_AI_FEATURE_LABELS,
  FACTURE_AI_PROPOSAL_STATUS_LABELS,
  type FactureAiFeature,
  type FactureAiProposalStatus,
} from '@ocall/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

/** Réglages de chaque fonctionnalité : colonne d'activation et de plafond. */
const FEATURES = [
  { feature: 'FACTURE_REPORT', enabled: 'reportEnabled', limit: 'reportMonthlyLimit' },
  { feature: 'FACTURE_QUOTE', enabled: 'quoteEnabled', limit: 'quoteMonthlyLimit' },
  { feature: 'FACTURE_PLANNING', enabled: 'planningEnabled', limit: 'planningMonthlyLimit' },
  {
    feature: 'FACTURE_MAINTENANCE',
    enabled: 'maintenanceEnabled',
    limit: 'maintenanceMonthlyLimit',
  },
] as const;
type EnabledKey = (typeof FEATURES)[number]['enabled'];
type LimitKey = (typeof FEATURES)[number]['limit'];

interface AiSettingsView extends Record<EnabledKey, boolean>, Record<LimitKey, number> {
  enabled: boolean;
  ceiling: number;
  configured: boolean;
  usedThisMonth: Record<FactureAiFeature, number>;
}

interface ProposalRow {
  id: string;
  feature: FactureAiFeature;
  status: FactureAiProposalStatus;
  createdAt: string;
  edited: boolean;
  promptId: string;
  promptVersion: number;
}

type Values = Pick<AiSettingsView, 'enabled' | EnabledKey | LimitKey>;

const dateTimeFr = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    timeZone: 'UTC',
    dateStyle: 'short',
    timeStyle: 'short',
  });

/**
 * Module IA (F6A, F6B) : activation, fonctionnalités, plafonds mensuels sous le plafond Ocall, consommation du
 * mois et traçabilité des propositions (qui, quand, appliquée ou rejetée, corrigée ou non).
 */
export function AiSettings({ editable }: { editable: boolean }) {
  const res = useApi<AiSettingsView>('/facture/ai/settings');
  const proposals = useApi<ProposalRow[]>(editable ? '/facture/ai/proposals' : null);
  const [values, setValues] = useState<Values | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const data = res.state === 'success' ? res.data : null;

  useEffect(() => {
    if (!data) return;
    const next = { enabled: data.enabled } as Values;
    for (const f of FEATURES) {
      next[f.enabled] = data[f.enabled];
      next[f.limit] = data[f.limit];
    }
    setValues(next);
  }, [data]);

  if (!data || !values) return res.state === 'error' ? null : <LoadingState />;

  const toggle = (key: 'enabled' | EnabledKey, label: string) => (
    <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
      <input
        type="checkbox"
        className="h-5 w-5 accent-forest"
        data-testid={`facture-ai-${key}`}
        checked={values[key]}
        disabled={!editable}
        onChange={(e) => {
          setSaved(false);
          setValues({ ...values, [key]: e.target.checked });
        }}
      />
      {label}
    </label>
  );

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/facture/ai/settings', { method: 'PUT', body: values });
      setSaved(true);
      res.reload();
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Assistant IA"
        description="L’IA propose, vous décidez : aucun rapport, aucun devis n’est enregistré sans votre validation."
      />
      <CardBody>
        <form className="space-y-4" onSubmit={save} data-testid="facture-ai-settings">
          {!data.configured && (
            <Alert tone="info" title="L’IA n’est pas encore activée sur la plateforme Ocall." />
          )}
          {toggle('enabled', 'Activer l’assistant IA pour mon entreprise')}
          <div className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div key={f.feature} className="space-y-2">
                {toggle(f.enabled, FACTURE_AI_FEATURE_LABELS[f.feature])}
                <InputField
                  label={`Plafond mensuel — ${FACTURE_AI_FEATURE_LABELS[f.feature]}`}
                  type="number"
                  min={0}
                  max={data.ceiling}
                  disabled={!editable}
                  value={String(values[f.limit])}
                  hint={`Utilisés ce mois : ${data.usedThisMonth[f.feature]} · plafond Ocall : ${data.ceiling}`}
                  onChange={(e) => setValues({ ...values, [f.limit]: Number(e.target.value) })}
                />
              </div>
            ))}
          </div>
          <ApiErrorAlert error={error} />
          {saved && <p className="text-sm font-medium text-forest">Réglages IA enregistrés.</p>}
          {editable && (
            <Button type="submit" loading={busy}>
              Enregistrer l’assistant IA
            </Button>
          )}
        </form>
        {proposals.state === 'success' && proposals.data.length > 0 && (
          <div className="mt-6 space-y-2">
            <h3 className="text-sm font-semibold text-charcoal">Dernières propositions de l’IA</h3>
            <ul className="divide-y divide-line/70 text-sm" data-testid="facture-ai-proposals">
              {proposals.data.slice(0, 20).map((p) => (
                <li key={p.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    {FACTURE_AI_FEATURE_LABELS[p.feature]} · {dateTimeFr(p.createdAt)}
                    <span className="block text-xs text-muted">
                      {p.promptId} v{p.promptVersion}
                    </span>
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {FACTURE_AI_PROPOSAL_STATUS_LABELS[p.status]}
                    {p.status === 'APPLIED' && p.edited ? ' (corrigée)' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
