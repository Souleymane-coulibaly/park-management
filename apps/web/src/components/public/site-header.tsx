'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { ButtonLink } from '@/components/ui/button';

const LINKS = [
  { href: '/metiers', label: 'Métiers' },
  { href: '/fonctionnalites', label: 'Fonctionnalités' },
  { href: '/tarifs', label: 'Tarifs' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-line/60 bg-ivory/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="Ocall Park — accueil">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Navigation principale">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${pathname === l.href ? 'text-forest' : 'text-charcoal-soft hover:text-charcoal'}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <ButtonLink href="/connexion" variant="ghost" size="sm">
            Connexion
          </ButtonLink>
          <ButtonLink href="/inscription" size="sm">
            Créer mon compte
          </ButtonLink>
        </div>
        <button
          type="button"
          className="rounded-lg p-2 text-charcoal md:hidden"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>
      {open && (
        <nav
          id="mobile-menu"
          className="border-t border-line/60 bg-ivory px-4 pb-4 pt-2 md:hidden"
          aria-label="Navigation mobile"
        >
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2.5 font-medium"
            >
              {l.label}
            </Link>
          ))}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <ButtonLink href="/connexion" variant="secondary">
              Connexion
            </ButtonLink>
            <ButtonLink href="/inscription">S’inscrire</ButtonLink>
          </div>
        </nav>
      )}
    </header>
  );
}
