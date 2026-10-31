'use client';

import { useState } from 'react';
import { Cpu } from 'lucide-react';
import { AI_FEATURE_LABELS, type AiFeature, formatXof } from '@ocall/shared';
import { useCanPlatform } from '@/components/app/session-context';
import { QuotaEditor } from '@/components/admin/quota-editor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import type { PlatformAiUsage, SuiteProduct } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const SOURCE_LABEL = { override: 'Dérogation', plan: 'Offre', default: 'Défaut' } as const;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Consommation IA par organisation, établissement et fonctionnalité ; plafond mensuel fixé par
 * Ocall (quota de l'offre ou dérogation). Coûts ESTIMÉS : le fournisseur facture séparément.
 */
export default function PlatformAiUsagePage() {
  const now = new Date();
  const [product, setProduct] = useState('');
  const [from, setFrom] = useState(isoDay(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(isoDay(now));
  const [editing, setEditing] = useState<PlatformAiUsage['rows'][number] | null>(null);
  const canManage = useCanPlatform('platform.quotas.manage');
  const products = useApi<SuiteProduct[]>('/platform/products');
  const query = new URLSearchParams({ from, to, ...(product ? { product } : {}) });
  const usage = useApi<PlatformAiUsage>(
    from && to && from <= to ? `/platform/ai-usage?${query}` : null,
  );

  return (
    <>
      <PageHeader
        eyebrow="Ocall Suite"
        title="Consommation IA"
        description="Appels par organisation, établissement et fonctionnalité. Le plafond mensuel vient de l’offre, sauf dérogation ; l’organisation peut se limiter en dessous."
      />
      <Card>
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField
              label="Produit"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              options={[
                { value: '', label: 'Tous les produits' },
                ...(products.state === 'success'
                  ? products.data.map((p) => ({ value: p.code, label: p.name }))
                  : []),
              ]}
            />
            <InputField
              label="Du"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <InputField label="Au" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardBody>
      </Card>
      <div className="mt-6">
        {usage.state === 'loading' && <LoadingState />}
        {usage.state === 'error' && <ErrorState error={usage.error} onRetry={usage.reload} />}
        {usage.state === 'success' && (
          <Card>
            <CardBody>
              <p className="text-sm text-muted">
                Fournisseur : <strong>{usage.data.provider}</strong> · {usage.data.totals.calls}{' '}
                appels · coût estimé{' '}
                {formatXof(Math.round(usage.data.totals.estimatedCostUsd * usage.data.usdXofRate))}
              </p>
            </CardBody>
            {usage.data.rows.length === 0 ? (
              <EmptyState
                icon={<Cpu className="h-7 w-7" />}
                title="Aucune organisation"
                description="Aucune organisation pour ce filtre."
              />
            ) : (
              <Table
                head={[
                  'Organisation',
                  'Appels (période)',
                  'Par fonctionnalité',
                  'Mois en cours',
                  '',
                ]}
              >
                {usage.data.rows.map((r) => (
                  <tr key={r.organization.id} data-testid="ai-usage-row">
                    <Td>
                      <p className="font-semibold">{r.organization.name}</p>
                      <p className="text-xs text-muted">
                        {r.product?.name ?? '—'} · {r.plan ?? '—'}
                      </p>
                    </Td>
                    <Td className="tabular-nums">
                      {r.calls}
                      {r.failed > 0 && (
                        <span className="block text-xs text-muted">dont {r.failed} en échec</span>
                      )}
                      <span className="block text-xs text-muted">
                        ≈ {formatXof(Math.round(r.estimatedCostUsd * usage.data.usdXofRate))}
                      </span>
                    </Td>
                    <Td>
                      <ul className="text-xs">
                        {Object.entries(r.features).map(([f, n]) => (
                          <li key={f}>
                            {AI_FEATURE_LABELS[f as AiFeature]} : {n}
                          </li>
                        ))}
                        {r.establishments.map((e) => (
                          <li key={e.id ?? 'org'} className="text-muted">
                            {e.name} : {e.calls}
                          </li>
                        ))}
                      </ul>
                    </Td>
                    <Td className="tabular-nums">
                      {r.monthUsed} / {r.monthQuota}
                      <span className="block">
                        <Badge tone={r.monthUsed >= r.monthQuota ? 'terracotta' : 'neutral'}>
                          {SOURCE_LABEL[r.quotaSource]}
                        </Badge>
                      </span>
                    </Td>
                    <Td>
                      {canManage && (
                        <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
                          Ajuster
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        )}
      </div>
      <QuotaEditor
        organization={editing?.organization ?? null}
        field="aiMonthlyCalls"
        label="Appels IA par mois"
        current={editing?.monthQuota ?? 0}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          usage.reload();
        }}
      />
    </>
  );
}
