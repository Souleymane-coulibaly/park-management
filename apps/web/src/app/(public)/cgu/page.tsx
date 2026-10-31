import type { Metadata } from 'next';
import { DRAFT_ROBOTS, LegalPage, ToComplete } from '@/components/public/legal-page';

export const metadata: Metadata = { title: 'Conditions d’utilisation', robots: DRAFT_ROBOTS };

export default function CguPage() {
  return (
    <LegalPage eyebrow="Informations" title="Conditions d’utilisation">
      <section>
        <h2>Objet</h2>
        <p>
          Ces conditions encadrent l’utilisation des solutions Ocall Suite. Le texte définitif est{' '}
          <ToComplete>à rédiger et valider juridiquement</ToComplete>.
        </p>
      </section>
      <section>
        <h2>Abonnement et paiement</h2>
        <p>
          Les solutions sont proposées sur abonnement : frais de mise en service unique puis
          abonnement mensuel, en FCFA. Aucun prélèvement ni renouvellement automatique : chaque
          période est réglée sur facture. Conditions de résiliation et de remboursement :{' '}
          <ToComplete>conditions commerciales validées</ToComplete>.
        </p>
      </section>
      <section>
        <h2>Responsabilités et disponibilité</h2>
        <p>
          <ToComplete>
            engagements de service, limitations de responsabilité, droit applicable et juridiction
          </ToComplete>
          .
        </p>
      </section>
    </LegalPage>
  );
}
