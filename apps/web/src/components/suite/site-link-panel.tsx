'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/field';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

/** Établissement du référentiel Suite, vu par une application (Stock, School). */
interface RegistryEstablishment {
  id: string;
  name: string;
  city: string | null;
  /** Fiche de l'application déjà rattachée (stockSiteId ou schoolId) ; null si libre. */
  linkedId: string | null;
}

interface Registry {
  establishments: RegistryEstablishment[];
  suggestions: { appSiteId: string; establishmentId: string; reason: 'same-name' | 'same-city' }[];
}

export interface SiteLinkLabels {
  title: string;
  linked: (name: string) => string;
  none: string;
  choose: string;
  suggestion: string;
  link: string;
  create: string;
  unlink: string;
}

/** Libellés français par défaut (Stock) ; School fournit les siens (français ou arabe). */
export const SITE_LINK_LABELS_FR: SiteLinkLabels = {
  title: 'Site du référentiel Ocall Suite',
  linked: (name) => `Rattaché à « ${name} »`,
  none: 'Pas encore rattaché : choisissez le lieu existant, ou créez-le dans le référentiel.',
  choose: 'Lieu du référentiel',
  suggestion: 'suggestion',
  link: 'Rattacher',
  create: 'Créer dans le référentiel',
  unlink: 'Retirer le rattachement',
};

/**
 * Ocall Suite Sprint 2B : rattachement d'une fiche d'application (site Stock, école) à un lieu du
 * référentiel commun. Les correspondances proposées (même nom, même ville) ne sont que des suggestions :
 * rien n'est rattaché sans clic explicite.
 */
export function SiteLinkPanel({
  registryPath,
  linkPath,
  appSiteId,
  establishmentId,
  normalize,
  labels = SITE_LINK_LABELS_FR,
  onDone,
}: {
  registryPath: string;
  linkPath: string;
  appSiteId: string;
  establishmentId: string | null;
  /** Adapte la réponse de l'application (stockSiteId / schoolId) au format commun. */
  normalize: (raw: unknown) => Registry;
  labels?: SiteLinkLabels;
  onDone: () => void;
}) {
  const registry = useApi<unknown>(registryPath);
  const [chosen, setChosen] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api(linkPath, { method: 'PUT', body });
      registry.reload();
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.'));
    } finally {
      setBusy(false);
    }
  }

  if (registry.state === 'loading') return <LoadingState />;
  if (registry.state === 'error') {
    return <ErrorState error={registry.error} onRetry={registry.reload} />;
  }
  const data = normalize(registry.data);
  const current = data.establishments.find((e) => e.id === establishmentId) ?? null;
  const suggested = new Map(
    data.suggestions.filter((s) => s.appSiteId === appSiteId).map((s) => [s.establishmentId, s]),
  );
  const free = data.establishments
    .filter((e) => !e.linkedId || e.linkedId === appSiteId)
    .sort((a, b) => Number(suggested.has(b.id)) - Number(suggested.has(a.id)));
  return (
    <div className="space-y-3" data-testid="site-link-panel">
      <p className="text-sm font-semibold">{labels.title}</p>
      <ApiErrorAlert error={error} />
      <p className="text-sm text-muted" data-testid="site-link-status">
        {current ? labels.linked(current.name) : labels.none}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 sm:max-w-sm">
          <SelectField
            label={labels.choose}
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
            options={[
              { value: '', label: '—' },
              ...free.map((e) => ({
                value: e.id,
                label: `${e.name}${e.city ? ` · ${e.city}` : ''}${suggested.has(e.id) ? ` (${labels.suggestion})` : ''}`,
              })),
            ]}
          />
        </div>
        <Button
          variant="secondary"
          disabled={!chosen || chosen === establishmentId}
          loading={busy}
          onClick={() => void send({ establishmentId: chosen })}
        >
          {labels.link}
        </Button>
        {!current && (
          <Button
            variant="secondary"
            loading={busy}
            onClick={() => void send({ createEstablishment: true })}
          >
            {labels.create}
          </Button>
        )}
        {current && (
          <Button
            variant="ghost"
            loading={busy}
            onClick={() => void send({ establishmentId: null })}
          >
            {labels.unlink}
          </Button>
        )}
      </div>
    </div>
  );
}
