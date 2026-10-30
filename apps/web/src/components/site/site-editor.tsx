'use client';

import { type ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Eye, Globe, ImagePlus, Save, Send, Trash2, Undo2 } from 'lucide-react';
import {
  ISO_WEEKDAY_LABELS,
  SITE_DOMAIN_STATUS_LABELS,
  SITE_SECTION_LABELS,
  SITE_STATUS_LABELS,
  SITE_DEFAULT_ACCENT,
  SITE_LIMITS,
  SITE_THEME_CATALOG,
  type PublishedSite,
  type SiteContent,
  type SiteTheme,
  type SiteMediaKind,
  type SiteSection,
  formatXof,
  sectionsFor,
} from '@ocall/shared';
import { useCan } from '@/components/app/session-context';
import { SiteView } from '@/components/site/site-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api, apiUpload } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { SiteCatalogOptions, SiteEditorView, SiteMediaView } from '@/lib/types';
import { useApi } from '@/lib/use-api';

type Tab = 'content' | 'media' | 'offer' | 'look' | 'domain';
type Look = { theme: SiteTheme; primaryColor: string; accentColor: string | null };

/**
 * Aperçu instantané construit dans le navigateur à partir du brouillon non enregistré (mêmes
 * composants que le site public). Approximation : la version publiée est construite par le
 * serveur (produits devenus indisponibles écartés, descriptions des produits).
 */
function draftToPreview(
  view: SiteEditorView,
  draft: SiteContent,
  look: Look,
  media: SiteMediaView[],
  options: SiteCatalogOptions | null,
): PublishedSite {
  const m = (id: string | null) => {
    const x = id ? media.find((y) => y.id === id) : undefined;
    return x ? { url: x.url, alt: x.alt, width: x.width, height: x.height } : null;
  };
  const groups = new Map<string, PublishedSite['menu'][number]['items']>();
  for (const item of draft.menu) {
    const p = options?.products.find((x) => x.id === item.productId);
    if (!p) continue;
    groups.set(p.category, [
      ...(groups.get(p.category) ?? []),
      { name: p.name, description: null, price: item.displayPrice ?? p.price },
    ]);
  }
  const { menu: _m, tickets: _t, media: _media, attractions, restaurant, ...texts } = draft;
  void _m;
  void _t;
  void _media;
  return {
    slug: view.slug,
    businessType: view.establishment.businessType,
    theme: look.theme,
    primaryColor: look.primaryColor,
    accentColor: look.accentColor ?? undefined,
    publishedAt: new Date().toISOString(),
    content: {
      ...texts,
      attractions: attractions.map((a) => ({
        name: a.name,
        description: a.description,
        image: m(a.mediaId),
      })),
      restaurant: {
        description: restaurant.description,
        photos: restaurant.mediaIds.map(m).filter((x): x is NonNullable<typeof x> => x !== null),
      },
    },
    logo: m(draft.media.logoId),
    cover: m(draft.media.coverId),
    gallery: draft.media.galleryIds.map(m).filter((x): x is NonNullable<typeof x> => x !== null),
    menu: [...groups.entries()].map(([category, items]) => ({ category, items })),
    tickets: draft.tickets.flatMap((t) => {
      const o = options?.tickets.find((x) => x.id === t.ticketCategoryId);
      return o
        ? [
            {
              name: o.name,
              description: null,
              conditions: null,
              price: t.displayPrice ?? o.price,
              peopleIncluded: o.peopleIncluded,
            },
          ]
        : [];
    }),
  };
}

const TEXTAREA =
  'block w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[15px] text-charcoal focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/20';

function TextArea({
  label,
  value,
  onChange,
  rows = 4,
  hint,
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  hint?: string;
  max?: number;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium">{label}</span>
      <textarea
        className={TEXTAREA}
        rows={rows}
        value={value}
        maxLength={max}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="block text-sm text-muted">{hint}</span>}
    </label>
  );
}

/**
 * Éditeur d'un site vitrine : brouillon (jamais public avant publication), médias, menu et tarifs
 * choisis explicitement, apparence, domaine. La publication fige une copie publique.
 */
export function SiteEditor({ siteId }: { siteId: string }) {
  const site = useApi<SiteEditorView>(`/sites/${siteId}`);
  const [view, setView] = useState<SiteEditorView | null>(null);
  const [draft, setDraft] = useState<SiteContent | null>(null);
  const [tab, setTab] = useState<Tab>('content');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canPublish = useCan('site.publish');
  const canDomain = useCan('site.domain');
  const media = useApi<SiteMediaView[]>(`/sites/${siteId}/media`);
  const options = useApi<SiteCatalogOptions>(`/sites/${siteId}/catalog-options`);
  const [look, setLook] = useState<Look | null>(null);
  const [livePreview, setLivePreview] = useState(true);

  useEffect(() => {
    if (site.state === 'success') {
      setView(site.data);
      setDraft(site.data.draft);
      setLook({
        theme: site.data.theme,
        primaryColor: site.data.primaryColor,
        accentColor: site.data.accentColor,
      });
    }
  }, [site]);

  if (site.state === 'loading' || !view || !draft || !look) return <LoadingState />;
  if (site.state === 'error') return <ErrorState error={site.error} onRetry={site.reload} />;

  const dirty = JSON.stringify(draft) !== JSON.stringify(view.draft);
  const set = (patch: Partial<SiteContent>) => setDraft({ ...draft, ...patch });

  async function run(label: string, fn: () => Promise<SiteEditorView>, message: string) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const next = await fn();
      setView(next);
      setDraft(next.draft);
      setNotice(next.warnings?.length ? `${message} ${next.warnings.join(' ')}` : message);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  }
  const saveDraft = () =>
    run(
      'save',
      () =>
        api<SiteEditorView>(`/sites/${siteId}/draft`, {
          method: 'PUT',
          // Lignes vides des listes retirées avant envoi.
          body: {
            content: { ...draft, attractions: draft.attractions.filter((a) => a.name.trim()) },
          },
        }),
      'Brouillon enregistré (non public).',
    );

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'content', label: 'Contenu', show: true },
    { key: 'media', label: 'Photos', show: true },
    {
      key: 'offer',
      label: view.establishment.businessType === 'PARK' ? 'Tarifs' : 'Menu et tarifs',
      show: true,
    },
    { key: 'look', label: 'Apparence', show: true },
    { key: 'domain', label: 'Nom de domaine', show: canDomain },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                tone={
                  view.status === 'PUBLISHED'
                    ? 'forest'
                    : view.status === 'UNPUBLISHED'
                      ? 'terracotta'
                      : 'savanna'
                }
              >
                {SITE_STATUS_LABELS[view.status]}
              </Badge>
              {view.hasUnpublishedChanges && view.publishedAt && (
                <Badge tone="savanna">Modifications non publiées</Badge>
              )}
            </div>
            <p className="text-sm text-muted">
              Adresse publique :{' '}
              <a
                href={view.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-forest underline"
                data-testid="site-public-url"
              >
                {view.publicUrl}
              </a>
            </p>
            {view.publishedAt && (
              <p className="text-sm text-muted">
                Dernière publication : {formatDateTime(view.publishedAt)}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/app/site-web/apercu?site=${siteId}`}
              target="_blank"
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold hover:bg-ivory"
            >
              <Eye className="h-4 w-4" aria-hidden /> Prévisualiser
            </Link>
            {canPublish && (
              <Button
                icon={<Send className="h-4 w-4" />}
                loading={busy === 'publish'}
                disabled={dirty}
                title={dirty ? 'Enregistrez le brouillon avant de publier.' : undefined}
                onClick={() =>
                  run(
                    'publish',
                    () => api<SiteEditorView>(`/sites/${siteId}/publish`, { method: 'POST' }),
                    'Site publié.',
                  )
                }
              >
                Publier
              </Button>
            )}
            {canPublish && view.isOnline && (
              <Button
                variant="secondary"
                icon={<Undo2 className="h-4 w-4" />}
                loading={busy === 'unpublish'}
                onClick={() =>
                  run(
                    'unpublish',
                    () => api<SiteEditorView>(`/sites/${siteId}/unpublish`, { method: 'POST' }),
                    'Site dépublié : il n’est plus visible. Son contenu est conservé.',
                  )
                }
              >
                Dépublier
              </Button>
            )}
          </div>
        </div>
        {!view.availableByPlan && (
          <div className="mt-3">
            <Alert tone="info" title="Site hors ligne : abonnement">
              L’organisation est suspendue ou l’abonnement a expiré : le site n’est pas affiché
              publiquement. Son contenu est conservé et reviendra à la réactivation.
            </Alert>
          </div>
        )}
      </Card>

      {notice && <Alert tone="success">{notice}</Alert>}
      <ApiErrorAlert error={error} />

      <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1" aria-label="Sections de l’éditeur">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? 'page' : undefined}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold ${tab === t.key ? 'bg-forest text-white' : 'bg-surface ring-1 ring-line'}`}
            >
              {t.label}
            </button>
          ))}
      </nav>

      <div className="flex justify-end">
        <label className="hidden items-center gap-2 text-sm xl:flex">
          <input
            type="checkbox"
            className="h-5 w-5 accent-forest"
            checked={livePreview}
            onChange={(e) => setLivePreview(e.target.checked)}
          />
          Aperçu instantané
        </label>
      </div>
      <div
        className={livePreview ? 'xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:gap-5' : ''}
      >
        <div className="min-w-0 space-y-4">
          {tab === 'content' && (
            <ContentTab
              draft={draft}
              set={set}
              businessType={view.establishment.businessType}
              media={media.state === 'success' ? media.data : []}
            />
          )}
          {tab === 'media' && (
            <MediaTab
              siteId={siteId}
              draft={draft}
              set={set}
              media={media}
              businessType={view.establishment.businessType}
            />
          )}
          {tab === 'offer' && (
            <OfferTab
              siteId={siteId}
              draft={draft}
              set={set}
              businessType={view.establishment.businessType}
            />
          )}
          {tab === 'look' && (
            <LookTab
              view={view}
              draft={draft}
              set={set}
              look={look}
              setLook={setLook}
              onSaved={(v) => {
                setView(v);
                setNotice('Apparence enregistrée (appliquée à la prochaine publication).');
              }}
            />
          )}
          {tab === 'domain' && <DomainTab view={view} onChange={(v) => setView(v)} />}
        </div>
        {livePreview && (
          <aside
            className="sticky top-4 hidden max-h-[85vh] self-start overflow-auto rounded-2xl border border-line bg-white shadow-card xl:block"
            aria-label="Aperçu instantané du brouillon"
            data-testid="site-live-preview"
          >
            <p className="sticky top-0 z-50 bg-savanna px-4 py-1.5 text-center text-xs font-semibold text-charcoal">
              Aperçu instantané (non enregistré, non publié)
            </p>
            <SiteView
              site={draftToPreview(
                view,
                draft,
                look,
                media.state === 'success' ? media.data : [],
                options.state === 'success' ? options.data : null,
              )}
            />
          </aside>
        )}
      </div>

      {tab !== 'domain' && (
        <div className="sticky bottom-3 z-10 flex justify-end">
          <Button
            icon={<Save className="h-4 w-4" />}
            loading={busy === 'save'}
            disabled={!dirty}
            onClick={saveDraft}
          >
            Enregistrer le brouillon
          </Button>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="space-y-3 px-5 pb-5 sm:px-6">{children}</div>
    </Card>
  );
}

function ContentTab({
  draft,
  set,
  businessType,
  media,
}: {
  draft: SiteContent;
  set: (p: Partial<SiteContent>) => void;
  businessType: SiteEditorView['establishment']['businessType'];
  media: SiteMediaView[];
}) {
  const park = businessType !== 'RESTAURANT';
  const hasRestaurant = businessType !== 'PARK';
  const photos = media.filter((x) => x.kind === 'GALLERY');
  const facts = [
    ...draft.keyFacts,
    ...Array.from({ length: SITE_LIMITS.keyFacts }, () => ({ label: '', value: '' })),
  ].slice(0, SITE_LIMITS.keyFacts);
  return (
    <div className="space-y-4">
      <Section
        title="Accueil"
        description="Étiquettes affichées sur la grande photo, et chiffres clés sous l’accueil (thème Aqua Premium). Sans chiffres saisis, le site affiche le tarif d’entrée le plus bas et les horaires."
      >
        <TextArea
          label={`Étiquettes (une par ligne, ${SITE_LIMITS.heroHighlights} au plus)`}
          rows={3}
          value={draft.heroHighlights.join('\n')}
          onChange={(v) =>
            set({ heroHighlights: v.split('\n').slice(0, SITE_LIMITS.heroHighlights) })
          }
          hint="Ex. Familles · Anniversaires · Sécurité · Restauration"
        />
        <div className="grid gap-2 sm:grid-cols-2">
          {facts.map((f, i) => (
            <div key={i} className="grid grid-cols-2 gap-2">
              <InputField
                label={`Chiffre clé ${i + 1} : libellé`}
                value={f.label}
                maxLength={SITE_LIMITS.keyFactLength}
                onChange={(e) => {
                  const next = facts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x));
                  set({ keyFacts: next.filter((x) => x.label || x.value) });
                }}
              />
              <InputField
                label="Valeur"
                value={f.value}
                maxLength={SITE_LIMITS.keyFactLength}
                onChange={(e) => {
                  const next = facts.map((x, j) => (j === i ? { ...x, value: e.target.value } : x));
                  set({ keyFacts: next.filter((x) => x.label || x.value) });
                }}
              />
            </div>
          ))}
        </div>
      </Section>
      <Section title="Présentation">
        <InputField
          label="Nom public"
          required
          value={draft.publicName}
          maxLength={80}
          onChange={(e) => set({ publicName: e.target.value })}
        />
        <InputField
          label="Accroche"
          value={draft.tagline}
          maxLength={140}
          onChange={(e) => set({ tagline: e.target.value })}
        />
        <TextArea
          label="Description"
          value={draft.description}
          max={2000}
          rows={6}
          onChange={(v) => set({ description: v })}
          hint="Texte simple : la mise en forme HTML n’est pas interprétée."
        />
      </Section>
      <Section title="Coordonnées et accès">
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField
            label="Adresse"
            value={draft.address}
            onChange={(e) => set({ address: e.target.value })}
          />
          <InputField
            label="Ville"
            value={draft.city}
            onChange={(e) => set({ city: e.target.value })}
          />
          <InputField
            label="Téléphone"
            value={draft.phone}
            onChange={(e) => set({ phone: e.target.value })}
          />
          <InputField
            label="WhatsApp"
            hint="Numéro avec l’indicatif, ex. +223 70 00 00 00"
            value={draft.whatsapp}
            onChange={(e) => set({ whatsapp: e.target.value })}
          />
          <InputField
            label="E-mail"
            type="email"
            value={draft.email}
            onChange={(e) => set({ email: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <InputField
              label="Latitude"
              type="number"
              step="any"
              value={draft.latitude ?? ''}
              onChange={(e) =>
                set({ latitude: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
            <InputField
              label="Longitude"
              type="number"
              step="any"
              value={draft.longitude ?? ''}
              onChange={(e) =>
                set({ longitude: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['facebook', 'instagram', 'tiktok', 'website'] as const).map((k) => (
            <InputField
              key={k}
              label={
                {
                  facebook: 'Facebook',
                  instagram: 'Instagram',
                  tiktok: 'TikTok',
                  website: 'Autre site web',
                }[k]
              }
              placeholder="https://…"
              value={draft.socials[k]}
              onChange={(e) => set({ socials: { ...draft.socials, [k]: e.target.value } })}
            />
          ))}
        </div>
      </Section>
      <Section title="Horaires d’ouverture">
        <ul className="space-y-2">
          {draft.hours.map((h, i) => (
            <li
              key={h.weekday}
              className="grid grid-cols-[6rem_auto_1fr_1fr] items-center gap-2 text-sm"
            >
              <span className="font-medium">{ISO_WEEKDAY_LABELS[h.weekday - 1]}</span>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-forest"
                  checked={h.closed}
                  onChange={(e) =>
                    set({
                      hours: draft.hours.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              closed: e.target.checked,
                              opens: e.target.checked ? null : (x.opens ?? '10:00'),
                              closes: e.target.checked ? null : (x.closes ?? '18:00'),
                            }
                          : x,
                      ),
                    })
                  }
                />
                Fermé
              </label>
              <input
                aria-label={`Ouverture ${ISO_WEEKDAY_LABELS[h.weekday - 1]}`}
                type="time"
                disabled={h.closed}
                className={TEXTAREA}
                value={h.opens ?? ''}
                onChange={(e) =>
                  set({
                    hours: draft.hours.map((x, j) =>
                      j === i ? { ...x, opens: e.target.value } : x,
                    ),
                  })
                }
              />
              <input
                aria-label={`Fermeture ${ISO_WEEKDAY_LABELS[h.weekday - 1]}`}
                type="time"
                disabled={h.closed}
                className={TEXTAREA}
                value={h.closes ?? ''}
                onChange={(e) =>
                  set({
                    hours: draft.hours.map((x, j) =>
                      j === i ? { ...x, closes: e.target.value } : x,
                    ),
                  })
                }
              />
            </li>
          ))}
        </ul>
        <InputField
          label="Précision sur les horaires"
          value={draft.hoursNote}
          onChange={(e) => set({ hoursNote: e.target.value })}
        />
      </Section>
      <Section title="Services" description="Un service par ligne (ex. Parking, Wi-Fi, Terrasse).">
        <TextArea
          label="Services proposés"
          value={draft.services.join('\n')}
          onChange={(v) => set({ services: v.split('\n').slice(0, 20) })}
        />
      </Section>
      {park && (
        <Section
          title="Attractions et activités"
          description="Nom, courte description et photo facultative de chaque attraction."
        >
          <ul className="space-y-3" data-testid="site-attractions">
            {draft.attractions.map((a, i) => (
              <li
                key={i}
                className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_1fr_12rem_auto] sm:items-end"
              >
                <InputField
                  label="Nom"
                  value={a.name}
                  maxLength={SITE_LIMITS.attractionName}
                  onChange={(e) =>
                    set({
                      attractions: draft.attractions.map((x, j) =>
                        j === i ? { ...x, name: e.target.value } : x,
                      ),
                    })
                  }
                />
                <InputField
                  label="Description"
                  value={a.description}
                  maxLength={SITE_LIMITS.attractionDescription}
                  onChange={(e) =>
                    set({
                      attractions: draft.attractions.map((x, j) =>
                        j === i ? { ...x, description: e.target.value } : x,
                      ),
                    })
                  }
                />
                <SelectField
                  label="Photo"
                  value={a.mediaId ?? ''}
                  onChange={(e) =>
                    set({
                      attractions: draft.attractions.map((x, j) =>
                        j === i ? { ...x, mediaId: e.target.value || null } : x,
                      ),
                    })
                  }
                  options={[
                    { value: '', label: 'Aucune' },
                    ...photos.map((p, k) => ({ value: p.id, label: p.alt || `Photo ${k + 1}` })),
                  ]}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Retirer ${a.name || 'l’attraction'}`}
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={() => set({ attractions: draft.attractions.filter((_, j) => j !== i) })}
                />
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="secondary"
            disabled={draft.attractions.length >= SITE_LIMITS.attractions}
            onClick={() =>
              set({
                attractions: [...draft.attractions, { name: '', description: '', mediaId: null }],
              })
            }
          >
            Ajouter une attraction
          </Button>
          <p className="text-sm text-muted">
            Les photos proposées sont celles de l’onglet Photos (type « Galerie »).
          </p>
          <TextArea
            label="Informations de sécurité"
            value={draft.safetyInfo}
            onChange={(v) => set({ safetyInfo: v })}
          />
        </Section>
      )}
      {hasRestaurant && (
        <Section
          title="Restaurant"
          description="Texte et photos de la section restaurant ; le menu se choisit dans l’onglet Menu et tarifs."
        >
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-5 w-5 accent-forest"
              checked={!draft.sections.hidden.includes('menu')}
              onChange={(e) =>
                set({
                  sections: {
                    ...draft.sections,
                    hidden: e.target.checked
                      ? draft.sections.hidden.filter((x) => x !== 'menu')
                      : [...draft.sections.hidden, 'menu'],
                  },
                })
              }
            />
            Afficher la section restaurant
          </label>
          <TextArea
            label="Présentation du restaurant"
            value={draft.restaurant.description}
            max={SITE_LIMITS.text}
            onChange={(v) => set({ restaurant: { ...draft.restaurant, description: v } })}
          />
        </Section>
      )}
      <Section title="Informations pratiques">
        <TextArea
          label="Informations pratiques"
          value={draft.practicalInfo}
          onChange={(v) => set({ practicalInfo: v })}
        />
      </Section>
    </div>
  );
}

function MediaTab({
  siteId,
  draft,
  set,
  media,
  businessType,
}: {
  siteId: string;
  draft: SiteContent;
  set: (p: Partial<SiteContent>) => void;
  media: ReturnType<typeof useApi<SiteMediaView[]>>;
  businessType: SiteEditorView['establishment']['businessType'];
}) {
  const [kind, setKind] = useState<SiteMediaKind>('GALLERY');
  const [alt, setAlt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('kind', kind);
      form.set('alt', alt);
      form.set('file', file);
      const m = await apiUpload<SiteMediaView>(`/sites/${siteId}/media`, form);
      if (m.kind === 'LOGO') set({ media: { ...draft.media, logoId: m.id } });
      if (m.kind === 'COVER') set({ media: { ...draft.media, coverId: m.id } });
      if (m.kind === 'GALLERY')
        set({ media: { ...draft.media, galleryIds: [...draft.media.galleryIds, m.id] } });
      setFile(null);
      setAlt('');
      media.reload();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api(`/sites/${siteId}/media/${id}`, { method: 'DELETE' });
      set({
        media: {
          logoId: draft.media.logoId === id ? null : draft.media.logoId,
          coverId: draft.media.coverId === id ? null : draft.media.coverId,
          galleryIds: draft.media.galleryIds.filter((g) => g !== id),
        },
        attractions: draft.attractions.map((a) => (a.mediaId === id ? { ...a, mediaId: null } : a)),
        restaurant: {
          ...draft.restaurant,
          mediaIds: draft.restaurant.mediaIds.filter((m) => m !== id),
        },
      });
      media.reload();
    } catch (e) {
      setError(e as ApiError);
    }
  }

  const used = (m: SiteMediaView) =>
    draft.media.logoId === m.id ||
    draft.media.coverId === m.id ||
    draft.media.galleryIds.includes(m.id);
  const toggle = (m: SiteMediaView) => {
    if (m.kind === 'LOGO')
      set({ media: { ...draft.media, logoId: draft.media.logoId === m.id ? null : m.id } });
    else if (m.kind === 'COVER')
      set({ media: { ...draft.media, coverId: draft.media.coverId === m.id ? null : m.id } });
    else
      set({
        media: {
          ...draft.media,
          galleryIds: used(m)
            ? draft.media.galleryIds.filter((g) => g !== m.id)
            : [...draft.media.galleryIds, m.id],
        },
      });
  };

  return (
    <Section
      title="Photos"
      description="JPEG, PNG ou WebP, 5 Mo au plus. Les images ne sont visibles du public qu’après publication."
    >
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_1fr_auto] sm:items-end">
        <SelectField
          label="Type"
          value={kind}
          onChange={(e) => setKind(e.target.value as SiteMediaKind)}
          options={[
            { value: 'LOGO', label: 'Logo' },
            { value: 'COVER', label: 'Couverture' },
            { value: 'GALLERY', label: 'Galerie' },
          ]}
        />
        <InputField
          label="Description (accessibilité)"
          value={alt}
          maxLength={140}
          onChange={(e) => setAlt(e.target.value)}
        />
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Fichier</span>
          <input
            data-testid="site-media-file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm"
          />
        </label>
        <Button
          icon={<ImagePlus className="h-4 w-4" />}
          loading={busy}
          disabled={!file}
          onClick={upload}
        >
          Ajouter
        </Button>
      </div>
      <ApiErrorAlert error={error} />
      {media.state === 'success' && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {media.data.map((m) => (
            <li
              key={m.id}
              className={`overflow-hidden rounded-xl border ${used(m) ? 'border-forest ring-2 ring-forest/30' : 'border-line'}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={m.url}
                alt={m.alt}
                className="aspect-[4/3] w-full object-cover"
                loading="lazy"
              />
              <div className="flex items-center justify-between gap-2 p-2 text-xs">
                <span>
                  {{ LOGO: 'Logo', COVER: 'Couverture', GALLERY: 'Galerie' }[m.kind]} · {m.width}×
                  {m.height}
                </span>
                <span className="flex flex-wrap justify-end gap-1">
                  <Button size="sm" variant="secondary" onClick={() => toggle(m)}>
                    {used(m) ? 'Retirer' : 'Utiliser'}
                  </Button>
                  {m.kind === 'GALLERY' && businessType !== 'PARK' && (
                    <Button
                      size="sm"
                      variant={draft.restaurant.mediaIds.includes(m.id) ? 'primary' : 'secondary'}
                      disabled={
                        !draft.restaurant.mediaIds.includes(m.id) &&
                        draft.restaurant.mediaIds.length >= SITE_LIMITS.restaurantPhotos
                      }
                      onClick={() =>
                        set({
                          restaurant: {
                            ...draft.restaurant,
                            mediaIds: draft.restaurant.mediaIds.includes(m.id)
                              ? draft.restaurant.mediaIds.filter((x) => x !== m.id)
                              : [...draft.restaurant.mediaIds, m.id],
                          },
                        })
                      }
                    >
                      Restaurant
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Supprimer l’image"
                    onClick={() => remove(m.id)}
                    icon={<Trash2 className="h-4 w-4" />}
                  />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function OfferTab({
  siteId,
  draft,
  set,
  businessType,
}: {
  siteId: string;
  draft: SiteContent;
  set: (p: Partial<SiteContent>) => void;
  businessType: SiteEditorView['establishment']['businessType'];
}) {
  const options = useApi<SiteCatalogOptions>(`/sites/${siteId}/catalog-options`);
  if (options.state === 'loading') return <LoadingState />;
  if (options.state === 'error')
    return <ErrorState error={options.error} onRetry={options.reload} />;
  const { products, tickets } = options.data;
  const menuOf = (id: string) => draft.menu.find((m) => m.productId === id);
  const ticketOf = (id: string) => draft.tickets.find((t) => t.ticketCategoryId === id);
  return (
    <div className="space-y-4">
      {businessType !== 'PARK' && (
        <Section
          title="Menu public"
          description="Rien n’est publié par défaut : cochez les produits à afficher. Le prix indicatif est facultatif (sinon, prix de vente actuel). Coûts, stocks et marges ne sont jamais publiés."
        >
          {products.length === 0 && (
            <p className="text-sm text-muted">Aucun produit proposé dans cet établissement.</p>
          )}
          <ul className="divide-y divide-line/70">
            {products.map((p) => {
              const m = menuOf(p.id);
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-3 py-2"
                  data-testid="site-menu-option"
                >
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-forest"
                      checked={!!m}
                      onChange={(e) =>
                        set({
                          menu: e.target.checked
                            ? [...draft.menu, { productId: p.id, displayPrice: null }]
                            : draft.menu.filter((x) => x.productId !== p.id),
                        })
                      }
                    />
                    <span className="truncate">{p.name}</span>
                    <span className="text-xs text-muted">
                      {p.category} · {formatXof(p.price)}
                    </span>
                  </label>
                  {m && (
                    <input
                      aria-label={`Prix indicatif ${p.name}`}
                      type="number"
                      min={0}
                      placeholder="Prix indicatif"
                      className={`${TEXTAREA} w-36`}
                      value={m.displayPrice ?? ''}
                      onChange={(e) =>
                        set({
                          menu: draft.menu.map((x) =>
                            x.productId === p.id
                              ? {
                                  ...x,
                                  displayPrice:
                                    e.target.value === '' ? null : Number(e.target.value),
                                }
                              : x,
                          ),
                        })
                      }
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      {businessType !== 'RESTAURANT' && (
        <Section
          title="Tarifs d’entrée publics"
          description="Cochez les tarifs à afficher (indicatifs). Aucune vente de billets en ligne."
        >
          {tickets.length === 0 && <p className="text-sm text-muted">Aucun tarif actif.</p>}
          <ul className="divide-y divide-line/70">
            {tickets.map((t) => {
              const s = ticketOf(t.id);
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-3 py-2">
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-forest"
                      checked={!!s}
                      onChange={(e) =>
                        set({
                          tickets: e.target.checked
                            ? [...draft.tickets, { ticketCategoryId: t.id, displayPrice: null }]
                            : draft.tickets.filter((x) => x.ticketCategoryId !== t.id),
                        })
                      }
                    />
                    <span className="truncate">{t.name}</span>
                    <span className="text-xs text-muted">
                      {formatXof(t.price)}
                      {t.peopleIncluded > 1 ? ` · ${t.peopleIncluded} pers.` : ''}
                    </span>
                  </label>
                  {s && (
                    <input
                      aria-label={`Prix indicatif ${t.name}`}
                      type="number"
                      min={0}
                      placeholder="Prix indicatif"
                      className={`${TEXTAREA} w-36`}
                      value={s.displayPrice ?? ''}
                      onChange={(e) =>
                        set({
                          tickets: draft.tickets.map((x) =>
                            x.ticketCategoryId === t.id
                              ? {
                                  ...x,
                                  displayPrice:
                                    e.target.value === '' ? null : Number(e.target.value),
                                }
                              : x,
                          ),
                        })
                      }
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}

function LookTab({
  view,
  draft,
  set,
  look,
  setLook,
  onSaved,
}: {
  view: SiteEditorView;
  draft: SiteContent;
  set: (p: Partial<SiteContent>) => void;
  look: Look;
  setLook: (l: Look) => void;
  onSaved: (v: SiteEditorView) => void;
}) {
  const { theme, primaryColor: color, accentColor } = look;
  const setTheme = (t: SiteTheme) => setLook({ ...look, theme: t });
  const setColor = (c: string) => setLook({ ...look, primaryColor: c });
  const [slug, setSlug] = useState(view.slug);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const allowed = sectionsFor(view.establishment.businessType);
  const order = draft.sections.order;
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    set({ sections: { ...draft.sections, order: next } });
  };
  const toggle = (s: SiteSection) =>
    set({
      sections: {
        ...draft.sections,
        hidden: draft.sections.hidden.includes(s)
          ? draft.sections.hidden.filter((x) => x !== s)
          : [...draft.sections.hidden, s],
      },
    });

  async function saveSettings() {
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api<SiteEditorView>(`/sites/${view.id}/settings`, {
          method: 'PUT',
          body: {
            theme,
            primaryColor: color,
            accentColor,
            ...(slug !== view.slug ? { slug } : {}),
          },
        }),
      );
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Section title="Thème, couleur et adresse">
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Thème</legend>
          <ul className="grid gap-2 sm:grid-cols-2" data-testid="site-themes">
            {SITE_THEME_CATALOG.map((t) => (
              <li key={t.key}>
                <label
                  className={`flex h-full items-start gap-3 rounded-xl border p-3 ${theme === t.key ? 'border-forest ring-2 ring-forest/30' : 'border-line'} ${t.available ? 'cursor-pointer' : 'opacity-55'}`}
                >
                  <input
                    type="radio"
                    name="site-theme"
                    className="mt-1 h-4 w-4 accent-forest"
                    disabled={!t.available}
                    checked={theme === t.key}
                    onChange={() => setTheme(t.key as SiteTheme)}
                  />
                  <span>
                    <span className="block font-semibold">
                      {t.label} {!t.available && <Badge>À venir</Badge>}
                    </span>
                    <span className="block text-sm text-muted">{t.description}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Couleur d’accent</span>
            <span className="flex items-center gap-2">
              <input
                type="color"
                value={accentColor ?? SITE_DEFAULT_ACCENT}
                onChange={(e) => setLook({ ...look, accentColor: e.target.value })}
                className="h-11 w-14 rounded-lg border border-line"
                aria-label="Couleur d’accent"
              />
              <code className="text-sm">{accentColor ?? `${SITE_DEFAULT_ACCENT} (défaut)`}</code>
            </span>
            <span className="block text-sm text-muted">
              Boutons et chiffres clés (thème Aqua Premium) : couleur claire.
            </span>
          </label>
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Couleur principale</span>
            <span className="flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-11 w-14 rounded-lg border border-line"
                aria-label="Couleur principale"
              />
              <code className="text-sm">{color}</code>
            </span>
            <span className="block text-sm text-muted">
              Doit rester lisible avec un texte blanc.
            </span>
          </label>
          <InputField
            label="Adresse (slug)"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            hint="Lettres, chiffres et tirets. Changer l’adresse casse les anciens liens."
          />
        </div>
        <ApiErrorAlert error={error} />
        <Button
          variant="secondary"
          icon={<Save className="h-4 w-4" />}
          loading={busy}
          onClick={saveSettings}
        >
          Enregistrer l’apparence
        </Button>
      </Section>
      <Section
        title="Sections"
        description="Ordre d’affichage et sections masquées (enregistrés avec le brouillon)."
      >
        <ul className="space-y-2">
          {order
            .filter((s) => allowed.includes(s))
            .map((s, i) => (
              <li
                key={s}
                className="flex items-center gap-2 rounded-xl border border-line px-3 py-2"
              >
                <span className="flex-1 font-medium">{SITE_SECTION_LABELS[s]}</span>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-forest"
                    checked={!draft.sections.hidden.includes(s)}
                    onChange={() => toggle(s)}
                  />
                  Afficher
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Monter ${SITE_SECTION_LABELS[s]}`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  icon={<ArrowUp className="h-4 w-4" />}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Descendre ${SITE_SECTION_LABELS[s]}`}
                  disabled={i === order.length - 1}
                  onClick={() => move(i, 1)}
                  icon={<ArrowDown className="h-4 w-4" />}
                />
              </li>
            ))}
        </ul>
      </Section>
    </div>
  );
}

function DomainTab({
  view,
  onChange,
}: {
  view: SiteEditorView;
  onChange: (v: SiteEditorView) => void;
}) {
  const [hostname, setHostname] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const run = async (label: string, fn: () => Promise<SiteEditorView>) => {
    setBusy(label);
    setError(null);
    try {
      onChange(await fn());
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  };
  const current = view.domains.find((d) => d.status !== 'ERROR') ?? view.domains[0];
  return (
    <Section
      title="Nom de domaine personnalisé"
      description="Facultatif. Votre site reste toujours accessible à son adresse Ocall."
    >
      {!current || current.status === 'ERROR' ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <InputField
            label="Votre domaine"
            placeholder="www.monrestaurant.ml"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
          />
          <Button
            icon={<Globe className="h-4 w-4" />}
            loading={busy === 'add'}
            disabled={!hostname.trim()}
            onClick={() =>
              run('add', () =>
                api<SiteEditorView>(`/sites/${view.id}/domains`, {
                  method: 'POST',
                  body: { hostname },
                }),
              )
            }
          >
            Ajouter
          </Button>
        </div>
      ) : null}
      {current && (
        <div className="space-y-3 rounded-xl border border-line p-4" data-testid="site-domain">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{current.hostname}</p>
            <Badge
              tone={
                current.status === 'ACTIVE'
                  ? 'forest'
                  : current.status === 'ERROR'
                    ? 'terracotta'
                    : 'savanna'
              }
            >
              {SITE_DOMAIN_STATUS_LABELS[current.status]}
            </Badge>
          </div>
          {current.lastError && <p className="text-sm text-terracotta-dark">{current.lastError}</p>}
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>
              Chez votre fournisseur de domaine, créez un enregistrement <strong>TXT</strong> :
              <code className="mt-1 block break-all rounded bg-ivory px-2 py-1">
                {current.dns.txtName}
              </code>
              <code className="mt-1 block break-all rounded bg-ivory px-2 py-1">
                {current.dns.txtValue}
              </code>
            </li>
            <li>
              Créez un enregistrement <strong>CNAME</strong> de <code>{current.dns.cnameName}</code>{' '}
              vers <code>{current.dns.cnameTarget ?? 'la cible communiquée par Ocall'}</code>.
            </li>
            <li>
              Lancez la vérification. Une fois la propriété vérifiée, Ocall active le domaine et son
              certificat HTTPS.
            </li>
          </ol>
          <ApiErrorAlert error={error} />
          <div className="flex flex-wrap gap-2">
            {(current.status === 'PENDING' ||
              current.status === 'VERIFYING' ||
              current.status === 'ERROR') && (
              <Button
                loading={busy === 'verify'}
                onClick={() =>
                  run('verify', () =>
                    api<SiteEditorView>(`/sites/${view.id}/domains/${current.id}/verify`, {
                      method: 'POST',
                    }),
                  )
                }
              >
                Vérifier la propriété
              </Button>
            )}
            <Button
              variant="secondary"
              icon={<Trash2 className="h-4 w-4" />}
              loading={busy === 'remove'}
              onClick={() =>
                run('remove', () =>
                  api<SiteEditorView>(`/sites/${view.id}/domains/${current.id}`, {
                    method: 'DELETE',
                  }),
                )
              }
            >
              Supprimer
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}
