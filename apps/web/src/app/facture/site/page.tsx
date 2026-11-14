'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ExternalLink, Trash2 } from 'lucide-react';
import {
  FACTURE_REQUEST_KINDS,
  FACTURE_REQUEST_KIND_LABELS,
  type FactureRequestKind,
  type FactureSiteContent,
  type FactureSiteMediaKind,
} from '@ocall/shared';
import { FacturePage } from '@/components/facture/facture-page';
import { TextareaField } from '@/components/facture/textarea-field';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { BrandColorField } from '@/components/site/brand-color-field';
import { CheckboxGroup, InputField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api, apiUpload } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface SiteView {
  site: {
    slug: string;
    draft: FactureSiteContent;
    isOnline: boolean;
    publishedAt: string | null;
    url: string;
  } | null;
  media: { id: string; kind: FactureSiteMediaKind; caption: string | null; isPublished: boolean }[];
  domains: {
    id: string;
    hostname: string;
    status: string;
    lastError: string | null;
    verificationToken: string;
  }[];
  entitled: boolean;
}
interface CatalogItem {
  id: string;
  kind: 'PRODUCT' | 'SERVICE';
  name: string;
  isArchived: boolean;
}

const toError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.');

/** Site vitrine (F5) : adresse, contenu, prestations, images, publication, domaine personnalisé. */
export default function FactureSitePage() {
  return (
    <FacturePage
      title="Site vitrine"
      description="Votre site public : présentation, prestations, réalisations et demandes de vos clients."
    >
      {({ canWrite, context }) =>
        context.permissions.includes('facture.site.manage') ? (
          <SiteEditor editable={canWrite('facture.site.manage')} />
        ) : (
          <Alert tone="info" title="Le site vitrine est géré par le gérant." />
        )
      }
    </FacturePage>
  );
}

function SiteEditor({ editable }: { editable: boolean }) {
  const res = useApi<SiteView>('/facture/site');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      res.reload();
    } catch (err) {
      setError(toError(err));
    } finally {
      setBusy(null);
    }
  };
  if (res.state === 'loading') return <LoadingState />;
  if (res.state === 'error') return <ErrorState error={res.error} onRetry={res.reload} />;
  const v = res.data;

  if (!v.site) return <SlugCard editable={editable} onDone={res.reload} />;
  const site = v.site;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={site.isOnline ? 'Site en ligne' : 'Site hors ligne'}
          description={site.url}
          action={site.isOnline ? <Badge tone="forest">En ligne</Badge> : <Badge>Brouillon</Badge>}
        />
        <CardBody className="space-y-3">
          {!v.entitled && (
            <Alert tone="info" title="Publication réservée à l’offre « avec vitrine »">
              Préparez votre site dès maintenant ; sa mise en ligne demande l’offre Ocall Facture
              avec vitrine.
            </Alert>
          )}
          <ApiErrorAlert error={error} />
          <div className="flex flex-wrap gap-2">
            {editable && (
              <Button
                loading={busy === 'publish'}
                data-testid="facture-site-publish"
                onClick={() =>
                  void run('publish', () => api('/facture/site/publish', { method: 'POST' }))
                }
              >
                {site.isOnline ? 'Publier les modifications' : 'Mettre en ligne'}
              </Button>
            )}
            {editable && site.isOnline && (
              <Button
                variant="secondary"
                loading={busy === 'unpublish'}
                onClick={() =>
                  void run('unpublish', () => api('/facture/site/unpublish', { method: 'POST' }))
                }
              >
                Retirer de la publication
              </Button>
            )}
            {site.isOnline && (
              <a
                href={site.url}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass('ghost')}
                data-testid="facture-site-open"
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
                Voir le site
              </a>
            )}
          </div>
        </CardBody>
      </Card>
      <ContentCard draft={site.draft} editable={editable} onSaved={res.reload} />
      <MediaCard media={v.media} editable={editable} onChanged={res.reload} />
      <DomainCard domains={v.domains} editable={editable} onChanged={res.reload} />
    </div>
  );
}

function SlugCard({ editable, onDone }: { editable: boolean; onDone: () => void }) {
  const suggestion = useApi<{ slug: string }>('/facture/site/suggest-slug');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (suggestion.state === 'success' && !slug) setSlug(suggestion.data.slug);
  }, [suggestion, slug]);
  return (
    <Card>
      <CardHeader
        title="Créer votre site"
        description="Choisissez l’adresse publique de votre site (modifiable tant qu’il n’est pas en ligne)."
      />
      <CardBody>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api('/facture/site/slug', { method: 'PUT', body: { slug } });
              onDone();
            } catch (err) {
              setError(toError(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <InputField
            label="Adresse du site"
            required
            minLength={3}
            maxLength={40}
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
          />
          {editable && (
            <Button type="submit" loading={busy}>
              Créer le site
            </Button>
          )}
        </form>
        <ApiErrorAlert error={error} />
      </CardBody>
    </Card>
  );
}

function ContentCard({
  draft,
  editable,
  onSaved,
}: {
  draft: FactureSiteContent;
  editable: boolean;
  onSaved: () => void;
}) {
  const items = useApi<CatalogItem[]>('/facture/items');
  const [c, setC] = useState<FactureSiteContent>(draft);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const text = (key: keyof FactureSiteContent) => ({
    value: (c[key] as string | null) ?? '',
    disabled: !editable,
    onChange: (e: { target: { value: string } }) => {
      setSaved(false);
      setC({ ...c, [key]: e.target.value || null });
    },
  });
  const services = items.state === 'success' ? items.data.filter((i) => !i.isArchived) : [];

  return (
    <Card>
      <CardHeader
        title="Contenu"
        description="Enregistré en brouillon ; visible du public après « Publier »."
      />
      <CardBody>
        <form
          className="grid gap-4 sm:grid-cols-2"
          data-testid="facture-site-content"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api('/facture/site/draft', { method: 'PUT', body: c });
              setSaved(true);
              onSaved();
            } catch (err) {
              setError(toError(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <InputField
            label="Titre principal"
            required
            minLength={3}
            maxLength={120}
            {...text('headline')}
            value={c.headline}
          />
          <InputField label="Accroche" maxLength={200} {...text('tagline')} />
          <div className="sm:col-span-2">
            <TextareaField label="Présentation" maxLength={3000} rows={4} {...text('about')} />
          </div>
          <InputField label="Téléphone (+223 …)" {...text('phone')} />
          <InputField label="WhatsApp (+223 …)" {...text('whatsapp')} />
          <InputField label="E-mail public" type="email" {...text('email')} />
          <InputField label="Horaires" maxLength={200} {...text('hours')} />
          <InputField label="Adresse" maxLength={240} {...text('address')} />
          <InputField label="Ville" maxLength={80} {...text('city')} />
          <InputField label="Lien de carte (https)" maxLength={500} {...text('mapUrl')} />
          <InputField
            label="Description pour les moteurs de recherche"
            maxLength={300}
            {...text('seoDescription')}
          />
          <div className="sm:col-span-2">
            <BrandColorField
              value={c.primaryColor}
              disabled={!editable}
              testId="showcase-brand-color"
              onChange={(color) => {
                setSaved(false);
                setC({ ...c, primaryColor: color });
              }}
            />
          </div>
          <div className="sm:col-span-2 space-y-2">
            <p className="text-sm font-medium text-charcoal">Prestations mises en avant</p>
            {services.length === 0 ? (
              <p className="text-sm text-muted">Ajoutez vos prestations dans le catalogue.</p>
            ) : (
              services.map((item) => {
                const chosen = c.services.find((s) => s.itemId === item.id);
                return (
                  <div key={item.id} className="flex flex-wrap items-center gap-4 text-sm">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-forest"
                        disabled={!editable}
                        checked={Boolean(chosen)}
                        onChange={(e) =>
                          setC({
                            ...c,
                            services: e.target.checked
                              ? [...c.services, { itemId: item.id, showPrice: false }]
                              : c.services.filter((s) => s.itemId !== item.id),
                          })
                        }
                      />
                      {item.name}
                    </label>
                    {chosen && (
                      <label className="inline-flex items-center gap-2 text-muted">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-forest"
                          disabled={!editable}
                          aria-label={`Afficher le prix — ${item.name}`}
                          checked={chosen.showPrice}
                          onChange={(e) =>
                            setC({
                              ...c,
                              services: c.services.map((s) =>
                                s.itemId === item.id ? { ...s, showPrice: e.target.checked } : s,
                              ),
                            })
                          }
                        />
                        Afficher le prix
                      </label>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div className="sm:col-span-2">
            <CheckboxGroup
              legend="Formulaires proposés aux visiteurs"
              options={FACTURE_REQUEST_KINDS.map((k) => ({
                value: k,
                label: FACTURE_REQUEST_KIND_LABELS[k],
              }))}
              value={c.forms}
              onChange={(forms) => setC({ ...c, forms: forms as FactureRequestKind[] })}
            />
          </div>
          <div className="sm:col-span-2 space-y-3">
            <ApiErrorAlert error={error} />
            {saved && <p className="text-sm font-medium text-forest">Brouillon enregistré.</p>}
            {editable && (
              <Button type="submit" variant="secondary" loading={busy}>
                Enregistrer le brouillon
              </Button>
            )}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function MediaCard({
  media,
  editable,
  onChanged,
}: {
  media: SiteView['media'];
  editable: boolean;
  onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<FactureSiteMediaKind>('GALLERY');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const labels: Record<FactureSiteMediaKind, string> = {
    LOGO: 'Logo',
    COVER: 'Image de couverture',
    GALLERY: 'Réalisation',
  };
  return (
    <Card>
      <CardHeader
        title="Images"
        description="Logo, couverture et réalisations (12 au plus), publiées avec le site."
      />
      <CardBody className="space-y-4">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="facture-site-media">
          {media.map((m) => (
            <li key={m.id} className="space-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element -- aperçu privé servi par l'API */}
              <img
                src={`/api/v1/facture/site/media/${m.id}`}
                alt={labels[m.kind]}
                className="aspect-[4/3] w-full rounded-xl border border-line object-cover"
              />
              <div className="flex items-center justify-between text-xs text-muted">
                <span>
                  {labels[m.kind]}
                  {m.isPublished ? ' · en ligne' : ''}
                </span>
                {editable && !m.isPublished && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Retirer cette image"
                    icon={<Trash2 className="h-4 w-4" aria-hidden />}
                    onClick={async () => {
                      try {
                        await api(`/facture/site/media/${m.id}`, { method: 'DELETE' });
                        onChanged();
                      } catch (err) {
                        setError(toError(err));
                      }
                    }}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
        {editable && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm font-medium">
              Type d’image
              <select
                className="mt-1 block rounded-xl border border-line bg-surface px-3 py-2.5"
                value={kind}
                onChange={(e) => setKind(e.target.value as FactureSiteMediaKind)}
              >
                {(Object.keys(labels) as FactureSiteMediaKind[]).map((k) => (
                  <option key={k} value={k}>
                    {labels[k]}
                  </option>
                ))}
              </select>
            </label>
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              data-testid="facture-site-media-input"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setBusy(true);
                setError(null);
                try {
                  const form = new FormData();
                  form.append('file', file);
                  form.append('kind', kind);
                  await apiUpload('/facture/site/media', form);
                  onChanged();
                } catch (err) {
                  setError(toError(err));
                } finally {
                  setBusy(false);
                }
              }}
            />
            <Button
              type="button"
              variant="secondary"
              loading={busy}
              onClick={() => input.current?.click()}
            >
              Ajouter une image
            </Button>
          </div>
        )}
        <ApiErrorAlert error={error} />
      </CardBody>
    </Card>
  );
}

function DomainCard({
  domains,
  editable,
  onChanged,
}: {
  domains: SiteView['domains'];
  editable: boolean;
  onChanged: () => void;
}) {
  const [hostname, setHostname] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const call = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(toError(err));
    }
  };
  const status: Record<string, string> = {
    PENDING: 'En attente de configuration DNS',
    VERIFIED: 'Propriété vérifiée — activation par Ocall',
    ACTIVE: 'Actif',
    ERROR: 'Erreur',
    SUSPENDED: 'Suspendu',
  };
  return (
    <Card>
      <CardHeader
        title="Domaine personnalisé"
        description="Votre propre adresse (ex. www.mon-entreprise.ml), activée par Ocall après vérification."
      />
      <CardBody className="space-y-3">
        {domains.map((d) => (
          <div key={d.id} className="space-y-1 rounded-xl border border-line px-4 py-3 text-sm">
            <p className="font-semibold">
              {d.hostname} · {status[d.status] ?? d.status}
            </p>
            {d.status !== 'ACTIVE' && (
              <p className="break-all text-xs text-muted">
                Enregistrement TXT à créer : _ocallpark-verify.{d.hostname} =
                ocallpark-site-verification={d.verificationToken}
              </p>
            )}
            {d.lastError && <p className="text-xs text-terracotta-dark">{d.lastError}</p>}
            {editable && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void call(() => api(`/facture/site/domains/${d.id}/verify`, { method: 'POST' }))
                  }
                >
                  Vérifier
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void call(() => api(`/facture/site/domains/${d.id}`, { method: 'DELETE' }))
                  }
                >
                  Supprimer
                </Button>
              </div>
            )}
          </div>
        ))}
        {editable && domains.length === 0 && (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void call(() => api('/facture/site/domains', { method: 'POST', body: { hostname } }));
            }}
          >
            <InputField
              label="Nom de domaine"
              required
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
            />
            <Button type="submit" variant="secondary">
              Ajouter le domaine
            </Button>
          </form>
        )}
        <ApiErrorAlert error={error} />
      </CardBody>
    </Card>
  );
}
