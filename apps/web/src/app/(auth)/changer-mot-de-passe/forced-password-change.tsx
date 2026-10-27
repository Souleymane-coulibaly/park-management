'use client';

import { useRouter } from 'next/navigation';
import { ChangePasswordForm } from '@/components/account/change-password-form';
import { Alert } from '@/components/ui/states';

export function ForcedPasswordChange({
  firstName,
  loginId,
  destination,
}: {
  firstName: string;
  loginId: string;
  destination: string;
}) {
  const router = useRouter();
  return (
    <div>
      <h1 className="text-3xl font-bold">Bienvenue, {firstName}</h1>
      <p className="mt-2 text-muted">
        Votre identifiant est{' '}
        <span className="font-mono font-semibold text-charcoal">{loginId}</span>. Pour sécuriser
        votre compte, remplacez le mot de passe temporaire qui vous a été remis.
      </p>
      <div className="mt-6">
        <Alert tone="info">
          Ce mot de passe est personnel : ne le partagez avec personne, pas même votre responsable.
        </Alert>
      </div>
      <div className="mt-6">
        <ChangePasswordForm
          submitLabel="Enregistrer et continuer"
          onDone={() => {
            router.replace(destination);
            router.refresh();
          }}
        />
      </div>
    </div>
  );
}
