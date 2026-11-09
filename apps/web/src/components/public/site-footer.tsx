import Link from 'next/link';
import { SuiteLogo } from '@/components/brand/suite-logo';

/**
 * Pied de page du site commercial. Uniquement des pages existantes ; aucune adresse, aucun téléphone
 * ni réseau social inventés (à ajouter ici quand les informations officielles existent).
 */
const COLUMNS = [
  {
    title: 'Logiciels',
    links: [
      { href: '/solutions/ocall-school', label: 'Ocall School' },
      { href: '/solutions/ocall-park', label: 'Ocall Park' },
      { href: '/solutions/ocall-restaurant', label: 'Ocall Restaurant' },
      { href: '/solutions', label: 'Toutes les solutions' },
    ],
  },
  {
    title: 'Ocall Suite',
    links: [
      { href: '/a-propos', label: 'À propos' },
      { href: '/contact', label: 'Contact' },
      { href: '/demo', label: 'Demander une démo' },
      { href: '/devenir-partenaire', label: 'Devenir partenaire' },
      { href: '/connexion', label: 'Se connecter' },
    ],
  },
  {
    title: 'Informations',
    links: [
      { href: '/mentions-legales', label: 'Mentions légales' },
      { href: '/confidentialite', label: 'Politique de confidentialité' },
      { href: '/cgu', label: 'Conditions d’utilisation' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative bg-suite-green-dark text-suite-ivory/80">
      <div aria-hidden className="suite-frieze h-2.5" />
      <div aria-hidden className="suite-pattern-dark absolute inset-x-0 bottom-0 top-2.5" />
      <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div>
          <SuiteLogo inverted />
          <p className="mt-4 max-w-sm text-sm leading-relaxed">
            Ocall Suite réunit des logiciels de gestion pensés pour les entreprises et les
            établissements africains : éducation, restauration, loisirs et, bientôt, gestion
            commerciale.
          </p>
        </div>
        {COLUMNS.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <p className="mb-3 text-sm font-semibold text-suite-ivory">{c.title}</p>
            <ul className="space-y-2 text-sm">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="transition-colors hover:text-suite-gold focus-visible:text-suite-gold"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="relative border-t border-suite-ivory/10 py-4 text-center text-xs text-suite-ivory/60">
        © {new Date().getFullYear()} Ocall Suite
      </div>
    </footer>
  );
}
