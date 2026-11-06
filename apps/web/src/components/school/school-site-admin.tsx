'use client';

import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import {
  SCHOOL_SITE_LINK_KINDS,
  SCHOOL_SITE_PAGE_LABELS,
  SCHOOL_SITE_LINK_LABELS,
  SCHOOL_SITE_THEMES,
  type SchoolRole,
  type SchoolSiteContent,
  type SchoolSiteLanguage,
  type SchoolSiteLinkKind,
  type SchoolSitePublished,
  type SchoolSitePublishedLink,
  type SchoolSitePublishedNews,
  type SchoolSiteText,
  type SchoolTextKey,
  hasSchoolPermission,
} from '@ocall/shared';
import { SchoolSitePageContent, SchoolSiteShell } from '@/components/school-site/school-site-view';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api, apiUpload } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface SiteView {
  id: string;
  slug: string;
  enabled: boolean;
  isOnline: boolean;
  languages: SchoolSiteLanguage[];
  defaultLanguage: SchoolSiteLanguage;
  theme: string;
  primaryColor: string;
  draft: SchoolSiteContent;
  publishedAt: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED';
  publicUrl: string;
  subdomainsEnabled: boolean;
  availability:
    | { online: true; canPublish: boolean; readOnlyUntil: string | null }
    | { online: false; canPublish: false; reason: 'NO_CONTRACT' | 'TERMINATED' | 'GRACE_ENDED' };
}

interface MediaView {
  id: string;
  kind: string;
  width: number;
  height: number;
  alt: string;
  altAr: string;
  isPublished: boolean;
  containsMinors: boolean;
  consentReference: string | null;
  withdrawnAt: string | null;
  /** Retiré, mais un fichier n'a pas encore pu être supprimé du stockage : retrait à rejouer. */
  filesPending: boolean;
  url: string | null;
  thumbUrl: string | null;
}

interface LinkView {
  id: string;
  kind: SchoolSiteLinkKind;
  label: string;
  url: string;
  enabled: boolean;
  position: number;
}

interface NewsView {
  id: string;
  slug: string;
  title: string;
  titleAr: string;
  publishedOn: string;
  mediaId: string | null;
  status: 'DRAFT' | 'PUBLISHED';
}

type Tab = 'settings' | 'content' | 'media' | 'news' | 'links';

/** Droits du rôle sur le site : préparer, publier ; écrire exige un contrat valide (sauf protection). */
export interface SiteRights {
  role: SchoolRole;
  full: boolean;
}

const can = (r: SiteRights, p: 'school.site.manage' | 'school.site.publish', protective = false) =>
  hasSchoolPermission(r.role, p) && (r.full || protective);

/**
 * Administration du site vitrine d'un établissement (Sprint 10) : activation, adresse, apparence,
 * contenus FR/AR, photos (réencodées, attestation pour les mineurs, retrait immédiat), actualités,
 * réseaux sociaux, prévisualisation, publication et export.
 */
export function SchoolSiteAdmin({ schoolId, rights }: { schoolId: string; rights: SiteRights }) {
  const { t } = useSchoolText();
  const site = useApi<SiteView | null>(`/school/sites?schoolId=${schoolId}`);
  if (site.state === 'loading') return <LoadingState />;
  if (site.state === 'error') return <ErrorState error={site.error} onRetry={site.reload} />;
  if (!site.data) return <CreateSite schoolId={schoolId} rights={rights} onCreated={site.reload} />;
  return (
    <SiteEditor key={site.data.id} site={site.data} rights={rights} reload={site.reload} t={t} />
  );
}

function CreateSite({
  schoolId,
  rights,
  onCreated,
}: {
  schoolId: string;
  rights: SiteRights;
  onCreated: () => void;
}) {
  const { t } = useSchoolText();
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/school/sites', { method: 'POST', body: { schoolId, slug } });
      onCreated();
    } catch (err) {
      setError(toApiError(err));
    }
  }
  return (
    <Card>
      <CardBody>
        <p className="mb-3 text-sm text-muted">{t('site.none')}</p>
        {can(rights, 'school.site.publish') ? (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => void submit(e)}
            data-testid="site-create"
          >
            <InputField
              label={t('site.slug')}
              hint={t('site.slugHint')}
              required
              dir="ltr"
              pattern="[a-z0-9-]{3,40}"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
            />
            <Button type="submit" disabled={slug.length < 3}>
              {t('site.create')}
            </Button>
          </form>
        ) : (
          <p className="text-sm">{t('site.createOnlyDirection')}</p>
        )}
        <div className="mt-3">
          <ApiErrorAlert error={error} />
        </div>
      </CardBody>
    </Card>
  );
}

function SiteEditor({
  site,
  rights,
  reload,
  t,
}: {
  site: SiteView;
  rights: SiteRights;
  reload: () => void;
  t: (key: SchoolTextKey, vars?: Record<string, string | number>) => string;
}) {
  const { date } = useSchoolText();
  const [tab, setTab] = useState<Tab>('settings');
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const media = useApi<MediaView[]>(`/school/sites/${site.id}/media`);

  async function act(path: string, method: 'POST' | 'PUT', body?: unknown, done?: string) {
    setError(null);
    setNotice(null);
    try {
      await api(path, { method, body });
      if (done) setNotice(done);
      reload();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  const a = site.availability;
  const tabs: [Tab, SchoolTextKey][] = [
    ['settings', 'site.tab.settings'],
    ['content', 'site.tab.content'],
    ['media', 'site.tab.media'],
    ['news', 'site.tab.news'],
    ['links', 'site.tab.links'],
  ];
  return (
    <>
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={site.isOnline ? 'forest' : 'neutral'}>
                  {t(`site.status.${site.status}`)}
                </Badge>
                <Badge tone={site.enabled ? 'forest' : 'savanna'}>
                  {site.enabled ? t('site.enabled') : t('site.disabled')}
                </Badge>
              </div>
              <p className="text-sm">
                {t('site.publicUrl')} :{' '}
                <a
                  href={site.publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  dir="ltr"
                  className="underline"
                  data-testid="site-public-url"
                >
                  {site.publicUrl}
                </a>
              </p>
              {!site.subdomainsEnabled && (
                <p className="text-xs text-muted">{t('site.subdomainsOff')}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => setPreview(true)}
                data-testid="site-preview"
              >
                {t('site.preview')}
              </Button>
              <a
                className="inline-flex h-10 items-center rounded-xl px-3 text-sm font-semibold text-charcoal-soft hover:bg-ivory-dark/60"
                href={`/api/v1/school/sites/${site.id}/export`}
              >
                {t('site.export')}
              </a>
              {site.enabled
                ? can(rights, 'school.site.publish', true) && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void act(`/school/sites/${site.id}/enabled`, 'PUT', { enabled: false })
                      }
                    >
                      {t('site.disable')}
                    </Button>
                  )
                : can(rights, 'school.site.publish') && (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void act(`/school/sites/${site.id}/enabled`, 'PUT', { enabled: true })
                      }
                      data-testid="site-enable"
                    >
                      {t('site.enable')}
                    </Button>
                  )}
              {site.isOnline && can(rights, 'school.site.publish', true) && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    void act(
                      `/school/sites/${site.id}/unpublish`,
                      'POST',
                      undefined,
                      t('site.unpublished'),
                    )
                  }
                  data-testid="site-unpublish"
                >
                  {t('site.unpublish')}
                </Button>
              )}
              {can(rights, 'school.site.publish') && (
                <Button
                  disabled={!site.enabled || !a.canPublish}
                  onClick={() =>
                    void act(
                      `/school/sites/${site.id}/publish`,
                      'POST',
                      undefined,
                      t('site.published'),
                    )
                  }
                  data-testid="site-publish"
                >
                  {t('site.publish')}
                </Button>
              )}
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {a.online && a.readOnlyUntil && (
              <Alert tone="info">{t('site.readOnlyUntil', { date: date(a.readOnlyUntil) })}</Alert>
            )}
            {!a.online && <Alert tone="error">{t(`site.offline.${a.reason}`)}</Alert>}
            {notice && <Alert tone="success">{notice}</Alert>}
            <ApiErrorAlert error={error} />
          </div>
        </CardBody>
      </Card>

      <div role="tablist" aria-label={t('site.title')} className="flex flex-wrap gap-1">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className="rounded-lg px-3 py-2 text-sm font-semibold aria-selected:bg-forest aria-selected:text-white"
          >
            {t(label)}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'settings' && <SettingsTab site={site} rights={rights} reload={reload} />}
        {tab === 'content' && <ContentTab site={site} rights={rights} reload={reload} />}
        {tab === 'media' && <MediaTab site={site} rights={rights} media={media} reload={reload} />}
        {tab === 'news' && (
          <NewsTab
            site={site}
            rights={rights}
            media={media.state === 'success' ? media.data : []}
          />
        )}
        {tab === 'links' && <LinksTab site={site} rights={rights} />}
      </div>

      {preview && (
        <Preview siteId={site.id} lang={site.defaultLanguage} onClose={() => setPreview(false)} />
      )}
    </>
  );
}

// ─── Réglages ───

function SettingsTab({
  site,
  rights,
  reload,
}: {
  site: SiteView;
  rights: SiteRights;
  reload: () => void;
}) {
  const { t } = useSchoolText();
  const [form, setForm] = useState({
    languages: site.languages,
    defaultLanguage: site.defaultLanguage,
    theme: site.theme,
    primaryColor: site.primaryColor,
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const editable = can(rights, 'school.site.manage');
  const toggleLang = (l: SchoolSiteLanguage) => {
    const languages = form.languages.includes(l)
      ? form.languages.filter((x) => x !== l)
      : [...form.languages, l];
    setForm({
      ...form,
      languages,
      defaultLanguage: languages.includes(form.defaultLanguage)
        ? form.defaultLanguage
        : (languages[0] ?? 'fr'),
    });
  };
  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await api(`/school/sites/${site.id}/settings`, { method: 'PATCH', body: form });
      setSaved(true);
      reload();
    } catch (err) {
      setError(toApiError(err));
    }
  }
  return (
    <Card>
      <CardBody>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => void save(e)}
          data-testid="site-settings"
        >
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">{t('site.languages')}</legend>
            {(['fr', 'ar'] as const).map((l) => (
              <label key={l} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!editable}
                  checked={form.languages.includes(l)}
                  onChange={() => toggleLang(l)}
                />
                {t(`site.lang.${l}`)}
              </label>
            ))}
          </fieldset>
          <SelectField
            label={t('site.defaultLanguage')}
            disabled={!editable}
            value={form.defaultLanguage}
            onChange={(e) =>
              setForm({ ...form, defaultLanguage: e.target.value as SchoolSiteLanguage })
            }
            options={form.languages.map((l) => ({ value: l, label: t(`site.lang.${l}`) }))}
          />
          <SelectField
            label={t('site.theme')}
            disabled={!editable}
            value={form.theme}
            onChange={(e) => setForm({ ...form, theme: e.target.value })}
            options={SCHOOL_SITE_THEMES.map((th) => ({ value: th, label: t(`site.theme.${th}`) }))}
          />
          <InputField
            label={t('site.color')}
            type="color"
            disabled={!editable}
            value={form.primaryColor}
            onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
          />
          <p className="text-xs text-muted sm:col-span-2">{t('site.fallbackNote')}</p>
          {editable && (
            <div className="sm:col-span-2">
              <Button type="submit" disabled={form.languages.length === 0}>
                {t('site.saveSettings')}
              </Button>
            </div>
          )}
        </form>
        <div className="mt-3 space-y-2">
          {saved && <Alert tone="success">{t('site.saved')}</Alert>}
          <ApiErrorAlert error={error} />
        </div>
      </CardBody>
    </Card>
  );
}

// ─── Contenus ───

function TextPair({
  label,
  value,
  languages,
  multiline,
  max,
  onChange,
  disabled,
}: {
  label: string;
  value: SchoolSiteText;
  languages: SchoolSiteLanguage[];
  multiline?: boolean;
  max: number;
  onChange: (v: SchoolSiteText) => void;
  disabled: boolean;
}) {
  const { t } = useSchoolText();
  return (
    <fieldset className="grid gap-2 sm:grid-cols-2">
      <legend className="mb-1 text-sm font-semibold">{label}</legend>
      {languages.map((l) => {
        const props = {
          'aria-label': `${label} — ${t(`site.f.${l}`)}`,
          dir: l === 'ar' ? 'rtl' : 'ltr',
          lang: l,
          maxLength: max,
          disabled,
          value: value[l],
          placeholder: t(`site.f.${l}`),
          className: 'w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm',
        } as const;
        return multiline ? (
          <textarea
            key={l}
            rows={4}
            {...props}
            onChange={(e) => onChange({ ...value, [l]: e.target.value })}
          />
        ) : (
          <input key={l} {...props} onChange={(e) => onChange({ ...value, [l]: e.target.value })} />
        );
      })}
    </fieldset>
  );
}

function ContentTab({
  site,
  rights,
  reload,
}: {
  site: SiteView;
  rights: SiteRights;
  reload: () => void;
}) {
  const { t } = useSchoolText();
  const [c, setC] = useState<SchoolSiteContent>(site.draft);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const editable = can(rights, 'school.site.manage');
  const langs = site.languages;
  const pair = (
    label: SchoolTextKey,
    value: SchoolSiteText,
    set: (v: SchoolSiteText) => void,
    multiline = true,
    max = 4000,
  ) => (
    <TextPair
      label={t(label)}
      value={value}
      languages={langs}
      multiline={multiline}
      max={max}
      onChange={set}
      disabled={!editable}
    />
  );
  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await api(`/school/sites/${site.id}/draft`, { method: 'PUT', body: { content: c } });
      setSaved(true);
      reload();
    } catch (err) {
      setError(toApiError(err));
    }
  }
  const highlights = (l: SchoolSiteLanguage) => c.home.highlights.map((h) => h[l]).join('\n');
  const setHighlights = (l: SchoolSiteLanguage, raw: string) => {
    const lines = raw.split('\n').slice(0, 6);
    const count = Math.max(lines.length, ...c.home.highlights.map(() => 0));
    const next: SchoolSiteText[] = Array.from({ length: count }, (_, i) => ({
      fr: l === 'fr' ? (lines[i] ?? '') : (c.home.highlights[i]?.fr ?? ''),
      ar: l === 'ar' ? (lines[i] ?? '') : (c.home.highlights[i]?.ar ?? ''),
    })).filter((h) => h.fr || h.ar);
    setC({ ...c, home: { ...c.home, highlights: next } });
  };
  return (
    <Card>
      <CardBody>
        <form className="space-y-6" onSubmit={(e) => void save(e)} data-testid="site-content">
          <Group title={t('site.tab.content')}>
            {pair(
              'site.f.tagline',
              c.home.tagline,
              (v) => setC({ ...c, home: { ...c.home, tagline: v } }),
              false,
              160,
            )}
            {pair('site.f.intro', c.home.intro, (v) =>
              setC({ ...c, home: { ...c.home, intro: v } }),
            )}
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="mb-1 text-sm font-semibold">{t('site.f.highlights')}</legend>
              {langs.map((l) => (
                <textarea
                  key={l}
                  rows={3}
                  aria-label={`${t('site.f.highlights')} — ${t(`site.f.${l}`)}`}
                  dir={l === 'ar' ? 'rtl' : 'ltr'}
                  lang={l}
                  disabled={!editable}
                  value={highlights(l)}
                  onChange={(e) => setHighlights(l, e.target.value)}
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
                />
              ))}
            </fieldset>
          </Group>
          <Group title={t('site.f.overview')}>
            {(['overview', 'history', 'mission', 'values'] as const).map((k) => (
              <div key={k}>
                {pair(`site.f.${k}`, c.about[k], (v) =>
                  setC({ ...c, about: { ...c.about, [k]: v } }),
                )}
              </div>
            ))}
          </Group>
          <Group title={t('site.f.levels')}>
            {(['levels', 'programs', 'languages', 'pedagogy'] as const).map((k) => (
              <div key={k}>
                {pair(
                  `site.f.${k}`,
                  c.teaching[k],
                  (v) => setC({ ...c, teaching: { ...c.teaching, [k]: v } }),
                  true,
                  k === 'languages' ? 600 : 4000,
                )}
              </div>
            ))}
          </Group>
          <Group title={t('site.f.hours')}>
            {pair(
              'site.f.hours',
              c.practical.hours,
              (v) => setC({ ...c, practical: { ...c.practical, hours: v } }),
              true,
              600,
            )}
            {pair(
              'site.f.address',
              c.practical.address,
              (v) => setC({ ...c, practical: { ...c.practical, address: v } }),
              true,
              600,
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <InputField
                label={t('site.f.phone')}
                dir="ltr"
                disabled={!editable}
                maxLength={30}
                value={c.practical.phone}
                onChange={(e) =>
                  setC({ ...c, practical: { ...c.practical, phone: e.target.value } })
                }
              />
              <InputField
                label={t('site.f.email')}
                type="email"
                dir="ltr"
                disabled={!editable}
                maxLength={254}
                value={c.practical.email}
                onChange={(e) =>
                  setC({ ...c, practical: { ...c.practical, email: e.target.value } })
                }
              />
              <InputField
                label={t('site.f.mapUrl')}
                type="url"
                dir="ltr"
                disabled={!editable}
                maxLength={500}
                value={c.practical.mapUrl}
                onChange={(e) =>
                  setC({ ...c, practical: { ...c.practical, mapUrl: e.target.value } })
                }
              />
            </div>
            {pair(
              'site.f.contactIntro',
              c.contact.intro,
              (v) => setC({ ...c, contact: { intro: v } }),
              true,
              600,
            )}
          </Group>
          {editable && (
            <Button type="submit" data-testid="site-save-draft">
              {t('site.saveDraft')}
            </Button>
          )}
        </form>
        <div className="mt-3 space-y-2">
          {saved && <Alert tone="success">{t('site.draftSaved')}</Alert>}
          <ApiErrorAlert error={error} />
        </div>
      </CardBody>
    </Card>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-line pb-5 last:border-0">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </section>
  );
}

// ─── Photos ───

function MediaTab({
  site,
  rights,
  media,
  reload,
}: {
  site: SiteView;
  rights: SiteRights;
  media: ReturnType<typeof useApi<MediaView[]>>;
  reload: () => void;
}) {
  const { t } = useSchoolText();
  const [error, setError] = useState<ApiError | null>(null);
  const [form, setForm] = useState({
    kind: 'GALLERY',
    alt: '',
    altAr: '',
    minors: false,
    consent: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const editable = can(rights, 'school.site.manage');
  const protective = can(rights, 'school.site.manage', true);
  // Brouillon local : un choix (logo, couverture, galerie) s'affiche aussitôt, annulé si l'API refuse.
  const [draft, setDraft] = useState<SchoolSiteContent>(site.draft);
  useEffect(() => setDraft(site.draft), [site.draft]);

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setSending(true);
    const body = new FormData();
    body.set('file', file);
    body.set('kind', form.kind);
    body.set('alt', form.alt);
    body.set('altAr', form.altAr);
    body.set('containsMinors', String(form.minors));
    if (form.minors) body.set('consentReference', form.consent);
    try {
      await apiUpload(`/school/sites/${site.id}/media`, body);
      setForm({ ...form, alt: '', altAr: '', minors: false, consent: '' });
      setFile(null);
      (e.target as HTMLFormElement).reset();
      media.reload();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setSending(false);
    }
  }

  async function saveDraft(next: SchoolSiteContent) {
    setError(null);
    const previous = draft;
    setDraft(next);
    try {
      await api(`/school/sites/${site.id}/draft`, { method: 'PUT', body: { content: next } });
      reload();
    } catch (err) {
      setDraft(previous);
      setError(toApiError(err));
    }
  }

  async function retryWithdraw(m: MediaView) {
    setError(null);
    try {
      await api(`/school/sites/${site.id}/media/${m.id}/withdraw`, { method: 'POST', body: {} });
      media.reload();
    } catch (err) {
      setError(toApiError(err));
    }
  }

  async function withdraw(m: MediaView) {
    if (!window.confirm(t('site.m.withdrawConfirm'))) return;
    const reason = window.prompt(t('site.m.withdrawReason')) ?? '';
    setError(null);
    try {
      await api(`/school/sites/${site.id}/media/${m.id}/withdraw`, {
        method: 'POST',
        body: { reason },
      });
      media.reload();
      reload();
    } catch (err) {
      setError(toApiError(err));
    }
  }

  const inGallery = (id: string) => draft.media.gallery.some((g) => g.mediaId === id);
  return (
    <Card>
      <CardBody>
        <ApiErrorAlert error={error} />
        <p className="mb-3 text-xs text-muted">{t('site.m.exifNote')}</p>
        {media.state === 'loading' ? (
          <LoadingState />
        ) : media.state === 'error' ? (
          <ErrorState error={media.error} onRetry={media.reload} />
        ) : media.data.length === 0 ? (
          <p className="text-sm text-muted">{t('site.m.none')}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="site-media">
            {media.data.map((m) => (
              <li
                key={m.id}
                className="rounded-xl border border-line p-2 text-sm"
                data-testid="site-media-item"
              >
                {m.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- aperçu authentifié servi par l'API, jamais optimisé ni mis en cache public.
                  <img
                    src={m.thumbUrl}
                    alt={m.alt}
                    className="mb-2 aspect-[4/3] w-full rounded-lg object-cover"
                  />
                ) : (
                  <div className="mb-2 grid aspect-[4/3] place-items-center rounded-lg bg-ivory-dark/50 text-muted">
                    {t('site.m.withdrawn')}
                  </div>
                )}
                <div className="flex flex-wrap gap-1">
                  <Badge>{t(`site.m.kind.${m.kind}` as SchoolTextKey)}</Badge>
                  {m.isPublished && <Badge tone="forest">{t('site.m.published')}</Badge>}
                  {m.containsMinors && <Badge tone="savanna">{t('site.m.minorsBadge')}</Badge>}
                  {m.withdrawnAt && <Badge tone="terracotta">{t('site.m.withdrawn')}</Badge>}
                  {m.filesPending && protective && (
                    <Button size="sm" variant="ghost" onClick={() => void retryWithdraw(m)}>
                      {t('site.m.retryDelete')}
                    </Button>
                  )}
                </div>
                {!m.withdrawnAt && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {editable && (
                      <>
                        <label className="flex items-center gap-1">
                          <input
                            type="radio"
                            name="logo"
                            checked={draft.media.logoId === m.id}
                            onChange={() =>
                              void saveDraft({ ...draft, media: { ...draft.media, logoId: m.id } })
                            }
                          />
                          {t('site.m.useLogo')}
                        </label>
                        <label className="flex items-center gap-1">
                          <input
                            type="radio"
                            name="cover"
                            checked={draft.media.coverId === m.id}
                            onChange={() =>
                              void saveDraft({ ...draft, media: { ...draft.media, coverId: m.id } })
                            }
                          />
                          {t('site.m.useCover')}
                        </label>
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={inGallery(m.id)}
                            onChange={() =>
                              void saveDraft({
                                ...draft,
                                media: {
                                  ...draft.media,
                                  gallery: inGallery(m.id)
                                    ? draft.media.gallery.filter((g) => g.mediaId !== m.id)
                                    : [
                                        ...draft.media.gallery,
                                        { mediaId: m.id, caption: { fr: m.alt, ar: m.altAr } },
                                      ],
                                },
                              })
                            }
                          />
                          {t('site.m.inGallery')}
                        </label>
                      </>
                    )}
                    {protective && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => void withdraw(m)}
                        data-testid="site-media-withdraw"
                      >
                        {t('site.m.withdraw')}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {editable && (
          <form
            className="mt-5 grid gap-3 border-t border-line pt-4 sm:grid-cols-2"
            onSubmit={(e) => void upload(e)}
            data-testid="site-media-upload"
          >
            <h3 className="font-semibold sm:col-span-2">{t('site.m.upload')}</h3>
            <label className="text-sm">
              <span className="mb-1 block font-medium">{t('site.m.file')}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                required
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <SelectField
              label={t('site.m.kind')}
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
              options={(['LOGO', 'COVER', 'GALLERY', 'NEWS'] as const).map((k) => ({
                value: k,
                label: t(`site.m.kind.${k}`),
              }))}
            />
            <InputField
              label={t('site.m.alt')}
              maxLength={200}
              value={form.alt}
              onChange={(e) => setForm({ ...form, alt: e.target.value })}
            />
            {site.languages.includes('ar') && (
              <InputField
                label={t('site.m.altAr')}
                dir="rtl"
                lang="ar"
                maxLength={200}
                value={form.altAr}
                onChange={(e) => setForm({ ...form, altAr: e.target.value })}
              />
            )}
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={form.minors}
                onChange={(e) => setForm({ ...form, minors: e.target.checked })}
              />
              {t('site.m.minors')}
            </label>
            {form.minors && (
              <div className="space-y-2 sm:col-span-2">
                <InputField
                  label={t('site.m.consent')}
                  required
                  maxLength={200}
                  value={form.consent}
                  onChange={(e) => setForm({ ...form, consent: e.target.value })}
                />
                <Alert tone="info">{t('site.m.consentNote')}</Alert>
              </div>
            )}
            <div className="sm:col-span-2">
              <Button
                type="submit"
                loading={sending}
                disabled={
                  !file ||
                  (form.minors && !form.consent.trim()) ||
                  ((form.kind === 'GALLERY' || form.kind === 'NEWS') &&
                    !form.alt.trim() &&
                    !form.altAr.trim())
                }
              >
                {t('site.m.send')}
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

// ─── Actualités ───

function NewsTab({
  site,
  rights,
  media,
}: {
  site: SiteView;
  rights: SiteRights;
  media: MediaView[];
}) {
  const { t } = useSchoolText();
  const news = useApi<NewsView[]>(`/school/sites/${site.id}/news`);
  const [error, setError] = useState<ApiError | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const empty = { title: '', titleAr: '', body: '', bodyAr: '', publishedOn: today, mediaId: '' };
  const [form, setForm] = useState(empty);
  const editable = can(rights, 'school.site.manage');

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      news.reload();
    } catch (err) {
      setError(toApiError(err));
    }
  }
  const images = media.filter((m) => !m.withdrawnAt);
  return (
    <Card>
      <CardBody>
        <ApiErrorAlert error={error} />
        {news.state === 'loading' ? (
          <LoadingState />
        ) : news.state === 'error' ? (
          <ErrorState error={news.error} onRetry={news.reload} />
        ) : news.data.length === 0 ? (
          <p className="text-sm text-muted">{t('site.n.none')}</p>
        ) : (
          <ul className="divide-y divide-line/70 text-sm" data-testid="site-news-admin">
            {news.data.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span dir="auto" className="font-medium">
                    {n.title || n.titleAr}
                  </span>
                  <span className="ms-2 text-muted" dir="ltr">
                    {n.publishedOn.slice(0, 10)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={n.status === 'PUBLISHED' ? 'forest' : 'neutral'}>
                    {n.status === 'PUBLISHED' ? t('site.n.published') : t('site.n.draft')}
                  </Badge>
                  {n.status === 'DRAFT'
                    ? can(rights, 'school.site.publish') && (
                        <Button
                          size="sm"
                          onClick={() =>
                            void run(() =>
                              api(`/school/sites/${site.id}/news/${n.id}/status`, {
                                method: 'PUT',
                                body: { publish: true },
                              }),
                            )
                          }
                        >
                          {t('site.n.publish')}
                        </Button>
                      )
                    : can(rights, 'school.site.publish', true) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void run(() =>
                              api(`/school/sites/${site.id}/news/${n.id}/status`, {
                                method: 'PUT',
                                body: { publish: false },
                              }),
                            )
                          }
                        >
                          {t('site.n.unpublish')}
                        </Button>
                      )}
                  {can(rights, 'school.site.manage', true) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void run(() =>
                          api(`/school/sites/${site.id}/news/${n.id}`, { method: 'DELETE' }),
                        )
                      }
                    >
                      {t('site.n.delete')}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {editable && (
          <form
            className="mt-5 grid gap-3 border-t border-line pt-4 sm:grid-cols-2"
            data-testid="site-news-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api(`/school/sites/${site.id}/news`, {
                  method: 'POST',
                  body: { ...form, mediaId: form.mediaId || null },
                });
                setForm(empty);
              });
            }}
          >
            <InputField
              label={t('site.n.title')}
              maxLength={160}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            {site.languages.includes('ar') && (
              <InputField
                label={t('site.n.titleAr')}
                dir="rtl"
                lang="ar"
                maxLength={160}
                value={form.titleAr}
                onChange={(e) => setForm({ ...form, titleAr: e.target.value })}
              />
            )}
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-medium">{t('site.n.body')}</span>
              <textarea
                rows={4}
                maxLength={8000}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                className="w-full rounded-xl border border-line bg-surface px-3 py-2"
              />
            </label>
            {site.languages.includes('ar') && (
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block font-medium">{t('site.n.bodyAr')}</span>
                <textarea
                  rows={4}
                  dir="rtl"
                  lang="ar"
                  maxLength={8000}
                  value={form.bodyAr}
                  onChange={(e) => setForm({ ...form, bodyAr: e.target.value })}
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2"
                />
              </label>
            )}
            <InputField
              label={t('site.n.date')}
              type="date"
              required
              value={form.publishedOn}
              onChange={(e) => setForm({ ...form, publishedOn: e.target.value })}
            />
            <SelectField
              label={t('site.n.image')}
              value={form.mediaId}
              onChange={(e) => setForm({ ...form, mediaId: e.target.value })}
              options={[
                { value: '', label: t('site.n.noImage') },
                ...images.map((m) => ({
                  value: m.id,
                  label: m.alt || m.altAr || m.id.slice(0, 8),
                })),
              ]}
            />
            <div className="sm:col-span-2">
              <Button
                type="submit"
                disabled={!(form.title || form.titleAr) || !(form.body || form.bodyAr)}
              >
                {t('site.n.add')}
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

// ─── Réseaux sociaux et liens ───

function LinksTab({ site, rights }: { site: SiteView; rights: SiteRights }) {
  const { t } = useSchoolText();
  const links = useApi<LinkView[]>(`/school/sites/${site.id}/links`);
  const [error, setError] = useState<ApiError | null>(null);
  const [form, setForm] = useState<{ kind: SchoolSiteLinkKind; url: string; label: string }>({
    kind: 'FACEBOOK',
    url: '',
    label: '',
  });
  const [editing, setEditing] = useState<{ id: string; url: string; label: string } | null>(null);
  const editable = can(rights, 'school.site.manage');
  const loaded = links.state === 'success' ? links.data : null;

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      links.reload();
    } catch (err) {
      setError(toApiError(err));
    }
  }
  const move = (index: number, delta: number) => {
    if (!loaded) return;
    const ids = loaded.map((l) => l.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved!);
    void run(() => api(`/school/sites/${site.id}/links-order`, { method: 'PUT', body: { ids } }));
  };
  const label = (k: SchoolSiteLinkKind) =>
    k === 'OTHER' ? t('site.l.other') : SCHOOL_SITE_LINK_LABELS[k];
  return (
    <Card>
      <CardBody>
        <ApiErrorAlert error={error} />
        <p className="mb-3 text-xs text-muted">{t('site.l.whatsappHint')}</p>
        {links.state === 'loading' ? (
          <LoadingState />
        ) : links.state === 'error' ? (
          <ErrorState error={links.error} onRetry={links.reload} />
        ) : links.data.length === 0 ? (
          <p className="text-sm text-muted">{t('site.l.none')}</p>
        ) : (
          <ol className="divide-y divide-line/70 text-sm" data-testid="site-links">
            {links.data.map((l, i) => (
              <li
                key={l.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
                data-testid="site-link"
              >
                {editing?.id === l.id ? (
                  <form
                    className="flex flex-1 flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        await api(`/school/sites/${site.id}/links/${l.id}`, {
                          method: 'PATCH',
                          body: { url: editing.url, label: editing.label },
                        });
                        setEditing(null);
                      });
                    }}
                  >
                    <InputField
                      label={t('site.l.url')}
                      dir="ltr"
                      value={editing.url}
                      onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                    />
                    <InputField
                      label={t('site.l.label')}
                      value={editing.label}
                      onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                    />
                    <Button size="sm" type="submit">
                      {t('site.l.save')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      onClick={() => setEditing(null)}
                    >
                      {t('site.l.cancel')}
                    </Button>
                  </form>
                ) : (
                  <>
                    <span className="min-w-0">
                      <span className="font-medium">{l.label || label(l.kind)}</span>
                      <span className="ms-2 break-all text-muted" dir="ltr">
                        {l.url}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1">
                      <Badge tone={l.enabled ? 'forest' : 'neutral'}>
                        {l.enabled ? t('site.l.enabled') : t('site.l.disabled')}
                      </Badge>
                      {editable && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={i === 0}
                            aria-label={`${t('site.l.up')} — ${l.label || label(l.kind)}`}
                            onClick={() => move(i, -1)}
                          >
                            ↑
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={i === links.data.length - 1}
                            aria-label={`${t('site.l.down')} — ${l.label || label(l.kind)}`}
                            onClick={() => move(i, 1)}
                          >
                            ↓
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              void run(() =>
                                api(`/school/sites/${site.id}/links/${l.id}`, {
                                  method: 'PATCH',
                                  body: { enabled: !l.enabled },
                                }),
                              )
                            }
                          >
                            {l.enabled ? t('site.l.disable') : t('site.l.enable')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing({ id: l.id, url: l.url, label: l.label })}
                          >
                            {t('site.l.edit')}
                          </Button>
                        </>
                      )}
                      {can(rights, 'school.site.manage', true) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void run(() =>
                              api(`/school/sites/${site.id}/links/${l.id}`, { method: 'DELETE' }),
                            )
                          }
                        >
                          {t('site.l.delete')}
                        </Button>
                      )}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
        {editable && (
          <form
            className="mt-5 grid gap-3 border-t border-line pt-4 sm:grid-cols-4"
            data-testid="site-link-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api(`/school/sites/${site.id}/links`, { method: 'POST', body: form });
                setForm({ ...form, url: '', label: '' });
              });
            }}
          >
            <SelectField
              label={t('site.l.kind')}
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as SchoolSiteLinkKind })}
              options={SCHOOL_SITE_LINK_KINDS.map((k) => ({ value: k, label: label(k) }))}
            />
            <InputField
              label={t('site.l.url')}
              dir="ltr"
              required
              maxLength={500}
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
            />
            <InputField
              label={t('site.l.label')}
              maxLength={40}
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
            <div className="flex items-end">
              <Button type="submit" disabled={!form.url.trim()}>
                {t('site.l.add')}
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

// ─── Prévisualisation ───

interface PreviewData {
  site: SchoolSitePublished;
  links: SchoolSitePublishedLink[];
  whatsapp: string | null;
  news: (SchoolSitePublishedNews & { status: string })[];
}

/** Aperçu du brouillon (non publié), rendu avec les composants des pages publiques. */
function Preview({
  siteId,
  lang: initial,
  onClose,
}: {
  siteId: string;
  lang: SchoolSiteLanguage;
  onClose: () => void;
}) {
  const { t } = useSchoolText();
  const data = useApi<PreviewData>(`/school/sites/${siteId}/preview`);
  const [lang, setLang] = useState<SchoolSiteLanguage>(initial);
  const [page, setPage] = useState<
    'home' | 'about' | 'teaching' | 'gallery' | 'news' | 'practical' | 'contact'
  >('home');
  const loaded = data.state === 'success' ? data.data : null;
  useEffect(() => {
    if (loaded && !loaded.site.languages.includes(lang)) setLang(loaded.site.defaultLanguage);
  }, [loaded, lang]);
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-charcoal/60 p-2 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t('site.previewTitle')}
    >
      <div className="mx-auto max-w-6xl overflow-hidden rounded-2xl bg-white shadow-lift">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-savanna-light px-4 py-2 text-sm">
          <strong>{t('site.previewTitle')}</strong>
          <span className="flex flex-wrap items-center gap-2">
            {loaded?.site.languages.map((l) => (
              <Button
                key={l}
                size="sm"
                variant={l === lang ? 'primary' : 'ghost'}
                onClick={() => setLang(l)}
              >
                {t(`site.lang.${l}`)}
              </Button>
            ))}
            <select
              aria-label={t('site.tab.content')}
              value={page}
              onChange={(e) => setPage(e.target.value as typeof page)}
              className="rounded border border-line px-2 py-1"
            >
              {(
                ['home', 'about', 'teaching', 'gallery', 'news', 'practical', 'contact'] as const
              ).map((p) => (
                <option key={p} value={p}>
                  {SCHOOL_SITE_PAGE_LABELS[p][lang]}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="secondary"
              onClick={onClose}
              data-testid="site-preview-close"
            >
              {t('site.close')}
            </Button>
          </span>
        </div>
        {data.state === 'loading' ? (
          <LoadingState />
        ) : data.state === 'error' ? (
          <ErrorState error={data.error} onRetry={data.reload} />
        ) : (
          <div data-testid="site-preview-frame">
            <SchoolSiteShell data={data.data} chrome={{ lang, page, base: '', preview: true }}>
              <SchoolSitePageContent
                data={data.data}
                chrome={{ lang, page, base: '', preview: true }}
                newsSlug={null}
              />
            </SchoolSiteShell>
          </div>
        )}
      </div>
    </div>
  );
}
