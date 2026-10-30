'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { SITE_SLUG_ERRORS, siteSlugError } from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { SiteEditor } from '@/components/site/site-editor';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import type { SiteEditorView, SiteOverviewEntry } from '@/lib/types';
import { useApi } from '@/lib/use-api';

/** Site vitrine de chaque établissement : création, édition du brouillon, publication. */
export default function SiteWebPage() {
  const canManage = useCan('site.manage');
  if (!canManage) return <AccessDenied />;
  return (
    <>
      <PageHeader
        eyebrow="Site web"
        title="Site vitrine"
        description="Présentez votre établissement : photos, horaires, coordonnées, menu et tarifs indicatifs. Les modifications restent en brouillon jusqu’à leur publication. Aucune vente ni réservation en ligne."
      />
      <SiteWeb />
    </>
  );
}

function SiteWeb() {
  const overview = useApi<SiteOverviewEntry[]>('/sites');
  const [selected, setSelected] = useState('');
  useEffect(() => {
    if (overview.state === 'success' && !selected && overview.data[0])
      setSelected(overview.data[0].id);
  }, [overview, selected]);
  if (overview.state === 'loading') return <LoadingState />;
  if (overview.state === 'error')
    return <ErrorState error={overview.error} onRetry={overview.reload} />;
  const current = overview.data.find((e) => e.id === selected);
  return (
    <div className="space-y-4">
      {overview.data.length > 1 && (
        <div className="max-w-xs">
          <SelectField
            label="Établissement"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            options={overview.data.map((e) => ({ value: e.id, label: e.name }))}
          />
        </div>
      )}
      {current &&
        (current.site ? (
          <SiteEditor key={current.site.id} siteId={current.site.id} />
        ) : (
          <CreateSite key={current.id} establishment={current} onCreated={overview.reload} />
        ))}
    </div>
  );
}

function CreateSite({
  establishment,
  onCreated,
}: {
  establishment: SiteOverviewEntry;
  onCreated: () => void;
}) {
  const [slug, setSlug] = useState(establishment.suggestedSlug);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const formatError = siteSlugError(slug);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api<SiteEditorView>('/sites', {
        method: 'POST',
        body: { establishmentId: establishment.id, slug },
      });
      onCreated();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={`Créer le site de ${establishment.name}`}
        description="Le site est créé en brouillon : rien n’est visible publiquement avant la publication."
      />
      <form onSubmit={submit} className="space-y-3 px-5 pb-5 sm:px-6">
        <InputField
          label="Adresse publique"
          hint={`Votre site sera accessible à …/e/${slug || 'adresse'}`}
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          error={slug && formatError ? SITE_SLUG_ERRORS[formatError] : undefined}
        />
        <ApiErrorAlert error={error} />
        <Button
          type="submit"
          icon={<Globe className="h-4 w-4" />}
          loading={busy}
          disabled={!!formatError}
        >
          Créer le site
        </Button>
      </form>
    </Card>
  );
}
