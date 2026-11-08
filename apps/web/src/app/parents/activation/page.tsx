'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useEffect, useState } from 'react';
import type { SchoolLocale } from '@ocall/shared';
import { SchoolLanguage, toApiError, useSchoolText } from '@/components/school/school-language';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';

type Check =
  | { status: 'INVALID' | 'EXPIRED' | 'USED' | 'REVOKED' }
  | {
      status: 'PENDING';
      firstName: string;
      school: { name: string; nameAr: string | null; defaultLocale: SchoolLocale };
      existingAccount: boolean;
    };

/**
 * Activation du compte parent par le lien d'invitation (page publique). Le lien n'est vérifié qu'ici,
 * sans être consommé ; l'activation le consomme une seule fois.
 */
export default function ActivationPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Activation />
    </Suspense>
  );
}

function Activation() {
  const token = useSearchParams().get('token') ?? '';
  const [check, setCheck] = useState<Check | null>(null);
  useEffect(() => {
    if (token.length < 20) {
      setCheck({ status: 'INVALID' });
      return;
    }
    api<Check>('/school/portal/activation/check', { method: 'POST', body: { token } })
      .then(setCheck)
      .catch(() => setCheck({ status: 'INVALID' }));
  }, [token]);
  const locale = check?.status === 'PENDING' ? check.school.defaultLocale : 'FR';
  return (
    <SchoolLanguage locale={locale} className="min-h-screen bg-ivory">
      <div className="mx-auto max-w-lg px-4 py-10">
        {check === null ? <LoadingState /> : <ActivationBody check={check} token={token} />}
      </div>
    </SchoolLanguage>
  );
}

function ActivationBody({ check, token }: { check: Check; token: string }) {
  const { t, name } = useSchoolText();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [loginId, setLoginId] = useState<string | null>(null);

  if (check.status !== 'PENDING') {
    return <Alert tone="error" title={t(`par.act.${check.status}`)} />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ loginId: string }>('/school/portal/activation', {
        method: 'POST',
        body: { token, password },
      });
      setLoginId(res.loginId);
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <p className="text-xs font-semibold uppercase tracking-wide text-forest">Ocall School</p>
        <h1 className="mt-1 text-xl font-bold">{t('par.act.title')}</h1>
        {loginId ? (
          <div className="mt-4 space-y-3" data-testid="activation-done">
            <Alert tone="success" title={t('par.act.done', { loginId })} />
            <ButtonLink href="/connexion">{t('par.act.login')}</ButtonLink>
          </div>
        ) : (
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => void submit(e)}
            data-testid="activation-form"
          >
            <p className="text-sm">
              {t('par.act.hello', { name: check.firstName, school: name(check.school) })}
            </p>
            {check.existingAccount && <Alert tone="info" title={t('par.act.existing')} />}
            <ApiErrorAlert error={error} />
            <InputField
              label={t('par.act.password')}
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <InputField
              label={t('par.act.confirm')}
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {confirm && confirm !== password && (
              <p className="text-sm text-terracotta-dark">{t('par.act.mismatch')}</p>
            )}
            <Button
              type="submit"
              loading={loading}
              disabled={password.length < 8 || confirm !== password}
            >
              {t('par.act.submit')}
            </Button>
          </form>
        )}
        <p className="mt-6 text-xs text-muted">
          <Link href="/connexion" className="underline">
            {t('par.act.login')}
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
