'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import { passwordPolicyErrors } from '@ocall/shared';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { Alert, ApiErrorAlert } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const policy = password ? passwordPolicyErrors(password) : [];
  const mismatch = confirm.length > 0 && confirm !== password;

  if (!token) {
    return (
      <Alert tone="error" title="Lien invalide">
        Ce lien de réinitialisation est incomplet. Faites une nouvelle demande.
      </Alert>
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api('/auth/password-reset/confirm', {
        method: 'POST',
        body: { token, newPassword: password },
      });
      router.replace('/connexion?reinitialise=1');
    } catch (e) {
      setError(
        e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion au serveur impossible.'),
      );
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-5">
      <ApiErrorAlert error={error} />
      <InputField
        label="Nouveau mot de passe"
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
        Enregistrer le mot de passe
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold">Nouveau mot de passe</h1>
      <p className="mt-2 text-muted">Toutes vos sessions ouvertes seront fermées.</p>
      <Suspense>
        <ResetForm />
      </Suspense>
      <p className="mt-8 text-center text-sm">
        <Link href="/connexion" className="font-semibold text-forest hover:underline">
          Retour à la connexion
        </Link>
      </p>
    </div>
  );
}
