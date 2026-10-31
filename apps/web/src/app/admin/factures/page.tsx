'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { FileText, Plus, XCircle } from 'lucide-react';
import {
  INVOICE_MAX_MONTHS,
  INVOICE_STATUS_LABELS,
  type InvoiceLineInput,
  type InvoiceStatus,
  formatXof,
} from '@ocall/shared';
import { useCanPlatform } from '@/components/app/session-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { PlatformOrganization, SuiteInvoice, SuiteOrganization } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const STATUS_TONE: Record<InvoiceStatus, 'savanna' | 'forest' | 'neutral'> = {
  ISSUED: 'savanna',
  PAID: 'forest',
  CANCELLED: 'neutral',
};

/**
 * Factures d'abonnement : montants calculés par le serveur à partir du tarif accepté, réglées hors
 * plateforme puis rapprochées d'un règlement validé (page Règlements). Aucun paiement en ligne.
 */
export default function InvoicesPage() {
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<SuiteInvoice | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canManage = useCanPlatform('platform.billing.manage');
  const invoices = useApi<SuiteInvoice[]>(`/platform/invoices${status ? `?status=${status}` : ''}`);

  return (
    <>
      <PageHeader
        eyebrow="Ocall Suite"
        title="Factures"
        description="Émises au tarif accepté par le client. Le règlement est saisi puis validé dans « Règlements » : la facture passe alors à « Payée »."
        action={
          canManage && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Émettre une facture
            </Button>
          )
        }
      />
      {notice && (
        <div className="mb-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      <Card>
        <CardHeader
          title="Registre des factures"
          action={
            <div className="w-48">
              <SelectField
                label="Statut"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                options={[
                  { value: '', label: 'Toutes' },
                  ...Object.entries(INVOICE_STATUS_LABELS).map(([value, label]) => ({
                    value,
                    label,
                  })),
                ]}
              />
            </div>
          }
        />
        {invoices.state === 'loading' && <LoadingState />}
        {invoices.state === 'error' && (
          <ErrorState error={invoices.error} onRetry={invoices.reload} />
        )}
        {invoices.state === 'success' &&
          (invoices.data.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-7 w-7" />}
              title="Aucune facture"
              description="Les factures émises apparaîtront ici."
            />
          ) : (
            <Table head={['Numéro', 'Organisation', 'Détail', 'Total', 'Échéance', 'Statut', '']}>
              {invoices.data.map((i) => (
                <tr key={i.id} data-testid="invoice-row">
                  <Td className="font-mono text-sm">{i.number}</Td>
                  <Td>
                    {i.organization.name}
                    <span className="block text-xs text-muted">{i.product.name}</span>
                  </Td>
                  <Td>
                    <ul className="text-xs">
                      {i.lines.map((l, n) => (
                        <li key={n}>
                          {l.label} : {formatXof(l.amount)}
                          {l.reason && <span className="text-muted"> ({l.reason})</span>}
                        </li>
                      ))}
                    </ul>
                  </Td>
                  <Td className="tabular-nums font-semibold">{formatXof(i.total)}</Td>
                  <Td>{formatDate(i.dueAt)}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[i.status]}>{INVOICE_STATUS_LABELS[i.status]}</Badge>
                    {i.paidAt && (
                      <span className="block text-xs text-muted">le {formatDate(i.paidAt)}</span>
                    )}
                    {i.cancelReason && (
                      <span className="block text-xs text-muted">{i.cancelReason}</span>
                    )}
                  </Td>
                  <Td>
                    {canManage && i.status === 'ISSUED' && i.payments.length === 0 && (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<XCircle className="h-4 w-4" />}
                        onClick={() => setCancelling(i)}
                      >
                        Annuler
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          ))}
      </Card>
      <IssueDialog
        open={creating}
        onClose={() => setCreating(false)}
        onIssued={(number) => {
          setCreating(false);
          setNotice(`Facture ${number} émise.`);
          invoices.reload();
        }}
      />
      <CancelDialog
        invoice={cancelling}
        onClose={() => setCancelling(null)}
        onCancelled={(number) => {
          setCancelling(null);
          setNotice(`Facture ${number} annulée.`);
          invoices.reload();
        }}
      />
    </>
  );
}

function IssueDialog({
  open,
  onClose,
  onIssued,
}: {
  open: boolean;
  onClose: () => void;
  onIssued: (number: string) => void;
}) {
  const orgs = useApi<PlatformOrganization[]>(open ? '/platform/organizations' : null);
  const [organizationId, setOrganizationId] = useState('');
  const org = useApi<SuiteOrganization>(
    organizationId ? `/platform/organizations/${organizationId}` : null,
  );
  const [subscriptionId, setSubscriptionId] = useState('');
  const [setup, setSetup] = useState(false);
  const [months, setMonths] = useState('1');
  const [adjustment, setAdjustment] = useState({ amount: '', reason: '' });
  const [dueAt, setDueAt] = useState('');
  const [notes, setNotes] = useState('');
  // Clé d'idempotence par ouverture : une nouvelle tentative après erreur réseau renvoie la même facture.
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (open) setIdempotencyKey(crypto.randomUUID());
  }, [open]);

  const sub =
    org.state === 'success'
      ? org.data.subscriptions.find((s) => s.id === subscriptionId)
      : undefined;
  const setupFee = sub ? (sub.agreedSetupFee ?? sub.plan.setupFee) : 0;
  const monthly = sub ? (sub.agreedMonthlyPrice ?? sub.plan.monthlyPrice) : 0;
  const monthsN = Number(months) || 0;
  const adjN = Number(adjustment.amount) || 0;
  const estimate = (setup ? setupFee : 0) + monthly * monthsN + adjN;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const lines: InvoiceLineInput[] = [];
    if (setup) lines.push({ kind: 'SETUP' });
    if (monthsN > 0) lines.push({ kind: 'MONTHLY', months: monthsN });
    if (adjN !== 0)
      lines.push({ kind: 'ADJUSTMENT', amount: adjN, reason: adjustment.reason.trim() });
    try {
      const res = await api<{ number: string }>('/platform/invoices', {
        method: 'POST',
        body: {
          subscriptionId,
          lines,
          ...(dueAt ? { dueAt } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          idempotencyKey,
        },
      });
      onIssued(res.number);
      setOrganizationId('');
      setSubscriptionId('');
      setSetup(false);
      setMonths('1');
      setAdjustment({ amount: '', reason: '' });
      setDueAt('');
      setNotes('');
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
      title="Émettre une facture"
      description="Montants calculés par le serveur au tarif accepté par le client (figé à l'activation)."
    >
      <form onSubmit={submit} className="space-y-3">
        {orgs.state === 'success' ? (
          <SelectField
            label="Organisation"
            required
            value={organizationId}
            onChange={(e) => {
              setOrganizationId(e.target.value);
              setSubscriptionId('');
            }}
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
        {org.state === 'success' && (
          <SelectField
            label="Abonnement"
            required
            value={subscriptionId}
            onChange={(e) => setSubscriptionId(e.target.value)}
            options={[
              { value: '', label: 'Choisir…' },
              ...org.data.subscriptions.map((s) => ({
                value: s.id,
                label: `${s.product.name} — ${s.plan.name}`,
              })),
            ]}
          />
        )}
        {sub && (
          <>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5 accent-forest"
                checked={setup}
                onChange={(e) => setSetup(e.target.checked)}
              />
              Frais de mise en service ({formatXof(setupFee)})
            </label>
            <InputField
              label={`Mensualités (${formatXof(monthly)} / mois)`}
              type="number"
              min={0}
              max={INVOICE_MAX_MONTHS}
              value={months}
              onChange={(e) => setMonths(e.target.value)}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <InputField
                label="Ajustement (FCFA, facultatif)"
                hint="Négatif pour une remise."
                type="number"
                value={adjustment.amount}
                onChange={(e) => setAdjustment({ ...adjustment, amount: e.target.value })}
              />
              <InputField
                label="Motif de l'ajustement"
                value={adjustment.reason}
                onChange={(e) => setAdjustment({ ...adjustment, reason: e.target.value })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <InputField
                label="Échéance"
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
              <InputField label="Note" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <p className="text-sm">
              Total estimé : <strong className="tabular-nums">{formatXof(estimate)}</strong>
              <span className="block text-xs text-muted">
                Le montant définitif est calculé par le serveur.
              </span>
            </p>
          </>
        )}
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={saving} disabled={!sub || estimate <= 0}>
            Émettre
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function CancelDialog({
  invoice,
  onClose,
  onCancelled,
}: {
  invoice: SuiteInvoice | null;
  onClose: () => void;
  onCancelled: (number: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!invoice) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/platform/invoices/${invoice.id}/cancel`, {
        method: 'POST',
        body: { reason: reason.trim() },
      });
      onCancelled(invoice.number);
      setReason('');
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={invoice !== null}
      onClose={onClose}
      title="Annuler la facture"
      description={
        invoice
          ? `${invoice.number} · ${invoice.organization.name} · ${formatXof(invoice.total)}`
          : ''
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <InputField
          label="Motif"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Retour
          </Button>
          <Button type="submit" loading={saving} disabled={reason.trim().length < 3}>
            Annuler la facture
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
