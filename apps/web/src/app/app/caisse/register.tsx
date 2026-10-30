'use client';

import { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, ShoppingBasket, Trash2 } from 'lucide-react';
import { formatSaleNumber, formatXof } from '@ocall/shared';
import {
  CashSessionGate,
  DeviceBar,
  OfflineBanner,
  SessionBar,
  toApiError,
} from '@/components/pos/cash-session';
import { PaymentDialog, ReceiptDialog } from '@/components/pos/payment-dialog';
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
}

type ProductTile = PosCatalogCategory['products'][number];

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
  useWakeLock(true);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [quote, setQuote] = useState<{
    data: Quote | null;
    error: ApiError | null;
    loading: boolean;
  }>({ data: null, error: null, loading: false });
  const [picker, setPicker] = useState<ProductTile | null>(null);
  // Clé d'idempotence du panier courant : renouvelée après chaque vente enregistrée.
  const [saleRequestId, setSaleRequestId] = useState(newRequestId);
  const [checkout, setCheckout] = useState<{ loading: boolean; error: ApiError | null }>({
    loading: false,
    error: null,
  });
  const [payingSale, setPayingSale] = useState<Sale | null>(null);
  const [receipt, setReceipt] = useState<PaymentResult | null>(null);
  const [unpaidNotice, setUnpaidNotice] = useState<Sale | null>(null);

  const categories = catalog.state === 'success' ? catalog.data : [];
  const activeCategory = categories.find((c) => c.id === categoryId) ?? categories[0];
  const cartKey = useMemo(() => JSON.stringify(cart.map((l) => [l.variantId, l.quantity])), [cart]);

  // Les montants affichés viennent du serveur (devis recalculé à chaque modification du panier).
  useEffect(() => {
    if (cart.length === 0) {
      setQuote({ data: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    setQuote((q) => ({ ...q, loading: true }));
    const timer = setTimeout(() => {
      api<Quote>('/pos/quote', {
        method: 'POST',
        body: {
          establishmentId,
          lines: cart.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        },
      })
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
      const existing = lines.find((l) => l.variantId === variant.id);
      if (existing)
        return lines.map((l) =>
          l.variantId === variant.id ? { ...l, quantity: Math.min(l.quantity + 1, 999) } : l,
        );
      return [
        ...lines,
        {
          variantId: variant.id,
          productName: product.name,
          variantName: variant.name,
          quantity: 1,
        },
      ];
    });
  }

  function onTile(product: ProductTile) {
    if (product.variants.length === 1) add(product, product.variants[0]!);
    else setPicker(product);
  }

  function changeQuantity(variantId: string, delta: number) {
    setCart((lines) =>
      lines.flatMap((l) => {
        if (l.variantId !== variantId) return [l];
        const quantity = Math.min(l.quantity + delta, 999);
        return quantity > 0 ? [{ ...l, quantity }] : [];
      }),
    );
  }

  async function startCheckout() {
    if (!quote.data || quote.loading) return;
    setCheckout({ loading: true, error: null });
    try {
      const sale = await api<Sale>('/sales', {
        method: 'POST',
        body: {
          establishmentId,
          clientRequestId: saleRequestId,
          lines: cart.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        },
      });
      // La vente est enregistrée : le panier repart de zéro, même si l'encaissement est reporté.
      setCart([]);
      setSaleRequestId(newRequestId());
      setCheckout({ loading: false, error: null });
      setPayingSale(sale);
    } catch (e) {
      setCheckout({ loading: false, error: toApiError(e) });
    }
  }

  const total = quote.data?.total;
  // Hors connexion, l'encaissement est suspendu : aucune vente n'est enregistrée localement.
  const canCheckout =
    online && cart.length > 0 && !!quote.data && !quote.loading && !checkout.loading;

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
              <h2 className="font-semibold">Ticket</h2>
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
            {cart.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted">
                Touchez un article pour l’ajouter.
              </p>
            ) : (
              <ul className="max-h-[50vh] divide-y divide-line/70 overflow-y-auto">
                {cart.map((l) => {
                  const priced = quote.data?.lines.find((q) => q.variantId === l.variantId);
                  return (
                    <li key={l.variantId} className="flex items-center gap-2 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{l.productName}</p>
                        <p className="text-xs text-muted">
                          {l.variantName}
                          {priced && ` · ${formatXof(priced.unitPrice)}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => changeQuantity(l.variantId, -1)}
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
                          onClick={() => changeQuantity(l.variantId, 1)}
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
                onClick={startCheckout}
                disabled={!canCheckout}
                loading={checkout.loading}
              >
                Encaisser
              </Button>
            </div>
          </Card>
        </aside>
      </div>

      {/* Barre fixe sur tablette en portrait et mobile : total et encaissement toujours accessibles. */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3 shadow-lift lg:hidden">
        <span className="font-display text-2xl font-bold">
          {total !== undefined ? formatXof(total) : '—'}
        </span>
        <Button
          size="lg"
          onClick={startCheckout}
          disabled={!canCheckout}
          loading={checkout.loading}
        >
          Encaisser
        </Button>
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

      {payingSale && (
        <PaymentDialog
          sale={payingSale}
          onClose={() => {
            setUnpaidNotice(payingSale);
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
        />
      )}
      {unpaidNotice && (
        <Dialog open onClose={() => setUnpaidNotice(null)} title="Vente enregistrée, non payée">
          <div className="space-y-4">
            <Alert tone="info">
              La vente n° {formatSaleNumber(unpaidNotice.number)} ({formatXof(unpaidNotice.total)})
              est enregistrée. Vous pourrez l’encaisser depuis l’historique des ventes.
            </Alert>
            <Button className="w-full" onClick={() => setUnpaidNotice(null)}>
              Compris
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
