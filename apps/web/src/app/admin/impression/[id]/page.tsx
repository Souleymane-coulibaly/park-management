'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PRINT_ORDER_FLOW, PRINT_ORDER_STATUS_LABELS, formatXof } from '@ocall/shared';
import { OrderDetail } from '@/components/print/print-orders';
import type { PrintOrderDetailView } from '@/components/print/print-types';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

type Detail = PrintOrderDetailView & { organizationName: string };
type Pending = 'reject' | 'item' | 'pay' | 'unpay' | null;

const asError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion au serveur impossible.');

/**
 * Commande vue par l'atelier : étapes de production dans l'ordre, refus d'une carte ou de la commande,
 * fichier de production (CR80 recto verso), encaissement en espèces à la livraison. Chaque action est
 * inscrite au journal de la commande et au journal d'audit de la plateforme.
 */
export default function AdminPrintOrderPage() {
  const { id } = useParams<{ id: string }>();
  const order = useApi<Detail>(`/platform/print/orders/${id}`);
  const me = useApi<{ platformPermissions: string[] }>('/auth/me');
  const [current, setCurrent] = useState<Detail | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState('');
  const [itemId, setItemId] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  if (order.state === 'loading') return <LoadingState />;
  if (order.state === 'error') return <ErrorState error={order.error} onRetry={order.reload} />;
  const o = current ?? order.data;
  const next = PRINT_ORDER_FLOW[o.status];
  const supervise =
    me.state === 'success' && me.data.platformPermissions.includes('platform.print.supervise');
  const pendingItems = o.items.filter((i) => i.status === 'PENDING');

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      setCurrent(
        await api<Detail>(`/platform/print/orders/${id}/${path}`, { method: 'POST', body }),
      );
      setPending(null);
      setReason('');
      setReference('');
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Atelier Ocall Print"
        title={`Commande ${o.number}`}
        description={o.organizationName}
      />
      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Production"
            description="Les étapes se suivent dans l’ordre ; le règlement s’enregistre à la livraison."
          />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap gap-3">
              {next && (
                <Button
                  loading={busy}
                  onClick={() => void act('advance', { status: next })}
                  data-testid="print-advance"
                >
                  Passer à « {PRINT_ORDER_STATUS_LABELS[next]} »
                </Button>
              )}
              {!o.filesPurged && o.quantity > 0 && (
                <a
                  href={`/api/v1/platform/print/orders/${id}/production.pdf`}
                  className="inline-flex items-center rounded-xl border border-line px-4 py-2 text-sm font-semibold text-forest hover:bg-forest-light/40"
                  data-testid="print-production-file"
                >
                  Fichier de production (PDF CR80)
                </a>
              )}
              {pendingItems.length > 0 &&
                ['SUBMITTED', 'ACCEPTED', 'IN_PRODUCTION'].includes(o.status) && (
                  <Button variant="secondary" onClick={() => setPending('item')}>
                    Refuser une carte
                  </Button>
                )}
              {['SUBMITTED', 'ACCEPTED'].includes(o.status) && (
                <Button variant="secondary" onClick={() => setPending('reject')}>
                  Refuser la commande
                </Button>
              )}
              {o.paymentStatus === 'UNPAID' &&
                ['READY', 'DELIVERED'].includes(o.status) &&
                o.totalAmount > 0 && (
                  <Button
                    variant="accent"
                    onClick={() => setPending('pay')}
                    data-testid="print-pay-open"
                  >
                    Encaisser {formatXof(o.totalAmount)} en espèces
                  </Button>
                )}
              {o.paymentStatus === 'PAID' && supervise && (
                <Button variant="ghost" onClick={() => setPending('unpay')}>
                  Annuler le règlement
                </Button>
              )}
            </div>
            <ApiErrorAlert error={error} />
          </CardBody>
        </Card>
        <OrderDetail order={o} onChange={(x) => setCurrent({ ...o, ...x })} />
      </div>
      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={
          pending === 'pay'
            ? 'Encaissement à la livraison'
            : pending === 'unpay'
              ? 'Annuler le règlement'
              : pending === 'item'
                ? 'Refuser une carte'
                : 'Refuser la commande'
        }
      >
        <div className="space-y-4">
          {pending === 'item' && (
            <SelectField
              label="Carte"
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              options={[
                { value: '', label: 'Choisir…' },
                ...pendingItems.map((i) => ({
                  value: i.id,
                  label: `${i.holderLabel ?? i.cardNumber}`,
                })),
              ]}
            />
          )}
          {pending === 'pay' ? (
            <>
              <p className="text-sm">
                Montant dû : <strong>{formatXof(o.totalAmount)}</strong> (espèces, montant exact).
              </p>
              <InputField
                label="N° du reçu remis"
                required
                value={reference}
                maxLength={60}
                onChange={(e) => setReference(e.target.value)}
              />
            </>
          ) : (
            <InputField
              label="Motif"
              required
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
          <ApiErrorAlert error={error} />
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setPending(null)}>
              Retour
            </Button>
            <Button
              loading={busy}
              disabled={
                pending === 'pay'
                  ? reference.trim().length < 2
                  : reason.trim().length < 3 || (pending === 'item' && !itemId)
              }
              data-testid="print-dialog-confirm"
              onClick={() => {
                if (pending === 'pay') void act('payment', { amount: o.totalAmount, reference });
                else if (pending === 'unpay') void act('payment/cancel', { reason });
                else if (pending === 'item') void act(`items/${itemId}/reject`, { reason });
                else void act('reject', { reason });
              }}
            >
              Confirmer
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
