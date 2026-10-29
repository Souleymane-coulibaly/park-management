'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Lock, Minus, Plus, ShoppingBasket, Trash2, Unlock, Vault, WifiOff } from 'lucide-react';
import { computeCashVariance, formatSaleNumber, formatXof } from '@ocall/shared';
import { useCan } from '@/components/app/session-context';
import { PaymentDialog, ReceiptDialog } from '@/components/pos/payment-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { newRequestId } from '@/lib/request-id';
import type { CashSession, PaymentResult, PosCatalogCategory, Quote, Sale } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { type HardwareOutcome, runDrawerOpening } from '@/lib/hardware/jobs';
import { useDeviceTerminal, useOnline, useWakeLock } from '@/lib/hardware/use-terminal';
import type { PosTerminal } from '@/lib/types';
import { SelectField } from '@/components/ui/field';
import Link from 'next/link';

const toApiError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion au serveur impossible.');

/** Saisie d'un montant entier en FCFA (clavier numérique sur tablette). */
function AmountInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        className="mt-1.5 block w-full rounded-xl border border-line bg-surface px-4 py-3 text-right font-display text-2xl font-bold focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/20"
        placeholder="0"
      />
    </div>
  );
}

/** Caisse d'un établissement : ouverture de session, puis terminal de vente. */
export function Register({ establishmentId }: { establishmentId: string }) {
  const session = useApi<CashSession | null>(
    `/cash-sessions/current?establishmentId=${establishmentId}`,
  );
  if (session.state === 'loading')
    return <LoadingState label="Vérification de la session de caisse…" />;
  if (session.state === 'error')
    return <ErrorState error={session.error} onRetry={session.reload} />;
  if (!session.data)
    return <OpenSession establishmentId={establishmentId} onOpened={session.reload} />;
  return (
    <Terminal
      establishmentId={establishmentId}
      session={session.data}
      onSessionChange={session.reload}
    />
  );
}

function OpenSession({
  establishmentId,
  onOpened,
}: {
  establishmentId: string;
  onOpened: () => void;
}) {
  const [float, setFloat] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api('/cash-sessions', {
        method: 'POST',
        body: { establishmentId, openingFloat: Number(float || 0) },
      });
      onOpened();
    } catch (e) {
      setError(toApiError(e));
      setLoading(false);
    }
  }

  return (
    <Card className="pattern-kente mx-auto max-w-md">
      <form onSubmit={onSubmit} className="space-y-5 bg-surface/95 p-6">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-forest text-ivory">
            <Unlock className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-bold">Ouvrir la caisse</h2>
            <p className="text-sm text-muted">Comptez les espèces présentes dans le tiroir.</p>
          </div>
        </div>
        <ApiErrorAlert error={error} />
        <AmountInput
          id="opening-float"
          label="Fond de caisse (FCFA)"
          value={float}
          onChange={setFloat}
        />
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          Ouvrir la caisse
        </Button>
      </form>
    </Card>
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
  const canOpenDrawer = useCan('drawer.open_manual');
  const canManageHardware = useCan('hardware.manage');
  const [manualDrawer, setManualDrawer] = useState(false);
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
  const [closing, setClosing] = useState(false);

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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-charcoal px-4 py-3 text-ivory">
        <div className="text-sm">
          <span className="font-semibold">Caisse ouverte</span>
          <span className="text-ivory/70">
            {' '}
            depuis {formatDateTime(session.openedAt)} · {session.salesCount} vente(s)
          </span>
          {session.unpaidCount > 0 && (
            <span className="text-savanna"> · {session.unpaidCount} non payée(s)</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm">
            Espèces attendues :{' '}
            <strong data-testid="expected-cash">{formatXof(session.expectedCash)}</strong>
          </span>
          <Button
            variant="accent"
            size="sm"
            onClick={() => setClosing(true)}
            icon={<Lock className="h-4 w-4" />}
          >
            Fermer la caisse
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        {device.terminals.length > 1 ? (
          <div className="w-56">
            <SelectField
              label="Poste de caisse"
              value={device.terminal?.id ?? ''}
              onChange={(e) => device.select(e.target.value || null)}
              options={[
                { value: '', label: 'Choisir un poste…' },
                ...device.terminals.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
          </div>
        ) : device.terminal ? (
          <span
            className="rounded-xl border border-line bg-surface px-3 py-2"
            data-testid="device-terminal"
          >
            Poste : <strong>{device.terminal.name}</strong>
          </span>
        ) : (
          !device.loading && (
            <span className="text-muted">
              Aucun poste de caisse : impression et tiroir désactivés.
              {canManageHardware && (
                <Link
                  href="/app/caisse/materiel"
                  className="ml-1 font-semibold text-forest underline"
                >
                  Configurer le matériel
                </Link>
              )}
            </span>
          )
        )}
        {canOpenDrawer && device.terminal?.drawerEnabled && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setManualDrawer(true)}
            icon={<Vault className="h-4 w-4" />}
          >
            Ouvrir le tiroir
          </Button>
        )}
      </div>

      {!online && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-terracotta/40 bg-terracotta-light/60 px-4 py-3 text-sm font-semibold text-terracotta-dark"
        >
          <WifiOff className="h-5 w-5" aria-hidden /> Hors connexion : l’encaissement est suspendu
          jusqu’au retour du réseau. Aucune vente n’est perdue.
        </div>
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
      {manualDrawer && device.terminal && (
        <ManualDrawerDialog terminal={device.terminal} onClose={() => setManualDrawer(false)} />
      )}
      {closing && (
        <CloseSessionDialog
          session={session}
          onClose={() => setClosing(false)}
          onClosed={onSessionChange}
        />
      )}
    </>
  );
}

function CloseSessionDialog({
  session,
  onClose,
  onClosed,
}: {
  session: CashSession;
  onClose: () => void;
  onClosed: () => void;
}) {
  const [counted, setCounted] = useState('');
  const [result, setResult] = useState<CashSession | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const amount = counted === '' ? null : Number(counted);
  const preview = amount !== null ? computeCashVariance(session.expectedCash, amount) : null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (amount === null) return;
    setLoading(true);
    setError(null);
    try {
      setResult(
        await api<CashSession>(`/cash-sessions/${session.id}/close`, {
          method: 'POST',
          body: { countedCash: amount },
        }),
      );
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    const variance = result.variance ?? 0;
    return (
      <Dialog open onClose={onClosed} title="Caisse fermée">
        <div className="space-y-4">
          <dl className="space-y-2 rounded-2xl border border-line bg-ivory/60 p-4">
            <div className="flex justify-between">
              <dt>Espèces attendues</dt>
              <dd className="font-semibold">{formatXof(result.expectedCash)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Espèces comptées</dt>
              <dd className="font-semibold">{formatXof(result.countedCash ?? 0)}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2 text-xl">
              <dt className="font-semibold">Écart</dt>
              <dd
                className={`font-display font-bold ${variance < 0 ? 'text-terracotta-dark' : 'text-forest'}`}
                data-testid="cash-variance"
              >
                {variance > 0 ? '+' : ''}
                {formatXof(variance)}
              </dd>
            </div>
          </dl>
          {variance !== 0 && (
            <Alert tone="info">
              L’écart est enregistré dans l’historique des sessions et le journal d’audit.
            </Alert>
          )}
          <Button className="w-full" size="lg" onClick={onClosed}>
            Terminer
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Fermer la caisse"
      description="Comptez les espèces du tiroir avant de valider."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <dl className="space-y-1 rounded-xl bg-ivory/70 p-4 text-sm">
          <div className="flex justify-between">
            <dt>Fond de caisse</dt>
            <dd>{formatXof(session.openingFloat)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Encaissements en espèces</dt>
            <dd>{formatXof(session.cashSalesTotal)}</dd>
          </div>
          <div className="flex justify-between font-semibold">
            <dt>Espèces attendues</dt>
            <dd>{formatXof(session.expectedCash)}</dd>
          </div>
        </dl>
        {session.unpaidCount > 0 && (
          <Alert tone="info">
            {session.unpaidCount} vente(s) non payée(s) resteront à encaisser depuis l’historique.
          </Alert>
        )}
        <AmountInput
          id="counted-cash"
          label="Espèces comptées (FCFA)"
          value={counted}
          onChange={setCounted}
        />
        {preview !== null && (
          <p
            className={`text-right text-sm font-semibold ${preview < 0 ? 'text-terracotta-dark' : 'text-forest'}`}
          >
            Écart prévu : {preview > 0 ? '+' : ''}
            {formatXof(preview)}
          </p>
        )}
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={loading} disabled={amount === null}>
            Valider la fermeture
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Ouverture manuelle du tiroir : réservée aux responsables, justification obligatoire, auditée. */
function ManualDrawerDialog({ terminal, onClose }: { terminal: PosTerminal; onClose: () => void }) {
  const [justification, setJustification] = useState('');
  const [outcome, setOutcome] = useState<HardwareOutcome | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setOutcome(
      await runDrawerOpening({ terminalId: terminal.id, reason: 'MANUAL', justification }),
    );
    setLoading(false);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Ouvrir le tiroir-caisse"
      description={`Poste ${terminal.name} — l’ouverture est enregistrée dans le journal d’audit.`}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="drawer-justification" className="block text-sm font-medium">
            Justification
          </label>
          <textarea
            id="drawer-justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={3}
            maxLength={200}
            className="mt-1.5 block w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/20"
            placeholder="Ex. dépôt du fond de caisse, échange de monnaie…"
          />
        </div>
        {outcome?.status === 'SUCCEEDED' && <Alert tone="success">Tiroir ouvert.</Alert>}
        {outcome?.status === 'FAILED' && (
          <Alert tone="error" title="Ouverture impossible">
            {outcome.message}
          </Alert>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Fermer
          </Button>
          <Button
            type="submit"
            loading={loading}
            disabled={justification.trim().length < 5 || outcome?.status === 'SUCCEEDED'}
          >
            Ouvrir le tiroir
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
