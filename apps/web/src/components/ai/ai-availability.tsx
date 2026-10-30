'use client';

import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import type { AiFeature } from '@ocall/shared';
import { ButtonLink } from '@/components/ui/button';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import type { AiStatus } from '@/lib/types';
import { useApi } from '@/lib/use-api';

/**
 * Affiche le contenu IA seulement si la fonctionnalité est utilisable ; sinon un message clair et
 * un chemin pour continuer sans IA (l'application reste entièrement utilisable).
 */
export function AiFeatureGate({
  feature,
  fallbackHref,
  fallbackLabel,
  children,
}: {
  feature: AiFeature;
  fallbackHref: string;
  fallbackLabel: string;
  children: (status: AiStatus) => ReactNode;
}) {
  const status = useApi<AiStatus>('/ai/status');
  if (status.state === 'loading') return <LoadingState />;
  if (status.state === 'error') return <ErrorState error={status.error} onRetry={status.reload} />;
  const s = status.data;
  const fallback = (
    <ButtonLink href={fallbackHref} variant="secondary" size="sm">
      {fallbackLabel}
    </ButtonLink>
  );
  if (!s.configured) {
    return (
      <div className="space-y-3">
        <Alert tone="info" title="IA non activée sur cette plateforme">
          Vous pouvez continuer sans IA.
        </Alert>
        {fallback}
      </div>
    );
  }
  if (!s.features[feature]) {
    return (
      <div className="space-y-3">
        <Alert tone="info" title="Fonctionnalité désactivée par votre administrateur">
          Vous pouvez continuer sans IA.
        </Alert>
        {fallback}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <AiUsageNotice status={s} />
      {children(s)}
    </div>
  );
}

/** Mode simulé, alerte de consommation ou plafond atteint. */
export function AiUsageNotice({ status }: { status: AiStatus }) {
  return (
    <>
      {status.simulated && (
        <Alert tone="info" title="Mode simulé">
          Fournisseur IA simulé (démonstration et tests) : les résultats ne proviennent pas d’un
          modèle réel.
        </Alert>
      )}
      {status.usage.exceeded ? (
        <Alert tone="error" title="Plafond mensuel d’appels IA atteint">
          {status.usage.used} / {status.usage.limit} appels ce mois-ci. Votre administrateur peut le
          relever dans Paramètres › Intelligence artificielle. Vous pouvez continuer sans IA.
        </Alert>
      ) : (
        status.usage.alert && (
          <Alert tone="info" title="Consommation IA élevée">
            {status.usage.used} / {status.usage.limit} appels ce mois-ci.
          </Alert>
        )
      )}
    </>
  );
}

/** Mention discrète « assisté par IA, vérifié par vous ». */
export function AiBadge({ children = 'Proposé par l’IA, à vérifier' }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-savanna-light px-2.5 py-0.5 text-xs font-semibold text-charcoal">
      <Sparkles className="h-3.5 w-3.5" aria-hidden /> {children}
    </span>
  );
}
