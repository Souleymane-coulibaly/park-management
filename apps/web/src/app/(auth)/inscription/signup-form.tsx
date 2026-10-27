'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import {
  BUSINESS_TYPES,
  type BusinessType,
  SUPPORTED_COUNTRIES,
  passwordPolicyErrors,
} from '@ocall/shared';
import { BUSINESS_PRESENTATION } from '@/components/public/business-cards';
import { Button } from '@/components/ui/button';
import { InputField, SelectField } from '@/components/ui/field';
import { ApiErrorAlert } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';

export function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const initialType = BUSINESS_TYPES.find((t) => t === params.get('metier')) ?? 'PARK';
  const [form, setForm] = useState({
    businessType: initialType as BusinessType,
    organizationName: '',
    establishmentName: '',
    countryCode: 'ML',
    firstName: '',
    lastName: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const passwordErrors = form.password ? passwordPolicyErrors(form.password) : [];

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api('/auth/signup', { method: 'POST', body: form });
      router.replace('/app');
      router.refresh();
    } catch (e) {
      setError(
        e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion au serveur impossible.'),
      );
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-3xl font-bold">Créer votre organisation</h1>
      <p className="mt-2 text-muted">
        Vous serez propriétaire du compte et pourrez ensuite inviter votre équipe.
      </p>
      <form onSubmit={onSubmit} className="mt-8 space-y-6" noValidate>
        <ApiErrorAlert error={error} />

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Votre métier</legend>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
            {BUSINESS_TYPES.map((type) => {
              const b = BUSINESS_PRESENTATION[type];
              const selected = form.businessType === type;
              return (
                <label
                  key={type}
                  className={`flex cursor-pointer flex-col items-start gap-2 rounded-xl border p-3 text-sm transition-colors ${selected ? 'border-forest bg-forest-light/60 ring-1 ring-forest' : 'border-line bg-surface hover:border-forest/40'}`}
                >
                  <input
                    type="radio"
                    name="businessType"
                    value={type}
                    checked={selected}
                    onChange={set('businessType')}
                    className="sr-only"
                  />
                  <span className={`grid h-9 w-9 place-items-center rounded-lg ${b.accent}`}>
                    {b.icon}
                  </span>
                  <span className="font-semibold">{b.title}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <InputField
            label="Nom commercial"
            value={form.organizationName}
            onChange={set('organizationName')}
            required
            autoComplete="organization"
          />
          <SelectField
            label="Pays"
            value={form.countryCode}
            onChange={set('countryCode')}
            options={SUPPORTED_COUNTRIES.map((c) => ({ value: c.code, label: c.label }))}
            required
          />
        </div>
        <InputField
          label="Premier établissement"
          hint="Par exemple : Aqua Splash — ACI 2000. Vous pourrez en ajouter d’autres."
          value={form.establishmentName}
          onChange={set('establishmentName')}
          required
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <InputField
            label="Prénom"
            value={form.firstName}
            onChange={set('firstName')}
            required
            autoComplete="given-name"
          />
          <InputField
            label="Nom"
            value={form.lastName}
            onChange={set('lastName')}
            required
            autoComplete="family-name"
          />
        </div>
        <InputField
          label="E-mail professionnel"
          type="email"
          value={form.email}
          onChange={set('email')}
          required
          autoComplete="email"
        />
        <InputField
          label="Mot de passe"
          type="password"
          value={form.password}
          onChange={set('password')}
          required
          autoComplete="new-password"
          hint="10 caractères minimum, avec une majuscule, une minuscule et un chiffre."
          error={passwordErrors.length > 0 ? passwordErrors.join(' ') : undefined}
        />
        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={loading}
          disabled={passwordErrors.length > 0}
        >
          Créer mon organisation <ArrowRight className="h-4 w-4" />
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-muted">
        Déjà un compte ?{' '}
        <Link href="/connexion" className="font-semibold text-forest hover:underline">
          Se connecter
        </Link>
      </p>
    </div>
  );
}
