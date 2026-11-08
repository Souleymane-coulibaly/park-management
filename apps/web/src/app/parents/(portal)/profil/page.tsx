'use client';

import { type FormEvent, useState } from 'react';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import type { Me } from '@/lib/types';
import { useApi } from '@/lib/use-api';

/** Profil du responsable : nom, identifiant de connexion, changement de mot de passe. */
export default function ParentProfilePage() {
  const me = useApi<Me>('/auth/me');
  if (me.state === 'loading') return <LoadingState />;
  if (me.state === 'error') return <ErrorState error={me.error} onRetry={me.reload} />;
  return (
    <>
      <Identity me={me.data} />
      <Password />
    </>
  );
}

function Identity({ me }: { me: Me }) {
  const { t } = useSchoolText();
  const [firstName, setFirst] = useState(me.user.firstName);
  const [lastName, setLast] = useState(me.user.lastName);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await api('/auth/me', { method: 'PATCH', body: { firstName, lastName } });
      setSaved(true);
    } catch (e) {
      setError(toApiError(e));
    }
  }

  return (
    <Card>
      <CardBody>
        <h2 className="mb-2 font-semibold">{t('par.profile.identity')}</h2>
        <p className="mb-3 text-sm">
          {t('par.profile.loginId')} : <strong dir="ltr">{me.user.loginId}</strong>
        </p>
        <form className="space-y-3" onSubmit={(e) => void save(e)}>
          {saved && <Alert tone="success" title={t('par.profile.saved')} />}
          <ApiErrorAlert error={error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <InputField
              label={t('par.profile.firstName')}
              value={firstName}
              required
              onChange={(e) => setFirst(e.target.value)}
            />
            <InputField
              label={t('par.profile.lastName')}
              value={lastName}
              required
              onChange={(e) => setLast(e.target.value)}
            />
          </div>
          <Button type="submit">{t('par.profile.save')}</Button>
        </form>
      </CardBody>
    </Card>
  );
}

function Password() {
  const { t } = useSchoolText();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);

  async function change(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(false);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setDone(true);
      setCurrent('');
      setNew('');
    } catch (e) {
      setError(toApiError(e));
    }
  }

  return (
    <Card>
      <CardBody>
        <h2 className="mb-2 font-semibold">{t('par.profile.password')}</h2>
        <form className="space-y-3" onSubmit={(e) => void change(e)}>
          {done && <Alert tone="success" title={t('par.profile.changed')} />}
          <ApiErrorAlert error={error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <InputField
              label={t('par.profile.current')}
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <InputField
              label={t('par.profile.new')}
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
            />
          </div>
          <Button type="submit">{t('par.profile.change')}</Button>
        </form>
      </CardBody>
    </Card>
  );
}
