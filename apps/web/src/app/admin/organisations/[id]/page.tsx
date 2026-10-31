'use client';

import { type FormEvent, use, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import {
  BUSINESS_TYPE_LABELS,
  INVOICE_STATUS_LABELS,
  SUBSCRIPTION_PAYMENT_METHOD_LABELS,
  SUBSCRIPTION_PAYMENT_STATUS_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  formatXof,
} from '@ocall/shared';
import { useCanPlatform } from '@/components/app/session-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { SuiteOrganization, SuiteProduct } from '@/lib/types';
import { useApi } from '@/lib/use-api';

/** Fiche organisation : établissements, abonnements par produit, factures et règlements (métadonnées). */
export default function OrganizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const org = useApi<SuiteOrganization>(`/platform/organizations/${id}`);
  const canSubscribe = useCanPlatform('platform.subscriptions.manage');
  const [subscribing, setSubscribing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      <Link
        href="/admin/organisations"
        className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-forest"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Organisations
      </Link>
      {org.state === 'loading' && <LoadingState />}
      {org.state === 'error' && <ErrorState error={org.error} onRetry={org.reload} />}
      {org.state === 'success' && (
        <>
          <PageHeader
            eyebrow={`${org.data.code} · ${BUSINESS_TYPE_LABELS[org.data.businessType]} · ${org.data.countryCode}`}
            title={org.data.name}
            description={`Créée le ${formatDate(org.data.createdAt)} · ${org.data._count.memberships} compte(s) · ${org.data.status === 'ACTIVE' ? 'active' : 'suspendue'}`}
            action={
              canSubscribe && (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => setSubscribing(true)}>
                  Ajouter un produit
                </Button>
              )
            }
          />
          {notice && (
            <div className="mb-4">
              <Alert tone="success">{notice}</Alert>
            </div>
          )}
          <div className="space-y-6">
            <Card>
              <CardHeader
                title="Abonnements"
                description="Tarif accepté figé à l'activation (validation d'un règlement)."
              />
              <Table head={['Produit', 'Offre', 'Tarif accepté', 'Statut', 'Échéance']}>
                {org.data.subscriptions.map((s) => (
                  <tr key={s.id}>
                    <Td className="font-medium">{s.product.name}</Td>
                    <Td>{s.plan.name}</Td>
                    <Td className="tabular-nums">
                      {s.agreedMonthlyPrice !== null ? (
                        <>
                          {formatXof(s.agreedSetupFee ?? 0)} + {formatXof(s.agreedMonthlyPrice)}
                          /mois
                          <span className="block text-xs text-muted">
                            depuis le {formatDate(s.agreedAt)}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted">
                          Non figé (offre : {formatXof(s.plan.setupFee)} +{' '}
                          {formatXof(s.plan.monthlyPrice)}/mois)
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={s.status === 'ACTIVE' ? 'forest' : 'savanna'}>
                        {SUBSCRIPTION_STATUS_LABELS[s.status]}
                      </Badge>
                    </Td>
                    <Td>{formatDate(s.expiresAt)}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
            <Card>
              <CardHeader title="Établissements" />
              <CardBody>
                <ul className="space-y-2 text-sm">
                  {org.data.establishments.map((e) => (
                    <li key={e.id} className="flex flex-wrap justify-between gap-2">
                      <span>
                        {e.name}
                        <span className="text-muted">
                          {' '}
                          · {BUSINESS_TYPE_LABELS[e.businessType]}
                          {e.city ? ` · ${e.city}` : ''}
                          {!e.isActive && ' · inactif'}
                        </span>
                      </span>
                      {e.publicSite && (
                        <span className="text-muted">
                          Site /{e.publicSite.slug}{' '}
                          {e.publicSite.isOnline ? '(en ligne)' : '(hors ligne)'}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader title="Factures" />
                <Table head={['Numéro', 'Total', 'Émise', 'Statut']}>
                  {org.data.invoices.map((i) => (
                    <tr key={i.id}>
                      <Td className="font-mono text-sm">{i.number}</Td>
                      <Td className="tabular-nums">{formatXof(i.total)}</Td>
                      <Td>{formatDate(i.issuedAt)}</Td>
                      <Td>{INVOICE_STATUS_LABELS[i.status]}</Td>
                    </tr>
                  ))}
                </Table>
              </Card>
              <Card>
                <CardHeader title="Règlements" />
                <Table head={['Montant', 'Moyen', 'Réglé le', 'Statut']}>
                  {org.data.subscriptionPayments.map((p) => (
                    <tr key={p.id}>
                      <Td className="tabular-nums">{formatXof(p.amount)}</Td>
                      <Td>{SUBSCRIPTION_PAYMENT_METHOD_LABELS[p.method]}</Td>
                      <Td>{formatDate(p.paidAt)}</Td>
                      <Td>{SUBSCRIPTION_PAYMENT_STATUS_LABELS[p.status]}</Td>
                    </tr>
                  ))}
                </Table>
              </Card>
            </div>
          </div>
          <SubscribeDialog
            open={subscribing}
            organization={org.data}
            onClose={() => setSubscribing(false)}
            onDone={(name) => {
              setSubscribing(false);
              setNotice(`Abonnement ${name} créé : à activer par la validation d'un règlement.`);
              org.reload();
            }}
          />
        </>
      )}
    </>
  );
}

function SubscribeDialog({
  open,
  organization,
  onClose,
  onDone,
}: {
  open: boolean;
  organization: SuiteOrganization;
  onClose: () => void;
  onDone: (productName: string) => void;
}) {
  const products = useApi<SuiteProduct[]>(open ? '/platform/products' : null);
  const [productId, setProductId] = useState('');
  const [planId, setPlanId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const owned = new Set(organization.subscriptions.map((s) => s.product.id));
  const sellable =
    products.state === 'success'
      ? products.data.filter(
          (p) => p.status === 'AVAILABLE' && !owned.has(p.id) && p.plans.some((pl) => pl.isActive),
        )
      : [];
  const product = sellable.find((p) => p.id === productId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!product) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/platform/organizations/${organization.id}/subscriptions`, {
        method: 'POST',
        body: { productId, planId },
      });
      onDone(product.name);
      setProductId('');
      setPlanId('');
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Ajouter un produit"
      description="Seuls les produits commercialisés sont proposés. L'abonnement reste non activé jusqu'à la validation d'un règlement."
    >
      <form onSubmit={submit} className="space-y-3">
        {products.state === 'loading' && <LoadingState />}
        {products.state === 'error' && (
          <ErrorState error={products.error} onRetry={products.reload} />
        )}
        {products.state === 'success' &&
          (sellable.length === 0 ? (
            <p className="text-sm text-muted">
              Aucun autre produit commercialisé disponible pour cette organisation.
            </p>
          ) : (
            <>
              <SelectField
                label="Produit"
                required
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                  setPlanId('');
                }}
                options={[
                  { value: '', label: 'Choisir…' },
                  ...sellable.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
              {product && (
                <SelectField
                  label="Offre"
                  required
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                  options={[
                    { value: '', label: 'Choisir…' },
                    ...product.plans
                      .filter((pl) => pl.isActive)
                      .map((pl) => ({
                        value: pl.id,
                        label: `${pl.name} — ${formatXof(pl.setupFee)} + ${formatXof(pl.monthlyPrice)}/mois`,
                      })),
                  ]}
                />
              )}
            </>
          ))}
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={saving} disabled={!product || !planId}>
            Ajouter
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
