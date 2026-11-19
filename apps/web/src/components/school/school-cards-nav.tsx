'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/school/cartes', label: 'Cartes' },
  { href: '/school/cartes/commandes', label: 'Commandes' },
  { href: '/school/cartes/modeles', label: 'Modèles' },
  { href: '/school/personnel', label: 'Personnel' },
  { href: '/school/cartes/verifier', label: 'Vérifier une carte' },
  { href: '/school/cartes/reprise', label: 'Reprise Ocall Print' },
];

/** Sous-navigation des cartes scolaires et badges (Ocall Print). */
export function SchoolCardsNav() {
  const path = usePathname();
  return (
    <nav aria-label="Cartes et badges" className="flex gap-1 overflow-x-auto border-b border-line">
      {LINKS.map((l) => {
        const active = l.href === '/school/cartes' ? path === l.href : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? 'page' : undefined}
            className={`min-h-11 whitespace-nowrap px-3 py-3 text-sm font-medium ${
              active ? 'border-b-2 border-forest text-forest' : 'text-muted hover:text-charcoal'
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
