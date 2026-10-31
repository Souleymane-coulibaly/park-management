'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { Alert, ApiErrorAlert } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';

/**
 * Double authentification : enrôlement (code QR à scanner avec une application d'authentification,
 * confirmation par un premier code, codes de secours affichés une seule fois) ou vérification
 * (code à 6 chiffres ou code de secours).
 */
export function MfaForm({
  enrolled,
  account,
  home = '/admin',
}: {
  enrolled: boolean;
  account: string;
  home?: string;
}) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (setup)
      QRCode.toDataURL(setup.otpauthUri, { margin: 1, width: 220 })
        .then(setQr)
        .catch(() => setQr(null));
  }, [setup]);

  const fail = (e: unknown) =>
    setError(
      e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion au serveur impossible.'),
    );

  async function start() {
    setLoading(true);
    setError(null);
    try {
      setSetup(
        await api<{ secret: string; otpauthUri: string }>('/auth/mfa/setup', { method: 'POST' }),
      );
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (!enrolled) {
        const res = await api<{ recoveryCodes: string[] }>('/auth/mfa/enable', {
          method: 'POST',
          body: { code },
        });
        setRecoveryCodes(res.recoveryCodes);
      } else {
        await api('/auth/mfa/verify', {
          method: 'POST',
          body: useRecovery ? { recoveryCode: code.trim() } : { code },
        });
        router.replace(home);
        router.refresh();
      }
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }

  if (recoveryCodes) {
    return (
      <div className="space-y-5">
        <h1 className="text-3xl font-bold">Codes de secours</h1>
        <Alert tone="info" title="À conserver en lieu sûr — affichés une seule fois">
          Chaque code permet une connexion si vous perdez votre téléphone. Ne les partagez avec
          personne.
        </Alert>
        <ul className="grid grid-cols-2 gap-2 font-mono text-lg" data-testid="mfa-recovery-codes">
          {recoveryCodes.map((c) => (
            <li key={c} className="rounded-lg bg-ivory px-3 py-2 text-center">
              {c}
            </li>
          ))}
        </ul>
        <Button
          className="w-full"
          onClick={() => {
            router.replace(home);
            router.refresh();
          }}
        >
          J’ai conservé mes codes, continuer
        </Button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-bold">Double authentification</h1>
      <p className="mt-2 text-muted">
        {enrolled
          ? 'Saisissez le code à 6 chiffres affiché par votre application d’authentification.'
          : 'Obligatoire pour les comptes de gestion Ocall : protégez votre compte avec une application d’authentification (Google Authenticator, Microsoft Authenticator, FreeOTP…).'}
      </p>
      <div className="mt-8 space-y-5">
        <ApiErrorAlert error={error} />
        {!enrolled && !setup && (
          <Button
            icon={<ShieldCheck className="h-4 w-4" />}
            loading={loading}
            onClick={start}
            className="w-full"
          >
            Activer la double authentification
          </Button>
        )}
        {!enrolled && setup && (
          <div className="space-y-3 rounded-2xl border border-line p-4">
            <p className="text-sm">1. Scannez ce code avec votre application ({account}) :</p>
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qr}
                alt="Code QR de configuration de la double authentification"
                width={220}
                height={220}
                className="mx-auto"
              />
            ) : null}
            <p className="text-sm text-muted">
              Ou saisissez la clé : <code className="break-all font-mono">{setup.secret}</code>
            </p>
            <p className="text-sm">2. Saisissez le premier code affiché :</p>
          </div>
        )}
        {(enrolled || setup) && (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <InputField
              label={useRecovery ? 'Code de secours' : 'Code à 6 chiffres'}
              inputMode={useRecovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              value={code}
              onChange={(e) =>
                setCode(
                  useRecovery ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6),
                )
              }
            />
            <Button
              type="submit"
              loading={loading}
              className="w-full"
              icon={<KeyRound className="h-4 w-4" />}
            >
              {enrolled ? 'Vérifier' : 'Confirmer et activer'}
            </Button>
            {enrolled && (
              <button
                type="button"
                className="text-sm font-semibold text-forest underline"
                onClick={() => {
                  setUseRecovery(!useRecovery);
                  setCode('');
                }}
              >
                {useRecovery ? 'Utiliser un code de l’application' : 'Utiliser un code de secours'}
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
