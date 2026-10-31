'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InputField, SelectField } from '@/components/ui/field';
import { ApiErrorAlert } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';

/**
 * Formulaire de demande de démonstration (Sprint 12A). Anti-spam sans service tiers : champ piège
 * invisible et délai minimal de remplissage, vérifiés par le serveur, plus une limite par IP.
 * La demande est suivie par l'équipe Ocall ; elle ne crée aucun abonnement.
 */
export function DemoForm({
  products,
  initialProduct,
}: {
  products: { slug: string; name: string }[];
  initialProduct: string;
}) {
  const [startedAt, setStartedAt] = useState(0);
  const [form, setForm] = useState({
    name: '',
    company: '',
    country: 'Mali',
    phone: '',
    email: '',
    product: products.some((p) => p.slug === initialProduct) ? initialProduct : '',
    message: '',
    consent: false,
    website: '',
  });
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => setStartedAt(Date.now()), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api('/public/suite/demo-requests', {
        method: 'POST',
        body: {
          name: form.name,
          company: form.company,
          country: form.country,
          phone: form.phone,
          email: form.email,
          ...(form.product ? { product: form.product } : {}),
          message: form.message,
          consent: form.consent,
          website: form.website,
          startedAt,
        },
      });
      setDone(true);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-forest/30 bg-forest/5 p-6" role="status">
        <CheckCircle2 className="h-8 w-8 text-forest" aria-hidden />
        <p className="mt-3 font-display text-xl font-bold">Merci, votre demande est envoyée.</p>
        <p className="mt-1 text-sm text-muted">
          Un membre de l’équipe Ocall vous recontacte par téléphone ou par e-mail.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate={false}>
      <div className="grid gap-4 sm:grid-cols-2">
        <InputField
          label="Nom et prénom"
          required
          autoComplete="name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <InputField
          label="Entreprise"
          required
          autoComplete="organization"
          value={form.company}
          onChange={(e) => setForm({ ...form, company: e.target.value })}
        />
        <InputField
          label="Pays"
          required
          autoComplete="country-name"
          value={form.country}
          onChange={(e) => setForm({ ...form, country: e.target.value })}
        />
        <InputField
          label="Téléphone"
          type="tel"
          required
          autoComplete="tel"
          placeholder="+223 …"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
        <InputField
          label="E-mail"
          type="email"
          required
          autoComplete="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <SelectField
          label="Produit souhaité"
          value={form.product}
          onChange={(e) => setForm({ ...form, product: e.target.value })}
          options={[
            { value: '', label: 'Je ne sais pas encore' },
            ...products.map((p) => ({ value: p.slug, label: p.name })),
          ]}
        />
      </div>
      <label className="block text-sm font-medium" htmlFor="demo-message">
        Message
      </label>
      <textarea
        id="demo-message"
        required
        minLength={10}
        maxLength={2000}
        rows={5}
        className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/30"
        placeholder="Votre activité, vos établissements, vos besoins…"
        value={form.message}
        onChange={(e) => setForm({ ...form, message: e.target.value })}
      />
      {/* Champ piège : invisible pour les personnes, rempli par les robots. */}
      <div className="absolute -left-[10000px] h-px w-px overflow-hidden" aria-hidden>
        <label>
          Site web
          <input
            tabIndex={-1}
            autoComplete="off"
            value={form.website}
            onChange={(e) => setForm({ ...form, website: e.target.value })}
          />
        </label>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          required
          className="mt-0.5 h-5 w-5 accent-forest"
          checked={form.consent}
          onChange={(e) => setForm({ ...form, consent: e.target.checked })}
        />
        <span>
          J’accepte qu’Ocall utilise ces informations pour me recontacter au sujet de ma demande,
          conformément à la{' '}
          <Link href="/confidentialite" className="underline">
            politique de confidentialité
          </Link>
          . Conservation : 24 mois au plus.
        </span>
      </label>
      <ApiErrorAlert error={error} />
      <Button type="submit" loading={saving} disabled={!form.consent}>
        Envoyer ma demande
      </Button>
    </form>
  );
}
