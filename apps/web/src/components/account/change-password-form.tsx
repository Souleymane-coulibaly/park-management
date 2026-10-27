'use client';

import { type FormEvent, useState } from 'react';
import { passwordPolicyErrors } from '@ocall/shared';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { ApiErrorAlert } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';

/** Formulaire de changement de mot de passe, partagé par l'écran imposé et la page Compte. */
export function ChangePasswordForm({
  onDone,
  submitLabel = 'Changer le mot de passe',
}: {
  onDone: () => void;
  submitLabel?: string;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const policy = next ? passwordPolicyErrors(next) : [];
  const mismatch = confirm.length > 0 && confirm !== next;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      });
      setCurrent('');
      setNext('');
      setConfirm('');
      onDone();
    } catch (e) {
      setError(
        e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion au serveur impossible.'),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <ApiErrorAlert error={error} />
      <InputField
        label="Mot de passe actuel"
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        required
      />
      <InputField
        label="Nouveau mot de passe"
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        hint="10 caractères minimum, avec une majuscule, une minuscule et un chiffre."
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
        loading={loading}
        disabled={!current || !next || policy.length > 0 || confirm !== next}
      >
        {submitLabel}
      </Button>
    </form>
  );
}
