import type { Metadata } from 'next';
import { LegalValue, joinLegal, loadLegalIdentity } from '@/components/public/legal-identity';
import { LegalPage } from '@/components/public/legal-page';
import { ButtonLink } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Contacter l’équipe commerciale Ocall Suite.',
  alternates: { canonical: '/contact' },
};

// Coordonnées saisies dans l'administration, relues toutes les 5 minutes.
export const dynamic = 'force-dynamic';

export default async function ContactPage() {
  const id = await loadLegalIdentity();
  const phones = joinLegal(
    [id?.phone, id?.whatsapp && id.whatsapp !== id.phone ? `WhatsApp ${id.whatsapp}` : null],
    ' · ',
  );
  return (
    <LegalPage eyebrow="Contact" title="Nous contacter">
      <section>
        <h2>Équipe commerciale</h2>
        <p>Le plus simple : envoyez une demande de démonstration, l’équipe vous recontacte.</p>
        <div className="mt-4">
          <ButtonLink href="/demo">Demander une démonstration</ButtonLink>
        </div>
      </section>
      <section>
        <h2>Coordonnées</h2>
        <ul className="space-y-1">
          <li>
            Téléphone et WhatsApp : <LegalValue value={phones} missing="numéro" />
          </li>
          <li>
            E-mail : <LegalValue value={id?.email ?? null} missing="adresse e-mail" />
          </li>
          <li>
            Adresse :{' '}
            <LegalValue value={joinLegal([id?.address, id?.city, id?.country])} missing="adresse" />
          </li>
        </ul>
      </section>
      <section>
        <h2>Clients Ocall</h2>
        <p>
          Les clients contactent le support directement depuis leur application (menu « Support
          Ocall »).
        </p>
      </section>
    </LegalPage>
  );
}
