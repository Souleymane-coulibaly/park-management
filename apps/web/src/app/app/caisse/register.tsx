'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChefHat, Minus, Plus, ShoppingBasket, StickyNote, Trash2 } from 'lucide-react';
import { formatSaleNumber, formatXof } from '@ocall/shared';
import { useCan } from '@/components/app/session-context';
import {
  CashSessionGate,
  DeviceBar,
  OfflineBanner,
  SessionBar,
  toApiError,
} from '@/components/pos/cash-session';
import { PaymentDialog, ReceiptDialog } from '@/components/pos/payment-dialog';
import { type SendResult, sendToKitchen } from '@/components/restaurant/kitchen-actions';
import {
  DEFAULT_ORDER_OPTIONS,
  LineNoteDialog,
  type OrderOptions,
  OrderOptionsBar,
} from '@/components/restaurant/order-options';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { newRequestId } from '@/lib/request-id';
import type { CashSession, PaymentResult, PosCatalogCategory, Quote, Sale } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { useDeviceTerminal, useOnline, useWakeLock } from '@/lib/hardware/use-terminal';

/** Caisse d'un établissement : ouverture de session, puis terminal de vente. */
export function Register({ establishmentId }: { establishmentId: string }) {
  return (
    <CashSessionGate establishmentId={establishmentId}>
      {(session, reload) => (
        <Terminal establishmentId={establishmentId} session={session} onSessionChange={reload} />
      )}
    </CashSessionGate>
  );
}

interface CartLine {
  variantId: string;
  productName: string;
  variantName: string;
  quantity: number;
  /** Instruction de préparation : deux lignes du même article diffèrent par leur instruction. */
  notes: string;
}

const lineKey = (l: Pick<CartLine, 'variantId' | 'notes'>) => `${l.variantId}|${l.notes}`;

type ProductTile = PosCatalogCategory['products'][number];
/** Ce qui suit l'enregistrement de la commande : encaissement, envoi en cuisine ou rien. */
type Checkout = 'pay' | 'kitchen' | 'save';

function Terminal({
  establishmentId,
  session,
  onSessionChange,
}: {
  establishmentId: string;
  session: CashSession;
  onSessionChange: () => void;
}) {
  const catalog = useApi<PosCatalogCategory[]>(`/pos/catalog?establishmentId=${establishmentId}`);
  const device = useDeviceTerminal(establishmentId);
  const online = useOnline();
  const canSend = useCan('order.send_kitchen');
  useWakeLock(true);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [options, setOptions] = useState<OrderOptions>(DEFAULT_ORDER_OPTIONS);
  const [quote, setQuote] = useState<{
    data: Quote | null;
    error: ApiError | null;
    loading: boolean;
  }>({ data: null, error: null, loading: false });
  const [picker, setPicker] = useState<ProductTile | null>(null);
  const [noteFor, setNoteFor] = useState<CartLine | null>(null);
  // Clé d'idempotence du panier courant : renouvelée après chaque commande enregistrée.
  const [saleRequestId, setSaleRequestId] = useState(newRequestId);
  const [checkout, setCheckout] = useState<{
    loading: Checkout | null;
    error: ApiError | null;
  }>({ loading: null, error: null });
  const [payingSale, setPayingSale] = useState<Sale | null>(null);
  const [receipt, setReceipt] = useState<PaymentResult | null>(null);
  const [savedOrder, setSavedOrder] = useState<{ sale: Sale; sent: SendResult | null } | null>(
    null,
  );

  const categories = catalog.state === 'success' ? catalog.data : [];
  const activeCategory = categories.find((c) => c.id === categoryId) ?? categories[0];
  const apiLines = cart.map((l) => ({
    variantId: l.variantId,
    quantity: l.quantity,
    ...(l.notes ? { notes: l.notes } : {}),
  }));
  const cartKey = useMemo(() => JSON.stringify(cart.map((l) => [lineKey(l), l.quantity])), [cart]);

  // Les montants affichés viennent du serveur (devis recalculé à chaque modification du panier).
  useEffect(() => {
    if (cart.length === 0) {
      setQuote({ data: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    setQuote((q) => ({ ...q, loading: true }));
    const timer = setTimeout(() => {
      api<Quote>('/pos/quote', { method: 'POST', body: { establishmentId, lines: apiLines } })
        .then((data) => !cancelled && setQuote({ data, error: null, loading: false }))
        .catch(
          (e: unknown) =>
            !cancelled && setQuote({ data: null, error: toApiError(e), loading: false }),
        );
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cartKey résume le contenu du panier
  }, [cartKey, establishmentId]);

  function add(product: ProductTile, variant: ProductTile['variants'][number]) {
    setCart((lines) => {
      const existing = lines.find((l) => l.variantId === variant.id && l.notes === '');
      if (existing)
        return lines.map((l) =>
          l === existing ? { ...l, quantity: Math.min(l.quantity + 1, 999) } : l,
        );
      return [
        ...lines,
        {
          variantId: variant.id,
          productName: product.name,
          variantName: variant.name,
          quantity: 1,
          notes: '',
        },
      ];
    });
  }

  function onTile(product: ProductTile) {
    if (product.variants.length === 1) add(product, product.variants[0]!);
    else setPicker(product);
  }

  function changeQuantity(key: string, delta: number) {
    setCart((lines) =>
      lines.flatMap((l) => {
        if (lineKey(l) !== key) return [l];
        const quantity = Math.min(l.quantity + delta, 999);
        return quantity > 0 ? [{ ...l, quantity }] : [];
      }),
    );
  }

  /** Change l'instruction d'une ligne ; fusionne avec une ligne identique (même article, même note). */
  function setNote(target: CartLine, notes: string) {
    setCart((lines) => {
      const others = lines.filter((l) => l !== target);
      const twin = others.find((l) => l.variantId === target.variantId && l.notes === notes);
      if (twin)
        return others.map((l) =>
          l === twin ? { ...l, quantity: l.quantity + target.quantity } : l,
        );
      return lines.map((l) => (l === target ? { ...l, notes } : l));
    });
  }

  async function submit(next: Checkout) {
    if (!quote.data || quote.loading) return;
    setCheckout({ loading: next, error: null });
    try {
      const sale = await api<Sale>('/orders', {
        method: 'POST',
        body: {
          establishmentId,
          channel: options.channel,
          ...(options.tableId ? { tableId: options.tableId } : {}),
          ...(options.notes.trim() ? { notes: options.notes.trim() } : {}),
          clientRequestId: saleRequestId,
          lines: apiLines,
        },
      });
      // La commande est enregistrée : le panier repart de zéro, quelle que soit la suite.
      setCart([]);
      setOptions(DEFAULT_ORDER_OPTIONS);
      setSaleRequestId(newRequestId());
      if (next === 'pay') setPayingSale(sale);
      else if (next === 'kitchen') {
        const sent = await sendToKitchen(sale.id, establishmentId).catch(() => null);
        setSavedOrder({ sale: sent?.order ?? sale, sent });
      } else setSavedOrder({ sale, sent: null });
      setCheckout({ loading: null, error: null });
    } catch (e) {
      setCheckout({ loading: null, error: toApiError(e) });
    }
  }

  const total = quote.data?.total;
  // Hors connexion, l'encaissement est suspendu : aucune vente n'est enregistrée localement.
  const ready = online && cart.length > 0 && !!quote.data && !quote.loading && !checkout.loading;

  return (
    <>
      <SessionBar session={session} onSessionChange={onSessionChange} />
      <DeviceBar device={device} />

      {!online && (
        <OfflineBanner>
          Hors connexion : l’encaissement est suspendu jusqu’au retour du réseau. Aucune vente n’est
          perdue.
        </OfflineBanner>
      )}

      <div className="grid gap-3 pb-24 lg:grid-cols-[minmax(0,1fr)_380px] lg:pb-0">
        <section aria-label="Articles" className="min-w-0">
          {catalog.state === 'loading' && <LoadingState label="Chargement du catalogue…" />}
          {catalog.state === 'error' && (
            <ErrorState error={catalog.error} onRetry={catalog.reload} />
          )}
          {catalog.state === 'success' && categories.length === 0 && (
            <Card>
              <EmptyState
                icon={<ShoppingBasket className="h-7 w-7" />}
                title="Aucun article à vendre"
                description="Ajoutez des produits avec un tarif pour cet établissement dans le catalogue."
              />
            </Card>
          )}
          {activeCategory && (
            <>
              <div
                className="flex gap-2 overflow-x-auto pb-2"
                role="tablist"
                aria-label="Catégories"
              >
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    aria-selected={c.id === activeCategory.id}
                    onClick={() => setCategoryId(c.id)}
                    className={`min-h-12 shrink-0 rounded-xl px-4 text-sm font-semibold transition-colors ${c.id === activeCategory.id ? 'bg-forest text-white' : 'border border-line bg-surface hover:border-forest'}`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {activeCategory.products.map((p) => {
                  const minPrice = Math.min(...p.variants.map((v) => v.price));
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onTile(p)}
                      className="flex min-h-28 flex-col justify-between rounded-2xl border border-line bg-surface p-4 text-left shadow-card transition active:scale-[0.98] hover:border-forest"
                    >
                      <span className="text-base font-semibold leading-tight">{p.name}</span>
                      <span className="text-sm text-muted">
                        {p.variants.length > 1
                          ? `dès ${formatXof(minPrice)} · ${p.variants.length} choix`
                          : formatXof(minPrice)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </section>

        <aside aria-label="Ticket" className="lg:sticky lg:top-20 lg:self-start">
          <Card className="flex flex-col">
            <div className="flex items-center justify-between border-b border-line/70 px-4 py-3">
              <h2 className="font-semibold">Commande</h2>
              {cart.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCart([])}
                  icon={<Trash2 className="h-4 w-4" />}
                >
                  Vider
                </Button>
              )}
            </div>
            <OrderOptionsBar
              establishmentId={establishmentId}
              value={options}
              onChange={setOptions}
            />
            {cart.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted">
                Touchez un article pour l’ajouter.
              </p>
            ) : (
              <ul className="max-h-[50vh] divide-y divide-line/70 overflow-y-auto">
                {cart.map((l) => {
                  const key = lineKey(l);
                  const priced = quote.data?.lines.find(
                    (q) => q.variantId === l.variantId && (q.notes ?? '') === l.notes,
                  );
                  return (
                    <li key={key} className="flex items-center gap-2 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{l.productName}</p>
                        <p className="text-xs text-muted">
                          {l.variantName}
                          {priced && ` · ${formatXof(priced.unitPrice)}`}
                        </p>
                        <button
                          type="button"
                          onClick={() => setNoteFor(l)}
                          className={`mt-0.5 inline-flex items-center gap-1 text-xs font-semibold ${l.notes ? 'text-terracotta-dark' : 'text-forest'}`}
                        >
                          <StickyNote className="h-3.5 w-3.5" aria-hidden />
                          {l.notes || 'Ajouter une instruction'}
                        </button>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => changeQuantity(key, -1)}
                          className="grid h-11 w-11 place-items-center rounded-xl border border-line"
                          aria-label={`Retirer un ${l.productName}`}
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="w-8 text-center font-semibold" aria-label="Quantité">
                          {l.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => changeQuantity(key, 1)}
                          className="grid h-11 w-11 place-items-center rounded-xl border border-line"
                          aria-label={`Ajouter un ${l.productName}`}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                      <span className="w-20 text-right text-sm font-semibold">
                        {priced ? formatXof(priced.lineTotal) : '…'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="space-y-3 border-t border-line/70 p-4">
              {quote.error && <ApiErrorAlert error={quote.error} />}
              <ApiErrorAlert error={checkout.error} />
              <div className="flex items-baseline justify-between">
                <span className="font-medium">Total</span>
                <span className="font-display text-3xl font-bold" data-testid="cart-total">
                  {total !== undefined ? formatXof(total) : '—'}
                </span>
              </div>
              <Button
                size="lg"
                className="hidden w-full lg:inline-flex"
                onClick={() => submit('pay')}
                disabled={!ready}
                loading={checkout.loading === 'pay'}
              >
                Encaisser
              </Button>
              <div className="hidden gap-2 lg:grid lg:grid-cols-2">
                {canSend && (
                  <Button
                    variant="secondary"
                    icon={<ChefHat className="h-4 w-4" />}
                    onClick={() => submit('kitchen')}
                    disabled={!ready}
                    loading={checkout.loading === 'kitchen'}
                  >
                    Envoyer en cuisine
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className={canSend ? '' : 'col-span-2'}
                  onClick={() => submit('save')}
                  disabled={!ready}
                  loading={checkout.loading === 'save'}
                >
                  Enregistrer
                </Button>
              </div>
            </div>
          </Card>
        </aside>
      </div>

      {/* Barre fixe sur tablette en portrait et mobile : total et actions toujours accessibles. */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-2 border-t border-line bg-surface px-4 py-3 shadow-lift lg:hidden">
        <span className="font-display text-2xl font-bold">
          {total !== undefined ? formatXof(total) : '—'}
        </span>
        <div className="flex gap-2">
          {canSend && (
            <Button
              variant="secondary"
              size="lg"
              aria-label="Envoyer en cuisine"
              icon={<ChefHat className="h-5 w-5" />}
              onClick={() => submit('kitchen')}
              disabled={!ready}
              loading={checkout.loading === 'kitchen'}
            />
          )}
          <Button
            size="lg"
            onClick={() => submit('pay')}
            disabled={!ready}
            loading={checkout.loading === 'pay'}
          >
            Encaisser
          </Button>
        </div>
      </div>

      {picker && (
        <Dialog
          open
          onClose={() => setPicker(null)}
          title={picker.name}
          description="Choisissez une variante"
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {picker.variants.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  add(picker, v);
                  setPicker(null);
                }}
                className="flex min-h-16 items-center justify-between rounded-xl border border-line bg-surface px-4 text-left font-semibold hover:border-forest"
              >
                <span>{v.name}</span>
                <span className="text-forest">{formatXof(v.price)}</span>
              </button>
            ))}
          </div>
        </Dialog>
      )}

      {noteFor && (
        <LineNoteDialog
          title={`${noteFor.productName} (${noteFor.variantName})`}
          initial={noteFor.notes}
          onClose={() => setNoteFor(null)}
          onSave={(note) => {
            setNote(noteFor, note);
            setNoteFor(null);
          }}
        />
      )}

      {payingSale && (
        <PaymentDialog
          sale={payingSale}
          onClose={() => {
            setSavedOrder({ sale: payingSale, sent: null });
            setPayingSale(null);
            onSessionChange();
          }}
          onPaid={(result) => {
            setPayingSale(null);
            setReceipt(result);
          }}
        />
      )}
      {receipt && (
        <ReceiptDialog
          result={receipt}
          terminal={device.terminal}
          onClose={() => {
            setReceipt(null);
            onSessionChange();
          }}
          extra={
            canSend &&
            receipt.sale.activity === 'RESTAURANT' &&
            receipt.sale.preparationStatus === 'NOT_SENT' ? (
              <KitchenButton
                sale={receipt.sale}
                establishmentId={establishmentId}
                onSent={(sale) => setReceipt({ ...receipt, sale })}
              />
            ) : undefined
          }
        />
      )}
      {savedOrder && (
        <SavedOrderDialog
          saved={savedOrder}
          establishmentId={establishmentId}
          canSend={canSend}
          onPay={(sale) => {
            setSavedOrder(null);
            setPayingSale(sale);
          }}
          onClose={() => {
            setSavedOrder(null);
            onSessionChange();
          }}
        />
      )}
    </>
  );
}

/** Envoi explicite en cuisine depuis la caisse (après encaissement ou enregistrement). */
function KitchenButton({
  sale,
  establishmentId,
  onSent,
}: {
  sale: Sale;
  establishmentId: string;
  onSent: (sale: Sale, result: SendResult) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <div className="space-y-2">
      <ApiErrorAlert error={error} />
      <Button
        variant="secondary"
        className="w-full"
        icon={<ChefHat className="h-4 w-4" />}
        loading={loading}
        onClick={async () => {
          setLoading(true);
          setError(null);
          try {
            const result = await sendToKitchen(sale.id, establishmentId);
            onSent(result.order, result);
          } catch (e) {
            setError(toApiError(e));
          } finally {
            setLoading(false);
          }
        }}
      >
        Envoyer en cuisine
      </Button>
    </div>
  );
}

function SavedOrderDialog({
  saved,
  establishmentId,
  canSend,
  onPay,
  onClose,
}: {
  saved: { sale: Sale; sent: SendResult | null };
  establishmentId: string;
  canSend: boolean;
  onPay: (sale: Sale) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState(saved);
  const { sale, sent } = state;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Commande n° ${formatSaleNumber(sale.number)} enregistrée`}
      description={formatXof(sale.total)}
    >
      <div className="space-y-4">
        <Alert tone={sale.preparationStatus === 'NOT_SENT' ? 'info' : 'success'}>
          {sale.preparationStatus === 'NOT_SENT'
            ? 'Non envoyée en cuisine.'
            : 'Envoyée en cuisine.'}{' '}
          {sale.paymentStatus === 'PAID'
            ? 'Payée.'
            : 'Non payée : vous pourrez l’encaisser plus tard.'}
        </Alert>
        {sent?.print && (
          <Alert tone={sent.print.status === 'SUCCEEDED' ? 'success' : 'error'}>
            {sent.print.status === 'SUCCEEDED'
              ? 'Ticket cuisine imprimé.'
              : `Ticket cuisine non imprimé : ${sent.print.message ?? 'erreur'}. La commande reste en cuisine.`}
          </Alert>
        )}
        {canSend && sale.preparationStatus === 'NOT_SENT' && (
          <KitchenButton
            sale={sale}
            establishmentId={establishmentId}
            onSent={(next, result) => setState({ sale: next, sent: result })}
          />
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          {sale.paymentStatus === 'UNPAID' && (
            <Button variant="accent" onClick={() => onPay(sale)}>
              Encaisser maintenant
            </Button>
          )}
          <Button
            className={sale.paymentStatus === 'UNPAID' ? '' : 'sm:col-span-2'}
            onClick={onClose}
          >
            Nouvelle commande
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
