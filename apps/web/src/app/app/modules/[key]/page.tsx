'use client';

import { use } from 'react';
import { Hourglass } from 'lucide-react';
import { ModuleIcon } from '@/components/app/module-icon';
import { UpcomingBadge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

interface ModuleView {
  key: string;
  label: string;
  description: string;
  status: 'available' | 'upcoming';
}

/** Page d'un module futur. L'accès est vérifié par l'API selon le métier (403 hors métier). */
export default function ModulePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const moduleView = useApi<ModuleView>(`/modules/${encodeURIComponent(key)}`);

  if (moduleView.state === 'loading') return <LoadingState />;
  if (moduleView.state === 'error') return <ErrorState error={moduleView.error} />;

  const m = moduleView.data;
  return (
    <>
      <PageHeader title={m.label} description={m.description} action={<UpcomingBadge />} />
      <Card>
        <EmptyState
          icon={<ModuleIcon moduleKey={m.key} className="h-7 w-7" />}
          title="Module en préparation"
          description={`Le module ${m.label} n’est pas encore opérationnel. Il sera activé pour votre organisation dès sa mise à disposition, sans action de votre part.`}
          action={
            <ButtonLink href="/app" variant="secondary">
              <Hourglass className="h-4 w-4" /> Retour au tableau de bord
            </ButtonLink>
          }
        />
      </Card>
    </>
  );
}
