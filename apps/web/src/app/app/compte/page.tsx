'use client';

import { type FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROLE_LABELS } from '@ocall/shared';
import { ChangePasswordForm } from '@/components/account/change-password-form';
import { useSession } from '@/components/app/session-context';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';

export default function ComptePage() {
  const me = useSession();
  const router = useRouter();
  const [firstName, setFirstName] = useState(me.user.firstName);
  const [lastName, setLastName] = useState(me.user.lastName);
  const [error, setError] = useState<ApiError | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [loading, setLoading] = useState(false);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setProfileSaved(false);
    try {
      await api('/auth/me', { method: 'PATCH', body: { firstName, lastName } });
      setProfileSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Mon compte"
        description="Vos informations personnelles et votre mot de passe."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profil" />
          <CardBody>
            <dl className="mb-5 grid grid-cols-2 gap-3 rounded-xl bg-ivory/70 p-4 text-sm">
              <div>
                <dt className="text-muted">Identifiant</dt>
                <dd className="font-mono font-semibold">{me.user.loginId}</dd>
              </div>
              <div>
                <dt className="text-muted">Rôle</dt>
                <dd className="font-semibold">{me.role && ROLE_LABELS[me.role]}</dd>
              </div>
              {me.user.email && (
                <div className="col-span-2">
                  <dt className="text-muted">E-mail</dt>
                  <dd>{me.user.email}</dd>
                </div>
              )}
            </dl>
            <form onSubmit={saveProfile} className="space-y-4">
              <ApiErrorAlert error={error} />
              {profileSaved && <Alert tone="success">Profil mis à jour.</Alert>}
              <div className="grid gap-4 sm:grid-cols-2">
                <InputField
                  label="Prénom"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
                <InputField
                  label="Nom"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" loading={loading}>
                Enregistrer
              </Button>
            </form>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Mot de passe" description="Vos autres sessions seront fermées." />
          <CardBody>
            {passwordChanged && (
              <div className="mb-4">
                <Alert tone="success">Mot de passe modifié.</Alert>
              </div>
            )}
            <ChangePasswordForm onDone={() => setPasswordChanged(true)} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
