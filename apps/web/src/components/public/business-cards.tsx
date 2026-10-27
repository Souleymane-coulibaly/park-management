import { Layers, UtensilsCrossed, Waves } from 'lucide-react';
import type { BusinessType } from '@ocall/shared';
import type { ReactNode } from 'react';

/** Présentation marketing des trois métiers, partagée par l'accueil, la page Métiers et l'inscription. */
export const BUSINESS_PRESENTATION: Record<
  BusinessType,
  { title: string; tagline: string; icon: ReactNode; points: string[]; accent: string }
> = {
  PARK: {
    title: 'Parc',
    tagline: 'Parcs aquatiques, piscines et espaces de loisirs.',
    icon: <Waves className="h-6 w-6" aria-hidden />,
    points: [
      'Billetterie adultes, enfants et groupes',
      'Tickets QR Code et contrôle des entrées',
      'Planning des équipes et fidélité',
    ],
    accent: 'bg-forest text-ivory',
  },
  RESTAURANT: {
    title: 'Restaurant',
    tagline: 'Restaurants indépendants, snacks et fast-foods.',
    icon: <UtensilsCrossed className="h-6 w-6" aria-hidden />,
    points: [
      'Caisse POS Android et impression thermique',
      'Catalogue, commandes et cuisine KDS',
      'Stocks et fidélité clients',
    ],
    accent: 'bg-terracotta text-ivory',
  },
  PARK_RESTAURANT: {
    title: 'Parc + Restaurant',
    tagline: 'Les établissements qui proposent les deux activités.',
    icon: <Layers className="h-6 w-6" aria-hidden />,
    points: [
      'Tous les modules Parc et Restaurant',
      'Revenus Parc et Restaurant séparés',
      'Une seule équipe, des rôles adaptés',
    ],
    accent: 'bg-savanna text-charcoal',
  },
};

export function BusinessCard({ type }: { type: BusinessType }) {
  const b = BUSINESS_PRESENTATION[type];
  return (
    <article className="group flex flex-col rounded-2xl border border-line/80 bg-surface p-6 shadow-card transition-shadow hover:shadow-lift">
      <div className={`mb-5 grid h-12 w-12 place-items-center rounded-xl ${b.accent}`}>
        {b.icon}
      </div>
      <h3 className="text-xl font-bold">{b.title}</h3>
      <p className="mt-1 text-sm text-muted">{b.tagline}</p>
      <ul className="mt-5 space-y-2.5 text-sm">
        {b.points.map((p) => (
          <li key={p} className="flex gap-2.5">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rotate-45 bg-savanna" aria-hidden />
            {p}
          </li>
        ))}
      </ul>
    </article>
  );
}
