'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, Handshake, Store } from 'lucide-react';
import { PARTNER_COUNTRIES, type PartnerType } from '@ocall/shared';
import { Button } from '@/components/ui/button';
import { InputField, SelectField } from '@/components/ui/field';
import { ApiErrorAlert } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';

const TEXTAREA =
  'w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm focus:border-suite-green focus:outline-none focus:ring-2 focus:ring-suite-green/30';

const TYPES: { value: PartnerType; title: string; text: string; icon: typeof Handshake }[] = [
  {
    value: 'REFERRER',
    title: 'Apporteur d’affaires',
    text: 'Vous recommandez Ocall à votre réseau et percevez une commission sur les ventes conclues.',
    icon: Handshake,
  },
  {
    value: 'RESELLER',
    title: 'Revendeur agréé',
    text: 'Vous prospectez, accompagnez vos clients et suivez votre portefeuille commercial.',
    icon: Store,
  },
];

/**
 * Candidature Ocall Partner (Sprint S3). Champs validés ici et par le serveur ; anti-spam sans service
 * tiers (champ piège, délai minimal), limite par IP. La candidature ne crée aucun compte : Ocall
 * l'examine puis envoie une invitation.
 */
export function PartnerApplicationForm() {
  const [startedAt, setStartedAt] = useState(0);
  const [form, setForm] = useState({
    type: 'REFERRER' as PartnerType,
    firstName: '',
    lastName: '',
    company: '',
    email: '',
    country: 'ML',
    phone: '+223 ',
    city: '',
    experience: '',
    targetSectors: '',
    motivation: '',
    consent: false,
    website: '',
  });
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => setStartedAt(Date.now()), []);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const country = PARTNER_COUNTRIES.find((c) => c.code === form.country)!;

  function changeCountry(code: string) {
    const next = PARTNER_COUNTRIES.find((c) => c.code === code)!;
    // Indicatif pré-rempli tant que le numéro n'a pas été saisi.
    const untouched = PARTNER_COUNTRIES.some((c) => form.phone.trim() === c.dial);
    set({ country: code, ...(untouched ? { phone: `${next.dial} ` } : {}) });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api('/public/partners/applications', {
        method: 'POST',
        body: {
          type: form.type,
          firstName: form.firstName,
          lastName: form.lastName,
          ...(form.company.trim() ? { company: form.company } : {}),
          email: form.email,
          phone: form.phone,
          country: country.name,
          city: form.city,
          experience: form.experience,
          targetSectors: form.targetSectors,
          motivation: form.motivation,
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
      <div
        className="flex flex-col items-center gap-3 py-8 text-center"
        role="status"
        data-testid="partner-application-done"
      >
        <CheckCircle2 className="h-12 w-12 text-suite-green" aria-hidden />
        <h2 className="font-display text-2xl font-extrabold text-suite-ink">Candidature envoyée</h2>
        <p className="max-w-md text-suite-ink-soft">
          Merci. L’équipe Ocall examine votre candidature et vous recontacte. Si elle est retenue,
          vous recevrez une invitation pour créer votre espace partenaire.
        </p>
      </div>
    );
  }

  return (
    <form className="relative space-y-5" onSubmit={submit} data-testid="partner-application-form">
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-suite-ink">Type de partenariat</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {TYPES.map((t) => (
            <label
              key={t.value}
              className={`flex cursor-pointer gap-3 rounded-2xl border p-4 transition ${
                form.type === t.value
                  ? 'border-suite-green bg-suite-green-soft'
                  : 'border-line bg-surface hover:border-suite-green/50'
              }`}
            >
              <input
                type="radio"
                name="partner-type"
                value={t.value}
                checked={form.type === t.value}
                onChange={() => set({ type: t.value })}
                className="mt-1 accent-suite-green"
              />
              <span>
                <span className="flex items-center gap-2 font-semibold text-suite-ink">
                  <t.icon className="h-4 w-4 text-suite-green" aria-hidden /> {t.title}
                </span>
                <span className="mt-1 block text-sm text-suite-ink-soft">{t.text}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <InputField
          label="Prénom"
          required
          minLength={2}
          maxLength={40}
          autoComplete="given-name"
          value={form.firstName}
          onChange={(e) => set({ firstName: e.target.value })}
        />
        <InputField
          label="Nom"
          required
          minLength={2}
          maxLength={40}
          autoComplete="family-name"
          value={form.lastName}
          onChange={(e) => set({ lastName: e.target.value })}
        />
        <InputField
          label="Entreprise (facultatif)"
          maxLength={120}
          autoComplete="organization"
          value={form.company}
          onChange={(e) => set({ company: e.target.value })}
        />
        <InputField
          label="E-mail"
          type="email"
          required
          maxLength={160}
          autoComplete="email"
          value={form.email}
          onChange={(e) => set({ email: e.target.value })}
        />
        <SelectField
          label="Pays d’activité"
          value={form.country}
          onChange={(e) => changeCountry(e.target.value)}
          options={PARTNER_COUNTRIES.map((c) => ({ value: c.code, label: c.name }))}
        />
        <InputField
          label="Ville"
          required
          minLength={2}
          maxLength={80}
          value={form.city}
          onChange={(e) => set({ city: e.target.value })}
        />
        <InputField
          label="Téléphone (avec indicatif)"
          type="tel"
          required
          pattern="\+[0-9][0-9 ().-]{6,22}"
          title="Numéro au format international, par exemple +223 70 00 00 00"
          autoComplete="tel"
          value={form.phone}
          onChange={(e) => set({ phone: e.target.value })}
        />
      </div>
      {(
        [
          [
            'experience',
            'Expérience commerciale',
            'Vos expériences de vente, votre réseau…',
            10,
            1500,
            3,
          ],
          [
            'targetSectors',
            'Secteurs ou types de clients ciblés',
            'Écoles privées, parcs de loisirs, restaurants…',
            3,
            500,
            2,
          ],
          [
            'motivation',
            'Motivation',
            'Pourquoi souhaitez-vous devenir partenaire Ocall ?',
            20,
            2000,
            4,
          ],
        ] as const
      ).map(([key, label, placeholder, min, max, rows]) => (
        <div key={key}>
          <label htmlFor={`partner-${key}`} className="mb-1 block text-sm font-medium">
            {label}
          </label>
          <textarea
            id={`partner-${key}`}
            required
            minLength={min}
            maxLength={max}
            rows={rows}
            className={TEXTAREA}
            placeholder={placeholder}
            value={form[key]}
            onChange={(e) => set({ [key]: e.target.value } as Partial<typeof form>)}
          />
        </div>
      ))}
      {/* Champ piège : invisible pour les personnes, rempli par les robots. */}
      <div className="absolute -left-[10000px] h-px w-px overflow-hidden" aria-hidden>
        <label>
          Site web
          <input
            tabIndex={-1}
            autoComplete="off"
            value={form.website}
            onChange={(e) => set({ website: e.target.value })}
          />
        </label>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          required
          className="mt-0.5 h-5 w-5 accent-suite-green"
          checked={form.consent}
          onChange={(e) => set({ consent: e.target.checked })}
        />
        <span>
          J’accepte qu’Ocall traite ces informations pour examiner ma candidature, conformément à la{' '}
          <Link href="/confidentialite" className="underline">
            politique de confidentialité
          </Link>
          . Aucune pièce d’identité n’est demandée à ce stade. Candidature non retenue :
          conservation 24 mois au plus, puis anonymisation.
        </span>
      </label>
      <ApiErrorAlert error={error} />
      <Button type="submit" loading={saving} disabled={!form.consent}>
        Envoyer ma candidature
      </Button>
    </form>
  );
}
