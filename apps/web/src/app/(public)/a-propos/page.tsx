import type { Metadata } from 'next';
import { LegalPage, ToComplete } from '@/components/public/legal-page';
import { ButtonLink } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'À propos',
  description:
    'Ocall Suite conçoit des logiciels de gestion spécialisés pour les entreprises africaines.',
  alternates: { canonical: '/a-propos' },
};

export default function AProposPage() {
  return (
    <LegalPage
      eyebrow="Ocall Suite"
      title="À propos"
      description="Des logiciels de gestion simples, spécialisés et pensés pour l’Afrique."
    >
      <section>
        <h2>Notre mission</h2>
        <p>
          Aider les entreprises africaines à mieux gérer leur activité grâce à des applications en
          ligne spécialisées par métier : simples à utiliser, adaptées aux réalités locales (mobile
          money, connexions mobiles, prix en FCFA) et accompagnées par une équipe proche.
        </p>
      </section>
      <section>
        <h2>Nos solutions</h2>
        <p>
          Ocall Park et Ocall Restaurant sont disponibles. Ocall School, Ocall Clinic, Ocall RH,
          Ocall Solar et Ocall Docs sont en préparation.
        </p>
      </section>
      <section>
        <h2>L’entreprise</h2>
        <p>
          <ToComplete>
            présentation de l’entreprise, fondateurs, implantation, chiffres validés
          </ToComplete>
          .
        </p>
      </section>
      <ButtonLink href="/demo">Demander une démonstration</ButtonLink>
    </LegalPage>
  );
}
