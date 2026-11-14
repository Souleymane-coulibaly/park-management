'use client';

import { type FormEvent, useEffect, useState } from 'react';
import {
  STOCK_SHOWCASE_MAX_REQUEST_ITEMS,
  STOCK_SHOWCASE_REQUEST_KIND_LABELS,
  type StockShowcaseRequestKind,
} from '@ocall/shared';

interface Wanted {
  productId: string;
  name: string;
  quantity: number;
}

const storageKey = (slug: string) => `ocall.stock-site.${slug}.demande`;
const EVENT = 'ocall-stock-site-request';

/** Liste « ma demande » du visiteur, gardée dans son navigateur (jamais envoyée sans le formulaire). */
function read(slug: string): Wanted[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(storageKey(slug)) ?? '[]') as unknown;
    return Array.isArray(raw) ? (raw as Wanted[]).slice(0, STOCK_SHOWCASE_MAX_REQUEST_ITEMS) : [];
  } catch {
    return [];
  }
}

function write(slug: string, items: Wanted[]) {
  try {
    window.localStorage.setItem(storageKey(slug), JSON.stringify(items));
  } catch {
    // Stockage indisponible (navigation privée) : la liste reste en mémoire pour cette page.
  }
  window.dispatchEvent(new Event(EVENT));
}

function useWanted(slug: string) {
  const [items, setItems] = useState<Wanted[]>([]);
  useEffect(() => {
    const sync = () => setItems(read(slug));
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [slug]);
  const save = (next: Wanted[]) => {
    setItems(next);
    write(slug, next);
  };
  return [items, save] as const;
}

/** « Ajouter à ma demande » : l'article rejoint la liste jointe à la demande de devis. */
export function AddToRequest({
  slug,
  product,
  withQuantity = false,
}: {
  slug: string;
  product: { id: string; name: string };
  withQuantity?: boolean;
}) {
  const [items, save] = useWanted(slug);
  const [quantity, setQuantity] = useState('1');
  const inList = items.some((i) => i.productId === product.id);
  const full = items.length >= STOCK_SHOWCASE_MAX_REQUEST_ITEMS;
  return (
    <div className="flex flex-wrap items-end gap-2">
      {withQuantity && !inList && (
        <label className="text-sm font-medium">
          Quantité
          <input
            type="number"
            min={0.001}
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="mt-1 block w-24 rounded-xl border border-black/15 bg-white px-3 py-2"
          />
        </label>
      )}
      <button
        type="button"
        disabled={inList || full}
        onClick={() =>
          save([
            ...items,
            { productId: product.id, name: product.name, quantity: Number(quantity) || 1 },
          ])
        }
        className="min-h-11 rounded-full px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: 'var(--brand, #176B53)' }}
        data-testid="stock-site-add"
      >
        {inList ? 'Dans votre demande' : 'Ajouter à ma demande'}
      </button>
    </div>
  );
}

/**
 * Formulaire public d'une vitrine Stock : renseignement ou demande de devis, avec les articles choisis
 * (quantités modifiables). Anti-spam : champ piège invisible et durée minimale de saisie (contrôlés par
 * l'API). La demande arrive dans Stock ; rien n'est vendu ni confirmé automatiquement.
 */
export function StockRequestForm({
  slug,
  forms,
  shop = null,
}: {
  slug: string;
  forms: StockShowcaseRequestKind[];
  /** Boutique choisie (S10) : la demande lui est adressée. */
  shop?: { siteId: string; name: string } | null;
}) {
  const [items, save] = useWanted(slug);
  const [startedAt] = useState(() => Date.now());
  const [kind, setKind] = useState<StockShowcaseRequestKind>(
    forms.includes('QUOTE') ? 'QUOTE' : forms[0]!,
  );
  const [form, setForm] = useState({ name: '', phone: '', email: '', message: '', website: '' });
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });
  const field =
    'mt-1 block w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-[15px]';
  const withItems = kind === 'QUOTE' && items.length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState('sending');
    setError(null);
    try {
      const res = await fetch(`/api/v1/public/stock-sites/${slug}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          name: form.name,
          phone: form.phone || null,
          email: form.email || null,
          message: form.message,
          items: withItems
            ? items.map((i) => ({ productId: i.productId, quantity: i.quantity }))
            : undefined,
          website: form.website,
          startedAt,
          ...(shop ? { siteId: shop.siteId } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
        setError(
          res.status === 429
            ? 'Trop de demandes envoyées : réessayez dans quelques minutes.'
            : ((Array.isArray(body?.message) ? body.message[0] : body?.message) ??
                'Envoi impossible.'),
        );
        setState('idle');
        return;
      }
      if (withItems) save([]);
      setState('sent');
    } catch {
      setError('Connexion impossible : réessayez.');
      setState('idle');
    }
  }

  if (state === 'sent') {
    return (
      <p
        className="mt-4 rounded-xl bg-forest-light px-4 py-3 font-medium text-forest-dark"
        role="status"
        data-testid="stock-site-request-sent"
      >
        Merci, votre demande a bien été envoyée. Le magasin vous recontacte rapidement.
      </p>
    );
  }

  return (
    <form className="mt-4 space-y-3" onSubmit={submit} data-testid="stock-site-request-form">
      {shop && (
        <p className="text-sm" data-testid="stock-site-request-shop">
          Demande adressée à <strong>{shop.name}</strong>.
        </p>
      )}
      {forms.length > 1 && (
        <label className="block text-sm font-medium">
          Objet
          <select
            className={field}
            value={kind}
            onChange={(e) => setKind(e.target.value as StockShowcaseRequestKind)}
          >
            {forms.map((k) => (
              <option key={k} value={k}>
                {STOCK_SHOWCASE_REQUEST_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === 'QUOTE' && items.length > 0 && (
        <fieldset
          className="rounded-xl border border-line p-3"
          data-testid="stock-site-request-items"
        >
          <legend className="px-1 text-sm font-semibold">Articles demandés</legend>
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.productId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1">{i.name}</span>
                <input
                  type="number"
                  min={0.001}
                  step="any"
                  aria-label={`Quantité : ${i.name}`}
                  value={i.quantity}
                  onChange={(e) =>
                    save(
                      items.map((x) =>
                        x.productId === i.productId
                          ? { ...x, quantity: Number(e.target.value) || 1 }
                          : x,
                      ),
                    )
                  }
                  className="w-24 rounded-lg border border-line px-2 py-1"
                />
                <button
                  type="button"
                  className="text-terracotta-dark underline"
                  onClick={() => save(items.filter((x) => x.productId !== i.productId))}
                >
                  Retirer
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <label className="block text-sm font-medium">
        Votre nom
        <input className={field} required minLength={2} maxLength={120} {...set('name')} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Téléphone
          <input className={field} type="tel" maxLength={30} {...set('phone')} />
        </label>
        <label className="block text-sm font-medium">
          E-mail
          <input className={field} type="email" maxLength={160} {...set('email')} />
        </label>
      </div>
      <label className="block text-sm font-medium">
        Message
        <textarea
          className={field}
          rows={4}
          required
          minLength={5}
          maxLength={2000}
          {...set('message')}
        />
      </label>
      {/* Champ piège : invisible pour un visiteur, rempli par les robots. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Site web
          <input tabIndex={-1} autoComplete="off" {...set('website')} />
        </label>
      </div>
      {error && (
        <p className="text-sm text-terracotta-dark" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={state === 'sending'}
        className="min-h-12 rounded-full px-6 py-3 font-semibold text-white disabled:opacity-60"
        style={{ background: 'var(--brand, #176B53)' }}
      >
        {state === 'sending' ? 'Envoi…' : 'Envoyer ma demande'}
      </button>
    </form>
  );
}
