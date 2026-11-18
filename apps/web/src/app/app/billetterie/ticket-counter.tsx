'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Minus, Plus, Ticket, Trash2, Users } from 'lucide-react';
import { TICKET_KIND_LABELS, formatSaleNumber, formatXof } from '@ocall/shared';
import { CustomerPicker } from '@/components/crm/customer-picker';
import { EventSalePanel, type EventSessionChoice } from '@/components/park/event-sale-panel';
import { describeOpening } from '@/components/park/opening';
import { SaleTickets } from '@/components/park/sale-tickets';
import { AfterPaymentHardware } from '@/components/pos/after-payment-hardware';
import { DeviceBar, OfflineBanner, SessionBar, toApiError } from '@/components/pos/cash-session';
import { PaymentDialog } from '@/components/pos/payment-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useDeviceTerminal, useOnline, useWakeLock } from '@/lib/hardware/use-terminal';
import { newRequestId } from '@/lib/request-id';
import type {
  CashSession,
  CustomerSummary,
  EventCatalogEntry,
  PaymentResult,
  PosTerminal,
  Sale,
  TicketCatalog,
  TicketCategory,
  TicketQuote,
} from '@/lib/types';
import { useApi } from '@/lib/use-api';

interface OrderLine {
  category: TicketCategory;
  quantity: number;
  /** Un prénom par billet individuel : quantité × personnes incluses. */
  names: string[];
  /** Billet d'événement : séance choisie (absente pour un billet du jour). */
  session?: EventSessionChoice;
}

const lineKey = (categoryId: string, sessionId?: string) => `${categoryId}:${sessionId ?? ''}`;
const keyOf = (l: OrderLine) => lineKey(l.category.id, l.session?.id);
/** Prénom exigé : toujours pour un billet du jour, selon le tarif pour un billet d'événement. */
const needsNames = (l: OrderLine) => !l.session || l.category.requiresVisitorName !== false;

const MAX_UNITS = 50;

/** Redimensionne la liste des prénoms en conservant ceux déjà saisis. */
const resize = (names: string[], size: number) =>
  size > names.length
    ? [...names, ...Array<string>(size - names.length).fill('')]
    : names.slice(0, size);

/**
 * Guichet de la billetterie : catégories en grandes tuiles tactiles, prénom de chaque visiteur,
 * montants calculés par le serveur, encaissement par le moteur de vente commun, puis billets et QR.
 */
export function TicketCounter({
  establishmentId,
  session,
  onSessionChange,
}: {
  establishmentId: string;
  session: CashSession;
  onSessionChange: () => void;
}) {
  const catalog = useApi<TicketCatalog>(`/ticketing/catalog?establishmentId=${establishmentId}`);
  const eventCatalog = useApi<EventCatalogEntry[]>(
    `/ticketing/event-catalog?establishmentId=${establishmentId}`,
  );
  const [mode, setMode] = useState<'day' | 'events'>('day');
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const device = useDeviceTerminal(establishmentId);
  const online = useOnline();
  useWakeLock(true);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [quote, setQuote] = useState<{
    data: TicketQuote | null;
    error: ApiError | null;
    loading: boolean;
  }>({
    data: null,
    error: null,
    loading: false,
  });
  // Clé d'idempotence de la commande en cours : renouvelée après chaque vente enregistrée.
  const [orderRequestId, setOrderRequestId] = useState(newRequestId);
  const [checkout, setCheckout] = useState<{ loading: boolean; error: ApiError | null }>({
    loading: false,
    error: null,
  });
  const [payingSale, setPayingSale] = useState<Sale | null>(null);
  const [issued, setIssued] = useState<PaymentResult | null>(null);
  const [unpaidNotice, setUnpaidNotice] = useState<Sale | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);

  const quoteKey = useMemo(() => JSON.stringify(lines.map((l) => [keyOf(l), l.quantity])), [lines]);

  // Montants affichés : ceux du serveur. Les prénoms non encore saisis sont remplacés par un
  // libellé provisoire pour l'aperçu uniquement (l'enregistrement exige tous les prénoms).
  useEffect(() => {
    if (lines.length === 0) {
      setQuote({ data: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    setQuote((q) => ({ ...q, loading: true }));
    const timer = setTimeout(() => {
      api<TicketQuote>('/ticketing/quote', {
        method: 'POST',
        body: {
          establishmentId,
          lines: lines.map((l) => ({
            ticketCategoryId: l.category.id,
            quantity: l.quantity,
            visitorNames: l.names.map((_, i) => `Visiteur ${i + 1}`),
            ...(l.session ? { eventSessionId: l.session.id } : {}),
          })),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- quoteKey résume la commande
  }, [quoteKey, establishmentId]);

  function changeQuantity(category: TicketCategory, delta: number, session?: EventSessionChoice) {
    const key = lineKey(category.id, session?.id);
    setLines((current) => {
      const existing = current.find((l) => keyOf(l) === key);
      const quantity = Math.min((existing?.quantity ?? 0) + delta, MAX_UNITS);
      if (!existing)
        return quantity > 0
          ? [
              ...current,
              {
                category,
                quantity,
                names: resize([], quantity * category.peopleIncluded),
                ...(session ? { session } : {}),
              },
            ]
          : current;
      if (quantity <= 0) return current.filter((l) => keyOf(l) !== key);
      return current.map((l) =>
        keyOf(l) === key
          ? { ...l, quantity, names: resize(l.names, quantity * category.peopleIncluded) }
          : l,
      );
    });
  }

  /** Places déjà dans la commande pour une séance (tous tarifs, ou un tarif). */
  const inCart = (sessionId: string, categoryId?: string) =>
    lines
      .filter((l) => l.session?.id === sessionId && (!categoryId || l.category.id === categoryId))
      .reduce((sum, l) => sum + l.names.length, 0);

  function setName(key: string, index: number, value: string) {
    setLines((current) =>
      current.map((l) =>
        keyOf(l) === key
          ? { ...l, names: l.names.map((n, i) => (i === index ? value.slice(0, 40) : n)) }
          : l,
      ),
    );
  }

  const visitors = lines.reduce((sum, l) => sum + l.names.length, 0);
  const missingNames = lines
    .filter(needsNames)
    .reduce((sum, l) => sum + l.names.filter((n) => n.trim() === '').length, 0);
  const openToday = catalog.state === 'success' ? catalog.data.openToday : false;
  // Billets du jour : parc ouvert aujourd'hui. Billets d'événement : selon leur séance.
  const needsOpenPark = lines.some((l) => !l.session);
  const canCheckout =
    online &&
    (openToday || !needsOpenPark) &&
    lines.length > 0 &&
    missingNames === 0 &&
    !!quote.data &&
    !quote.loading &&
    !checkout.loading;

  async function startCheckout() {
    if (!canCheckout) return;
    setCheckout({ loading: true, error: null });
    try {
      const sale = await api<Sale>('/ticketing/orders', {
        method: 'POST',
        body: {
          establishmentId,
          clientRequestId: orderRequestId,
          ...(customer && lines.some((l) => l.session) ? { customerId: customer.id } : {}),
          lines: lines.map((l) => ({
            ticketCategoryId: l.category.id,
            quantity: l.quantity,
            visitorNames: l.names.map((n) => n.trim()),
            ...(l.session ? { eventSessionId: l.session.id } : {}),
          })),
        },
      });
      setLines([]);
      setCustomer(null);
      setOrderRequestId(newRequestId());
      setCheckout({ loading: false, error: null });
      setPayingSale(sale);
    } catch (e) {
      setCheckout({ loading: false, error: toApiError(e) });
    }
  }

  const refresh = () => {
    onSessionChange();
    setHistoryVersion((v) => v + 1);
    eventCatalog.reload();
  };
  const hasEvents = eventCatalog.state === 'success' && eventCatalog.data.length > 0;
  const total = quote.data?.total;

  return (
    <>
      <SessionBar session={session} onSessionChange={onSessionChange} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DeviceBar device={device} />
        {catalog.state === 'success' && (
          <Badge tone={catalog.data.status.open ? 'forest' : 'terracotta'}>
            {describeOpening(catalog.data.status)}
          </Badge>
        )}
      </div>
      {!online && (
        <OfflineBanner>
          Hors connexion : la vente de billets est suspendue jusqu’au retour du réseau.
        </OfflineBanner>
      )}
      {catalog.state === 'success' && !catalog.data.openToday && (
        <Alert tone="error" title="Parc fermé aujourd’hui">
          La vente de billets du jour est suspendue (fermeture hebdomadaire ou exceptionnelle). Les
          billets d’événement restent en vente selon leur séance. Le restaurant n’est pas concerné.
        </Alert>
      )}

      <div className="grid gap-3 pb-24 lg:grid-cols-[minmax(0,1fr)_400px] lg:pb-0">
        <section aria-label="Catégories de billets" className="min-w-0 space-y-3">
          {(hasEvents || mode === 'events') && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Type de billet">
              {(
                [
                  ['day', 'Billets du jour', Ticket],
                  ['events', 'Événements', CalendarDays],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                  className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold ${mode === value ? 'bg-forest text-white' : 'border border-line bg-surface hover:border-forest'}`}
                >
                  <Icon className="h-4 w-4" aria-hidden /> {label}
                </button>
              ))}
            </div>
          )}
          {mode === 'events' && (
            <EventSalePanel
              catalog={eventCatalog}
              inCart={inCart}
              onAdd={(category, session) => changeQuantity(category, 1, session)}
            />
          )}
          {mode === 'day' && catalog.state === 'loading' && (
            <LoadingState label="Chargement des tarifs…" />
          )}
          {mode === 'day' && catalog.state === 'error' && (
            <ErrorState error={catalog.error} onRetry={catalog.reload} />
          )}
          {mode === 'day' &&
            catalog.state === 'success' &&
            catalog.data.categories.length === 0 && (
              <Card>
                <EmptyState
                  icon={<Ticket className="h-7 w-7" />}
                  title="Aucun billet en vente aujourd’hui"
                  description="Un responsable peut créer les tarifs dans la configuration de la billetterie."
                />
              </Card>
            )}
          {mode === 'day' && catalog.state === 'success' && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {catalog.data.categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => changeQuantity(c, 1)}
                  disabled={!openToday}
                  className="flex min-h-32 flex-col justify-between rounded-2xl border border-line bg-surface p-4 text-left shadow-card transition active:scale-[0.98] hover:border-forest disabled:opacity-50"
                >
                  <span>
                    <span className="block text-lg font-bold leading-tight">{c.name}</span>
                    <span className="text-xs uppercase tracking-wide text-muted">
                      {TICKET_KIND_LABELS[c.kind]}
                    </span>
                  </span>
                  <span className="space-y-0.5">
                    <span className="block font-display text-xl font-bold text-forest">
                      {formatXof(c.price)}
                    </span>
                    {c.peopleIncluded > 1 && (
                      <span className="flex items-center gap-1 text-xs text-muted">
                        <Users className="h-3.5 w-3.5" aria-hidden /> {c.peopleIncluded} personnes
                      </span>
                    )}
                    {c.conditions && (
                      <span className="block text-xs text-muted">{c.conditions}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <aside aria-label="Commande" className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <Card className="flex flex-col">
            <div className="flex items-center justify-between border-b border-line/70 px-4 py-3">
              <h2 className="font-semibold">
                Commande
                {visitors > 0 && (
                  <span className="font-normal text-muted"> · {visitors} billet(s)</span>
                )}
              </h2>
              {lines.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLines([])}
                  icon={<Trash2 className="h-4 w-4" />}
                >
                  Vider
                </Button>
              )}
            </div>
            {lines.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted">
                Touchez une catégorie pour ajouter un billet.
              </p>
            ) : (
              <ul className="max-h-[55vh] divide-y divide-line/70 overflow-y-auto">
                {lines.map((l) => {
                  const key = keyOf(l);
                  const optional = !needsNames(l);
                  const priced = quote.data?.lines.find(
                    (q) =>
                      q.ticketCategoryId === l.category.id &&
                      (q.eventSessionId ?? '') === (l.session?.id ?? ''),
                  );
                  return (
                    <li key={key} className="space-y-2 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{l.category.name}</p>
                          {l.session && (
                            <p className="truncate text-xs font-semibold text-forest">
                              {l.session.eventName} · {l.session.label}
                            </p>
                          )}
                          <p className="text-xs text-muted">
                            {priced ? formatXof(priced.unitPrice) : '…'} l’unité
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => changeQuantity(l.category, -1, l.session)}
                          className="grid h-11 w-11 place-items-center rounded-xl border border-line"
                          aria-label={`Retirer un billet ${l.category.name}`}
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="w-8 text-center font-semibold" aria-label="Quantité">
                          {l.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => changeQuantity(l.category, 1, l.session)}
                          className="grid h-11 w-11 place-items-center rounded-xl border border-line"
                          aria-label={`Ajouter un billet ${l.category.name}`}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                        <span className="w-20 text-right text-sm font-semibold">
                          {priced ? formatXof(priced.lineTotal) : '…'}
                        </span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {l.names.map((name, i) => (
                          <input
                            key={i}
                            value={name}
                            onChange={(e) => setName(key, i, e.target.value)}
                            aria-label={`Prénom du visiteur ${i + 1} (${l.category.name})${optional ? ', facultatif' : ''}`}
                            placeholder={
                              optional ? `Prénom ${i + 1} (facultatif)` : `Prénom ${i + 1}`
                            }
                            autoComplete="off"
                            className="min-h-11 rounded-xl border border-line bg-surface px-3 text-base focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/20"
                          />
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="space-y-3 border-t border-line/70 p-4">
              {lines.some((l) => l.session) && (
                <CustomerPicker
                  value={customer}
                  onChange={setCustomer}
                  label="Acheteur (facultatif : contact en cas d’annulation)"
                  testId="event-buyer"
                />
              )}
              {quote.error && <ApiErrorAlert error={quote.error} />}
              <ApiErrorAlert error={checkout.error} />
              {missingNames > 0 && (
                <p className="text-sm text-muted">
                  Saisissez le prénom de chaque visiteur ({missingNames} manquant(s)).
                </p>
              )}
              <div className="flex items-baseline justify-between">
                <span className="font-medium">Total</span>
                <span className="font-display text-3xl font-bold" data-testid="ticket-total">
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

      <SessionTicketSales
        key={historyVersion}
        sessionId={session.id}
        terminal={device.terminal}
        onPay={(sale) => setPayingSale(sale)}
      />

      {/* Barre fixe sur mobile et tablette en portrait : total et encaissement toujours accessibles. */}
      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3 shadow-lift lg:hidden">
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

      {payingSale && (
        <PaymentDialog
          sale={payingSale}
          onClose={() => {
            setUnpaidNotice(payingSale);
            setPayingSale(null);
            refresh();
          }}
          onPaid={(result) => {
            setPayingSale(null);
            setIssued(result);
          }}
        />
      )}
      {issued && (
        <TicketsIssuedDialog
          result={issued}
          terminal={device.terminal}
          onClose={() => {
            setIssued(null);
            refresh();
          }}
        />
      )}
      {unpaidNotice && (
        <Dialog open onClose={() => setUnpaidNotice(null)} title="Commande enregistrée, non payée">
          <div className="space-y-4">
            <Alert tone="info">
              La vente n° {formatSaleNumber(unpaidNotice.number)} ({formatXof(unpaidNotice.total)})
              est enregistrée. Aucun billet n’est émis tant qu’elle n’est pas payée.
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

/** Après paiement : montants confirmés par le serveur, impression des billets, QR codes à l'écran. */
function TicketsIssuedDialog({
  result,
  terminal,
  onClose,
}: {
  result: PaymentResult;
  terminal: PosTerminal | null;
  onClose: () => void;
}) {
  const { sale, payment } = result;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Billets émis"
      description={`Vente n° ${formatSaleNumber(sale.number)}`}
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-3 gap-2 rounded-2xl border border-line bg-ivory/60 p-4 text-center">
          <div>
            <dt className="text-xs text-muted">Total</dt>
            <dd className="font-semibold">{formatXof(payment.amount)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Reçu</dt>
            <dd className="font-semibold">{formatXof(payment.amountTendered ?? payment.amount)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Monnaie rendue</dt>
            <dd className="font-display text-xl font-bold text-forest" data-testid="change-given">
              {formatXof(payment.changeGiven ?? 0)}
            </dd>
          </div>
        </dl>
        <AfterPaymentHardware result={result} terminal={terminal} document="billets" />
        <SaleTickets saleId={sale.id} terminal={terminal} />
        <Button size="lg" className="w-full" onClick={onClose}>
          Nouvelle vente
        </Button>
      </div>
    </Dialog>
  );
}

/** Ventes de billetterie de la session : billets à revoir, ventes non payées à encaisser. */
function SessionTicketSales({
  sessionId,
  terminal,
  onPay,
}: {
  sessionId: string;
  terminal: PosTerminal | null;
  onPay: (sale: Sale) => void;
}) {
  const sales = useApi<Sale[]>(`/sales?activity=PARK&cashSessionId=${sessionId}&limit=20`);
  const [viewing, setViewing] = useState<Sale | null>(null);
  if (sales.state !== 'success' || sales.data.length === 0) return null;
  return (
    <Card>
      <div className="border-b border-line/70 px-4 py-3">
        <h2 className="font-semibold">Ventes de la session</h2>
      </div>
      <ul className="divide-y divide-line/70">
        {sales.data.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <span className="font-semibold">n° {formatSaleNumber(s.number)}</span>
            <span className="text-muted">{formatDateTime(s.createdAt)}</span>
            <span className="flex-1 truncate text-muted">
              {s.lines.map((l) => `${l.quantity} × ${l.productName}`).join(', ')}
            </span>
            <span className="font-semibold">{formatXof(s.total)}</span>
            {s.status === 'CANCELLED' ? (
              <Badge>Annulée</Badge>
            ) : s.paymentStatus === 'PAID' ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setViewing(s)}
                icon={<Ticket className="h-4 w-4" />}
              >
                Billets
              </Button>
            ) : (
              <Button size="sm" onClick={() => onPay(s)}>
                Encaisser
              </Button>
            )}
          </li>
        ))}
      </ul>
      {viewing && (
        <Dialog
          open
          onClose={() => setViewing(null)}
          title={`Billets de la vente n° ${formatSaleNumber(viewing.number)}`}
          description={formatDateTime(viewing.createdAt)}
        >
          <SaleTickets saleId={viewing.id} terminal={terminal} />
        </Dialog>
      )}
    </Card>
  );
}
