'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { Sparkles } from 'lucide-react';
import {
  STOCK_AI_FEATURE_LABELS,
  STOCK_RESTOCK_PRIORITY_LABELS,
  STOCK_STOCKOUT_RISK_LABELS,
  type StockAiFeature,
  type StockRestockPriority,
  type StockStockoutRisk,
  formatStockQuantity,
  formatXof,
} from '@ocall/shared';
import { StockPage } from '@/components/stock/stock-page';
import { type StockSiteView, asApiError } from '@/components/stock/stock-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface SettingsView {
  enabled: boolean;
  restockEnabled: boolean;
  stockoutEnabled: boolean;
  analysisEnabled: boolean;
  photoEnabled: boolean;
  illustrationEnabled: boolean;
  restockMonthlyLimit: number;
  stockoutMonthlyLimit: number;
  analysisMonthlyLimit: number;
  photoMonthlyLimit: number;
  illustrationMonthlyLimit: number;
  configured: boolean;
  ceilings: { monthlyCeiling: number; imageMonthlyCeiling: number };
  usage: { feature: StockAiFeature; used: number; limit: number }[];
}

interface RestockLine {
  variantId: string;
  sku: string;
  label: string;
  unit: string;
  unitCost: number;
  costKnown: boolean;
  out90: number;
  available: number;
  incoming: number;
  minStock: number | null;
  quantity: number;
  daysLeft: number | null;
  priority: StockRestockPriority;
  reason: string;
}

interface RestockResult {
  proposal: { id: string } | null;
  lines: RestockLine[];
  summary?: string;
  supplier: { name: string };
  leadTimeDays: number;
  leadAssumed: boolean;
  scope: 'SUPPLIER' | 'ALL';
}

interface StockoutItem {
  variantId: string;
  siteId: string;
  siteName: string;
  label: string;
  sku: string;
  unit: string;
  available: number;
  daysMin: number;
  daysMax: number;
  risk: StockStockoutRisk;
  leadTimeDays: number;
  leadAssumed: boolean;
  explanation: string;
}

interface AnalysisResult {
  summary: string;
  trends: string[];
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  facts: string[];
  period: { from: string; to: string };
}

const SETTINGS_FIELDS: {
  feature: StockAiFeature;
  enabled: keyof SettingsView;
  limit: keyof SettingsView;
}[] = [
  { feature: 'STOCK_RESTOCK', enabled: 'restockEnabled', limit: 'restockMonthlyLimit' },
  { feature: 'STOCK_STOCKOUT', enabled: 'stockoutEnabled', limit: 'stockoutMonthlyLimit' },
  { feature: 'STOCK_ANALYSIS', enabled: 'analysisEnabled', limit: 'analysisMonthlyLimit' },
  { feature: 'STOCK_PRODUCT_PHOTO', enabled: 'photoEnabled', limit: 'photoMonthlyLimit' },
  {
    feature: 'STOCK_ILLUSTRATION',
    enabled: 'illustrationEnabled',
    limit: 'illustrationMonthlyLimit',
  },
];

/**
 * Assistant IA d'Ocall Stock (S8) : réapprovisionnement, prévision des ruptures, analyse commerciale.
 * L'IA propose, vous décidez : les chiffres sont calculés par Ocall Stock, l'IA explique et classe. Rien
 * n'est modifié sans votre action (une commande n'est créée qu'en brouillon).
 */
export default function StockAiPage() {
  return (
    <StockPage
      title="Assistant IA"
      description="Réapprovisionnement, ruptures et analyse commerciale : l’IA propose, vous décidez."
    >
      {({ can, canWrite }) => (
        <>
          <Settings manage={canWrite('stock.settings.manage')} />
          {canWrite('stock.ai.use') ? (
            <>
              <Restock canOrder={canWrite('stock.purchases.manage')} />
              <Stockouts />
              {can('stock.sales.read') && <Analysis />}
            </>
          ) : (
            <Alert tone="info" title="Les assistants IA ne sont pas ouverts à votre rôle." />
          )}
        </>
      )}
    </StockPage>
  );
}

function Settings({ manage }: { manage: boolean }) {
  const res = useApi<SettingsView>('/ocall-stock/ai/settings');
  const [draft, setDraft] = useState<SettingsView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  if (res.state === 'loading') return <LoadingState />;
  if (res.state === 'error') return <ErrorState error={res.error} onRetry={res.reload} />;
  const v = draft ?? res.data;
  const set = (patch: Partial<SettingsView>) => {
    setSaved(false);
    setDraft({ ...v, ...patch });
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body = Object.fromEntries(
        ['enabled', ...SETTINGS_FIELDS.flatMap((f) => [f.enabled, f.limit])].map((k) => [
          k,
          v[k as keyof SettingsView],
        ]),
      );
      await api('/ocall-stock/ai/settings', { method: 'PUT', body });
      setDraft(null);
      setSaved(true);
      res.reload();
    } catch (err) {
      setError(asApiError(err));
    }
  }

  return (
    <Card>
      <CardHeader
        title="Réglages et consommation"
        description={`Plafonds Ocall par mois : ${res.data.ceilings.monthlyCeiling} appels par fonctionnalité, ${res.data.ceilings.imageMonthlyCeiling} illustrations.`}
        action={
          res.data.enabled ? <Badge tone="forest">IA activée</Badge> : <Badge>IA désactivée</Badge>
        }
      />
      <CardBody>
        {!res.data.configured && (
          <Alert tone="info" title="L’IA n’est pas activée sur la plateforme">
            Ocall Stock fonctionne normalement sans IA.
          </Alert>
        )}
        <form className="space-y-4" onSubmit={save} data-testid="stock-ai-settings">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              disabled={!manage}
              checked={v.enabled}
              onChange={(e) => set({ enabled: e.target.checked })}
            />
            Activer l’IA pour mon entreprise
          </label>
          <div className="overflow-x-auto">
            <Table head={['Fonctionnalité', 'Active', 'Plafond / mois', 'Utilisé ce mois']}>
              {SETTINGS_FIELDS.map((f) => {
                const usage = res.data.usage.find((u) => u.feature === f.feature);
                return (
                  <tr key={f.feature}>
                    <Td>{STOCK_AI_FEATURE_LABELS[f.feature]}</Td>
                    <Td>
                      <input
                        type="checkbox"
                        aria-label={`Activer : ${STOCK_AI_FEATURE_LABELS[f.feature]}`}
                        disabled={!manage}
                        checked={Boolean(v[f.enabled])}
                        onChange={(e) => set({ [f.enabled]: e.target.checked })}
                      />
                    </Td>
                    <Td>
                      <input
                        type="number"
                        min={0}
                        max={100000}
                        aria-label={`Plafond : ${STOCK_AI_FEATURE_LABELS[f.feature]}`}
                        disabled={!manage}
                        value={String(v[f.limit])}
                        onChange={(e) => set({ [f.limit]: Number(e.target.value) })}
                        className="w-24 rounded-lg border border-line px-2 py-1"
                      />
                    </Td>
                    <Td>{usage ? `${usage.used} / ${usage.limit}` : '—'}</Td>
                  </tr>
                );
              })}
            </Table>
          </div>
          <ApiErrorAlert error={error} />
          {saved && <p className="text-sm font-medium text-forest">Réglages IA enregistrés.</p>}
          {manage && <Button type="submit">Enregistrer</Button>}
        </form>
      </CardBody>
    </Card>
  );
}

function SitePicker({
  value,
  onChange,
  label,
  allowAll = false,
}: {
  value: string;
  onChange: (id: string) => void;
  label: string;
  allowAll?: boolean;
}) {
  const sites = useApi<StockSiteView[]>('/ocall-stock/sites');
  return (
    <SelectField
      label={label}
      value={value}
      required={!allowAll}
      onChange={(e) => onChange(e.target.value)}
      options={[
        { value: '', label: allowAll ? 'Tous mes sites' : 'Choisir…' },
        ...(sites.state === 'success' ? sites.data : [])
          .filter((s) => !s.isArchived)
          .map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` })),
      ]}
    />
  );
}

function Restock({ canOrder }: { canOrder: boolean }) {
  const suppliers =
    useApi<{ id: string; name: string; isArchived: boolean }[]>('/ocall-stock/suppliers');
  const [siteId, setSiteId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [coverDays, setCoverDays] = useState('14');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<RestockResult | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [kept, setKept] = useState<Record<string, boolean>>({});
  const [order, setOrder] = useState<string | null>(null);

  async function suggest(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOrder(null);
    try {
      const r = await api<RestockResult>('/ocall-stock/ai/restock', {
        method: 'POST',
        body: { siteId, supplierId, coverDays: Number(coverDays) },
      });
      setResult(r);
      setQuantities(Object.fromEntries(r.lines.map((l) => [l.variantId, String(l.quantity)])));
      setKept(Object.fromEntries(r.lines.map((l) => [l.variantId, true])));
    } catch (err) {
      setError(asApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function createOrder() {
    if (!result?.proposal) return;
    setError(null);
    try {
      const p = await api<{ resultId: string }>(
        `/ocall-stock/ai/proposals/${result.proposal.id}/apply`,
        {
          method: 'POST',
          body: {
            lines: result.lines
              .filter((l) => kept[l.variantId])
              .map((l) => ({ variantId: l.variantId, quantity: Number(quantities[l.variantId]) })),
          },
        },
      );
      setOrder(p.resultId);
    } catch (err) {
      setError(asApiError(err));
    }
  }

  return (
    <Card>
      <CardHeader
        title={STOCK_AI_FEATURE_LABELS.STOCK_RESTOCK}
        description="Quantités calculées sur vos sorties réelles (90 jours), votre disponible, vos commandes en cours et le délai du fournisseur. L’IA classe et explique ; vous validez."
      />
      <CardBody className="space-y-4">
        <form
          className="grid gap-3 sm:grid-cols-4 sm:items-end"
          onSubmit={suggest}
          data-testid="stock-ai-restock-form"
        >
          <SitePicker label="Site à réapprovisionner" value={siteId} onChange={setSiteId} />
          <SelectField
            label="Fournisseur"
            required
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            options={[
              { value: '', label: 'Choisir…' },
              ...(suppliers.state === 'success' ? suppliers.data : [])
                .filter((s) => !s.isArchived)
                .map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
          <InputField
            label="Couverture visée (jours)"
            type="number"
            min={0}
            max={120}
            value={coverDays}
            onChange={(e) => setCoverDays(e.target.value)}
          />
          <Button type="submit" loading={busy} disabled={!siteId || !supplierId}>
            <Sparkles className="h-4 w-4" aria-hidden /> Proposer une commande
          </Button>
        </form>
        <ApiErrorAlert error={error} />
        {result && result.lines.length === 0 && (
          <p className="text-sm text-muted">Rien à commander : le stock couvre la période visée.</p>
        )}
        {result && result.lines.length > 0 && (
          <div className="space-y-3" data-testid="stock-ai-restock-result">
            {result.summary && <p className="text-sm">{result.summary}</p>}
            <p className="text-xs text-muted">
              Délai {result.supplier.name} : {result.leadTimeDays} jours
              {result.leadAssumed ? ' (non renseigné sur la fiche fournisseur : supposé)' : ''}
              {result.scope === 'ALL'
                ? ' · aucun article encore reçu de ce fournisseur : tous les articles qui sortent sont considérés.'
                : ''}
            </p>
            <div className="overflow-x-auto">
              <Table
                head={[
                  '',
                  'Article',
                  'Sorties 90 j',
                  'Disponible',
                  'Commandé',
                  'Priorité',
                  'Quantité',
                ]}
              >
                {result.lines.map((l) => (
                  <tr key={l.variantId}>
                    <Td>
                      <input
                        type="checkbox"
                        aria-label={`Retenir : ${l.label}`}
                        checked={kept[l.variantId] ?? false}
                        onChange={(e) => setKept({ ...kept, [l.variantId]: e.target.checked })}
                      />
                    </Td>
                    <Td>
                      <span className="block font-semibold">{l.label}</span>
                      <span className="block text-xs text-muted">{l.reason}</span>
                      {!l.costKnown && (
                        <span className="block text-xs text-terracotta-dark">
                          Coût inconnu : à saisir dans le brouillon.
                        </span>
                      )}
                    </Td>
                    <Td>{formatStockQuantity(l.out90)}</Td>
                    <Td>{formatStockQuantity(l.available)}</Td>
                    <Td>{formatStockQuantity(l.incoming)}</Td>
                    <Td>
                      <Badge
                        tone={
                          l.priority === 'HIGH'
                            ? 'terracotta'
                            : l.priority === 'MEDIUM'
                              ? 'savanna'
                              : 'neutral'
                        }
                      >
                        {STOCK_RESTOCK_PRIORITY_LABELS[l.priority]}
                      </Badge>
                    </Td>
                    <Td>
                      <input
                        type="number"
                        min={0.001}
                        step="any"
                        aria-label={`Quantité : ${l.label}`}
                        value={quantities[l.variantId] ?? ''}
                        onChange={(e) =>
                          setQuantities({ ...quantities, [l.variantId]: e.target.value })
                        }
                        className="w-24 rounded-lg border border-line px-2 py-1"
                      />{' '}
                      <span className="text-xs text-muted">{l.unit}</span>
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
            {order ? (
              <Alert tone="success" title="Commande brouillon créée">
                <Link href={`/stock/achats/${order}`} className="font-semibold underline">
                  Ouvrir le brouillon
                </Link>{' '}
                pour le vérifier, puis le passer vous-même au fournisseur.
              </Alert>
            ) : (
              canOrder &&
              result.proposal && (
                <Button onClick={() => void createOrder()} data-testid="stock-ai-restock-order">
                  Créer le brouillon de commande
                </Button>
              )
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Stockouts() {
  const [siteId, setSiteId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [items, setItems] = useState<StockoutItem[] | null>(null);
  const [summary, setSummary] = useState('');

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ items: StockoutItem[]; summary?: string }>(
        '/ocall-stock/ai/stockouts',
        {
          method: 'POST',
          body: siteId ? { siteId } : {},
        },
      );
      setItems(r.items);
      setSummary(r.summary ?? '');
    } catch (err) {
      setError(asApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={STOCK_AI_FEATURE_LABELS.STOCK_STOCKOUT}
        description="Estimation prudente des jours avant épuisement, à partir des sorties sur 30 et 90 jours. Ce n’est jamais une garantie."
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full max-w-xs">
            <SitePicker label="Site" value={siteId} onChange={setSiteId} allowAll />
          </div>
          <Button loading={busy} onClick={() => void run()} data-testid="stock-ai-stockouts-run">
            <Sparkles className="h-4 w-4" aria-hidden /> Prévoir les ruptures
          </Button>
        </div>
        <ApiErrorAlert error={error} />
        {items && items.length === 0 && (
          <p className="text-sm text-muted">Aucun article à risque au rythme actuel des sorties.</p>
        )}
        {items && items.length > 0 && (
          <div className="space-y-2" data-testid="stock-ai-stockouts">
            {summary && <p className="text-sm">{summary}</p>}
            <ul className="divide-y divide-line">
              {items.map((it) => (
                <li key={`${it.siteId}:${it.variantId}`} className="space-y-1 py-2 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{it.label}</span>
                    <span className="text-muted">· {it.siteName}</span>
                    <Badge tone={it.risk === 'HIGH' ? 'terracotta' : 'savanna'}>
                      {STOCK_STOCKOUT_RISK_LABELS[it.risk]}
                    </Badge>
                  </p>
                  <p className="text-muted">
                    Disponible {formatStockQuantity(it.available)} {it.unit} · épuisement estimé
                    entre {it.daysMin} et {it.daysMax} jours · délai fournisseur {it.leadTimeDays} j
                    {it.leadAssumed ? ' (supposé)' : ''}
                  </p>
                  {it.explanation && <p>{it.explanation}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Analysis() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api<AnalysisResult>('/ocall-stock/ai/analysis', { method: 'POST', body: {} }),
      );
    } catch (err) {
      setError(asApiError(err));
    } finally {
      setBusy(false);
    }
  }

  const block = (title: string, items: string[]) =>
    items.length > 0 && (
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <ul className="list-disc pl-5 text-sm">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </div>
    );

  return (
    <Card>
      <CardHeader
        title={STOCK_AI_FEATURE_LABELS.STOCK_ANALYSIS}
        description="Synthèse des 30 derniers jours comparés aux 30 précédents, à partir des indicateurs du tableau de bord."
      />
      <CardBody className="space-y-4">
        <Button loading={busy} onClick={() => void run()} data-testid="stock-ai-analysis-run">
          <Sparkles className="h-4 w-4" aria-hidden /> Analyser mes ventes
        </Button>
        <ApiErrorAlert error={error} />
        {result && (
          <div className="space-y-3" data-testid="stock-ai-analysis">
            <p>{result.summary}</p>
            {block('Tendances', result.trends)}
            {block('Points forts', result.strengths)}
            {block('Points faibles', result.weaknesses)}
            {block('Suggestions', result.suggestions)}
            <details className="text-xs text-muted">
              <summary>Données utilisées</summary>
              <ul className="mt-1 list-disc pl-5">
                {result.facts.map((f, i) => (
                  <li key={i}>
                    {f.replace(/(\d+) FCFA/g, (_m, n: string) => formatXof(Number(n)))}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
