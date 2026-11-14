'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { ArrowLeft, MapPin } from 'lucide-react';
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  type BusinessType,
  ESTABLISHMENT_KINDS,
  ESTABLISHMENT_KIND_LABELS,
  type EstablishmentKind,
  type SiteUsage,
  isCompatibleBusinessType,
} from '@ocall/shared';
import { SuiteShell } from '@/components/suite/suite-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { SimpleForm } from '@/components/ui/simple-form';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface RegistrySiteView {
  id: string;
  name: string;
  businessType: BusinessType;
  kind: EstablishmentKind | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  brandId: string | null;
  brand: { name: string } | null;
  applications: SiteUsage[];
}

interface BrandView {
  id: string;
  name: string;
  isActive: boolean;
  _count: { establishments: number };
}

const KIND_OPTIONS = [
  { value: '', label: '—' },
  ...ESTABLISHMENT_KINDS.map((k) => ({ value: k, label: ESTABLISHMENT_KIND_LABELS[k] })),
];

/**
 * Sites de l'organisation (Ocall Suite Sprint 2B) : un lieu physique (boutique, restaurant, parc, école,
 * agence…) est enregistré une seule fois ; chaque application qui l'utilise s'y rattache.
 */
export function SitesRegistry({
  canRead,
  canManage,
  businessType,
}: {
  canRead: boolean;
  canManage: boolean;
  businessType: BusinessType;
}) {
  return (
    <SuiteShell>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-10 sm:px-6">
        <Link
          href="/suite"
          className="inline-flex items-center gap-1 text-sm font-semibold text-suite-green"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Mes applications
        </Link>
        <div>
          <h1 className="font-display text-3xl font-extrabold text-suite-green">
            Sites de l’organisation
          </h1>
          <p className="mt-1 text-suite-ink-soft">
            Chaque lieu physique est enregistré une seule fois ; plusieurs applications peuvent
            l’utiliser.
          </p>
        </div>
        {canRead ? (
          <Registry canManage={canManage} businessType={businessType} />
        ) : (
          <Alert tone="info" title="Accès réservé">
            Les sites de l’organisation sont gérés par le propriétaire et les administrateurs.
          </Alert>
        )}
      </main>
    </SuiteShell>
  );
}

function Registry({ canManage, businessType }: { canManage: boolean; businessType: BusinessType }) {
  const sites = useApi<RegistrySiteView[]>('/establishments/registry');
  const brands = useApi<BrandView[]>('/establishments/brands');
  const [editing, setEditing] = useState<RegistrySiteView | 'new' | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const activeBrands = brands.state === 'success' ? brands.data.filter((b) => b.isActive) : [];

  async function toggle(site: RegistrySiteView) {
    setError(null);
    try {
      await api(`/establishments/${site.id}`, {
        method: 'PATCH',
        body: { isActive: !site.isActive },
      });
      sites.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    }
  }

  return (
    <>
      <ApiErrorAlert error={error} />
      {sites.state === 'loading' && <LoadingState />}
      {sites.state === 'error' && <ErrorState error={sites.error} onRetry={sites.reload} />}
      {sites.state === 'success' && (
        <ul className="grid gap-4 sm:grid-cols-2" data-testid="suite-sites">
          {sites.data.length === 0 && (
            <li className="text-sm text-suite-ink-soft">Aucun site pour l’instant.</li>
          )}
          {sites.data.map((s) => (
            <li
              key={s.id}
              className={`min-w-0 rounded-2xl border border-suite-ink/10 bg-white p-5 ${s.isActive ? '' : 'opacity-60'}`}
              data-testid="suite-site"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words font-semibold text-suite-ink">{s.name}</p>
                  <p className="text-xs text-suite-ink-soft">
                    {[
                      s.kind ? ESTABLISHMENT_KIND_LABELS[s.kind] : null,
                      s.brand?.name ? `Enseigne : ${s.brand.name}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Nature non précisée'}
                  </p>
                  {s.city && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-suite-ink-soft">
                      <MapPin className="h-3 w-3" aria-hidden /> {s.city}
                    </p>
                  )}
                </div>
                {!s.isActive && <Badge>Désactivé</Badge>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2" data-testid="suite-site-apps">
                {s.applications.length === 0 ? (
                  <span className="text-xs text-suite-ink-soft">Aucune application</span>
                ) : (
                  s.applications.map((a) => (
                    <Badge key={`${a.product}-${a.appSiteId ?? s.id}`} tone="forest">
                      {a.label}
                    </Badge>
                  ))
                )}
              </div>
              {canManage && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>
                    Modifier
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void toggle(s)}>
                    {s.isActive ? 'Désactiver' : 'Réactiver'}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && editing && (
        <SiteForm
          key={editing === 'new' ? 'new' : editing.id}
          site={editing === 'new' ? null : editing}
          businessType={businessType}
          brands={activeBrands}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            sites.reload();
          }}
        />
      )}
      {canManage && !editing && <Button onClick={() => setEditing('new')}>Ajouter un site</Button>}
      <Brands canManage={canManage} brands={brands} />
    </>
  );
}

function SiteForm({
  site,
  businessType,
  brands,
  onClose,
  onSaved,
}: {
  site: RegistrySiteView | null;
  businessType: BusinessType;
  brands: BrandView[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Activité Park : seulement celles que couvre le métier de l'organisation ; « Aucune » pour un lieu
  // utilisé par d'autres applications (boutique, école, agence…).
  const activities: BusinessType[] = [
    'NONE',
    ...BUSINESS_TYPES.filter((t) => isCompatibleBusinessType(businessType, t)),
  ];
  const [form, setForm] = useState({
    name: site?.name ?? '',
    kind: site?.kind ?? '',
    businessType: site?.businessType ?? ('NONE' as BusinessType),
    city: site?.city ?? '',
    address: site?.address ?? '',
    phone: site?.phone ?? '',
    brandId: site?.brandId ?? '',
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      name: form.name,
      businessType: form.businessType,
      kind: form.kind || null,
      brandId: form.brandId || null,
      city: form.city || undefined,
      address: form.address || undefined,
      phone: form.phone || undefined,
    };
    try {
      if (site) await api(`/establishments/${site.id}`, { method: 'PATCH', body });
      else await api('/establishments', { method: 'POST', body });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title={site ? `Modifier ${site.name}` : 'Nouveau site'} />
      <CardBody>
        <form onSubmit={submit} className="space-y-4" data-testid="suite-site-form">
          <ApiErrorAlert error={error} />
          <InputField label="Nom du site" value={form.name} onChange={set('name')} required />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Nature du lieu"
              value={form.kind}
              onChange={set('kind')}
              options={KIND_OPTIONS}
            />
            <SelectField
              label="Activité Ocall Park"
              value={form.businessType}
              onChange={set('businessType')}
              options={activities.map((t) => ({
                value: t,
                label: t === 'NONE' ? 'Aucune (autres applications)' : BUSINESS_TYPE_LABELS[t],
              }))}
            />
            <SelectField
              label="Enseigne"
              value={form.brandId}
              onChange={set('brandId')}
              options={[
                { value: '', label: 'Aucune' },
                ...brands.map((b) => ({ value: b.id, label: b.name })),
              ]}
            />
            <InputField label="Ville" value={form.city} onChange={set('city')} />
            <InputField label="Adresse" value={form.address} onChange={set('address')} />
            <InputField label="Téléphone" value={form.phone} onChange={set('phone')} />
          </div>
          <div className="flex gap-3">
            <Button type="submit" loading={saving}>
              Enregistrer
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Annuler
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function Brands({
  canManage,
  brands,
}: {
  canManage: boolean;
  brands: ReturnType<typeof useApi<BrandView[]>>;
}) {
  return (
    <Card>
      <CardHeader
        title="Enseignes"
        description="Marques ou activités commerciales de l’organisation ; un site peut être rattaché à une enseigne."
      />
      <CardBody className="space-y-4">
        {brands.state === 'success' && (
          <ul className="flex flex-wrap gap-2" data-testid="suite-brands">
            {brands.data.length === 0 && (
              <li className="text-sm text-suite-ink-soft">Aucune enseigne.</li>
            )}
            {brands.data.map((b) => (
              <li key={b.id}>
                <Badge tone={b.isActive ? 'forest' : 'neutral'}>
                  {b.name} · {b._count.establishments} site{b._count.establishments > 1 ? 's' : ''}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <SimpleForm
            testId="suite-brand-form"
            path="/establishments/brands"
            submitLabel="Ajouter l’enseigne"
            fields={[{ name: 'name', label: 'Nom de l’enseigne', required: true }]}
            onDone={() => brands.reload()}
          />
        )}
      </CardBody>
    </Card>
  );
}
