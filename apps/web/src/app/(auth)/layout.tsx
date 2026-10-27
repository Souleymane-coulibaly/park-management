import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';

/** Mise en page des écrans d'authentification : formulaire à gauche, panneau identitaire à droite. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_minmax(0,0.9fr)]">
      <div className="flex flex-col px-4 py-6 sm:px-10">
        <Link href="/" aria-label="Retour à l’accueil">
          <Logo />
        </Link>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-md">{children}</div>
        </main>
      </div>
      <aside className="relative hidden overflow-hidden bg-forest lg:block" aria-hidden>
        <div className="pattern-bogolan absolute inset-0" />
        <div className="pattern-kente absolute inset-x-0 bottom-0 h-40 opacity-60" />
        <div className="relative flex h-full flex-col justify-center px-14 text-ivory">
          <p className="font-display text-4xl font-bold leading-tight">
            Vos établissements,
            <br />
            vos équipes, <span className="text-savanna">un seul outil.</span>
          </p>
          <p className="mt-4 max-w-sm text-ivory/75">
            Parcs aquatiques, espaces de loisirs et restaurants gérés avec rigueur, en FCFA et en
            français.
          </p>
        </div>
      </aside>
    </div>
  );
}
