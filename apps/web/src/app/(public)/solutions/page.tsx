import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/states';
import { PRODUCT_CONTENT, loadCatalog, productIcon } from '@/lib/suite-catalog';

export const metadata: Metadata = {
  title: 'Nos solutions',
  description: 'Le catalogue Ocall Suite : solutions disponibles et projets à venir.',
  alternates: { canonical: '/solutions' },
};
export const revalidate = 300;

export default async function SolutionsPage() {
  const catalog = await loadCatalog();
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <PageHeader
        eyebrow="Nos solutions"
        title="Une application par métier"
        description="Les solutions disponibles aujourd’hui et celles en préparation. Seules les solutions marquées « Disponible » peuvent être souscrites."
      />
      {!catalog ? (
        <Alert tone="info" title="Catalogue momentanément indisponible">
          Réessayez dans quelques instants.
        </Alert>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {catalog.map((p) => {
            const Icon = productIcon(p.slug);
            const live = p.status === 'ACTIVE';
            return (
              <article
                key={p.slug}
                className="flex flex-col rounded-2xl border border-line/80 bg-surface p-6 shadow-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className={`grid h-12 w-12 place-items-center rounded-xl ${live ? 'bg-forest text-ivory' : 'bg-savanna-light text-charcoal'}`}
                  >
                    <Icon className="h-6 w-6" aria-hidden />
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${live ? 'bg-forest/10 text-forest' : 'bg-savanna-light text-charcoal'}`}
                  >
                    {p.statusLabel}
                  </span>
                </div>
                <h2 className="mt-4 font-display text-xl font-bold">{p.name}</h2>
                <p className="text-sm font-medium text-terracotta-dark">
                  {PRODUCT_CONTENT[p.slug]?.audience ?? p.tagline}
                </p>
                <p className="mt-2 flex-1 text-sm text-muted">{p.tagline}</p>
                <Link
                  href={`/solutions/${p.slug}`}
                  className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-forest"
                >
                  {live ? 'Découvrir la solution' : 'En savoir plus'}{' '}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
