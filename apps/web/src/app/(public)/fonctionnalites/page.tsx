import type { Metadata } from 'next';
import { CheckCircle2, Clock } from 'lucide-react';
import { MODULES } from '@ocall/shared';
import { PageHeader } from '@/components/ui/page-header';
import { Badge, UpcomingBadge } from '@/components/ui/badge';

export const metadata: Metadata = { title: 'Fonctionnalités' };

const AVAILABLE_NOW = [
  'Inscription de votre organisation et choix du métier',
  'Gestion de plusieurs établissements, chacun avec son fuseau horaire',
  'Comptes employés nominatifs avec identifiant individuel',
  'Rôles : propriétaire, administrateur, superviseur, caisse, cuisine, agent d’entrée',
  'Mot de passe initial à changer, verrouillage après tentatives répétées',
  'Journal d’audit des actions sensibles',
  'Restaurant : catalogue avec catégories, variantes et tarifs par établissement',
  'Restaurant : caisse tactile pour tablette, encaissement en espèces et rendu de monnaie',
  'Restaurant : sessions de caisse avec fond, fermeture et suivi des écarts',
  'Restaurant : historique des ventes et chiffre d’affaires encaissé',
];

export default function FonctionnalitesPage() {
  const upcoming = MODULES.filter((m) => m.status === 'upcoming');
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <PageHeader
        eyebrow="Fonctionnalités"
        title="Ce qui est disponible, et ce qui arrive"
        description="Nous présentons honnêtement l’état du produit : le socle de gestion est disponible, les modules métier arrivent progressivement."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-surface p-6 shadow-card">
          <div className="mb-4 flex items-center gap-2">
            <h2 className="text-lg font-bold">Disponible aujourd’hui</h2>
            <Badge tone="forest">Disponible</Badge>
          </div>
          <ul className="space-y-3">
            {AVAILABLE_NOW.map((f) => (
              <li key={f} className="flex gap-3 text-sm">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-forest" aria-hidden />
                {f}
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-2xl border border-line bg-surface p-6 shadow-card">
          <div className="mb-4 flex items-center gap-2">
            <h2 className="text-lg font-bold">Modules en préparation</h2>
            <UpcomingBadge />
          </div>
          <ul className="space-y-3">
            {upcoming.map((m) => (
              <li key={m.key} className="flex gap-3 text-sm">
                <Clock className="h-5 w-5 shrink-0 text-savanna" aria-hidden />
                <span>
                  <span className="font-semibold">{m.label}</span>
                  <span className="text-muted"> — {m.description}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
