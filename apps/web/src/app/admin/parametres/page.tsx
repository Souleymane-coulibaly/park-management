'use client';

import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingState } from '@/components/ui/states';
import type { PlatformSettings } from '@/lib/types';
import { useApi } from '@/lib/use-api';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-line/60 py-2 text-sm last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

const yes = (ok: boolean, on = 'Oui', off = 'Non') => (
  <Badge tone={ok ? 'forest' : 'terracotta'}>{ok ? on : off}</Badge>
);

/**
 * Paramètres généraux de la plateforme, en lecture seule : ils se règlent par variables
 * d'environnement sur l'hébergeur (aucun secret affiché, seulement leur présence).
 */
export default function PlatformSettingsPage() {
  const settings = useApi<PlatformSettings>('/platform/settings');
  return (
    <>
      <PageHeader
        eyebrow="Ocall Suite"
        title="Paramètres généraux"
        description="Lecture seule : la configuration se modifie sur l’hébergeur (voir docs/PRODUCTION.md). Aucun secret n’est affiché."
      />
      {settings.state === 'loading' && <LoadingState />}
      {settings.state === 'error' && (
        <ErrorState error={settings.error} onRetry={settings.reload} />
      )}
      {settings.state === 'success' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Environnement et sécurité" />
            <CardBody>
              <dl>
                <Row label="Environnement">{settings.data.environment}</Row>
                <Row label="Double authentification configurée">
                  {yes(settings.data.security.mfaConfigured)}
                </Row>
                <Row label="Cookie sécurisé (HTTPS)">
                  {yes(settings.data.security.cookieSecure)}
                </Row>
                <Row label="Durée de session">{settings.data.security.sessionTtlHours} h</Row>
                <Row label="Verrouillage après échecs">
                  {settings.data.security.accountLockThreshold}
                </Row>
                <Row label="Format des journaux">{settings.data.logFormat}</Row>
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Services" />
            <CardBody>
              <dl>
                <Row label="Fournisseur IA">{settings.data.ai.provider}</Row>
                <Row label="Stockage">
                  {settings.data.storage.driver}{' '}
                  {yes(settings.data.storage.healthy, 'Disponible', 'Indisponible')}
                </Row>
                <Row label="Bucket">{settings.data.storage.bucket ?? '—'}</Row>
                <Row label="Origine des sites">{settings.data.sites.publicOrigin}</Row>
                <Row label="Sous-domaines">
                  {settings.data.sites.subdomainsEnabled
                    ? settings.data.sites.baseDomain
                    : 'Désactivés'}
                </Row>
                <Row label="Paiements des abonnements">{settings.data.payments}</Row>
              </dl>
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
