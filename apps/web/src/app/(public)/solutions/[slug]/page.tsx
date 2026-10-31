import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Check, Info } from 'lucide-react';
import { formatXof } from '@ocall/shared';
import { ButtonLink } from '@/components/ui/button';
import { Alert } from '@/components/ui/states';
import { PRODUCT_CONTENT, loadProduct, productIcon } from '@/lib/suite-catalog';

export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const p = await loadProduct(slug);
  if (!p || p === 'unavailable') return { title: 'Solution' };
  return {
    title: p.name,
    description: `${p.name} — ${p.tagline}.`,
    alternates: { canonical: `/solutions/${p.slug}` },
    openGraph: { title: `${p.name} · Ocall Suite`, description: p.tagline },
  };
}

/**
 * Page d'une solution. Le statut (disponible, pilote, bientôt) vient du serveur ; un produit non
 * commercialisé n'affiche ni tarif ni date non validée, et son bouton mène à une demande
 * d'information plutôt qu'à une souscription.
 */
export default async function SolutionPage({ params }: Props) {
  const { slug } = await params;
  const p = await loadProduct(slug);
  if (p === null) notFound();
  if (p === 'unavailable') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <Alert tone="info" title="Page momentanément indisponible">
          Réessayez dans quelques instants.
        </Alert>
      </div>
    );
  }
  const content = PRODUCT_CONTENT[p.slug];
  const Icon = productIcon(p.slug);
  const live = p.status === 'ACTIVE';
  return (
    <>
      <section className={live ? 'bg-forest text-ivory' : 'bg-ivory-dark/50'}>
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <Link
            href="/solutions"
            className={`inline-flex items-center gap-1 text-sm ${live ? 'text-ivory/80' : 'text-muted'}`}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Toutes les solutions
          </Link>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <span
              className={`grid h-14 w-14 place-items-center rounded-2xl ${live ? 'bg-ivory/15' : 'bg-savanna-light'}`}
            >
              <Icon className="h-7 w-7" aria-hidden />
            </span>
            <div>
              <h1 className="font-display text-4xl font-bold">{p.name}</h1>
              <p className={live ? 'text-ivory/85' : 'text-muted'}>
                {content?.audience ?? p.tagline}
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-sm font-semibold ${live ? 'bg-savanna text-charcoal' : 'bg-savanna-light text-charcoal'}`}
            >
              {p.statusLabel}
            </span>
          </div>
          <p className={`mt-5 max-w-2xl text-lg ${live ? 'text-ivory/90' : ''}`}>{p.tagline}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            {live ? (
              <>
                <ButtonLink href={`/demo?produit=${p.slug}`} variant="accent">
                  Demander une démonstration
                </ButtonLink>
                <ButtonLink href="/tarifs" variant="secondary">
                  Voir les tarifs
                </ButtonLink>
              </>
            ) : (
              <ButtonLink href={`/demo?produit=${p.slug}`}>Être informé du lancement</ButtonLink>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        {!live && (
          <div className="mb-8">
            <Alert
              tone="info"
              title={p.status === 'PILOT' ? 'Solution en pilote' : 'Bientôt disponible'}
            >
              {p.status === 'PILOT'
                ? 'Cette solution est testée avec des clients pilotes. Contactez-nous pour en savoir plus.'
                : 'Cette solution est en préparation : elle ne peut pas encore être souscrite. Aucune date de lancement n’est annoncée pour le moment.'}
              {p.availableAt && ` Disponibilité prévue : ${p.availableAt}.`}
            </Alert>
          </div>
        )}
        {p.description && <p className="mb-8 max-w-3xl text-muted">{p.description}</p>}
        {content && (
          <>
            <h2 className="font-display text-2xl font-bold">
              {live ? 'Fonctionnalités' : 'Le projet'}
            </h2>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {content.features.map((f) => (
                <li key={f.title} className="rounded-2xl border border-line/80 bg-surface p-5">
                  <Check className="h-5 w-5 text-forest" aria-hidden />
                  <h3 className="mt-2 font-semibold">{f.title}</h3>
                  <p className="mt-1 text-sm text-muted">{f.text}</p>
                </li>
              ))}
            </ul>
            {content.note && (
              <p className="mt-6 flex items-start gap-2 text-sm text-muted">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {content.note}
              </p>
            )}
          </>
        )}
        {live && p.plans.length > 0 && (
          <div className="mt-12">
            <h2 className="font-display text-2xl font-bold">Tarifs</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {p.plans.map((plan) => (
                <div
                  key={plan.name}
                  className="rounded-2xl border border-line/80 bg-surface p-5 shadow-card"
                >
                  <p className="font-semibold">{plan.name}</p>
                  <p className="mt-2 font-display text-2xl font-bold">
                    {formatXof(plan.monthlyPrice)}{' '}
                    <span className="text-sm font-medium text-muted">/ mois</span>
                  </p>
                  <p className="text-sm text-muted">
                    Mise en service : {formatXof(plan.setupFee)} (une fois)
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
