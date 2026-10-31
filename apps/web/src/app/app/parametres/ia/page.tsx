'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { Eraser, Save } from 'lucide-react';
import { AI_FEATURE_LABELS, AI_MAX_RETENTION_DAYS, type AiFeature } from '@ocall/shared';
import { AiUsageNotice } from '@/components/ai/ai-availability';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { AiSettings, AiStatus, AiUsageReport } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const TOGGLES: Array<{ key: keyof AiSettings; feature: AiFeature }> = [
  { key: 'catalogImportEnabled', feature: 'CATALOG_IMPORT' },
  { key: 'ticketImportEnabled', feature: 'TICKET_IMPORT' },
  { key: 'copilotEnabled', feature: 'COPILOT' },
  { key: 'voiceOrderEnabled', feature: 'VOICE_ORDER' },
];

/** Réglages IA de l'organisation et consommation du mois (coûts ESTIMÉS). */
export default function AiSettingsPage() {
  const canManage = useCan('ai.manage');
  if (!canManage) return <AccessDenied />;
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Paramètres"
        title="Intelligence artificielle"
        description="Activez chaque fonctionnalité séparément, fixez un plafond mensuel et la durée de conservation. Les fichiers et enregistrements vocaux ne sont jamais conservés."
      />
      <SettingsForm />
      <Usage />
    </div>
  );
}

function SettingsForm() {
  const settings = useApi<AiSettings>('/ai/settings');
  const status = useApi<AiStatus>('/ai/status');
  const [form, setForm] = useState<AiSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // Référence stable (état de useApi) : la saisie n'est pas réinitialisée à chaque rendu.
  const loaded = settings.state === 'success' ? settings.data : null;
  useEffect(() => {
    if (loaded) setForm(loaded);
  }, [loaded]);

  if (settings.state === 'loading' || !form) return <LoadingState />;
  if (settings.state === 'error')
    return <ErrorState error={settings.error} onRetry={settings.reload} />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const { platformLimit: _platformLimit, ...body } = form;
      setForm(await api<AiSettings>('/ai/settings', { method: 'PUT', body }));
      setSaved(true);
      status.reload();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4 sm:p-5">
      <form onSubmit={onSubmit} className="space-y-4">
        {status.state === 'success' && !status.data.configured && (
          <Alert tone="info" title="IA non activée sur cette plateforme">
            Les réglages s’appliqueront dès son activation par l’éditeur.
          </Alert>
        )}
        {status.state === 'success' && <AiUsageNotice status={status.data} />}
        <fieldset className="space-y-2">
          <legend className="mb-1 font-semibold">Fonctionnalités</legend>
          {TOGGLES.map(({ key, feature }) => (
            <label key={key} className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                className="h-5 w-5 accent-forest"
                checked={Boolean(form[key])}
                onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
              />
              {AI_FEATURE_LABELS[feature]}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <InputField
            label="Plafond mensuel d’appels"
            type="number"
            min={0}
            max={form.platformLimit ?? 1_000_000}
            hint={
              form.platformLimit !== undefined
                ? `Votre offre Ocall autorise ${form.platformLimit} appels par mois au plus.`
                : undefined
            }
            value={form.monthlyCallLimit}
            onChange={(e) => setForm({ ...form, monthlyCallLimit: Number(e.target.value) })}
          />
          <InputField
            label="Alerte à (% du plafond)"
            type="number"
            min={1}
            max={100}
            value={form.alertPercent}
            onChange={(e) => setForm({ ...form, alertPercent: Number(e.target.value) })}
          />
          <InputField
            label="Conservation (jours)"
            hint="Transcriptions et résultats d’import."
            type="number"
            min={1}
            max={AI_MAX_RETENTION_DAYS}
            value={form.retentionDays}
            onChange={(e) => setForm({ ...form, retentionDays: Number(e.target.value) })}
          />
        </div>
        <ApiErrorAlert error={error} />
        {saved && <Alert tone="success">Réglages enregistrés.</Alert>}
        <Button type="submit" loading={saving} icon={<Save className="h-4 w-4" />}>
          Enregistrer
        </Button>
      </form>
    </Card>
  );
}

function Usage() {
  const usage = useApi<AiUsageReport>('/ai/usage');
  const [purged, setPurged] = useState<string | null>(null);
  if (usage.state === 'loading') return <LoadingState />;
  if (usage.state === 'error') return <ErrorState error={usage.error} onRetry={usage.reload} />;
  const r = usage.data;
  const totalXof = r.rows.reduce((s, row) => s + row.estimatedCostXof, 0);
  const totalCalls = r.rows.reduce((s, row) => s + row.calls, 0);
  return (
    <Card>
      <CardHeader
        title="Consommation du mois"
        description={`Depuis le ${formatDateTime(r.since)}. Coûts ESTIMÉS d’après les tarifs publics du fournisseur (1 USD ≈ ${r.usdXofRate} FCFA) : seule sa facture fait foi.`}
        action={
          <Button
            size="sm"
            variant="secondary"
            icon={<Eraser className="h-4 w-4" />}
            onClick={async () => {
              const res = await api<{ imports: number; voiceDrafts: number }>('/ai/purge', {
                method: 'POST',
              });
              setPurged(
                `${res.imports} résultat(s) d’import et ${res.voiceDrafts} transcription(s) effacé(s).`,
              );
            }}
          >
            Purger l’échu
          </Button>
        }
      />
      <div className="space-y-3 px-5 pb-5 pt-4 sm:px-6">
        {purged && <Alert tone="success">{purged}</Alert>}
        <p className="text-[15px]">
          <strong>{totalCalls}</strong> appel(s) · coût estimé ≈{' '}
          <strong>{totalXof.toLocaleString('fr-FR')} FCFA</strong>
          {r.unestimatedCalls > 0 && ` (+ ${r.unestimatedCalls} appel(s) non estimable(s))`}
        </p>
        {r.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-2 pr-3 font-medium">Fonctionnalité</th>
                  <th className="py-2 pr-3 font-medium">Établissement</th>
                  <th className="py-2 pr-3 font-medium">Statut</th>
                  <th className="py-2 pr-3 text-right font-medium">Appels</th>
                  <th className="py-2 text-right font-medium">Coût estimé</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {r.rows.map((row, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-3">{AI_FEATURE_LABELS[row.feature]}</td>
                    <td className="py-2 pr-3">{row.establishmentName ?? '—'}</td>
                    <td className="py-2 pr-3">
                      {row.status === 'SUCCEEDED'
                        ? 'Réussi'
                        : row.status === 'FAILED'
                          ? 'Échec'
                          : 'En cours'}
                    </td>
                    <td className="py-2 pr-3 text-right">{row.calls}</td>
                    <td className="py-2 text-right">
                      ≈ {row.estimatedCostXof.toLocaleString('fr-FR')} FCFA
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
