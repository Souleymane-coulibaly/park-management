'use client';

import { type FormEvent, useState } from 'react';
import { FACTURE_REQUEST_KIND_LABELS, type FactureRequestKind } from '@ocall/shared';

/**
 * Formulaire public d'une vitrine Facture : contact, demande de devis, d'intervention ou de rendez-vous.
 * Anti-spam : champ piège invisible et durée minimale de saisie (contrôlés par l'API). La demande arrive
 * dans la boîte de l'entreprise ; rien n'est confirmé automatiquement.
 */
export function FactureRequestForm({
  slug,
  forms,
  services,
}: {
  slug: string;
  forms: FactureRequestKind[];
  services: { id: string; name: string }[];
}) {
  const [startedAt] = useState(() => Date.now());
  const [kind, setKind] = useState<FactureRequestKind>(forms[0]!);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    message: '',
    serviceItemId: '',
    preferredDate: '',
    website: '',
  });
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });
  const field =
    'mt-1 block w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-[15px]';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState('sending');
    setError(null);
    try {
      const res = await fetch(`/api/v1/public/facture-sites/${slug}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          name: form.name,
          phone: form.phone || null,
          email: form.email || null,
          message: form.message,
          serviceItemId: form.serviceItemId || null,
          preferredDate: form.preferredDate || null,
          website: form.website,
          startedAt,
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
        data-testid="facture-site-request-sent"
      >
        Merci, votre demande a bien été envoyée. L’entreprise vous recontacte rapidement.
      </p>
    );
  }

  return (
    <form className="mt-4 space-y-3" onSubmit={submit} data-testid="facture-site-request-form">
      {forms.length > 1 && (
        <label className="block text-sm font-medium">
          Objet
          <select
            className={field}
            value={kind}
            onChange={(e) => setKind(e.target.value as FactureRequestKind)}
          >
            {forms.map((k) => (
              <option key={k} value={k}>
                {FACTURE_REQUEST_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
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
      {services.length > 0 && kind !== 'CONTACT' && (
        <label className="block text-sm font-medium">
          Prestation
          <select className={field} {...set('serviceItemId')}>
            <option value="">—</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {(kind === 'APPOINTMENT' || kind === 'INTERVENTION') && (
        <label className="block text-sm font-medium">
          Date souhaitée
          <input className={field} type="date" {...set('preferredDate')} />
        </label>
      )}
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
      {/* Champ piège : invisible pour une personne, rempli par les robots. */}
      <input
        type="text"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="hidden"
        {...set('website')}
      />
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
