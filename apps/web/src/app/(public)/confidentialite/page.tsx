import type { Metadata } from 'next';
import { DRAFT_ROBOTS, LegalPage, ToComplete } from '@/components/public/legal-page';

export const metadata: Metadata = { title: 'Politique de confidentialité', robots: DRAFT_ROBOTS };

export default function ConfidentialitePage() {
  return (
    <LegalPage
      eyebrow="Informations"
      title="Politique de confidentialité"
      description="Comment Ocall Suite traite les données personnelles."
    >
      <section>
        <h2>Responsable du traitement</h2>
        <p>
          <ToComplete>raison sociale, adresse et contact du responsable du traitement</ToComplete>.
        </p>
      </section>
      <section>
        <h2>Demandes de démonstration</h2>
        <p>
          Données collectées : nom, entreprise, pays, téléphone, e-mail, produit souhaité et
          message. Finalité : vous recontacter au sujet de votre demande. Base : votre consentement,
          donné dans le formulaire. Accès : équipe commerciale et support d’Ocall uniquement. Aucune
          revente, aucun envoi automatique de messages.
        </p>
        <p className="mt-2">
          Durée de conservation : 24 mois au plus, puis anonymisation automatique.
        </p>
      </section>
      <section>
        <h2>Clients des solutions Ocall</h2>
        <p>
          Les données saisies par une entreprise cliente dans son application restent les siennes :
          elles ne sont accessibles qu’à ses utilisateurs autorisés et, pour le support, aux agents
          Ocall habilités. Les paiements par carte sont traités par le prestataire de paiement :
          Ocall ne reçoit ni ne conserve aucune donnée de carte.
        </p>
      </section>
      <section>
        <h2>Vos droits</h2>
        <p>
          Vous pouvez demander l’accès, la rectification ou la suppression de vos données en
          écrivant à <ToComplete>adresse e-mail dédiée</ToComplete>.
        </p>
      </section>
      <section>
        <h2>Cadre légal applicable</h2>
        <p>
          <ToComplete>
            références légales validées (protection des données au Mali, RGPD le cas échéant)
          </ToComplete>
          .
        </p>
      </section>
    </LegalPage>
  );
}
