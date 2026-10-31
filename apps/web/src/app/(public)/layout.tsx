import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/public/site-footer';
import { SiteHeader } from '@/components/public/site-header';

const SITE_URL = process.env.SUITE_PUBLIC_URL ?? 'http://localhost:3000';
const DESCRIPTION =
  'Ocall Suite : des logiciels de gestion en ligne pour les entreprises africaines — parcs aquatiques, restaurants, et bientôt écoles, cliniques, RH, solaire et documents.';

/**
 * Site commercial Ocall Suite. Ces métadonnées ne concernent que ce groupe de pages : les sites
 * vitrines des clients (/e/[slug]) gardent les leurs.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Ocall Suite — logiciels de gestion pour l’Afrique',
    template: '%s · Ocall Suite',
  },
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    siteName: 'Ocall Suite',
    locale: 'fr_FR',
    title: 'Ocall Suite',
    description: DESCRIPTION,
  },
  alternates: { canonical: '/' },
};

const ORGANIZATION_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Ocall Suite',
  url: SITE_URL,
  description: DESCRIPTION,
};

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-forest focus:px-4 focus:py-2 focus:text-ivory"
      >
        Aller au contenu
      </a>
      <SiteHeader />
      <main id="contenu" className="flex-1">
        {children}
      </main>
      <SiteFooter />
      <script
        type="application/ld+json"
        // Contenu statique, sans donnée utilisateur.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_LD) }}
      />
    </div>
  );
}
