'use client';

import { AiFeatureGate } from '@/components/ai/ai-availability';
import { ImportWorkspace } from '@/components/ai/import-workspace';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { ParkEstablishmentScope } from '@/components/park/park-establishment';
import { PageHeader } from '@/components/ui/page-header';

/** Import IA d'une grille tarifaire de parc : billets créés désactivés, activation explicite ensuite. */
export default function TicketImportPage() {
  const canManage = useCan('ticketing.manage');
  if (!canManage) return <AccessDenied />;
  return (
    <div>
      <PageHeader
        eyebrow="Billetterie · Intelligence artificielle"
        title="Importer une grille tarifaire"
        description="Photographiez vos tarifs : l’IA propose les billets, vous vérifiez. Les billets sont créés désactivés."
      />
      <AiFeatureGate
        feature="TICKET_IMPORT"
        fallbackHref="/app/billetterie/configuration"
        fallbackLabel="Saisir les tarifs à la main"
      >
        {() => (
          <ParkEstablishmentScope source="/ticketing/establishments">
            {(e) => <ImportWorkspace kind="tickets" establishmentId={e.id} />}
          </ParkEstablishmentScope>
        )}
      </AiFeatureGate>
    </div>
  );
}
