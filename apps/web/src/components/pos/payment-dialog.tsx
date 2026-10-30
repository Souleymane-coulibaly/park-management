'use client';

import { type FormEvent, type ReactNode, useState } from 'react';
import { Banknote, CheckCircle2, Smartphone } from 'lucide-react';
import { PREPARATION_STATUS_LABELS, formatSaleNumber, formatXof } from '@ocall/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert, ApiErrorAlert } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { newRequestId } from '@/lib/request-id';
import type { PaymentMethodInfo, PaymentResult, Sale } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import type { PosTerminal } from '@/lib/types';
import { AfterPaymentHardware } from './after-payment-hardware';

/** Montants rapides : le total exact, puis les arrondis aux coupures FCFA courantes. */
function quickAmounts(total: number): number[] {
  const bills = [500, 1000, 2000, 5000, 10_000];
  const rounded = bills.map((b) => Math.ceil(total / b) * b);
  return [...new Set([total, ...rounded])].filter((a) => a >= total).slice(0, 5);
}

/**
 * Encaissement d'une vente. La monnaie affichée avant validation n'est qu'un aperçu :
 * le montant enregistré et la monnaie à rendre sont ceux calculés par le serveur.
 */
export function PaymentDialog({
  sale,
  onClose,
  onPaid,
}: {
  sale: Sale;
  onClose: () => void;
  onPaid: (result: PaymentResult) => void;
}) {
  const methods = useApi<PaymentMethodInfo[]>('/payments/methods');
  const [tendered, setTendered] = useState('');
  // Une clé par tentative d'encaissement : un double appui ou une reprise réseau ne paie pas deux fois.
  const [requestId] = useState(newRequestId);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const amount = tendered === '' ? null : Number(tendered);
  const validAmount = amount !== null && Number.isInteger(amount) && amount >= sale.total;
  const wave =
    methods.state === 'success' ? methods.data.find((m) => m.method === 'WAVE') : undefined;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!validAmount) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api<PaymentResult>(`/sales/${sale.id}/payments`, {
        method: 'POST',
        body: { method: 'CASH', amountTendered: amount, clientRequestId: requestId },
      });
      onPaid(result);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e
          : new ApiError(
              0,
              'NETWORK',
              'Connexion au serveur impossible. Réessayez : le paiement ne sera pas compté deux fois.',
            ),
      );
      setLoading(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Encaisser la vente n° ${formatSaleNumber(sale.number)}`}
      description={sale.establishment.name}
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="rounded-2xl bg-forest px-5 py-4 text-ivory">
          <p className="text-sm text-ivory/75">Total à payer</p>
          <p className="font-display text-4xl font-bold" data-testid="payment-total">
            {formatXof(sale.total)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-forest bg-forest-light/60 font-semibold text-forest-dark">
            <Banknote className="h-5 w-5" aria-hidden /> Espèces
          </div>
          <div
            className="flex min-h-14 flex-col items-center justify-center rounded-xl border border-line bg-ivory-dark/40 px-2 text-center text-muted"
            aria-disabled="true"
            title={wave?.reason ?? undefined}
          >
            <span className="flex items-center gap-2 font-semibold">
              <Smartphone className="h-5 w-5" aria-hidden /> Wave
            </span>
            <span className="text-xs">{wave?.available ? 'Disponible' : 'Non activé'}</span>
          </div>
        </div>

        <div>
          <label htmlFor="amount-tendered" className="block text-sm font-medium">
            Montant remis par le client (FCFA)
          </label>
          <input
            id="amount-tendered"
            inputMode="numeric"
            pattern="[0-9]*"
            autoFocus
            value={tendered}
            onChange={(e) => setTendered(e.target.value.replace(/\D/g, ''))}
            className="mt-1.5 block w-full rounded-xl border border-line bg-surface px-4 py-3 text-right font-display text-3xl font-bold focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/20"
            placeholder="0"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {quickAmounts(sale.total).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setTendered(String(a))}
                className="min-h-11 rounded-xl border border-line bg-surface px-3 text-sm font-semibold hover:border-forest"
              >
                {a === sale.total ? 'Montant exact' : formatXof(a)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-savanna-light/60 px-4 py-3">
          <span className="font-medium">Monnaie à rendre</span>
          <span className="font-display text-2xl font-bold">
            {validAmount ? formatXof(amount! - sale.total) : '—'}
          </span>
        </div>
        {amount !== null && !validAmount && (
          <Alert tone="error">Le montant remis doit couvrir le total.</Alert>
        )}
        <ApiErrorAlert error={error} />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="lg" onClick={onClose}>
            Plus tard
          </Button>
          <Button
            type="submit"
            size="lg"
            loading={loading}
            disabled={!validAmount}
            icon={<CheckCircle2 className="h-5 w-5" />}
          >
            Valider l’encaissement
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Reçu affiché après paiement : montants confirmés par le serveur, puis tiroir et ticket. */
export function ReceiptDialog({
  result,
  terminal,
  onClose,
  extra,
}: {
  result: PaymentResult;
  terminal: PosTerminal | null;
  onClose: () => void;
  /** Actions complémentaires (ex. envoi explicite en cuisine), affichées avant « Nouvelle vente ». */
  extra?: ReactNode;
}) {
  const { sale, payment } = result;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Paiement enregistré"
      description={`Vente n° ${formatSaleNumber(sale.number)}`}
    >
      <div className="space-y-4">
        <dl className="space-y-2 rounded-2xl border border-line bg-ivory/60 p-4 text-lg">
          <div className="flex justify-between">
            <dt>Total</dt>
            <dd className="font-semibold">{formatXof(payment.amount)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Reçu en espèces</dt>
            <dd className="font-semibold">{formatXof(payment.amountTendered ?? payment.amount)}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-2 text-2xl">
            <dt className="font-semibold">Monnaie rendue</dt>
            <dd className="font-display font-bold text-forest" data-testid="change-given">
              {formatXof(payment.changeGiven ?? 0)}
            </dd>
          </div>
        </dl>
        <AfterPaymentHardware result={result} terminal={terminal} />
        {sale.activity === 'RESTAURANT' && (
          <Alert tone="info">
            Préparation : {PREPARATION_STATUS_LABELS[sale.preparationStatus].toLowerCase()}. Le
            paiement ne déclenche jamais la préparation.
          </Alert>
        )}
        {extra}
        <Button size="lg" className="w-full" onClick={onClose}>
          Nouvelle vente
        </Button>
      </div>
    </Dialog>
  );
}
