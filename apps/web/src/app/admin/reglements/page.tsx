'use client';

import { type FormEvent, useState } from 'react';
import { BadgeCheck, CheckCircle2, Plus, RotateCcw, Undo2, XCircle } from 'lucide-react';
import {
  type ManualSubscriptionPaymentMethod,
  PAYMENT_ACTIVATION_STATUS_LABELS,
  SUBSCRIPTION_PAYMENT_METHODS,
  SUBSCRIPTION_PAYMENT_METHOD_LABELS,
  SUBSCRIPTION_PAYMENT_STATUS_LABELS,
  type SubscriptionPaymentStatus,
  type SubscriptionPaymentView,
  canConfirmPayment,
  formatXof,
  invoiceRemaining,
} from '@ocall/shared';
import { useCanPlatform, useSession } from '@/components/app/session-context';
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

const STATUS_TONE: Record<
  SubscriptionPaymentStatus,
  'savanna' | 'forest' | 'terracotta' | 'neutral'
> = {
  DECLARED: 'savanna',
  PENDING_VERIFICATION: 'savanna',
  CONFIRMED: 'forest',
  REJECTED: 'terracotta',
  CANCELLED: 'neutral',
  REFUNDED: 'terracotta',
};

type Action = 'confirm' | 'reject' | 'cancel' | 'refund' | 'approve' | 'refuse';

const ACTION_COPY: Record<
  Action,
  { title: string; button: string; reason?: string; done: string }
> = {
  confirm: {
    title: 'Confirmer l’encaissement',
    button: 'Confirmer',
    done: 'Encaissement confirmé.',
  },
  reject: {
    title: 'Rejeter le règlement',
    button: 'Rejeter',
    reason: 'Motif du rejet',
    done: 'Règlement rejeté.',
  },
  cancel: {
    title: 'Annuler la déclaration',
    button: 'Annuler la déclaration',
    reason: 'Motif de l’annulation',
    done: 'Déclaration annulée.',
  },
  refund: {
    title: 'Enregistrer un remboursement',
    button: 'Enregistrer le remboursement',
    reason: 'Motif et moyen du remboursement',
    done: 'Remboursement enregistré.',
  },
  approve: {
    title: 'Approuver l’activation',
    button: 'Approuver',
    done: 'Activation approuvée : abonnement activé ou prolongé.',
  },
  refuse: {
    title: 'Refuser l’activation',
    button: 'Refuser',
    reason: 'Justification du refus',
    done: 'Activation refusée : le paiement reste encaissé, à rembourser.',
  },
};

const ACTION_PATH: Record<Action, string> = {
  confirm: 'confirm',
  reject: 'reject',
  cancel: 'cancel',
  refund: 'refund',
  approve: 'approve-activation',
  refuse: 'refuse-activation',
};

/**
 * Règlements des abonnements (Sprint 12A) : virements et espèces DÉCLARÉS par Ocall, puis
 * confirmés par une autre personne (quatre yeux) ; paiements en ligne vérifiés ; décisions
 * d'activation ; remboursements. Aucun prélèvement ni renouvellement automatique.
 */
export default function SubscriptionPaymentsPage() {
  const [status, setStatus] = useState('');
  const [onlyActivations, setOnlyActivations] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canTransfer = useCanPlatform('platform.billing.manage');
  const canCash = useCanPlatform('platform.billing.cash.declare');
  const query = new URLSearchParams({
    ...(status ? { status } : {}),
    ...(onlyActivations ? { activationStatus: 'PENDING' } : {}),
  }).toString();
  const payments = useApi<SubscriptionPaymentView[]>(
    `/platform/subscription-payments${query ? `?${query}` : ''}`,
  );
  return (
    <>
      <PageHeader
        eyebrow="Super Admin"
        title="Règlements d’abonnement"
        description="Virements et espèces sont déclarés, puis confirmés par une autre personne. Les paiements en ligne n’arrivent ici qu’après vérification auprès du prestataire. L’activation suit le mode figé de chaque abonnement."
        action={
          canTransfer || canCash ? (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Déclarer un règlement
            </Button>
          ) : undefined
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
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-forest"
                  checked={onlyActivations}
                  onChange={(e) => setOnlyActivations(e.target.checked)}
                />
                Activations à approuver
              </label>
              <div className="w-52">
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
              description="Les règlements déclarés ou payés en ligne apparaîtront ici."
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
      {creating && (
        <DeclareDialog
          canTransfer={canTransfer}
          canCash={canCash}
          onClose={() => setCreating(false)}
          onDeclared={() => {
            setCreating(false);
            setNotice('Règlement déclaré : une autre personne doit le confirmer.');
            payments.reload();
          }}
        />
      )}
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
  const me = useSession();
  const canValidate = useCanPlatform('platform.billing.validate');
  const canApprove = useCanPlatform('platform.activations.approve');
  const [action, setAction] = useState<Action | null>(null);
  const open = p.status === 'DECLARED' || p.status === 'PENDING_VERIFICATION';
  const fourEyes = canConfirmPayment(me.user.id, p);
  const note = p.refundReason ?? p.activationDecisionReason ?? p.rejectionReason;
  return (
    <tr data-testid="payment-row">
      <Td className="font-medium">
        {p.organization.name}
        <span className="block text-xs text-muted">
          {p.invoice ? `Facture ${p.invoice.number} · ` : ''}
          {p.plan.name} · déclaré par {p.recordedBy}
        </span>
      </Td>
      <Td className="tabular-nums">{formatXof(p.amount)}</Td>
      <Td>
        {SUBSCRIPTION_PAYMENT_METHOD_LABELS[p.method]}
        {p.receiptNumber && (
          <span className="block text-xs text-muted">
            Reçu {p.receiptNumber}
            {p.receiptReference && ` (papier ${p.receiptReference})`}
            {p.collectedBy && ` · collecté par ${p.collectedBy}`}
          </span>
        )}
        {p.reference && <span className="block text-xs text-muted">Réf. {p.reference}</span>}
        {p.remittanceNumber && (
          <span className="block text-xs text-muted">Remise {p.remittanceNumber}</span>
        )}
      </Td>
      <Td>{formatDate(p.paidAt)}</Td>
      <Td>
        {formatDate(p.periodStart)} → {formatDate(p.periodEnd)}
      </Td>
      <Td>
        <Badge tone={STATUS_TONE[p.status]}>{SUBSCRIPTION_PAYMENT_STATUS_LABELS[p.status]}</Badge>
        {p.status === 'CONFIRMED' && p.activationStatus !== 'NOT_REQUIRED' && (
          <span
            className={`block text-xs ${p.activationStatus === 'PENDING' || p.activationStatus === 'REFUSED' ? 'text-terracotta-dark' : 'text-muted'}`}
          >
            {PAYMENT_ACTIVATION_STATUS_LABELS[p.activationStatus]}
          </span>
        )}
        {p.validatedBy && <span className="block text-xs text-muted">par {p.validatedBy}</span>}
        {note && <span className="block text-xs text-muted">{note}</span>}
      </Td>
      <Td>
        <div className="flex flex-wrap gap-2">
          {open && canValidate && (
            <>
              <Button
                size="sm"
                icon={<CheckCircle2 className="h-4 w-4" />}
                disabled={!fourEyes}
                title={fourEyes ? undefined : 'Confirmation par une autre personne (quatre yeux)'}
                onClick={() => setAction('confirm')}
              >
                Confirmer
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<XCircle className="h-4 w-4" />}
                onClick={() => setAction('reject')}
              >
                Rejeter
              </Button>
            </>
          )}
          {open && (p.recordedById === me.user.id || canValidate) && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Undo2 className="h-4 w-4" />}
              onClick={() => setAction('cancel')}
            >
              Annuler
            </Button>
          )}
          {p.status === 'CONFIRMED' && p.activationStatus === 'PENDING' && canApprove && (
            <>
              <Button
                size="sm"
                icon={<BadgeCheck className="h-4 w-4" />}
                onClick={() => setAction('approve')}
              >
                Approuver l’activation
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setAction('refuse')}>
                Refuser
              </Button>
            </>
          )}
          {p.status === 'CONFIRMED' && canValidate && (
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw className="h-4 w-4" />}
              onClick={() => setAction('refund')}
            >
              Remboursement
            </Button>
          )}
        </div>
        {action && (
          <ActionDialog
            payment={p}
            action={action}
            onClose={() => setAction(null)}
            onDone={(msg) => {
              setAction(null);
              onDone(msg);
            }}
          />
        )}
      </Td>
    </tr>
  );
}

function ActionDialog({
  payment: p,
  action,
  onClose,
  onDone,
}: {
  payment: SubscriptionPaymentView;
  action: Action;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const copy = ACTION_COPY[action];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await api<{ activation?: { result: string } | null }>(
        `/platform/subscription-payments/${p.id}/${ACTION_PATH[action]}`,
        { method: 'POST', body: copy.reason ? { reason } : {} },
      );
      let done = copy.done;
      if (action === 'confirm') {
        done = !result.activation
          ? 'Encaissement confirmé. Facture pas encore soldée : aucune activation.'
          : result.activation.result === 'applied'
            ? 'Encaissement confirmé : abonnement activé automatiquement (mode AUTO).'
            : 'Encaissement confirmé : activation à approuver.';
      }
      onDone(done);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={copy.title}
      description={`${p.organization.name} · ${formatXof(p.amount)} · ${SUBSCRIPTION_PAYMENT_METHOD_LABELS[p.method]}`}
    >
      <form onSubmit={submit} className="space-y-4">
        {action === 'confirm' && (
          <p className="text-sm">
            Confirmez avoir vérifié la réception effective de ce règlement. Si la facture est alors
            soldée, l’activation suit le mode de l’abonnement (automatique ou à approuver).
          </p>
        )}
        {action === 'approve' && (
          <p className="text-sm">
            L’abonnement sera activé ou prolongé jusqu’au <strong>{formatDate(p.periodEnd)}</strong>{' '}
            inclus. Une échéance plus lointaine n’est jamais raccourcie.
          </p>
        )}
        {copy.reason && (
          <InputField
            label={copy.reason}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Fermer
          </Button>
          <Button
            type="submit"
            loading={saving}
            disabled={!!copy.reason && reason.trim().length < 3}
          >
            {copy.button}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeclareDialog({
  canTransfer,
  canCash,
  onClose,
  onDeclared,
}: {
  canTransfer: boolean;
  canCash: boolean;
  onClose: () => void;
  onDeclared: () => void;
}) {
  const orgs = useApi<PlatformOrganization[]>('/platform/organizations');
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    organizationId: '',
    invoiceId: '',
    amount: '',
    method: (canTransfer ? 'MANUAL_TRANSFER' : 'CASH') as ManualSubscriptionPaymentMethod,
    reference: '',
    receiptReference: '',
    paidAt: today,
    periodStart: '',
    periodEnd: '',
    note: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const invoices = useApi<SuiteInvoice[]>(
    form.organizationId
      ? `/platform/invoices?status=ISSUED&organizationId=${form.organizationId}`
      : null,
  );
  const remaining = (i: SuiteInvoice) => invoiceRemaining(i.total, i.payments);
  const invoice =
    invoices.state === 'success' ? invoices.data.find((i) => i.id === form.invoiceId) : undefined;
  const cash = form.method === 'CASH';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!invoice) return;
    setSaving(true);
    setError(null);
    try {
      await api(cash ? '/platform/subscription-payments/cash' : '/platform/subscription-payments', {
        method: 'POST',
        body: {
          organizationId: form.organizationId,
          invoiceId: form.invoiceId,
          amount: Number(form.amount),
          currency: invoice.currency,
          method: form.method,
          ...(form.reference.trim() ? { reference: form.reference.trim() } : {}),
          ...(cash ? { receiptReference: form.receiptReference.trim() } : {}),
          paidAt: form.paidAt,
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
          ...(form.note.trim() ? { note: form.note.trim() } : {}),
        },
      });
      onDeclared();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Déclarer un règlement"
      description="Virement reçu ou espèces collectées. La déclaration n’est pas un encaissement : une autre personne habilitée doit la confirmer."
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
        {invoices.state === 'success' &&
          (invoices.data.length === 0 ? (
            <Alert tone="info">Aucune facture à payer pour cette organisation.</Alert>
          ) : (
            <SelectField
              label="Facture"
              required
              hint="Le montant ne peut pas dépasser le reste dû (règlements en cours compris)."
              value={form.invoiceId}
              onChange={(e) => {
                const inv = invoices.data.find((i) => i.id === e.target.value);
                setForm({
                  ...form,
                  invoiceId: e.target.value,
                  ...(inv ? { amount: String(remaining(inv)) } : {}),
                });
              }}
              options={[
                { value: '', label: 'Choisir…' },
                ...invoices.data.map((i) => ({
                  value: i.id,
                  label: `${i.number} · ${i.product.name} · reste ${formatXof(remaining(i))}`,
                })),
              ]}
            />
          ))}
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Moyen"
            value={form.method}
            onChange={(e) =>
              setForm({ ...form, method: e.target.value as ManualSubscriptionPaymentMethod })
            }
            options={SUBSCRIPTION_PAYMENT_METHODS.filter((m) =>
              m === 'CASH' ? canCash : canTransfer,
            ).map((m) => ({ value: m, label: SUBSCRIPTION_PAYMENT_METHOD_LABELS[m] }))}
          />
          <InputField
            label={`Montant (${invoice?.currency ?? 'FCFA'})`}
            type="number"
            min={1}
            required
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
          {cash ? (
            <InputField
              label="Référence du reçu remis au client"
              required
              hint="Un numéro de reçu Ocall est aussi attribué automatiquement."
              value={form.receiptReference}
              onChange={(e) => setForm({ ...form, receiptReference: e.target.value })}
            />
          ) : (
            <InputField
              label="Référence du virement"
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
            />
          )}
          <InputField
            label={cash ? 'Collecté le' : 'Reçu le'}
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
          label="Observations"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={saving} disabled={!invoice}>
            Déclarer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
