'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Minus, Pause, Plus, Trash2 } from 'lucide-react';
import {
  STOCK_PAYMENT_METHODS,
  STOCK_PAYMENT_METHOD_LABELS,
  type StockPaymentMethod,
  formatStockMoney,
  formatStockQuantity,
  stockCheckPayments,
  stockDiscountCap,
  stockLineAmounts,
  stockSaleTotals,
} from '@ocall/shared';
import { ScanField, type ScanFeedback } from '@/components/scan/scan-field';
import {
  PrintReceiptButton,
  ReceiptPreview,
  type StockCustomerView,
  type StockPosItem,
  type StockReceiptView,
  type StockRegisterView,
  type StockSaleView,
} from '@/components/stock/pos';
import { StockPage, type StockPageProps } from '@/components/stock/stock-page';
import { asApiError, newIdempotencyKey } from '@/components/stock/stock-types';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { useApi } from '@/lib/use-api';

const REGISTER_KEY = 'ocall.stock.register';

interface CartLine {
  item: StockPosItem;
  quantity: string;
  discount: string;
}

interface PaymentLine {
  method: StockPaymentMethod;
  amount: string;
  tendered: string;
  reference: string;
}

interface SettingsView {
  maxDiscountPercent: number;
}

interface HeldCart {
  id: string;
  label: string;
  createdAt: string;
  payload: {
    customerId: string | null;
    lines: { variantId: string; quantity: number; discount: number }[];
  };
}

/** Caisse : vente rapide au scan ou à la recherche, paiements saisis à la main, ticket. */
export default function StockPosPage() {
  return (
    <StockPage title="Caisse" description="Scannez ou recherchez, encaissez, imprimez le ticket.">
      {(p) =>
        p.can('stock.sales.create') ? (
          <Registers {...p} />
        ) : (
          <Alert tone="info" title="Accès réservé">
            La caisse est réservée aux caissiers, commerciaux et responsables.
          </Alert>
        )
      }
    </StockPage>
  );
}

function Registers(p: StockPageProps) {
  const registers = useApi<StockRegisterView[]>('/ocall-stock/registers');
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    try {
      setChosen(localStorage.getItem(REGISTER_KEY));
    } catch {
      setChosen(null);
    }
  }, []);

  function choose(id: string) {
    setChosen(id);
    try {
      localStorage.setItem(REGISTER_KEY, id);
    } catch {
      // Choix non mémorisé (navigation privée) : il vaut pour la page.
    }
  }

  if (registers.state === 'loading') return <LoadingState />;
  if (registers.state === 'error')
    return <ErrorState error={registers.error} onRetry={registers.reload} />;
  const list = registers.data.filter((r) => !r.isArchived);
  if (list.length === 0) {
    return (
      <Alert tone="info" title="Aucune caisse">
        {p.can('stock.registers.manage') ? (
          <>
            Créez une caisse dans{' '}
            <Link href="/stock/caisses" className="font-semibold underline">
              Caisses et sessions
            </Link>
            .
          </>
        ) : (
          'Demandez à un responsable de créer une caisse pour votre magasin.'
        )}
      </Alert>
    );
  }
  const register = list.find((r) => r.id === chosen) ?? (list.length === 1 ? list[0]! : null);
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-72">
          <SelectField
            label="Caisse"
            value={register?.id ?? ''}
            onChange={(e) => choose(e.target.value)}
            options={[
              ...(register ? [] : [{ value: '', label: 'Choisir…' }]),
              ...list.map((r) => ({ value: r.id, label: `${r.name} · ${r.site.code}` })),
            ]}
          />
        </div>
        {register?.openSession && (
          <p className="pb-2 text-sm text-muted">
            Session {register.openSession.label}
            {register.openSession.openedBy ? ` ouverte par ${register.openSession.openedBy}` : ''}
            {' · '}
            <Link
              href={`/stock/caisses/sessions/${register.openSession.id}`}
              className="font-medium text-forest hover:underline"
            >
              Rapport et clôture
            </Link>
          </p>
        )}
      </div>
      {register &&
        (register.openSession ? (
          <Till key={register.openSession.id} register={register} page={p} />
        ) : (
          <OpenSession register={register} page={p} onOpened={registers.reload} />
        ))}
    </>
  );
}

function OpenSession({
  register,
  page,
  onOpened,
}: {
  register: StockRegisterView;
  page: StockPageProps;
  onOpened: () => void;
}) {
  const [float, setFloat] = useState('0');
  const [error, setError] = useState<ApiError | null>(null);
  if (!page.canWrite('stock.cash.session')) {
    return (
      <Alert tone="info" title="Caisse fermée">
        Un responsable doit ouvrir la session de {register.name}.
      </Alert>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api(`/ocall-stock/registers/${register.id}/sessions`, {
        method: 'POST',
        body: { openingFloat: Number(float) },
      });
      onOpened();
    } catch (e) {
      setError(asApiError(e));
    }
  }

  return (
    <Card>
      <CardHeader
        title={`Ouvrir ${register.name}`}
        description="Comptez les espèces du tiroir : c’est le fond de caisse."
      />
      <CardBody>
        <form onSubmit={submit} className="space-y-4" data-testid="stock-open-session">
          <ApiErrorAlert error={error} />
          <div className="max-w-xs">
            <InputField
              label="Fond de caisse"
              type="number"
              min={0}
              required
              value={float}
              onChange={(e) => setFloat(e.target.value)}
            />
          </div>
          <Button type="submit">Ouvrir la caisse</Button>
        </form>
      </CardBody>
    </Card>
  );
}

function Till({ register, page }: { register: StockRegisterView; page: StockPageProps }) {
  const currency = page.context.currency;
  const money = (n: number) => formatStockMoney(n, currency);
  const settings = useApi<SettingsView>('/ocall-stock/settings');
  const canDiscount = page.can('stock.sales.discount');
  const unlimited = page.can('stock.sales.discount.unlimited');
  const maxPercent = settings.state === 'success' ? settings.data.maxDiscountPercent : 0;

  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<StockCustomerView | null>(null);
  const [q, setQ] = useState('');
  const [feedback, setFeedback] = useState<ScanFeedback>(null);
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState<{ sale: StockSaleView; receipt: StockReceiptView } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const results = useApi<StockPosItem[]>(
    q.trim().length >= 2
      ? `/ocall-stock/registers/${register.id}/items?${new URLSearchParams({ q: q.trim() })}`
      : null,
  );
  const held = useApi<HeldCart[]>(`/ocall-stock/registers/${register.id}/held-carts`);

  const totals = useMemo(
    () =>
      stockSaleTotals(
        cart.map((l) => ({
          quantity: Number(l.quantity) || 0,
          unitPrice: l.item.unitPrice,
          vatRate: l.item.vatRate,
          discount: Number(l.discount) || 0,
        })),
      ),
    [cart],
  );

  function add(item: StockPosItem) {
    setCart((cur) => {
      const existing = cur.find((l) => l.item.variantId === item.variantId);
      if (existing) {
        return cur.map((l) =>
          l === existing ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l,
        );
      }
      return [...cur, { item, quantity: '1', discount: '' }];
    });
  }

  function patch(variantId: string, change: Partial<CartLine>) {
    setCart((cur) => cur.map((l) => (l.item.variantId === variantId ? { ...l, ...change } : l)));
  }

  async function onScan(code: string) {
    try {
      const r = await api<{ found: boolean; item?: StockPosItem; archived?: boolean }>(
        `/ocall-stock/registers/${register.id}/scan?code=${encodeURIComponent(code)}`,
      );
      if (!r.found || !r.item) {
        setFeedback({
          tone: 'warn',
          message: r.archived ? `Article archivé : ${code}` : `Code inconnu : ${code}`,
        });
        return;
      }
      add(r.item);
      setFeedback({ tone: 'ok', message: `${r.item.label} · ${money(r.item.unitPrice)}` });
    } catch (e) {
      setFeedback({ tone: 'error', message: asApiError(e).message });
    }
  }

  async function hold() {
    const label = customer?.name ?? `Panier ${new Date().toLocaleTimeString('fr-FR')}`;
    setError(null);
    try {
      await api(`/ocall-stock/registers/${register.id}/held-carts`, {
        method: 'POST',
        body: {
          label: label.slice(0, 60),
          customerId: customer?.id ?? null,
          lines: cart.map((l) => ({
            variantId: l.item.variantId,
            quantity: Number(l.quantity),
            discount: Number(l.discount) || 0,
          })),
        },
      });
      setCart([]);
      setCustomer(null);
      held.reload();
    } catch (e) {
      setError(asApiError(e));
    }
  }

  async function resume(cartId: string) {
    setError(null);
    try {
      const c = await api<HeldCart & { items: StockPosItem[] }>(
        `/ocall-stock/held-carts/${cartId}`,
        { method: 'DELETE' },
      );
      // Prix et disponibilités relus à la reprise ; un article archivé entre-temps n'est plus proposé.
      const lines: CartLine[] = c.payload.lines.flatMap((l) => {
        const item = c.items.find((i) => i.variantId === l.variantId);
        return item
          ? [{ item, quantity: String(l.quantity), discount: l.discount ? String(l.discount) : '' }]
          : [];
      });
      setCart(lines);
      setCustomer(
        c.payload.customerId
          ? await api<StockCustomerView>(`/ocall-stock/customers/${c.payload.customerId}`).catch(
              () => null,
            )
          : null,
      );
      held.reload();
    } catch (e) {
      setError(asApiError(e));
    }
  }

  function newSale() {
    setDone(null);
    setCart([]);
    setCustomer(null);
    setPaying(false);
    setFeedback(null);
  }

  if (done) {
    return (
      <Card>
        <CardHeader
          title={`Vente ${done.sale.label} encaissée`}
          description={`Total ${money(done.sale.total)}${done.sale.changeGiven ? ` · monnaie à rendre ${money(done.sale.changeGiven)}` : ''}`}
        />
        <CardBody className="space-y-4" data-testid="stock-sale-done">
          {done.sale.changeGiven > 0 && (
            <Alert tone="success" title={`Rendez ${money(done.sale.changeGiven)}`} />
          )}
          <ReceiptPreview receipt={done.receipt} />
          <div className="flex flex-wrap gap-3">
            <PrintReceiptButton receipt={done.receipt} />
            <Button
              variant="secondary"
              onClick={() =>
                void downloadFile(
                  `/ocall-stock/sales/${done.sale.id}/receipt.pdf`,
                  `ticket-${done.sale.label}.pdf`,
                )
              }
            >
              Ticket PDF
            </Button>
            <Button onClick={newSale}>Nouvelle vente</Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="min-w-0 space-y-4">
        <Card>
          <CardBody className="space-y-4">
            <ScanField onScan={onScan} feedback={feedback} testId="stock-pos-scan" />
            <InputField
              label="Rechercher un article"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {results.state === 'success' && q.trim().length >= 2 && (
              <div className="grid gap-2 sm:grid-cols-2" data-testid="stock-pos-results">
                {results.data.length === 0 && <p className="text-sm text-muted">Aucun article.</p>}
                {results.data.map((item) => (
                  <button
                    key={item.variantId}
                    type="button"
                    onClick={() => add(item)}
                    className="flex min-h-16 flex-col items-start rounded-xl border border-line bg-surface px-3 py-2 text-left hover:border-forest/50 hover:bg-forest-light/30"
                  >
                    <span className="font-semibold">{item.label}</span>
                    <span className="text-sm">{money(item.unitPrice)}</span>
                    <span className="text-xs text-muted">
                      {item.available === null
                        ? 'Non stocké'
                        : `Disponible : ${formatStockQuantity(item.available)}`}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
        {held.state === 'success' && held.data.length > 0 && (
          <Card>
            <CardHeader title="Paniers en attente" />
            <CardBody>
              <ul className="divide-y divide-line/60 text-sm" data-testid="stock-held-carts">
                {held.data.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      <span className="font-semibold">{c.label}</span>{' '}
                      <span className="text-xs text-muted">
                        {c.payload.lines.length} article(s) ·{' '}
                        {new Date(c.createdAt).toLocaleTimeString('fr-FR')}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={cart.length > 0}
                      onClick={() => void resume(c.id)}
                    >
                      Reprendre
                    </Button>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
      </div>

      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader title="Panier" />
          <CardBody className="space-y-4" data-testid="stock-cart">
            <ApiErrorAlert error={error} />
            <CustomerPicker value={customer} onChange={setCustomer} page={page} />
            {cart.length === 0 ? (
              <p className="text-sm text-muted">Scannez ou choisissez un article.</p>
            ) : (
              <ul className="space-y-3">
                {cart.map((l) => {
                  const qty = Number(l.quantity) || 0;
                  const amounts = stockLineAmounts(
                    qty,
                    l.item.unitPrice,
                    l.item.vatRate,
                    Number(l.discount) || 0,
                  );
                  const short =
                    l.item.available !== null && qty > l.item.available
                      ? `Disponible : ${formatStockQuantity(l.item.available)}`
                      : null;
                  return (
                    <li key={l.item.variantId} className="rounded-xl border border-line p-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block font-semibold">{l.item.label}</span>
                          <span className="text-xs text-muted">
                            {money(l.item.unitPrice)} · {l.item.sku}
                          </span>
                        </span>
                        <span className="shrink-0 font-semibold">{money(amounts.total)}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label={`Retirer un ${l.item.label}`}
                          onClick={() =>
                            patch(l.item.variantId, { quantity: String(Math.max(qty - 1, 1)) })
                          }
                        >
                          <Minus className="h-4 w-4" aria-hidden />
                        </Button>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          aria-label={`Quantité de ${l.item.label}`}
                          className="h-9 w-20 rounded-lg border border-line px-2 text-center"
                          value={l.quantity}
                          onChange={(e) => patch(l.item.variantId, { quantity: e.target.value })}
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label={`Ajouter un ${l.item.label}`}
                          onClick={() => patch(l.item.variantId, { quantity: String(qty + 1) })}
                        >
                          <Plus className="h-4 w-4" aria-hidden />
                        </Button>
                        {canDiscount && (
                          <input
                            type="number"
                            min={0}
                            aria-label={`Remise sur ${l.item.label}`}
                            placeholder="Remise"
                            title={
                              unlimited
                                ? 'Remise sans plafond'
                                : `Au plus ${money(stockDiscountCap(amounts.gross, maxPercent))}`
                            }
                            className="h-9 w-24 rounded-lg border border-line px-2"
                            value={l.discount}
                            onChange={(e) => patch(l.item.variantId, { discount: e.target.value })}
                          />
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Supprimer ${l.item.label}`}
                          onClick={() =>
                            setCart((cur) =>
                              cur.filter((x) => x.item.variantId !== l.item.variantId),
                            )
                          }
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                      {short && <p className="mt-1 text-xs text-terracotta-dark">{short}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
            <dl className="space-y-1 border-t border-line pt-3 text-sm">
              {totals.discount > 0 && (
                <>
                  <div className="flex justify-between">
                    <dt>Sous-total</dt>
                    <dd>{money(totals.gross)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Remises</dt>
                    <dd>-{money(totals.discount)}</dd>
                  </div>
                </>
              )}
              <div className="flex justify-between text-lg font-bold">
                <dt>Total TTC</dt>
                <dd data-testid="stock-cart-total">{money(totals.total)}</dd>
              </div>
              <div className="flex justify-between text-xs text-muted">
                <dt>dont TVA</dt>
                <dd>{money(totals.vat)}</dd>
              </div>
            </dl>
            {!paying && (
              <div className="flex flex-wrap gap-2">
                <Button size="lg" disabled={cart.length === 0} onClick={() => setPaying(true)}>
                  Encaisser
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  disabled={cart.length === 0}
                  icon={<Pause className="h-4 w-4" aria-hidden />}
                  onClick={() => void hold()}
                >
                  Mettre en attente
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
        {paying && cart.length > 0 && (
          <Payment
            total={totals.total}
            currency={currency}
            onCancel={() => setPaying(false)}
            submit={async (payments, idempotencyKey) => {
              const sale = await api<StockSaleView>('/ocall-stock/sales', {
                method: 'POST',
                body: {
                  idempotencyKey,
                  registerId: register.id,
                  customerId: customer?.id ?? null,
                  lines: cart.map((l) => ({
                    variantId: l.item.variantId,
                    quantity: Number(l.quantity),
                    ...(Number(l.discount) ? { discount: Number(l.discount) } : {}),
                  })),
                  payments,
                },
              });
              const receipt = await api<StockReceiptView>(`/ocall-stock/sales/${sale.id}/receipt`);
              setDone({ sale, receipt });
            }}
          />
        )}
      </div>
    </div>
  );
}

function Payment({
  total,
  currency,
  onCancel,
  submit,
}: {
  total: number;
  currency: string;
  onCancel: () => void;
  submit: (
    payments: {
      method: StockPaymentMethod;
      amount: number;
      tendered?: number;
      reference?: string;
    }[],
    idempotencyKey: string,
  ) => Promise<void>;
}) {
  const money = (n: number) => formatStockMoney(n, currency);
  const [lines, setLines] = useState<PaymentLine[]>([
    { method: 'CASH', amount: String(total), tendered: '', reference: '' },
  ]);
  // Une clé par tentative d'encaissement : un double envoi n'enregistre qu'une vente.
  const [key] = useState(newIdempotencyKey);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const payments = lines.map((l) => ({
    method: l.method,
    amount: Number(l.amount) || 0,
    ...(l.method === 'CASH' && l.tendered ? { tendered: Number(l.tendered) } : {}),
    ...(l.method !== 'CASH' && l.reference.trim() ? { reference: l.reference.trim() } : {}),
  }));
  const check = stockCheckPayments(total, payments);
  const paid = payments.reduce((n, p) => n + p.amount, 0);

  function patch(i: number, change: Partial<PaymentLine>) {
    setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...change } : l)));
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submit(payments, key);
    } catch (e) {
      setError(asApiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={`Paiement · ${money(total)}`}
        description="Mobile money et carte : saisissez le montant confirmé par le client ou le terminal, et la référence de la transaction."
      />
      <CardBody>
        <form onSubmit={confirm} className="space-y-4" data-testid="stock-payment">
          <ApiErrorAlert error={error} />
          {lines.map((l, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-line p-3">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Moyen de paiement">
                {STOCK_PAYMENT_METHODS.map((m) => (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant={l.method === m ? 'primary' : 'secondary'}
                    aria-pressed={l.method === m}
                    onClick={() => patch(i, { method: m })}
                  >
                    {STOCK_PAYMENT_METHOD_LABELS[m]}
                  </Button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <InputField
                  label={`Montant ${STOCK_PAYMENT_METHOD_LABELS[l.method].toLowerCase()}`}
                  type="number"
                  min={1}
                  required
                  value={l.amount}
                  onChange={(e) => patch(i, { amount: e.target.value })}
                />
                {l.method === 'CASH' ? (
                  <InputField
                    label="Somme remise par le client"
                    type="number"
                    min={0}
                    value={l.tendered}
                    onChange={(e) => patch(i, { tendered: e.target.value })}
                  />
                ) : (
                  <InputField
                    label="Référence de la transaction"
                    value={l.reference}
                    onChange={(e) => patch(i, { reference: e.target.value })}
                  />
                )}
              </div>
              {lines.length > 1 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}
                >
                  Retirer ce paiement
                </Button>
              )}
            </div>
          ))}
          {lines.length < 4 && paid < total && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                setLines((cur) => [
                  ...cur,
                  {
                    method: 'MOBILE_MONEY',
                    amount: String(total - paid),
                    tendered: '',
                    reference: '',
                  },
                ])
              }
            >
              Ajouter un moyen de paiement
            </Button>
          )}
          <div className="flex justify-between text-sm">
            <span>Reste à payer</span>
            <span className="font-semibold">{money(Math.max(total - paid, 0))}</span>
          </div>
          {check.error === null && check.change > 0 && (
            <Alert tone="success" title={`Monnaie à rendre : ${money(check.change)}`} />
          )}
          {check.error !== null && paid > 0 && <p className="text-sm text-muted">{check.error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" loading={busy} disabled={check.error !== null}>
              Valider le paiement
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Retour au panier
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

/** Client facultatif : recherche par nom ou téléphone, création rapide. */
function CustomerPicker({
  value,
  onChange,
  page,
}: {
  value: StockCustomerView | null;
  onChange: (c: StockCustomerView | null) => void;
  page: StockPageProps;
}) {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const found = useApi<StockCustomerView[]>(
    q.trim().length >= 2 ? `/ocall-stock/customers?${new URLSearchParams({ q: q.trim() })}` : null,
  );
  if (!page.can('stock.customers.read')) return null;
  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl bg-ivory-dark/50 px-3 py-2 text-sm">
        <span>
          Client : <span className="font-semibold">{value.name}</span>
          {value.phone ? ` · ${value.phone}` : ''}
        </span>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          Retirer
        </Button>
      </div>
    );
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const c = await api<StockCustomerView>('/ocall-stock/customers', {
        method: 'POST',
        body: { name, phone: phone || null },
      });
      onChange(c);
      setCreating(false);
      setName('');
      setPhone('');
    } catch (e) {
      setError(asApiError(e));
    }
  }

  if (creating) {
    return (
      <form onSubmit={create} className="space-y-2 rounded-xl border border-line p-3">
        <ApiErrorAlert error={error} />
        <InputField
          label="Nom du client"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <InputField label="Téléphone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            Créer le client
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
            Annuler
          </Button>
        </div>
      </form>
    );
  }
  return (
    <div className="space-y-2">
      <InputField
        label="Client (facultatif) : nom ou téléphone"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {found.state === 'success' && q.trim().length >= 2 && (
        <ul className="divide-y divide-line/60 text-sm">
          {found.data.slice(0, 6).map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-1.5">
              <span>
                {c.name} <span className="text-xs text-muted">{c.phone}</span>
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  onChange(c);
                  setQ('');
                }}
              >
                Choisir
              </Button>
            </li>
          ))}
          {found.data.length === 0 && <li className="py-1.5 text-muted">Aucun client.</li>}
        </ul>
      )}
      {page.canWrite('stock.customers.manage') && (
        <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
          Nouveau client
        </Button>
      )}
    </div>
  );
}
