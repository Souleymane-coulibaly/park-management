'use client';

import { useState } from 'react';
import { Building2, RefreshCw, Sparkles } from 'lucide-react';
import {
  COMMERCIAL_STATE_LABELS,
  type CommercialState,
  PARK_APP_PRODUCT_CODES,
  formatXof,
} from '@ocall/shared';
import { useSession } from '@/components/app/session-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface Application {
  code: string;
  name: string;
  state: CommercialState;
  expiresAt: string | null;
  plan?: string;
  planId?: string;
  includesShowcase?: boolean;
  monthlyPrice?: number;
  startedAt?: string | null;
}
interface ClientRow {
  attributionId: string;
  organizationId: string;
  name: string;
  product: { code: string; name: string } | null;
  attributedAt: string | null;
  applications: Application[];
  collected: number;
  commissions: number;
}
interface Product {
  code: string;
  name: string;
  plans: { id: string; name: string; monthlyPrice: number; includesShowcase: boolean }[];
}

const tone = (s: CommercialState) =>
  s === 'ACTIVE' || s === 'TRIAL_ACTIVE'
    ? 'forest'
    : s === 'RENEWAL_PENDING'
      ? 'savanna'
      : s === 'NOT_ACTIVATED'
        ? 'neutral'
        : 'terracotta';

/**
 * Mes clients (Sprint S3) : organisations attribuées par Ocall, par application ; état et échéance des
 * abonnements, encaissé depuis l'attribution, primes générées. Le revendeur voit aussi l'offre et le
 * tarif contractuel, et prépare activation ou renouvellement. Aucune donnée métier du client.
 */
export default function PartnerClientsPage() {
  const me = useSession();
  const reseller = me.partner?.type === 'RESELLER';
  const clients = useApi<ClientRow[]>('/partner/clients');
  const products = useApi<Product[]>(reseller ? '/partner/products' : null);
  return (
    <>
      <PageHeader
        eyebrow="Portail partenaire"
        title="Mes clients"
        description="Organisations qui vous sont attribuées par Ocall, application par application. Aucune donnée métier du client n’est visible."
      />
      {clients.state === 'loading' && <LoadingState />}
      {clients.state === 'error' && <ErrorState error={clients.error} onRetry={clients.reload} />}
      {clients.state === 'success' &&
        (clients.data.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Building2 className="h-7 w-7" />}
              title="Aucun client pour le moment"
              description="Vos clients apparaissent ici dès qu’Ocall confirme leur attribution (lien de recommandation, prospect converti ou attribution directe)."
            />
          </Card>
        ) : (
          <ul className="space-y-4" data-testid="partner-clients">
            {clients.data.map((c) => (
              <li key={c.attributionId}>
                <Card>
                  <CardHeader
                    title={c.name}
                    description={`${c.product ? c.product.name : 'Toutes applications'} · attribué le ${formatDate(c.attributedAt)}`}
                  />
                  <CardBody className="space-y-3 text-sm">
                    <dl className="grid gap-2 sm:grid-cols-2">
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Encaissé depuis l’attribution</dt>
                        <dd className="font-semibold tabular-nums">{formatXof(c.collected)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Primes générées</dt>
                        <dd className="font-semibold tabular-nums">{formatXof(c.commissions)}</dd>
                      </div>
                    </dl>
                    {c.applications.length === 0 ? (
                      <p className="text-muted">Aucun abonnement pour le moment.</p>
                    ) : (
                      <ul className="divide-y divide-line/70">
                        {c.applications.map((a) => (
                          <li
                            key={a.code}
                            className="flex flex-wrap items-center justify-between gap-2 py-2"
                          >
                            <span className="font-medium">{a.name}</span>
                            <span className="flex flex-wrap items-center gap-2 text-muted">
                              <Badge tone={tone(a.state)}>{COMMERCIAL_STATE_LABELS[a.state]}</Badge>
                              {a.expiresAt && <span>échéance {formatDate(a.expiresAt)}</span>}
                              {reseller && a.plan && (
                                <span>
                                  {a.includesShowcase ? 'avec vitrine' : 'sans vitrine'} ·{' '}
                                  {formatXof(a.monthlyPrice ?? 0)} / mois
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {reseller && products.state === 'success' && (
                      <ResellerRequest client={c} products={products.data} />
                    )}
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        ))}
    </>
  );
}

/** Revendeur : prépare une activation ou un renouvellement ; Ocall vérifie le règlement et active. */
function ResellerRequest({ client, products }: { client: ClientRow; products: Product[] }) {
  const choices = products.filter((p) => !client.product || p.code === client.product.code);
  const [productCode, setProductCode] = useState(choices[0]?.code ?? '');
  const product = choices.find((p) => p.code === productCode);
  const [planId, setPlanId] = useState(product?.plans[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (choices.length === 0) return null;
  // Renouvellement : toujours l'offre contractuelle en cours (même retirée du catalogue, famille Park
  // comprise), au tarif figé ; l'offre choisie ne sert qu'à l'activation.
  const park = (code: string) => PARK_APP_PRODUCT_CODES.includes(code);
  const contractPlanId = client.applications.find(
    (a) => a.code === productCode || (park(a.code) && park(productCode)),
  )?.planId;

  async function send(kind: 'ACTIVATION' | 'RENEWAL') {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api('/partner/subscription-requests', {
        method: 'POST',
        body: {
          organizationId: client.organizationId,
          productCode,
          kind,
          planId: kind === 'RENEWAL' ? contractPlanId : planId,
        },
      });
      setNotice(
        kind === 'ACTIVATION'
          ? 'Demande d’activation transmise à Ocall.'
          : 'Demande de renouvellement transmise à Ocall.',
      );
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-line/80 p-3" data-testid="reseller-request">
      <p className="font-semibold">Préparer une demande pour ce client</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <SelectField
          label="Application"
          value={productCode}
          onChange={(e) => {
            setProductCode(e.target.value);
            setPlanId(choices.find((p) => p.code === e.target.value)?.plans[0]?.id ?? '');
          }}
          options={choices.map((p) => ({ value: p.code, label: p.name }))}
        />
        <SelectField
          label="Offre"
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          options={(product?.plans ?? []).map((p) => ({
            value: p.id,
            label: `${p.includesShowcase ? 'Avec vitrine' : 'Sans vitrine'} — ${formatXof(p.monthlyPrice)} / mois`,
          }))}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !planId} onClick={() => void send('ACTIVATION')}>
          <Sparkles className="h-4 w-4" aria-hidden /> Demander l’activation
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || !contractPlanId}
          onClick={() => void send('RENEWAL')}
        >
          <RefreshCw className="h-4 w-4" aria-hidden /> Demander le renouvellement
        </Button>
      </div>
      <p className="text-xs text-muted">
        Le règlement se fait hors plateforme ; seul Ocall confirme le paiement et active
        l’abonnement.
      </p>
      {notice && (
        <p className="text-forest" role="status">
          {notice}
        </p>
      )}
      <ApiErrorAlert error={error} />
    </div>
  );
}
