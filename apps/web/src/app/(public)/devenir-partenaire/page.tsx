import type { Metadata } from 'next';
import { BadgeCheck, Coins, Globe2, LineChart } from 'lucide-react';
import { PartnerApplicationForm } from '@/components/public/partner-application-form';

export const metadata: Metadata = {
  title: 'Devenir partenaire Ocall',
  description:
    'Rejoignez le réseau Ocall Partner : apporteurs d’affaires et revendeurs agréés pour Ocall Park, Ocall School et les applications Ocall Suite.',
  alternates: { canonical: '/devenir-partenaire' },
};

const BENEFITS = [
  {
    icon: Coins,
    title: 'Commissions sur les ventes encaissées',
    text: 'Calculées sur les montants réellement encaissés, réglées chaque mois (le mois suivant).',
  },
  {
    icon: LineChart,
    title: 'Un portail commercial dédié',
    text: 'Prospects, clients, solde de primes et règlements, sans abonnement à payer.',
  },
  {
    icon: Globe2,
    title: 'Un réseau en Afrique',
    text: 'Commercialisez Ocall Park, Ocall School et les prochaines applications Ocall Suite.',
  },
  {
    icon: BadgeCheck,
    title: 'Un accompagnement Ocall',
    text: 'Démonstrations, activation et support assurés par l’équipe Ocall.',
  },
];

/** Page publique de candidature Ocall Partner (Sprint S3). */
export default function DevenirPartenairePage() {
  return (
    <div className="bg-suite-ivory">
      <section className="relative overflow-hidden bg-suite-green text-suite-ivory">
        <span aria-hidden className="suite-pattern-dark absolute inset-0 opacity-40" />
        <div className="relative mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
          <p className="inline-flex rounded-full bg-suite-gold px-3 py-1 text-xs font-bold uppercase tracking-wide text-suite-ink">
            Ocall Partner
          </p>
          <h1 className="mt-4 max-w-2xl font-display text-3xl font-extrabold sm:text-5xl">
            Devenez partenaire Ocall
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-suite-ivory/85">
            Apporteur d’affaires ou revendeur agréé : accompagnez les entreprises et les écoles de
            votre région vers des outils numériques simples.
          </p>
        </div>
        <div aria-hidden className="suite-frieze h-2" />
      </section>
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_1.4fr]">
        <ul className="space-y-4">
          {BENEFITS.map((b) => (
            <li key={b.title} className="flex gap-3 rounded-2xl bg-white p-4 shadow-card">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-suite-gold-soft text-suite-ink">
                <b.icon className="h-5 w-5" aria-hidden />
              </span>
              <span>
                <span className="block font-semibold text-suite-ink">{b.title}</span>
                <span className="mt-1 block text-sm text-suite-ink-soft">{b.text}</span>
              </span>
            </li>
          ))}
          <li className="rounded-2xl border border-suite-clay/30 bg-suite-clay-soft p-4 text-sm text-suite-ink">
            Les taux de commission sont précisés dans votre contrat de partenariat, après examen de
            votre candidature.
          </li>
        </ul>
        <div className="rounded-3xl border border-suite-ink/5 bg-white p-5 shadow-card sm:p-8">
          <h2 className="mb-5 font-display text-2xl font-extrabold text-suite-green">
            Votre candidature
          </h2>
          <PartnerApplicationForm />
        </div>
      </div>
    </div>
  );
}
