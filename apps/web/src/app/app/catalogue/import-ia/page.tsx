'use client';

import { AiFeatureGate } from '@/components/ai/ai-availability';
import { ImportWorkspace } from '@/components/ai/import-workspace';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { RestaurantScope } from '@/components/restaurant/restaurant-scope';
import { PageHeader } from '@/components/ui/page-header';

/** Import IA d'une carte de restaurant (photo ou PDF), avec validation humaine avant publication. */
export default function CatalogImportPage() {
  const canManage = useCan('catalog.manage');
  if (!canManage) return <AccessDenied />;
  return (
    <div>
      <PageHeader
        eyebrow="Catalogue · Intelligence artificielle"
        title="Importer une carte"
        description="Photographiez votre carte : l’IA détecte les plats et les prix, vous vérifiez et corrigez avant de publier."
      />
      <AiFeatureGate
        feature="CATALOG_IMPORT"
        fallbackHref="/app/catalogue"
        fallbackLabel="Saisir le catalogue à la main"
      >
        {() => (
          <RestaurantScope>
            {(e) => <ImportWorkspace kind="catalog" establishmentId={e.id} />}
          </RestaurantScope>
        )}
      </AiFeatureGate>
    </div>
  );
}
