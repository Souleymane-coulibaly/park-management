'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, ShoppingBag, UtensilsCrossed, WifiOff } from 'lucide-react';
import {
  KIOSK_CONFIRMATION_SECONDS,
  KIOSK_IDLE_SECONDS,
  formatKioskNumber,
  formatXof,
} from '@ocall/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { InputField } from '@/components/ui/field';
import { Alert, LoadingState } from '@/components/ui/states';
import { PairPrinterButton } from '@/components/pos/pair-printer-button';
import { printOnDevice } from '@/lib/hardware/device';
import { HardwareError } from '@/lib/hardware/hardware-error';
import { useOnline } from '@/lib/hardware/use-terminal';
import { newRequestId } from '@/lib/request-id';
import type { HardwareTarget, KioskMenu } from '@/lib/types';

/** Erreur de la borne (jamais de redirection vers la connexion des employés). */
class KioskError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Appels de la borne : authentifiés par le cookie d'appareil (httpOnly), routes /api/v1/kiosk. */
async function kioskApi<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/kiosk${path}`, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new KioskError(0, 'NETWORK', 'Connexion perdue. Réessayez dans un instant.');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
  if (!res.ok) {
    throw new KioskError(
      res.status,
      data?.code ?? 'ERROR',
      data?.message ?? 'Une erreur est survenue.',
    );
  }
  return data as T;
}

type Product = KioskMenu['categories'][number]['products'][number];
interface CartLine {
  variantId: string;
  label: string;
  price: number;
  quantity: number;
  notes: string;
}
type Screen =
  | { kind: 'loading' }
  | { kind: 'unpaired' }
  | { kind: 'home' }
  | { kind: 'ordering'; sessionId: string }
  | { kind: 'done'; number: number; total: number; print: PrintOutcome };

/** Ticket imprimé par la borne : absent (pas d'imprimante), imprimé ou en échec. */
type PrintOutcome = 'none' | 'printed' | 'failed';

interface KioskDevice {
  deviceName: string;
  establishmentName: string;
  printer: HardwareTarget | null;
}

interface KioskPrint {
  jobId: string;
  printer: HardwareTarget;
  data: string | null;
  preview: string[];
}

export default function KioskPage() {
  const online = useOnline();
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [device, setDevice] = useState<KioskDevice | null>(null);
  const [menu, setMenu] = useState<KioskMenu | null>(null);
  const [error, setError] = useState<KioskError | null>(null);

  const identify = useCallback(async () => {
    try {
      setDevice(await kioskApi('/me'));
      setScreen({ kind: 'home' });
    } catch (e) {
      const err = e as KioskError;
      if (err.status === 401) setScreen({ kind: 'unpaired' });
      else {
        setError(err);
        setScreen({ kind: 'home' });
      }
    }
  }, []);

  useEffect(() => {
    void identify();
  }, [identify]);

  async function start() {
    setError(null);
    try {
      const [session, catalog] = await Promise.all([
        kioskApi<{ id: string }>('/sessions', { method: 'POST' }),
        kioskApi<KioskMenu>('/menu'),
      ]);
      setMenu(catalog);
      setScreen({ kind: 'ordering', sessionId: session.id });
    } catch (e) {
      const err = e as KioskError;
      if (err.status === 401) setScreen({ kind: 'unpaired' });
      else setError(err);
    }
  }

  if (screen.kind === 'loading') return <LoadingState label="Démarrage de la borne…" />;
  if (screen.kind === 'unpaired') return <Pairing onPaired={identify} />;

  return (
    <>
      {!online && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-charcoal/80 p-6 text-center text-white"
          role="alert"
        >
          <div className="space-y-3">
            <WifiOff className="mx-auto h-12 w-12" aria-hidden />
            <p className="text-2xl font-bold">Connexion perdue</p>
            <p>La borne reprendra dès le retour du réseau. Votre commande n’est pas perdue.</p>
          </div>
        </div>
      )}
      {screen.kind === 'home' && <Home device={device} error={error} onStart={start} />}
      {screen.kind === 'ordering' && menu && (
        <Ordering
          menu={menu}
          sessionId={screen.sessionId}
          online={online}
          onDone={(number, total, print) => setScreen({ kind: 'done', number, total, print })}
          onAbandon={() => {
            void kioskApi(`/sessions/${screen.sessionId}/end`, { method: 'POST' }).catch(
              () => undefined,
            );
            setMenu(null);
            setScreen({ kind: 'home' });
          }}
          onUnpaired={() => setScreen({ kind: 'unpaired' })}
        />
      )}
      {screen.kind === 'done' && (
        <Confirmation
          print={screen.print}
          number={screen.number}
          total={screen.total}
          onHome={() => setScreen({ kind: 'home' })}
        />
      )}
    </>
  );
}

/**
 * Impression du ticket de commande sur l'imprimante de la borne, puis compte rendu au serveur
 * (historique d'impression). Un échec n'annule pas la commande : le numéro reste affiché.
 */
async function printTicket(print: KioskPrint | null): Promise<PrintOutcome> {
  if (!print) return 'none';
  if (!print.data) return 'printed';
  let outcome: PrintOutcome = 'printed';
  let failure: { errorCode: string; errorMessage: string } | null = null;
  try {
    await printOnDevice(print.printer, print.data, print.preview);
  } catch (e) {
    outcome = 'failed';
    failure =
      e instanceof HardwareError
        ? { errorCode: e.code, errorMessage: e.message.slice(0, 300) }
        : { errorCode: 'PRINT_FAILED', errorMessage: 'Impression impossible.' };
  }
  await kioskApi(`/print-jobs/${print.jobId}/result`, {
    method: 'POST',
    body: failure ? { status: 'FAILED', ...failure } : { status: 'SUCCEEDED' },
  }).catch(() => undefined);
  return outcome;
}

function Pairing({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await kioskApi('/pair', { method: 'POST', body: { code } });
      onPaired();
    } catch (e) {
      setError((e as KioskError).message);
      setLoading(false);
    }
  }
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div className="text-center">
        <UtensilsCrossed className="mx-auto h-10 w-10 text-forest" aria-hidden />
        <h1 className="mt-3 text-2xl font-bold">Appairer la borne</h1>
        <p className="mt-1 text-sm text-muted">
          Saisissez le code affiché par un responsable dans « Bornes de commande ». Il est valable
          15 minutes et ne sert qu’une fois.
        </p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <InputField
          label="Code d’appairage"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={9}
          autoComplete="off"
          required
        />
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          Appairer
        </Button>
      </form>
    </div>
  );
}

function Home({
  device,
  error,
  onStart,
}: {
  device: KioskDevice | null;
  error: KioskError | null;
  onStart: () => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onStart}
        className="flex min-h-screen w-full flex-col items-center justify-center gap-6 bg-forest p-8 text-center text-white"
      >
        <UtensilsCrossed className="h-16 w-16" aria-hidden />
        <span className="text-4xl font-bold">{device?.establishmentName ?? 'Bienvenue'}</span>
        <span className="rounded-2xl bg-savanna px-8 py-5 text-2xl font-bold text-charcoal">
          Touchez pour commander
        </span>
        <span className="max-w-md text-sm opacity-90">
          Le paiement se fait à la caisse avec votre numéro de commande.
        </span>
        {error && (
          <span className="rounded-xl bg-terracotta px-4 py-2 text-sm">{error.message}</span>
        )}
      </button>
      {/* Mise en service par le personnel : association de l'imprimante USB ou BLE à la tablette. */}
      {device?.printer && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <PairPrinterButton
            connection={device.printer.connection}
            address={device.printer.address}
          />
        </div>
      )}
    </div>
  );
}

function Ordering({
  menu,
  sessionId,
  online,
  onDone,
  onAbandon,
  onUnpaired,
}: {
  menu: KioskMenu;
  sessionId: string;
  online: boolean;
  onDone: (number: number, total: number, print: PrintOutcome) => void;
  onAbandon: () => void;
  onUnpaired: () => void;
}) {
  const [categoryId, setCategoryId] = useState(menu.categories[0]?.id ?? null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picking, setPicking] = useState<Product | null>(null);
  const [review, setReview] = useState(false);
  const [name, setName] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idle, setIdle] = useState(0);
  const lastTouch = useRef(Date.now());
  // Clé stable tant que le panier ne change pas : un renvoi après coupure ne crée pas de doublon.
  const signature = JSON.stringify(cart.map((l) => [l.variantId, l.quantity, l.notes]));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- la signature résume le panier
  const requestId = useMemo(() => newRequestId(), [signature]);

  // Inactivité : retour à l'accueil et effacement du panier après 90 s (avertissement 15 s avant).
  useEffect(() => {
    const touch = () => {
      lastTouch.current = Date.now();
      setIdle(0);
    };
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - lastTouch.current) / 1000);
      setIdle(seconds);
      if (seconds >= KIOSK_IDLE_SECONDS) onAbandon();
    }, 1000);
    return () => {
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      clearInterval(timer);
    };
  }, [onAbandon]);

  const category = menu.categories.find((c) => c.id === categoryId) ?? menu.categories[0];
  const total = cart.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const count = cart.reduce((sum, l) => sum + l.quantity, 0);

  function add(product: Product, variant: Product['variants'][number], notes: string) {
    setCart((lines) => {
      const existing = lines.find((l) => l.variantId === variant.id && l.notes === notes);
      if (existing)
        return lines.map((l) =>
          l === existing ? { ...l, quantity: Math.min(l.quantity + 1, 20) } : l,
        );
      const label =
        product.variants.length > 1 ? `${product.name} (${variant.name})` : product.name;
      return [...lines, { variantId: variant.id, label, price: variant.price, quantity: 1, notes }];
    });
  }

  function change(line: CartLine, delta: number) {
    setCart((lines) =>
      lines.flatMap((l) => {
        if (l !== line) return [l];
        const quantity = Math.min(l.quantity + delta, 20);
        return quantity > 0 ? [{ ...l, quantity }] : [];
      }),
    );
  }

  async function submit() {
    setSending(true);
    setError(null);
    try {
      const res = await kioskApi<{
        displayNumber: number;
        estimatedTotal: number;
        print: KioskPrint | null;
      }>(`/sessions/${sessionId}/orders`, {
        method: 'POST',
        body: {
          clientRequestId: requestId,
          ...(name.trim() ? { customerName: name.trim() } : {}),
          lines: cart.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
            ...(l.notes ? { notes: l.notes } : {}),
          })),
        },
      });
      onDone(res.displayNumber, res.estimatedTotal, await printTicket(res.print));
    } catch (e) {
      const err = e as KioskError;
      if (err.status === 401) return onUnpaired();
      setError(err.message);
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-3 bg-forest px-5 py-4 text-white">
        <h1 className="text-xl font-bold">{menu.establishmentName}</h1>
        <Button variant="secondary" onClick={onAbandon}>
          Annuler
        </Button>
      </header>
      {idle >= KIOSK_IDLE_SECONDS - 15 && (
        <div className="bg-savanna px-5 py-3 text-center font-semibold" role="alert">
          Toujours là ? Retour à l’accueil dans {KIOSK_IDLE_SECONDS - idle} s — touchez l’écran pour
          continuer.
        </div>
      )}
      <nav aria-label="Catégories" className="flex gap-2 overflow-x-auto px-5 py-3">
        {menu.categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategoryId(c.id)}
            aria-pressed={c.id === category?.id}
            className={`min-h-14 shrink-0 rounded-2xl px-6 text-lg font-semibold ${c.id === category?.id ? 'bg-forest text-white' : 'border border-line bg-surface'}`}
          >
            {c.name}
          </button>
        ))}
      </nav>
      <section
        aria-label="Produits"
        className="grid flex-1 grid-cols-2 gap-4 px-5 pb-32 md:grid-cols-3 xl:grid-cols-4"
      >
        {category?.products.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPicking(p)}
            className="flex flex-col overflow-hidden rounded-3xl border border-line bg-surface text-left shadow-card active:scale-[0.98]"
          >
            {p.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- photo fournie par l'établissement (https)
              <img
                src={p.imageUrl}
                alt=""
                className="aspect-[4/3] w-full object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="grid aspect-[4/3] w-full place-items-center bg-forest-light text-forest">
                <UtensilsCrossed className="h-10 w-10" aria-hidden />
              </span>
            )}
            <span className="space-y-1 p-4">
              <span className="block text-lg font-bold leading-tight">{p.name}</span>
              <span className="block font-semibold text-forest">
                {p.variants.length > 1 ? 'dès ' : ''}
                {formatXof(Math.min(...p.variants.map((v) => v.price)))}
              </span>
            </span>
          </button>
        ))}
      </section>
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-4 border-t border-line bg-surface px-5 py-4 shadow-lift">
          <span className="text-xl font-bold">
            {count} article(s) · {formatXof(total)}
          </span>
          <Button
            size="lg"
            icon={<ShoppingBag className="h-5 w-5" />}
            onClick={() => setReview(true)}
          >
            Voir ma commande
          </Button>
        </div>
      )}
      {picking && (
        <ProductDialog
          product={picking}
          onClose={() => setPicking(null)}
          onAdd={(variant, notes) => {
            add(picking, variant, notes);
            setPicking(null);
          }}
        />
      )}
      {review && (
        <Dialog open onClose={() => setReview(false)} title="Ma commande">
          <div className="space-y-4">
            <ul className="divide-y divide-line/70 rounded-xl border border-line">
              {cart.map((l) => (
                <li key={`${l.variantId}|${l.notes}`} className="flex items-center gap-2 px-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{l.label}</p>
                    {l.notes && <p className="text-sm text-terracotta-dark">{l.notes}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => change(l, -1)}
                    className="grid h-12 w-12 place-items-center rounded-xl border border-line"
                    aria-label={`Retirer ${l.label}`}
                  >
                    <Minus className="h-5 w-5" />
                  </button>
                  <span className="w-8 text-center text-lg font-bold">{l.quantity}</span>
                  <button
                    type="button"
                    onClick={() => change(l, 1)}
                    className="grid h-12 w-12 place-items-center rounded-xl border border-line"
                    aria-label={`Ajouter ${l.label}`}
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </li>
              ))}
            </ul>
            <p className="flex justify-between text-lg font-bold">
              <span>Total</span>
              <span>{formatXof(total)}</span>
            </p>
            <InputField
              label="Votre prénom (facultatif, pour vous appeler)"
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {error && <Alert tone="error">{error}</Alert>}
            <Button
              size="lg"
              className="w-full"
              loading={sending}
              disabled={!online || cart.length === 0}
              onClick={submit}
            >
              Valider ma commande
            </Button>
            <p className="text-center text-sm text-muted">
              Vous paierez à la caisse avec votre numéro de commande. La préparation commence après
              validation par le personnel.
            </p>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function ProductDialog({
  product,
  onClose,
  onAdd,
}: {
  product: Product;
  onClose: () => void;
  onAdd: (variant: Product['variants'][number], notes: string) => void;
}) {
  const [variantId, setVariantId] = useState(product.variants[0]!.id);
  const [notes, setNotes] = useState('');
  const variant = product.variants.find((v) => v.id === variantId)!;
  return (
    <Dialog
      open
      onClose={onClose}
      title={product.name}
      description={product.description ?? undefined}
    >
      <div className="space-y-4">
        {product.variants.length > 1 && (
          <div role="radiogroup" aria-label="Choix" className="grid gap-2">
            {product.variants.map((v) => (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={v.id === variantId}
                onClick={() => setVariantId(v.id)}
                className={`flex min-h-14 items-center justify-between rounded-xl px-4 text-lg font-semibold ${v.id === variantId ? 'bg-forest text-white' : 'border border-line bg-surface'}`}
              >
                <span>{v.name}</span>
                <span>{formatXof(v.price)}</span>
              </button>
            ))}
          </div>
        )}
        <InputField
          label="Instruction (facultatif)"
          maxLength={200}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Sans piment, bien cuit…"
        />
        <Button size="lg" className="w-full" onClick={() => onAdd(variant, notes.trim())}>
          Ajouter · {formatXof(variant.price)}
        </Button>
      </div>
    </Dialog>
  );
}

function Confirmation({
  number,
  total,
  print,
  onHome,
}: {
  number: number;
  total: number;
  print: PrintOutcome;
  onHome: () => void;
}) {
  const [left, setLeft] = useState(KIOSK_CONFIRMATION_SECONDS);
  useEffect(() => {
    const timer = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (left <= 0) onHome();
  }, [left, onHome]);
  return (
    <button
      type="button"
      onClick={onHome}
      className="flex min-h-screen w-full flex-col items-center justify-center gap-5 bg-ivory p-8 text-center"
    >
      <p className="text-2xl font-semibold">Votre numéro de commande</p>
      <p className="font-display text-8xl font-bold text-forest" data-testid="kiosk-number">
        {formatKioskNumber(number)}
      </p>
      <p className="max-w-lg text-xl">
        Présentez ce numéro à la caisse pour régler {formatXof(total)}. Votre commande sera préparée
        après validation.
      </p>
      {print === 'printed' && (
        <p className="rounded-xl bg-forest-light px-4 py-2 font-semibold text-forest-dark">
          Prenez votre ticket.
        </p>
      )}
      {print === 'failed' && (
        <p className="rounded-xl bg-terracotta-light px-4 py-2 font-semibold text-terracotta-dark">
          Le ticket n’a pas pu être imprimé : notez votre numéro.
        </p>
      )}
      <p className="text-sm text-muted">Retour à l’accueil dans {Math.max(0, left)} s</p>
    </button>
  );
}
