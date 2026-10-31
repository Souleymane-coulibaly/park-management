import type { Metadata } from 'next';
import { DRAFT_ROBOTS, LegalPage, ToComplete } from '@/components/public/legal-page';

export const metadata: Metadata = { title: 'Mentions légales', robots: DRAFT_ROBOTS };

export default function MentionsLegalesPage() {
  return (
    <LegalPage eyebrow="Informations" title="Mentions légales">
      <section>
        <h2>Éditeur du site</h2>
        <ul className="mt-2 space-y-1">
          <li>
            Raison sociale : <ToComplete>raison sociale</ToComplete>
          </li>
          <li>
            Forme juridique et capital : <ToComplete>forme juridique, capital</ToComplete>
          </li>
          <li>
            Siège social : <ToComplete>adresse du siège</ToComplete>
          </li>
          <li>
            Immatriculation : <ToComplete>RCCM et NIF</ToComplete>
          </li>
          <li>
            Directeur de la publication : <ToComplete>nom et fonction</ToComplete>
          </li>
          <li>
            Contact : <ToComplete>e-mail et téléphone</ToComplete>
          </li>
        </ul>
      </section>
      <section>
        <h2>Hébergement</h2>
        <p>
          Application hébergée dans une région européenne, chez{' '}
          <ToComplete>hébergeur(s), raison sociale et adresse</ToComplete>.
        </p>
      </section>
      <section>
        <h2>Propriété intellectuelle</h2>
        <p>
          Les marques Ocall Suite, Ocall Park et leurs logos, ainsi que les contenus de ce site,
          sont protégés. Toute reproduction sans autorisation est interdite.
        </p>
      </section>
    </LegalPage>
  );
}
