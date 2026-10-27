'use client';

import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Save } from 'lucide-react';
import { BUSINESS_TYPE_LABELS, SUPPORTED_COUNTRIES, canChangeBusinessType } from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { Organization } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function OrganisationPage() {
  const canRead = useCan('organization.read');
  const canUpdate = useCan('organization.update');
  const canChangeType = useCan('organization.change_business_type');
  const org = useApi<Organization>(canRead ? '/organization' : null);

  if (!canRead) return <AccessDenied />;
  if (org.state === 'loading') return <LoadingState />;
  if (org.state === 'error') return <ErrorState error={org.error} onRetry={org.reload} />;

  const o = org.data;
  const country = SUPPORTED_COUNTRIES.find((c) => c.code === o.countryCode)?.label ?? o.countryCode;
  return (
    <>
      <PageHeader
        title="Organisation"
        description="Informations générales de votre organisation."
      />
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader title="Informations" />
          <CardBody>
            {canUpdate ? (
              <OrganizationForm org={o} onSaved={org.reload} />
            ) : (
              <OrganizationDetails org={o} />
            )}
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Identité" />
            <CardBody>
              <dl className="space-y-3 text-sm">
                <Row
                  label="Code organisation"
                  value={<span className="font-mono font-semibold">{o.code}</span>}
                />
                <Row label="Pays" value={country} />
                <Row label="Devise" value={`${o.currency} (FCFA)`} />
                <Row
                  label="Statut"
                  value={
                    <Badge tone={o.status === 'ACTIVE' ? 'forest' : 'terracotta'}>
                      {o.status === 'ACTIVE' ? 'Active' : 'Suspendue'}
                    </Badge>
                  }
                />
                <Row label="Créée le" value={formatDate(o.createdAt)} />
              </dl>
            </CardBody>
          </Card>
          <BusinessTypeCard org={o} canChange={canChangeType} onChanged={org.reload} />
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function OrganizationDetails({ org }: { org: Organization }) {
  return (
    <dl className="space-y-3 text-sm">
      <Row label="Nom commercial" value={org.name} />
      <Row label="Fuseau horaire" value={org.timezone} />
    </dl>
  );
}

function OrganizationForm({ org, onSaved }: { org: Organization; onSaved: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(org.name);
  const [timezone, setTimezone] = useState(org.timezone);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => setSaved(false), [name, timezone]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api('/organization', { method: 'PATCH', body: { name, timezone } });
      setSaved(true);
      onSaved();
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <ApiErrorAlert error={error} />
      {saved && <Alert tone="success">Modifications enregistrées.</Alert>}
      <InputField
        label="Nom commercial"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <InputField
        label="Fuseau horaire"
        value={timezone}
        onChange={(e) => setTimezone(e.target.value)}
        hint="Format IANA, par exemple Africa/Bamako."
        required
      />
      <Button type="submit" loading={loading} icon={<Save className="h-4 w-4" />}>
        Enregistrer
      </Button>
    </form>
  );
}

/** Évolution vers Parc + Restaurant : réservée au propriétaire, sans perte de données. */
function BusinessTypeCard({
  org,
  canChange,
  onChanged,
}: {
  org: Organization;
  canChange: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const upgradable = canChangeBusinessType(org.businessType, 'PARK_RESTAURANT');

  async function confirm() {
    setLoading(true);
    setError(null);
    try {
      await api('/organization/business-type', {
        method: 'POST',
        body: { businessType: 'PARK_RESTAURANT' },
      });
      setOpen(false);
      onChanged();
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Métier" description="Détermine vos modules et votre offre." />
      <CardBody>
        <p className="font-display text-xl font-bold">{BUSINESS_TYPE_LABELS[org.businessType]}</p>
        {upgradable && canChange && (
          <>
            <p className="mt-2 text-sm text-muted">
              Vous lancez la seconde activité ? Passez à Parc + Restaurant. Vos données sont
              conservées.
            </p>
            <Button
              variant="accent"
              size="sm"
              className="mt-4"
              onClick={() => setOpen(true)}
              icon={<ArrowUpRight className="h-4 w-4" />}
            >
              Passer à Parc + Restaurant
            </Button>
          </>
        )}
        {upgradable && !canChange && (
          <p className="mt-2 text-sm text-muted">
            Seul un propriétaire peut faire évoluer le métier.
          </p>
        )}
      </CardBody>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Passer à Parc + Restaurant ?"
        description="Vos établissements, employés et historique sont conservés."
      >
        <div className="space-y-4">
          <ApiErrorAlert error={error} />
          <Alert tone="info">
            Votre abonnement basculera sur l’offre Parc + Restaurant. Le changement est enregistré
            dans l’historique de l’abonnement.
          </Alert>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button onClick={confirm} loading={loading}>
              Confirmer
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}
