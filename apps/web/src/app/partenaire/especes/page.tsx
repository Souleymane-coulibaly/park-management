'use client';

import { type FormEvent, useState } from 'react';
import { Banknote } from 'lucide-react';
import {
  SUBSCRIPTION_PAYMENT_STATUS_LABELS,
  type SubscriptionPaymentStatus,
  formatXof,
} from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface Profile {
  cashCollectionEnabled: boolean;
  cashCollectionLimit: number;
}
interface CollectibleInvoice {
  id: string;
  number: string;
  currency: string;
  remaining: number;
  organization: { id: string; name: string };
}
interface Collection {
  id: string;
  amount: number;
  status: SubscriptionPaymentStatus;
  paidAt: string;
  receiptNumber: string | null;
  receiptReference: string | null;
  organization: { name: string };
  invoice: { number: string } | null;
}

/**
 * Collecte d'espèces (si Ocall vous y a habilité) : vous DÉCLAREZ la collecte avec le reçu remis
 * au client ; Ocall la confirme à la remise des espèces. Vous ne confirmez jamais une collecte et
 * n'activez aucun abonnement.
 */
export default function PartnerCashPage() {
  const profile = useApi<Profile>('/partner/profile');
  const enabled = profile.state === 'success' && profile.data.cashCollectionEnabled;
  const invoices = useApi<CollectibleInvoice[]>(enabled ? '/partner/cash/invoices' : null);
  const collections = useApi<Collection[]>(enabled ? '/partner/cash/collections' : null);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    invoiceId: '',
    amount: '',
    receiptReference: '',
    paidAt: today,
    periodStart: '',
    periodEnd: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (profile.state === 'loading') return <LoadingState />;
  if (profile.state === 'error')
    return <ErrorState error={profile.error} onRetry={profile.reload} />;
  if (!enabled) {
    return (
      <>
        <PageHeader eyebrow="Portail partenaire" title="Espèces" />
        <Alert tone="info" title="Encaissement non autorisé">
          Vous n’êtes pas habilité à encaisser des espèces pour le compte d’Ocall. Contactez votre
          responsable Ocall si nécessaire.
        </Alert>
      </>
    );
  }
  const invoice =
    invoices.state === 'success' ? invoices.data.find((i) => i.id === form.invoiceId) : undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!invoice) return;
    setSaving(true);
    setError(null);
    try {
      await api('/partner/cash/collections', {
        method: 'POST',
        body: {
          organizationId: invoice.organization.id,
          invoiceId: invoice.id,
          amount: Number(form.amount),
          currency: invoice.currency,
          method: 'CASH',
          receiptReference: form.receiptReference.trim(),
          paidAt: form.paidAt,
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
        },
      });
      setNotice('Collecte déclarée. Remettez les espèces à Ocall, qui la confirmera.');
      setForm({ ...form, invoiceId: '', amount: '', receiptReference: '' });
      collections.reload();
      invoices.reload();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Portail partenaire"
        title="Espèces"
        description={`Plafond des collectes non encore remises : ${formatXof(profile.data.cashCollectionLimit)}.`}
      />
      {notice && (
        <div className="mb-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      <Card className="mb-6">
        <CardHeader title="Déclarer une collecte" />
        <form onSubmit={submit} className="space-y-3 px-5 pb-5 pt-4 sm:px-6">
          {invoices.state === 'success' && invoices.data.length === 0 && (
            <Alert tone="info">Aucune facture à encaisser chez vos clients.</Alert>
          )}
          {invoices.state === 'success' && invoices.data.length > 0 && (
            <SelectField
              label="Facture"
              required
              value={form.invoiceId}
              onChange={(e) => {
                const inv = invoices.data.find((i) => i.id === e.target.value);
                setForm({
                  ...form,
                  invoiceId: e.target.value,
                  ...(inv ? { amount: String(inv.remaining) } : {}),
                });
              }}
              options={[
                { value: '', label: 'Choisir…' },
                ...invoices.data.map((i) => ({
                  value: i.id,
                  label: `${i.number} · ${i.organization.name} · reste ${formatXof(i.remaining)}`,
                })),
              ]}
            />
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <InputField
              label="Montant collecté"
              type="number"
              min={1}
              required
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
            <InputField
              label="Référence du reçu remis au client"
              required
              value={form.receiptReference}
              onChange={(e) => setForm({ ...form, receiptReference: e.target.value })}
            />
            <InputField
              label="Collecté le"
              type="date"
              required
              value={form.paidAt}
              onChange={(e) => setForm({ ...form, paidAt: e.target.value })}
            />
            <div />
            <InputField
              label="Période du"
              type="date"
              required
              value={form.periodStart}
              onChange={(e) => setForm({ ...form, periodStart: e.target.value })}
            />
            <InputField
              label="au"
              type="date"
              required
              value={form.periodEnd}
              onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
            />
          </div>
          <ApiErrorAlert error={error} />
          <Button type="submit" loading={saving} disabled={!invoice}>
            Déclarer la collecte
          </Button>
        </form>
      </Card>
      <Card>
        <CardHeader title="Mes collectes" />
        {collections.state === 'loading' && <LoadingState />}
        {collections.state === 'error' && (
          <ErrorState error={collections.error} onRetry={collections.reload} />
        )}
        {collections.state === 'success' &&
          (collections.data.length === 0 ? (
            <EmptyState
              icon={<Banknote className="h-7 w-7" />}
              title="Aucune collecte"
              description="Vos collectes déclarées apparaîtront ici."
            />
          ) : (
            <Table head={['Client', 'Facture', 'Montant', 'Reçu', 'Date', 'Statut']}>
              {collections.data.map((c) => (
                <tr key={c.id}>
                  <Td className="font-medium">{c.organization.name}</Td>
                  <Td>{c.invoice?.number ?? '—'}</Td>
                  <Td className="tabular-nums">{formatXof(c.amount)}</Td>
                  <Td>
                    {c.receiptNumber}
                    {c.receiptReference ? ` (${c.receiptReference})` : ''}
                  </Td>
                  <Td>{formatDate(c.paidAt)}</Td>
                  <Td>
                    <Badge
                      tone={
                        c.status === 'CONFIRMED'
                          ? 'forest'
                          : c.status === 'DECLARED'
                            ? 'savanna'
                            : 'terracotta'
                      }
                    >
                      {SUBSCRIPTION_PAYMENT_STATUS_LABELS[c.status]}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </Table>
          ))}
      </Card>
    </>
  );
}
