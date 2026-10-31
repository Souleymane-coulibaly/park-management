'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { Alert, ApiErrorAlert } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import type { Me } from '@/lib/types';

/** Destination après connexion : changement de mot de passe imposé, espace Super Admin ou espace client. */
export function destinationFor(me: Me, requested: string | null): string {
  if (me.user.mustChangePassword) return '/changer-mot-de-passe';
  if (me.accountKind !== 'member') {
    // Comptes internes Ocall et partenaires : second facteur avant leur espace.
    if (me.mfa.required && !me.mfa.verified) return '/double-authentification';
    return me.accountKind === 'partner' ? '/partenaire' : '/admin';
  }
  return requested?.startsWith('/app') ? requested : '/app';
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const me = await api<Me>('/auth/login', { method: 'POST', body: { identifier, password } });
      router.replace(destinationFor(me, params.get('suivant')));
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
      <h1 className="text-3xl font-bold">Connexion</h1>
      <p className="mt-2 text-muted">Accédez à l’espace de gestion de votre établissement.</p>
      <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
        {params.get('expire') && !error && (
          <Alert tone="info">Votre session a expiré. Reconnectez-vous.</Alert>
        )}
        {params.get('reinitialise') && !error && (
          <Alert tone="success">Mot de passe modifié. Vous pouvez vous connecter.</Alert>
        )}
        <ApiErrorAlert error={error} />
        <InputField
          label="E-mail ou identifiant"
          hint="Les employés utilisent leur identifiant personnel, par exemple AQUASP-0002."
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          required
        />
        <InputField
          label="Mot de passe"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <div className="flex justify-end">
          <Link
            href="/mot-de-passe-oublie"
            className="text-sm font-medium text-forest hover:underline"
          >
            Mot de passe oublié ?
          </Link>
        </div>
        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={loading}
          icon={<LogIn className="h-4 w-4" />}
          disabled={!identifier || !password}
        >
          Se connecter
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-muted">
        Nouvel établissement ?{' '}
        <Link href="/inscription" className="font-semibold text-forest hover:underline">
          Créer une organisation
        </Link>
      </p>
    </div>
  );
}
