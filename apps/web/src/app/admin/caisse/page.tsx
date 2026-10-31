'use client';

import { type FormEvent, useState } from 'react';
import { Banknote, CheckCircle2, Plus, XCircle } from 'lucide-react';
import { type SubscriptionPaymentView, formatXof } from '@ocall/shared';
import { useCanPlatform, useSession } from '@/components/app/session-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface ReconciliationRow {
  collectorId: string;
  collector: string | null;
  inProgress: number;
  confirmed: number;
  rejectedOrCancelled: number;
  refunded: number;
  remittedConfirmed: number;
  remittedPending: number;
  toRemit: number;
}

interface RemittanceRow {
  id: string;
  number: string;
  amount: number;
  remittedAt: string;
  reference: string | null;
  status: 'DECLARED' | 'CONFIRMED' | 'REJECTED';
  collectorId: string;
  recordedById: string;
  collector: string | null;
  confirmedBy: string | null;
  rejectionReason: string | null;
  payments: number;
}

const REMITTANCE_LABELS = { DECLARED: 'À confirmer', CONFIRMED: 'Confirmée', REJECTED: 'Rejetée' };

/**
 * Espèces : rapprochement par collecteur et remises à Ocall (Sprint 12A). Une remise regroupe des
 * règlements en espèces confirmés ; elle est confirmée par une autre personne que le collecteur.
 */
export default function CashPage() {
  const me = useSession();
  const canDeclare = useCanPlatform('platform.billing.cash.declare');
  const canValidate = useCanPlatform('platform.billing.validate');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [creating, setCreating] = useState(false);
  const reconciliation = useApi<ReconciliationRow[]>('/platform/cash-remittances/reconciliation');
  const remittances = useApi<RemittanceRow[]>('/platform/cash-remittances');

  async function decide(id: string, decision: 'confirm' | 'reject') {
    const reason = decision === 'reject' ? window.prompt('Motif du rejet de la remise') : null;
    if (decision === 'reject' && (!reason || reason.trim().length < 3)) return;
    setError(null);
    try {
      await api(`/platform/cash-remittances/${id}/${decision}`, {
        method: 'POST',
        body: decision === 'reject' ? { reason: reason!.trim() } : {},
      });
      setNotice(decision === 'confirm' ? 'Remise confirmée.' : 'Remise rejetée.');
      remittances.reload();
      reconciliation.reload();
    } catch (e) {
      setError(e as ApiError);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Super Admin"
        title="Caisse et remises d’espèces"
        description="Suivi des espèces collectées par chaque collecteur : confirmées, remises à Ocall et restant à remettre."
        action={
          canDeclare ? (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Déclarer une remise
            </Button>
          ) : undefined
        }
      />
      {notice && (
        <div className="mb-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      <ApiErrorAlert error={error} />
      <Card className="mb-6">
        <CardHeader title="Rapprochement par collecteur" />
        {reconciliation.state === 'loading' && <LoadingState />}
        {reconciliation.state === 'error' && (
          <ErrorState error={reconciliation.error} onRetry={reconciliation.reload} />
        )}
        {reconciliation.state === 'success' &&
          (reconciliation.data.length === 0 ? (
            <EmptyState
              icon={<Banknote className="h-7 w-7" />}
              title="Aucune espèce collectée"
              description="Les règlements en espèces apparaîtront ici."
            />
          ) : (
            <Table
              head={[
                'Collecteur',
                'En cours',
                'Confirmées',
                'Remises',
                'En attente',
                'À remettre',
                'Remboursées',
              ]}
            >
              {reconciliation.data.map((r) => (
                <tr key={r.collectorId}>
                  <Td className="font-medium">{r.collector ?? '—'}</Td>
                  <Td className="tabular-nums">{formatXof(r.inProgress)}</Td>
                  <Td className="tabular-nums">{formatXof(r.confirmed)}</Td>
                  <Td className="tabular-nums">{formatXof(r.remittedConfirmed)}</Td>
                  <Td className="tabular-nums">{formatXof(r.remittedPending)}</Td>
                  <Td
                    className={`tabular-nums ${r.toRemit > 0 ? 'font-semibold text-terracotta-dark' : ''}`}
                  >
                    {formatXof(r.toRemit)}
                  </Td>
                  <Td className="tabular-nums">{formatXof(r.refunded)}</Td>
                </tr>
              ))}
            </Table>
          ))}
      </Card>
      <Card>
        <CardHeader title="Remises" />
        {remittances.state === 'loading' && <LoadingState />}
        {remittances.state === 'error' && (
          <ErrorState error={remittances.error} onRetry={remittances.reload} />
        )}
        {remittances.state === 'success' &&
          (remittances.data.length === 0 ? (
            <EmptyState
              icon={<Banknote className="h-7 w-7" />}
              title="Aucune remise"
              description="Déclarez une remise quand un collecteur dépose ses espèces."
            />
          ) : (
            <Table head={['Remise', 'Collecteur', 'Montant', 'Statut', '']}>
              {remittances.data.map((r) => {
                const self = r.collectorId === me.user.id || r.recordedById === me.user.id;
                return (
                  <tr key={r.id}>
                    <Td className="font-medium">
                      {r.number}
                      <span className="block text-xs text-muted">
                        {formatDate(r.remittedAt)} · {r.payments} règlement(s)
                        {r.reference && ` · ${r.reference}`}
                      </span>
                    </Td>
                    <Td>{r.collector}</Td>
                    <Td className="tabular-nums">{formatXof(r.amount)}</Td>
                    <Td>
                      <Badge
                        tone={
                          r.status === 'CONFIRMED'
                            ? 'forest'
                            : r.status === 'DECLARED'
                              ? 'savanna'
                              : 'terracotta'
                        }
                      >
                        {REMITTANCE_LABELS[r.status]}
                      </Badge>
                      {r.confirmedBy && (
                        <span className="block text-xs text-muted">par {r.confirmedBy}</span>
                      )}
                    </Td>
                    <Td>
                      {r.status === 'DECLARED' && canValidate && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            icon={<CheckCircle2 className="h-4 w-4" />}
                            disabled={self}
                            title={
                              self ? 'Confirmation par une autre personne (quatre yeux)' : undefined
                            }
                            onClick={() => decide(r.id, 'confirm')}
                          >
                            Confirmer
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<XCircle className="h-4 w-4" />}
                            onClick={() => decide(r.id, 'reject')}
                          >
                            Rejeter
                          </Button>
                        </div>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          ))}
      </Card>
      {creating && (
        <RemittanceDialog
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            setNotice('Remise déclarée : une autre personne doit la confirmer.');
            remittances.reload();
            reconciliation.reload();
          }}
        />
      )}
    </>
  );
}

function RemittanceDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const me = useSession();
  const payments = useApi<SubscriptionPaymentView[]>(
    '/platform/subscription-payments?status=CONFIRMED',
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [remittedAt, setRemittedAt] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // Espèces confirmées collectées par l'utilisateur courant, pas encore remises.
  const mine =
    payments.state === 'success'
      ? payments.data.filter(
          (p) => p.method === 'CASH' && p.collectedById === me.user.id && !p.remittanceNumber,
        )
      : [];
  const total = mine.filter((p) => selected.includes(p.id)).reduce((t, p) => t + p.amount, 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api('/platform/cash-remittances', {
        method: 'POST',
        body: {
          collectorId: me.user.id,
          paymentIds: selected,
          remittedAt,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
        },
      });
      onDone();
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
      title="Déclarer une remise"
      description="Espèces confirmées que vous avez collectées et que vous remettez à Ocall."
    >
      <form onSubmit={submit} className="space-y-3">
        {payments.state === 'loading' && <LoadingState />}
        {payments.state === 'success' && mine.length === 0 && (
          <Alert tone="info">Aucune espèce confirmée à remettre.</Alert>
        )}
        {mine.map((p) => (
          <label key={p.id} className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5 accent-forest"
              checked={selected.includes(p.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked ? [...selected, p.id] : selected.filter((x) => x !== p.id),
                )
              }
            />
            <span>
              {p.receiptNumber} · {p.organization.name} · {formatXof(p.amount)}
            </span>
          </label>
        ))}
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField
            label="Remis le"
            type="date"
            required
            value={remittedAt}
            onChange={(e) => setRemittedAt(e.target.value)}
          />
          <InputField
            label="Référence (bordereau…)"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>
        <p className="text-sm font-semibold">Total : {formatXof(total)}</p>
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={saving} disabled={selected.length === 0}>
            Déclarer la remise
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
