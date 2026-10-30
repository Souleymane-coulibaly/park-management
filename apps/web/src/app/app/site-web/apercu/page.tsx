'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import type { PublishedSite } from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { SiteView } from '@/components/site/site-view';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

/**
 * Aperçu du BROUILLON, réservé à l'éditeur (espace authentifié, jamais indexé) : rendu identique au
 * site public, avec un bandeau. Rien n'est publié.
 */
export default function SitePreviewPage() {
  const canManage = useCan('site.manage');
  if (!canManage) return <AccessDenied />;
  return (
    <Suspense fallback={<LoadingState />}>
      <Preview />
    </Suspense>
  );
}

function Preview() {
  const siteId = useSearchParams().get('site');
  const preview = useApi<{ site: PublishedSite; warnings: string[] }>(
    siteId && /^[0-9a-f-]{36}$/.test(siteId) ? `/sites/${siteId}/preview` : null,
  );
  if (!siteId) return <p className="p-6">Site non précisé.</p>;
  if (preview.state === 'loading') return <LoadingState />;
  if (preview.state === 'error')
    return <ErrorState error={preview.error} onRetry={preview.reload} />;
  return (
    <div className="-m-4 sm:-m-6" data-testid="site-preview">
      <SiteView
        site={preview.data.site}
        banner={
          <div className="bg-savanna px-4 py-2 text-center text-sm font-semibold text-charcoal">
            Aperçu du brouillon — non publié, invisible du public.
            {preview.data.warnings.length > 0 && ` ${preview.data.warnings.join(' ')}`}
          </div>
        }
      />
    </div>
  );
}
