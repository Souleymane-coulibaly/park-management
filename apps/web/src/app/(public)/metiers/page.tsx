import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { BusinessCard } from '@/components/public/business-cards';
import { ButtonLink } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';

export const metadata: Metadata = { title: 'Métiers' };

export default function MetiersPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <PageHeader
        eyebrow="Métiers"
        title="Parc, Restaurant, ou les deux"
        description="Ocall Park est un logiciel de gestion pour votre établissement, pas une place de marché. Votre métier détermine les modules disponibles et la navigation de votre équipe."
      />
      <div className="grid gap-5 md:grid-cols-3">
        <BusinessCard type="PARK" />
        <BusinessCard type="RESTAURANT" />
        <BusinessCard type="PARK_RESTAURANT" />
      </div>
      <div className="mt-10 rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
        <h2 className="text-xl font-bold">Votre activité évolue ? Votre logiciel aussi.</h2>
        <p className="mt-2 max-w-3xl text-muted">
          Un parc qui ouvre un restaurant, ou un restaurant qui ajoute un espace de loisirs, passe à
          l’offre Parc + Restaurant depuis ses paramètres. Établissements, employés et historique
          sont conservés.
        </p>
        <ButtonLink href="/inscription" className="mt-5">
          Choisir mon métier <ArrowRight className="h-4 w-4" />
        </ButtonLink>
      </div>
    </div>
  );
}
