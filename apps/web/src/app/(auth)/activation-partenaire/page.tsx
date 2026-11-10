'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useEffect, useState } from 'react';
import { PARTNER_TYPE_LABELS, type PartnerType, passwordPolicyErrors } from '@ocall/shared';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';

type Check =
  | { state: 'loading' }
  | { state: 'invalid' }
  | { state: 'ready'; firstName: string; type: PartnerType };

/**
 * Création du compte partenaire depuis l'invitation d'Ocall (Sprint S3) : lien à usage unique, avec
 * expiration. La double authentification est configurée à la première connexion.
 */
function ActivationForm() {
  const token = useSearchParams().get('token');
  const [check, setCheck] = useState<Check>({ state: 'loading' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [loginId, setLoginId] = useState<string | null>(null);
  const policy = password ? passwordPolicyErrors(password) : [];
  const mismatch = confirm.length > 0 && confirm !== password;

  useEffect(() => {
    if (!token) {
      setCheck({ state: 'invalid' });
      return;
    }
    api<{ status: string; firstName: string | null; type: PartnerType | null }>(
      '/public/partners/activation/check',
      { method: 'POST', body: { token } },
    )
      .then((r) =>
        setCheck(
          r.status === 'PENDING' && r.firstName && r.type
            ? { state: 'ready', firstName: r.firstName, type: r.type }
            : { state: 'invalid' },
        ),
      )
      .catch(() => setCheck({ state: 'invalid' }));
  }, [token]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ loginId: string }>('/public/partners/activation', {
        method: 'POST',
        body: { token, password },
      });
      setLoginId(r.loginId);
    } catch (e) {
      setError(
        e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion au serveur impossible.'),
      );
    } finally {
      setLoading(false);
    }
  }

  if (check.state === 'loading') return <LoadingState />;
  if (check.state === 'invalid') {
    return (
      <Alert tone="error" title="Lien invalide ou expiré">
        Ce lien d’invitation n’est plus valable (déjà utilisé, remplacé ou expiré). Demandez une
        nouvelle invitation à l’équipe Ocall.
      </Alert>
    );
  }
  if (loginId) {
    return (
      <div className="mt-6 space-y-4" role="status" data-testid="partner-activated">
        <Alert tone="success" title="Votre espace partenaire est créé">
          Connectez-vous avec votre adresse e-mail. À la première connexion, vous configurerez la
          double authentification (application d’authentification sur votre téléphone).
        </Alert>
        <Link
          href="/connexion"
          className="inline-flex w-full justify-center rounded-xl bg-forest px-4 py-3 font-semibold text-white"
        >
          Se connecter
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-5">
      <p className="text-muted">
        Bonjour {check.firstName}, votre candidature de{' '}
        <strong>{PARTNER_TYPE_LABELS[check.type].toLowerCase()}</strong> a été retenue. Choisissez
        votre mot de passe.
      </p>
      <ApiErrorAlert error={error} />
      <InputField
        label="Mot de passe"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={policy.length ? policy.join(' ') : undefined}
        required
      />
      <InputField
        label="Confirmation"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={mismatch ? 'Les mots de passe ne correspondent pas.' : undefined}
        required
      />
      <Button
        type="submit"
        size="lg"
        className="w-full"
        loading={loading}
        disabled={!password || policy.length > 0 || confirm !== password}
      >
        Créer mon espace partenaire
      </Button>
    </form>
  );
}

export default function PartnerActivationPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold">Espace partenaire Ocall</h1>
      <Suspense>
        <ActivationForm />
      </Suspense>
    </div>
  );
}
