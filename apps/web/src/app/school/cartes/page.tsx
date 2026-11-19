'use client';

import { SchoolCardsManager } from '@/components/school/school-cards';
import { SchoolCardsNav } from '@/components/school/school-cards-nav';
import { SchoolPage } from '@/components/school/school-page';

/** Cartes scolaires et badges : moteur commun Ocall Print, impression à l'atelier Ocall de Bamako. */
export default function SchoolCardsPage() {
  return (
    <SchoolPage
      title={() => 'Cartes et badges'}
      description={() =>
        'Cartes scolaires et badges du personnel : création depuis les fiches, aperçu recto verso, commande à l’atelier Ocall (3 000 FCFA par carte, payés à la livraison).'
      }
    >
      {(page) => (
        <div className="space-y-4">
          <SchoolCardsNav />
          {page.school && <SchoolCardsManager key={page.school.id} page={page} />}
        </div>
      )}
    </SchoolPage>
  );
}
