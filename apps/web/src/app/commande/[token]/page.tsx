'use client';

import { use, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Minus, Plus, ShoppingBag, UtensilsCrossed } from 'lucide-react';
import { MAX_QR_LINE_QUANTITY, formatXof, publicOrderStatusPath } from '@ocall/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { InputField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { newRequestId } from '@/lib/request-id';
import type { PublicMenu } from '@/lib/types';
import { useApi } from '@/lib/use-api';

interface CartLine {
  variantId: string;
  label: string;
  price: number;
  quantity: number;
  notes: string;
}

type Product = PublicMenu['categories'][number]['products'][number];

/**
 * Menu public ouvert par le QR code d'une table ou d'une zone. Le client compose sa demande sans
 * compte ; elle sera validée par le personnel. Les montants affichés sont indicatifs : seuls les
 * prix calculés par le serveur font foi, et rien n'est payé ici.
 */
export default function PublicMenuPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const menu = useApi<PublicMenu>(`/public/menu/${encodeURIComponent(token)}`);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picking, setPicking] = useState<Product | null>(null);
  const [review, setReview] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [notes, setNotes] = useState('');
  // Clé de la demande : stable tant que le panier ne change pas, si bien qu'un renvoi après une
  // coupure réseau ne crée pas de doublon ; un panier modifié est une nouvelle demande.
  const cartSignature = JSON.stringify(cart.map((l) => [l.variantId, l.quantity, l.notes]));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- la signature résume le panier
  const requestId = useMemo(() => newRequestId(), [cartSignature]);
  const [error, setError] = useState<ApiError | null>(null);
  const [sending, setSending] = useState(false);

  if (menu.state === 'loading') return <LoadingState label="Chargement du menu…" />;
  if (menu.state === 'error') return <ErrorState error={menu.error} onRetry={menu.reload} />;

  const total = cart.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const count = cart.reduce((sum, l) => sum + l.quantity, 0);

  function add(product: Product, variant: Product['variants'][number], note = '') {
    setCart((lines) => {
      const existing = lines.find((l) => l.variantId === variant.id && l.notes === note);
      if (existing)
        return lines.map((l) =>
          l === existing ? { ...l, quantity: Math.min(l.quantity + 1, MAX_QR_LINE_QUANTITY) } : l,
        );
      const label =
        product.variants.length > 1 ? `${product.name} (${variant.name})` : product.name;
      return [
        ...lines,
        { variantId: variant.id, label, price: variant.price, quantity: 1, notes: note },
      ];
    });
  }

  function change(line: CartLine, delta: number) {
    setCart((lines) =>
      lines.flatMap((l) => {
        if (l !== line) return [l];
        const quantity = Math.min(l.quantity + delta, MAX_QR_LINE_QUANTITY);
        return quantity > 0 ? [{ ...l, quantity }] : [];
      }),
    );
  }

  async function submit() {
    setSending(true);
    setError(null);
    try {
      const res = await api<{ publicToken: string }>(
        `/public/menu/${encodeURIComponent(token)}/orders`,
        {
          method: 'POST',
          body: {
            clientRequestId: requestId,
            ...(customerName.trim() ? { customerName: customerName.trim() } : {}),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
            lines: cart.map((l) => ({
              variantId: l.variantId,
              quantity: l.quantity,
              ...(l.notes ? { notes: l.notes } : {}),
            })),
          },
        },
      );
      router.push(publicOrderStatusPath(res.publicToken));
    } catch (e) {
      setError(
        e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion impossible, réessayez.'),
      );
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <header className="rounded-2xl bg-forest p-5 text-white">
        <p className="flex items-center gap-2 text-sm opacity-90">
          <UtensilsCrossed className="h-4 w-4" aria-hidden /> {menu.data.establishmentName}
        </p>
        <h1 className="mt-1 text-2xl font-bold">{menu.data.location || 'Commander'}</h1>
        <p className="mt-1 text-sm opacity-90">
          Composez votre commande : le personnel la valide avant de l’envoyer en cuisine. Le
          paiement se fait auprès du personnel.
        </p>
      </header>

      {menu.data.categories.length === 0 && (
        <Alert tone="info">
          Le menu n’est pas disponible pour le moment. Adressez-vous au personnel.
        </Alert>
      )}
      {menu.data.categories.map((category) => (
        <section key={category.id} aria-label={category.name}>
          <h2 className="mb-2 text-lg font-bold">{category.name}</h2>
          <ul className="space-y-2">
            {category.products.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setPicking(p)}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 text-left shadow-card"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold">{p.name}</span>
                    {p.description && (
                      <span className="block text-sm text-muted">{p.description}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-semibold text-forest">
                    {p.variants.length > 1 ? 'dès ' : ''}
                    {formatXof(Math.min(...p.variants.map((v) => v.price)))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface p-4 shadow-lift">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
            <span className="font-semibold">
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
        </div>
      )}

      {picking && (
        <ProductDialog
          product={picking}
          onClose={() => setPicking(null)}
          onAdd={(variant, note) => {
            add(picking, variant, note);
            setPicking(null);
          }}
        />
      )}

      {review && (
        <Dialog
          open
          onClose={() => setReview(false)}
          title="Ma commande"
          description={menu.data.location}
        >
          <div className="space-y-4">
            <ul className="divide-y divide-line/70 rounded-xl border border-line">
              {cart.map((l) => (
                <li key={`${l.variantId}|${l.notes}`} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{l.label}</p>
                    {l.notes && <p className="text-sm text-terracotta-dark">{l.notes}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => change(l, -1)}
                    className="grid h-11 w-11 place-items-center rounded-xl border border-line"
                    aria-label={`Retirer ${l.label}`}
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-6 text-center font-semibold">{l.quantity}</span>
                  <button
                    type="button"
                    onClick={() => change(l, 1)}
                    className="grid h-11 w-11 place-items-center rounded-xl border border-line"
                    aria-label={`Ajouter ${l.label}`}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
            <p className="flex justify-between font-semibold">
              <span>Total indicatif</span>
              <span>{formatXof(total)}</span>
            </p>
            <InputField
              label="Votre prénom (facultatif)"
              maxLength={60}
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
            <InputField
              label="Remarque pour le personnel (facultatif)"
              maxLength={200}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <ApiErrorAlert error={error} />
            <Button
              size="lg"
              className="w-full"
              loading={sending}
              disabled={cart.length === 0}
              onClick={submit}
            >
              Envoyer ma demande
            </Button>
            <p className="text-center text-xs text-muted">
              Votre demande n’est ni payée ni envoyée en cuisine tant que le personnel ne l’a pas
              validée.
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
  onAdd: (variant: Product['variants'][number], note: string) => void;
}) {
  const [variantId, setVariantId] = useState(product.variants[0]!.id);
  const [note, setNote] = useState('');
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
                className={`flex min-h-12 items-center justify-between rounded-xl px-4 font-semibold ${v.id === variantId ? 'bg-forest text-white' : 'border border-line bg-surface'}`}
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
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Sans piment, bien cuit…"
        />
        <Button size="lg" className="w-full" onClick={() => onAdd(variant, note.trim())}>
          Ajouter · {formatXof(variant.price)}
        </Button>
      </div>
    </Dialog>
  );
}
