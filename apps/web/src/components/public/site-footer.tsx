import Link from 'next/link';
import { Logo } from '@/components/brand/logo';

const COLUMNS = [
  {
    title: 'Solutions',
    links: [
      { href: '/solutions/ocall-park', label: 'Ocall Park' },
      { href: '/solutions/ocall-restaurant', label: 'Ocall Restaurant' },
      { href: '/solutions', label: 'Toutes les solutions' },
      { href: '/tarifs', label: 'Tarifs' },
    ],
  },
  {
    title: 'Ocall Suite',
    links: [
      { href: '/a-propos', label: 'À propos' },
      { href: '/contact', label: 'Contact' },
      { href: '/demo', label: 'Demander une démo' },
      { href: '/connexion', label: 'Connexion' },
    ],
  },
  {
    title: 'Informations',
    links: [
      { href: '/mentions-legales', label: 'Mentions légales' },
      { href: '/confidentialite', label: 'Confidentialité' },
      { href: '/cgu', label: 'Conditions d’utilisation' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="pattern-bogolan bg-charcoal text-ivory/80">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div>
          <Logo inverted product="Suite" />
          <p className="mt-3 max-w-sm text-sm">
            Des logiciels de gestion spécialisés pour les entreprises africaines : parcs aquatiques,
            restaurants, et bientôt écoles, cliniques, ressources humaines, solaire et documents.
          </p>
        </div>
        {COLUMNS.map((c) => (
          <div key={c.title}>
            <p className="mb-3 text-sm font-semibold text-ivory">{c.title}</p>
            <ul className="space-y-2 text-sm">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="hover:text-savanna">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-ivory/10 py-4 text-center text-xs text-ivory/60">
        © {new Date().getFullYear()} Ocall Suite · Prix en FCFA (XOF)
      </div>
    </footer>
  );
}
