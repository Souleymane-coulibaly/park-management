import type { Metadata } from 'next';
import { LegalPage, ToComplete } from '@/components/public/legal-page';
import { ButtonLink } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Contacter l’équipe commerciale Ocall Suite.',
  alternates: { canonical: '/contact' },
};

export default function ContactPage() {
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
            Téléphone et WhatsApp : <ToComplete>numéro</ToComplete>
          </li>
          <li>
            E-mail : <ToComplete>adresse e-mail</ToComplete>
          </li>
          <li>
            Adresse : <ToComplete>adresse</ToComplete>
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
