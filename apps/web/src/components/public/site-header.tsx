'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { SuiteLogo } from '@/components/brand/suite-logo';
import { TRIAL_DAYS, TRIAL_HREF } from '@/lib/suite-landing';

/**
 * Navigation du site commercial : pas de lien vers des tarifs globaux (les tarifs appartiennent à la
 * page de chaque logiciel), uniquement des pages et ancres existantes.
 */
const LINKS = [
  { href: '/#logiciels', label: 'Nos logiciels' },
  { href: '/solutions', label: 'Nos solutions' },
  { href: '/#ia', label: 'IA Ocall' },
  { href: '/a-propos', label: 'À propos' },
  { href: '/contact', label: 'Contact' },
];

/** En-tête du site commercial Ocall Suite (distinct des sites vitrines des clients). */
export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) =>
    !href.includes('#') && (pathname === href || pathname.startsWith(`${href}/`));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-30 border-b border-suite-ink/5 bg-suite-ivory/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="Ocall Suite — accueil" className="shrink-0">
          <SuiteLogo />
        </Link>
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Navigation principale">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active(l.href) ? 'page' : undefined}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active(l.href) ? 'text-suite-green' : 'text-suite-ink-soft hover:text-suite-ink'}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <Link
            href="/connexion"
            className="rounded-xl border-2 border-suite-green px-4 py-2 text-sm font-semibold text-suite-green transition hover:bg-suite-green-soft"
          >
            Se connecter
          </Link>
          <Link
            href={TRIAL_HREF}
            className="rounded-xl bg-suite-gold px-4 py-2.5 text-sm font-semibold text-suite-ink shadow-sm transition hover:brightness-95"
          >
            Essai gratuit {TRIAL_DAYS} jours
          </Link>
        </div>
        <button
          type="button"
          className="rounded-lg p-2 text-suite-ink lg:hidden"
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
          className="border-t border-suite-ink/5 bg-suite-ivory px-4 pb-4 pt-2 lg:hidden"
          aria-label="Navigation mobile"
        >
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2.5 font-medium text-suite-ink"
            >
              {l.label}
            </Link>
          ))}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link
              href="/connexion"
              onClick={() => setOpen(false)}
              className="rounded-xl border-2 border-suite-green px-3 py-2.5 text-center text-sm font-semibold text-suite-green"
            >
              Se connecter
            </Link>
            <Link
              href={TRIAL_HREF}
              onClick={() => setOpen(false)}
              className="rounded-xl bg-suite-gold px-3 py-2.5 text-center text-sm font-semibold text-suite-ink"
            >
              Essai gratuit
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
