'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { Alert, ApiErrorAlert } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api('/auth/password-reset/request', { method: 'POST', body: { identifier } });
      setSent(true);
    } catch (e) {
      setError(
        e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion au serveur impossible.'),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-3xl font-bold">Mot de passe oublié</h1>
      <p className="mt-2 text-muted">Saisissez votre e-mail ou votre identifiant.</p>
      {sent ? (
        <div className="mt-8 space-y-4">
          <Alert tone="success" title="Demande enregistrée">
            Si un compte avec e-mail correspond, un lien de réinitialisation valable 30 minutes lui
            a été envoyé.
          </Alert>
          <Alert tone="info">
            Employé sans e-mail ? Demandez à votre responsable de réinitialiser votre mot de passe
            depuis la gestion des employés.
          </Alert>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-5">
          <ApiErrorAlert error={error} />
          <InputField
            label="E-mail ou identifiant"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            autoComplete="username"
          />
          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={loading}
            disabled={!identifier}
          >
            Envoyer le lien
          </Button>
        </form>
      )}
      <p className="mt-8 text-center text-sm">
        <Link href="/connexion" className="font-semibold text-forest hover:underline">
          Retour à la connexion
        </Link>
      </p>
    </div>
  );
}
