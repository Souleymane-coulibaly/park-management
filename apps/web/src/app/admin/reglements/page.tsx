'use client';

import { type FormEvent, useState } from 'react';
import { CheckCircle2, Plus, XCircle } from 'lucide-react';
import {
  SUBSCRIPTION_PAYMENT_METHODS,
  SUBSCRIPTION_PAYMENT_METHOD_LABELS,
  SUBSCRIPTION_PAYMENT_STATUS_LABELS,
  type SubscriptionPaymentMethod,
  type SubscriptionPaymentStatus,
  type SubscriptionPaymentView,
  formatXof,
} from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { PlatformOrganization, SuiteInvoice } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const STATUS_TONE: Record<SubscriptionPaymentStatus, 'savanna' | 'forest' | 'terracotta'> = {
  PENDING: 'savanna',
  VALIDATED: 'forest',
  REJECTED: 'terracotta',
};

/**
 * Registre des règlements d'abonnement : payés directement à Ocall, hors plateforme, saisis puis
 * vérifiés et validés manuellement. Aucun paiement en ligne, aucun renouvellement automatique.
 */
export default function SubscriptionPaymentsPage() {
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const payments = useApi<SubscriptionPaymentView[]>(
    `/platform/subscription-payments${status ? `?status=${status}` : ''}`,
  );
  return (
    <>
      <PageHeader
        eyebrow="Super Admin"
        title="Règlements d’abonnement"
        description="Les clients paient Ocall directement (espèces, virement, mobile money hors plateforme). Saisissez chaque règlement, vérifiez-le, puis validez-le ou rejetez-le."
        action={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Saisir un règlement
          </Button>
        }
      />
      {notice && (
        <div className="mb-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      <Card>
        <CardHeader
          title="Registre"
          action={
            <div className="w-48">
              <SelectField
                label="Statut"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                options={[
                  { value: '', label: 'Tous' },
                  ...Object.entries(SUBSCRIPTION_PAYMENT_STATUS_LABELS).map(([value, label]) => ({
                    value,
                    label,
                  })),
                ]}
              />
            </div>
          }
        />
        {payments.state === 'loading' && <LoadingState />}
        {payments.state === 'error' && (
          <ErrorState error={payments.error} onRetry={payments.reload} />
        )}
        {payments.state === 'success' &&
          (payments.data.length === 0 ? (
            <EmptyState
              icon={<Plus className="h-7 w-7" />}
              title="Aucun règlement"
              description="Les règlements saisis apparaîtront ici."
            />
          ) : (
            <Table head={['Organisation', 'Montant', 'Moyen', 'Réglé le', 'Période', 'Statut', '']}>
              {payments.data.map((p) => (
                <PaymentRow
                  key={p.id}
                  payment={p}
                  onDone={(msg) => {
                    setNotice(msg);
                    payments.reload();
                  }}
                />
              ))}
            </Table>
          ))}
      </Card>
      <RecordDialog
        open={creating}
        onClose={() => setCreating(false)}
        onRecorded={() => {
          setCreating(false);
          setNotice('Règlement enregistré : à vérifier puis valider.');
          payments.reload();
        }}
      />
    </>
  );
}

function PaymentRow({
  payment: p,
  onDone,
}: {
  payment: SubscriptionPaymentView;
  onDone: (msg: string) => void;
}) {
  const [mode, setMode] = useState<'validate' | 'reject' | null>(null);
  return (
    <tr data-testid="payment-row">
      <Td className="font-medium">
        {p.organization.name}
        <span className="block text-xs text-muted">
          {p.plan.name} · saisi par {p.recordedBy}
        </span>
      </Td>
      <Td className="tabular-nums">{formatXof(p.amount)}</Td>
      <Td>
        {SUBSCRIPTION_PAYMENT_METHOD_LABELS[p.method]}
        {p.reference && <span className="block text-xs text-muted">Réf. {p.reference}</span>}
      </Td>
      <Td>{formatDate(p.paidAt)}</Td>
      <Td>
        {formatDate(p.periodStart)} → {formatDate(p.periodEnd)}
      </Td>
      <Td>
        <Badge tone={STATUS_TONE[p.status]}>{SUBSCRIPTION_PAYMENT_STATUS_LABELS[p.status]}</Badge>
        {p.validatedBy && (
          <span className="block text-xs text-muted">
            par {p.validatedBy}
            {p.subscriptionExtended && ' · abonnement prolongé'}
          </span>
        )}
        {p.rejectionReason && (
          <span className="block text-xs text-terracotta-dark">{p.rejectionReason}</span>
        )}
      </Td>
      <Td>
        {p.status === 'PENDING' && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              icon={<CheckCircle2 className="h-4 w-4" />}
              onClick={() => setMode('validate')}
            >
              Valider
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<XCircle className="h-4 w-4" />}
              onClick={() => setMode('reject')}
            >
              Rejeter
            </Button>
          </div>
        )}
        <DecisionDialog
          payment={p}
          mode={mode}
          onClose={() => setMode(null)}
          onDone={(msg) => {
            setMode(null);
            onDone(msg);
          }}
        />
      </Td>
    </tr>
  );
}

function DecisionDialog({
  payment: p,
  mode,
  onClose,
  onDone,
}: {
  payment: SubscriptionPaymentView;
  mode: 'validate' | 'reject' | null;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [extend, setExtend] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (mode === 'validate') {
        await api(`/platform/subscription-payments/${p.id}/validate`, {
          method: 'POST',
          body: { extendSubscription: extend },
        });
        onDone(
          extend
            ? 'Règlement validé, abonnement activé / prolongé.'
            : 'Règlement validé. Abonnement inchangé.',
        );
      } else {
        await api(`/platform/subscription-payments/${p.id}/reject`, {
          method: 'POST',
          body: { reason },
        });
        onDone('Règlement rejeté.');
      }
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={mode !== null}
      onClose={onClose}
      title={mode === 'validate' ? 'Valider le règlement' : 'Rejeter le règlement'}
      description={`${p.organization.name} · ${formatXof(p.amount)} · ${SUBSCRIPTION_PAYMENT_METHOD_LABELS[p.method]}${p.reference ? ` · réf. ${p.reference}` : ''}`}
    >
      <form onSubmit={submit} className="space-y-4">
        {mode === 'validate' ? (
          <>
            <p className="text-sm">Confirmez avoir vérifié la réception de ce règlement.</p>
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 accent-forest"
                checked={extend}
                onChange={(e) => setExtend(e.target.checked)}
              />
              <span>
                Activer / prolonger l’abonnement jusqu’au <strong>{formatDate(p.periodEnd)}</strong>{' '}
                inclus.
                <span className="block text-muted">
                  Action manuelle : aucune prolongation n’est faite sans cette case. Une échéance
                  plus lointaine n’est jamais raccourcie.
                </span>
              </span>
            </label>
          </>
        ) : (
          <InputField
            label="Motif du rejet"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex. virement non reçu"
          />
        )}
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            type="submit"
            loading={saving}
            disabled={mode === 'reject' && reason.trim().length < 3}
          >
            {mode === 'validate' ? 'Valider' : 'Rejeter'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function RecordDialog({
  open,
  onClose,
  onRecorded,
}: {
  open: boolean;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const orgs = useApi<PlatformOrganization[]>(open ? '/platform/organizations' : null);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    organizationId: '',
    invoiceId: '',
    amount: '',
    method: 'BANK_TRANSFER' as SubscriptionPaymentMethod,
    reference: '',
    paidAt: today,
    periodStart: '',
    periodEnd: '',
    note: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // Factures émises non réglées de l'organisation : le règlement doit couvrir le reste à payer.
  const invoices = useApi<SuiteInvoice[]>(
    open && form.organizationId
      ? `/platform/invoices?status=ISSUED&organizationId=${form.organizationId}`
      : null,
  );
  const outstanding = (i: SuiteInvoice) =>
    i.total - i.payments.reduce((sum, p) => sum + p.amount, 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api('/platform/subscription-payments', {
        method: 'POST',
        body: {
          organizationId: form.organizationId,
          ...(form.invoiceId ? { invoiceId: form.invoiceId } : {}),
          amount: Number(form.amount),
          method: form.method,
          ...(form.reference.trim() ? { reference: form.reference.trim() } : {}),
          paidAt: form.paidAt,
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
          ...(form.note.trim() ? { note: form.note.trim() } : {}),
        },
      });
      onRecorded();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Saisir un règlement"
      description="Règlement reçu hors plateforme. Il restera « à vérifier » jusqu’à sa validation."
    >
      <form onSubmit={submit} className="space-y-3">
        {orgs.state === 'success' ? (
          <SelectField
            label="Organisation"
            required
            value={form.organizationId}
            onChange={(e) => setForm({ ...form, organizationId: e.target.value, invoiceId: '' })}
            options={[
              { value: '', label: 'Choisir…' },
              ...orgs.data.map((o) => ({ value: o.id, label: o.name })),
            ]}
          />
        ) : orgs.state === 'error' ? (
          <ErrorState error={orgs.error} onRetry={orgs.reload} />
        ) : (
          <LoadingState />
        )}
        {invoices.state === 'success' && invoices.data.length > 0 && (
          <SelectField
            label="Facture réglée"
            hint="Le montant doit correspondre au reste à payer ; la validation marque la facture payée."
            value={form.invoiceId}
            onChange={(e) => {
              const inv = invoices.data.find((i) => i.id === e.target.value);
              setForm({
                ...form,
                invoiceId: e.target.value,
                ...(inv ? { amount: String(outstanding(inv)) } : {}),
              });
            }}
            options={[
              { value: '', label: 'Sans facture (registre)' },
              ...invoices.data.map((i) => ({
                value: i.id,
                label: `${i.number} · ${i.product.name} · reste ${formatXof(outstanding(i))}`,
              })),
            ]}
          />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField
            label="Montant (FCFA)"
            type="number"
            min={1}
            required
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
          <SelectField
            label="Moyen"
            value={form.method}
            onChange={(e) =>
              setForm({ ...form, method: e.target.value as SubscriptionPaymentMethod })
            }
            options={SUBSCRIPTION_PAYMENT_METHODS.map((m) => ({
              value: m,
              label: SUBSCRIPTION_PAYMENT_METHOD_LABELS[m],
            }))}
          />
          <InputField
            label="Référence"
            hint="Virement, reçu ou transaction."
            value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
          />
          <InputField
            label="Réglé le"
            type="date"
            required
            value={form.paidAt}
            onChange={(e) => setForm({ ...form, paidAt: e.target.value })}
          />
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
        <InputField
          label="Note"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={saving}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
