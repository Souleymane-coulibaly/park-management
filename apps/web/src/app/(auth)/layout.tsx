import Link from 'next/link';
import type { ReactNode } from 'react';
import { GraduationCap, ShieldCheck, Sparkles, Ticket } from 'lucide-react';
import { SuiteLogo } from '@/components/brand/suite-logo';

/**
 * Écrans d'authentification (connexion, mot de passe, double authentification, inscription), communs à
 * tous les logiciels Ocall : identité Ocall Suite, formulaire à gauche, panneau identitaire à droite.
 * Présentation seulement : la logique des formulaires est inchangée.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-suite-ivory lg:grid-cols-[1fr_minmax(0,0.9fr)]">
      <div className="flex flex-col px-4 py-6 sm:px-10">
        <Link href="/" aria-label="Retour à l’accueil Ocall Suite" className="w-fit">
          <SuiteLogo />
        </Link>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-md rounded-3xl border border-suite-ink/5 bg-white p-6 shadow-card sm:p-8">
            {children}
          </div>
        </main>
        <p className="text-center text-xs text-suite-ink-soft">
          Un seul compte pour vos logiciels Ocall ·{' '}
          <Link href="/confidentialite" className="underline-offset-2 hover:underline">
            Confidentialité
          </Link>
        </p>
      </div>
      <aside className="relative hidden overflow-hidden bg-suite-green lg:block" aria-hidden>
        <div className="suite-pattern-dark absolute inset-0" />
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-suite-gold/20" />
        <div className="absolute -bottom-28 -left-16 h-80 w-80 rounded-full bg-suite-clay/20" />
        <div className="suite-frieze absolute inset-x-0 bottom-0 h-2.5" />
        <div className="relative flex h-full flex-col justify-center px-14 text-suite-ivory">
          <p className="font-display text-5xl font-extrabold leading-[1.05]">
            Gérez moins.
            <span className="block text-suite-gold">Développez plus.</span>
          </p>
          <p className="mt-5 max-w-sm text-suite-ivory/80">
            Retrouvez vos logiciels Ocall : votre établissement, vos équipes et vos données, en
            toute sécurité.
          </p>
          <ul className="mt-8 space-y-3 text-sm">
            {[
              { icon: GraduationCap, label: 'Ocall School — établissements scolaires' },
              { icon: Ticket, label: 'Ocall Park — parcs, restaurants et loisirs' },
              { icon: Sparkles, label: 'Assistants IA intégrés' },
              { icon: ShieldCheck, label: 'Accès par rôle et données isolées' },
            ].map((item) => (
              <li key={item.label} className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-suite-ivory/10 text-suite-gold">
                  <item.icon className="h-5 w-5" />
                </span>
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
