import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/states';

/**
 * Page légale ou institutionnelle du site Ocall Suite (Sprint 12A). Aucune information juridique
 * n'est inventée : les données à fournir par Ocall sont signalées par <ToComplete>, et un bandeau
 * rappelle que la page n'est pas publiable en l'état.
 */
export function LegalPage({
  eyebrow,
  title,
  description,
  draft = true,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  draft?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      {draft && (
        <div className="mb-8">
          <Alert tone="info" title="Document en préparation">
            Les informations signalées « à compléter » doivent être fournies et validées par Ocall
            avant toute publication.
          </Alert>
        </div>
      )}
      <div className="space-y-6 text-sm leading-relaxed [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-charcoal">
        {children}
      </div>
    </div>
  );
}

/** Donnée à fournir par Ocall (jamais inventée). */
export function ToComplete({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded bg-savanna-light px-1.5 py-0.5 font-medium text-charcoal">
      [À compléter : {children}]
    </mark>
  );
}

/** Métadonnées communes : pages non indexées tant qu'elles contiennent des champs à compléter. */
export const DRAFT_ROBOTS = { index: false, follow: true } as const;
