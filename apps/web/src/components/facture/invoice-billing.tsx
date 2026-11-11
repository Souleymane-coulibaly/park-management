'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  FACTURE_PAYMENT_METHODS,
  FACTURE_PAYMENT_METHOD_LABELS,
  type FactureDocumentStatus,
  type FacturePaymentMethod,
  canCreditFactureInvoice,
  canRecordFacturePayment,
  formatXof,
} from '@ocall/shared';
import { DocumentStatusBadge } from '@/components/facture/document-status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';

export interface InvoicePayment {
  id: string;
  amount: number;
  method: FacturePaymentMethod;
  paidAt: string;
  reference: string | null;
  note: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface InvoiceBillingView {
  id: string;
  type: 'INVOICE';
  status: FactureDocumentStatus;
  totalTtc: number;
  amountPaid: number;
  amountCredited: number;
  balance: number | null;
  overdue: boolean;
  dueDate: string | null;
  reminderCount: number;
  lastReminderAt: string | null;
  client: { email: string | null };
  payments: InvoicePayment[];
  creditNotes: {
    id: string;
    number: string | null;
    status: FactureDocumentStatus;
    totalTtc: number;
  }[];
}

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'UTC' });
const today = () => new Date().toISOString().slice(0, 10);
const toError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.');

/**
 * Facture émise : reste à payer, échéance, encaissements (saisie, annulation), avoirs et relance. Les
 * montants affichés viennent de l'API, qui seule les calcule.
 */
export function InvoiceBilling({
  invoice,
  canBill,
  canManage,
  onChanged,
}: {
  invoice: InvoiceBillingView;
  /** Encaissements et avoirs : gérant et comptable. */
  canBill: boolean;
  /** Relance par e-mail : rôles qui gèrent les documents. */
  canManage: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const balance = invoice.balance ?? 0;
  const [payment, setPayment] = useState(() => ({
    amount: String(Math.max(balance, 0)),
    method: 'CASH' as FacturePaymentMethod,
    paidAt: today(),
    reference: '',
  }));
  const [to, setTo] = useState(invoice.client.email ?? '');
  // Facture rechargée (après un encaissement ou un avoir) : montant proposé = nouveau reste à payer.
  useEffect(() => setPayment((p) => ({ ...p, amount: String(Math.max(balance, 0)) })), [balance]);

  async function run(action: string, work: () => Promise<void>) {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (e) {
      setError(toError(e));
    } finally {
      setBusy(null);
    }
  }
  const post = (path: string, body?: unknown) =>
    api<{ id: string }>(`/facture/documents/${invoice.id}/${path}`, { method: 'POST', body });

  const payable = canRecordFacturePayment(invoice);
  const creditable = canCreditFactureInvoice(invoice);

  return (
    <div className="space-y-6" data-testid="facture-invoice-billing">
      {notice && (
        <div role="status">
          <Alert tone="success" title={notice} />
        </div>
      )}
      <ApiErrorAlert error={error} />
      <Card>
        <CardHeader title="Règlement" />
        <CardBody>
          <dl className="grid gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted">Montant TTC</dt>
              <dd className="text-base font-semibold">{formatXof(invoice.totalTtc)}</dd>
            </div>
            <div>
              <dt className="text-muted">Encaissé</dt>
              <dd className="text-base font-semibold" data-testid="facture-amount-paid">
                {formatXof(invoice.amountPaid)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Avoirs</dt>
              <dd className="text-base font-semibold">{formatXof(invoice.amountCredited)}</dd>
            </div>
            <div>
              <dt className="text-muted">
                {balance < 0 ? 'Trop-perçu à rembourser' : 'Reste à payer'}
              </dt>
              <dd className="text-base font-semibold" data-testid="facture-balance">
                {formatXof(Math.abs(balance))}
              </dd>
            </div>
          </dl>
          {invoice.dueDate && (
            <p className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Échéance :</span> {dateFr(invoice.dueDate)}
              {invoice.overdue && (
                <span
                  className="inline-flex items-center gap-1 font-semibold text-terracotta-dark"
                  data-testid="facture-overdue"
                >
                  <AlertTriangle className="h-4 w-4" aria-hidden /> En retard
                </span>
              )}
              {invoice.reminderCount > 0 && invoice.lastReminderAt && (
                <span className="text-muted">
                  · Relancée {invoice.reminderCount} fois, dernière le{' '}
                  {dateFr(invoice.lastReminderAt)}
                </span>
              )}
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Encaissements" />
        <CardBody className="space-y-4">
          {invoice.payments.length === 0 ? (
            <p className="text-sm text-muted">Aucun encaissement.</p>
          ) : (
            <ul className="divide-y divide-line/70 text-sm" data-testid="facture-payments">
              {invoice.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className={p.cancelledAt ? 'text-muted line-through' : ''}>
                    {dateFr(p.paidAt)} — {FACTURE_PAYMENT_METHOD_LABELS[p.method]}
                    {p.reference ? ` (${p.reference})` : ''}
                  </span>
                  <span className="flex items-center gap-3">
                    <strong className={p.cancelledAt ? 'text-muted line-through' : ''}>
                      {formatXof(p.amount)}
                    </strong>
                    {p.cancelledAt ? (
                      <span className="text-xs text-muted">Annulé : {p.cancelReason}</span>
                    ) : (
                      canBill && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={busy === `cancel-${p.id}`}
                          onClick={() =>
                            void run(`cancel-${p.id}`, async () => {
                              const reason = window.prompt(
                                'Motif de l’annulation de l’encaissement :',
                              );
                              if (!reason || reason.trim().length < 3) return;
                              await post(`payments/${p.id}/cancel`, { reason: reason.trim() });
                              setNotice('Encaissement annulé.');
                              onChanged();
                            })
                          }
                        >
                          Annuler
                        </Button>
                      )
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canBill && payable && (
            <form
              className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-5"
              data-testid="facture-payment-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run('pay', async () => {
                  await post('payments', {
                    amount: Number(payment.amount),
                    method: payment.method,
                    paidAt: payment.paidAt,
                    ...(payment.reference ? { reference: payment.reference } : {}),
                  });
                  setNotice('Encaissement enregistré.');
                  setPayment((p) => ({ ...p, reference: '' }));
                  onChanged();
                });
              }}
            >
              <InputField
                label="Montant (FCFA)"
                type="number"
                min={1}
                max={balance}
                step={1}
                required
                value={payment.amount}
                onChange={(e) => setPayment({ ...payment, amount: e.target.value })}
              />
              <SelectField
                label="Mode"
                value={payment.method}
                onChange={(e) =>
                  setPayment({ ...payment, method: e.target.value as FacturePaymentMethod })
                }
                options={FACTURE_PAYMENT_METHODS.map((m) => ({
                  value: m,
                  label: FACTURE_PAYMENT_METHOD_LABELS[m],
                }))}
              />
              <InputField
                label="Date"
                type="date"
                max={today()}
                required
                value={payment.paidAt}
                onChange={(e) => setPayment({ ...payment, paidAt: e.target.value })}
              />
              <InputField
                label="Référence (facultatif)"
                maxLength={80}
                value={payment.reference}
                onChange={(e) => setPayment({ ...payment, reference: e.target.value })}
              />
              <div className="flex items-end">
                <Button type="submit" loading={busy === 'pay'} data-testid="facture-record-payment">
                  Enregistrer
                </Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>

      {(invoice.creditNotes.length > 0 || (canBill && creditable)) && (
        <Card>
          <CardHeader
            title="Avoirs"
            description="Une facture émise ne se modifie ni ne s’annule : elle se corrige par un avoir, total ou partiel."
          />
          <CardBody className="space-y-3">
            {invoice.creditNotes.map((c) => (
              <p key={c.id} className="flex flex-wrap items-center gap-3 text-sm">
                <Link
                  href={`/facture/documents/${c.id}`}
                  className="font-semibold text-forest underline"
                >
                  Avoir {c.number ?? '(brouillon)'}
                </Link>
                <span>{formatXof(c.totalTtc)}</span>
                <DocumentStatusBadge status={c.status} />
              </p>
            ))}
            {canBill && creditable && (
              <Button
                variant="secondary"
                loading={busy === 'credit'}
                data-testid="facture-create-credit-note"
                onClick={() =>
                  void run('credit', async () => {
                    const note = await post('credit-note');
                    router.push(`/facture/documents/${note.id}`);
                  })
                }
              >
                Établir un avoir
              </Button>
            )}
          </CardBody>
        </Card>
      )}

      {canManage && payable && (
        <Card>
          <CardHeader
            title="Relancer le client"
            description="E-mail rappelant le reste à payer et l’échéance, facture en pièce jointe."
          />
          <CardBody className="flex flex-wrap items-end gap-3">
            <InputField
              label="Destinataire"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <Button
              variant="secondary"
              loading={busy === 'remind'}
              data-testid="facture-remind"
              onClick={() =>
                void run('remind', async () => {
                  await post('remind', to ? { to } : {});
                  setNotice('Relance envoyée.');
                  onChanged();
                })
              }
            >
              Envoyer la relance
            </Button>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
