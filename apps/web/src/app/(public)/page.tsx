import type { Metadata } from 'next';
import {
  SuiteAi,
  SuiteBenefits,
  SuiteHero,
  SuitePortal,
  SuiteProducts,
  SuiteTrial,
} from '@/components/suite/landing-sections';

/**
 * Page d'accueil commerciale Ocall Suite (SUITE-S01, premier livrable).
 * Contenu statique (src/lib/suite-landing.ts) : aucun tarif global, aucun chiffre inventé, aucun
 * appel à l'API au rendu (la page reste disponible même si l'API ne répond pas).
 */
export const metadata: Metadata = {
  title: { absolute: 'Ocall Suite — Gérez moins. Développez plus.' },
  description:
    'Ocall Suite : des logiciels de gestion intelligents pour l’éducation, la restauration, les loisirs et la gestion commerciale. Gagnez du temps, sécurisez vos activités, développez vos revenus.',
  alternates: { canonical: '/' },
  // Remplace en entier l'openGraph du gabarit (pas de fusion) : siteName, type et langue redonnés.
  openGraph: {
    type: 'website',
    siteName: 'Ocall Suite',
    locale: 'fr_FR',
    title: 'Ocall Suite — Gérez moins. Développez plus.',
    description:
      'Des logiciels intelligents pour gagner du temps, sécuriser vos activités et développer vos revenus.',
    url: '/',
  },
};

export default function HomePage() {
  return (
    <>
      <SuiteHero />
      <SuiteBenefits />
      <SuiteProducts />
      <SuiteAi />
      <SuitePortal />
      <SuiteTrial />
    </>
  );
}
