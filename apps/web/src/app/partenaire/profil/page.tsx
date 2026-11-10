'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { PARTNER_TYPE_LABELS, type PartnerType } from '@ocall/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface Profile {
  code: string;
  type: PartnerType;
  companyName: string;
  contactName: string;
  email: string | null;
  phone: string;
  country: string;
  city: string | null;
}

/**
 * Profil du partenaire (Sprint S3) : coordonnées modifiables par lui-même. Le statut, le type de
 * partenariat et les taux de commission relèvent d'Ocall.
 */
export default function PartnerProfilePage() {
  const profile = useApi<Profile>('/partner/profile');
  const [form, setForm] = useState({ companyName: '', phone: '', city: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (profile.state === 'success') {
      setForm({
        companyName: profile.data.companyName,
        phone: profile.data.phone,
        city: profile.data.city ?? '',
      });
    }
  }, [profile.state]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api('/partner/profile', {
        method: 'PATCH',
        body: {
          companyName: form.companyName,
          phone: form.phone,
          ...(form.city.trim() ? { city: form.city.trim() } : {}),
        },
      });
      setNotice('Coordonnées enregistrées.');
      profile.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.'));
    } finally {
      setSaving(false);
    }
  }

  if (profile.state === 'loading') return <LoadingState />;
  if (profile.state === 'error')
    return <ErrorState error={profile.error} onRetry={profile.reload} />;
  const p = profile.data;
  return (
    <>
      <PageHeader eyebrow="Portail partenaire" title="Mon profil" />
      <Card className="mb-6">
        <CardHeader title="Partenariat" description="Défini par Ocall dans votre contrat." />
        <CardBody>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <dt className="text-muted">Type</dt>
            <dd>{PARTNER_TYPE_LABELS[p.type]}</dd>
            <dt className="text-muted">Code commercial</dt>
            <dd className="font-mono">{p.code}</dd>
            <dt className="text-muted">Contact</dt>
            <dd>{p.contactName}</dd>
            <dt className="text-muted">E-mail de connexion</dt>
            <dd>{p.email ?? '—'}</dd>
            <dt className="text-muted">Pays</dt>
            <dd>{p.country}</dd>
          </dl>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Mes coordonnées" />
        <CardBody>
          <form className="grid gap-3 sm:grid-cols-3" onSubmit={submit}>
            <InputField
              label="Nom ou raison sociale"
              required
              minLength={2}
              maxLength={120}
              value={form.companyName}
              onChange={(e) => setForm({ ...form, companyName: e.target.value })}
            />
            <InputField
              label="Téléphone"
              type="tel"
              required
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <InputField
              label="Ville"
              maxLength={80}
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
            <div className="sm:col-span-3">
              <ApiErrorAlert error={error} />
              {notice && (
                <p className="mb-2 text-sm text-forest" role="status">
                  {notice}
                </p>
              )}
              <Button type="submit" loading={saving}>
                Enregistrer
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </>
  );
}
