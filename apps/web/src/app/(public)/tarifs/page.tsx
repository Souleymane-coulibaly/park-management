import type { Metadata } from 'next';
import { Check } from 'lucide-react';
import { formatXof } from '@ocall/shared';
import { BUSINESS_PRESENTATION } from '@/components/public/business-cards';
import { ButtonLink } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/states';
import type { Plan } from '@/lib/types';

export const metadata: Metadata = { title: 'Tarifs' };
// Rendu à la demande : les prix (gérés par le Super Admin) sont mis en cache 5 minutes.
export const dynamic = 'force-dynamic';

async function loadPlans(): Promise<Plan[] | null> {
  try {
    const res = await fetch(`${process.env.API_URL ?? 'http://localhost:4000'}/api/v1/plans`, {
      next: { revalidate: 300 },
    });
    return res.ok ? ((await res.json()) as Plan[]) : null;
  } catch {
    return null;
  }
}

export default async function TarifsPage() {
  const plans = await loadPlans();
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <PageHeader
        eyebrow="Tarifs"
        title="Un abonnement mensuel simple, en FCFA"
        description="Choisissez l’offre de votre métier. Le paiement en ligne sera disponible prochainement."
      />
      {!plans ? (
        <Alert tone="info" title="Tarifs momentanément indisponibles">
          Nous n’arrivons pas à charger les offres pour le moment. Réessayez dans quelques instants.
        </Alert>
      ) : (
        <div className="grid gap-5 md:grid-cols-3">
          {plans.map((plan) => {
            // L'API ne renvoie ici que les offres Ocall Park (métier renseigné).
            if (!plan.businessType) return null;
            const p = BUSINESS_PRESENTATION[plan.businessType];
            const featured = plan.businessType === 'PARK_RESTAURANT';
            return (
              <article
                key={plan.id}
                className={`relative flex flex-col rounded-2xl border p-6 shadow-card ${featured ? 'border-forest bg-forest text-ivory' : 'border-line bg-surface'}`}
              >
                {featured && (
                  <span className="absolute -top-3 left-6 rounded-full bg-savanna px-3 py-0.5 text-xs font-bold text-charcoal">
                    Le plus complet
                  </span>
                )}
                <h2 className="text-lg font-bold">{plan.name}</h2>
                <p className={`mt-1 text-sm ${featured ? 'text-ivory/75' : 'text-muted'}`}>
                  {p.tagline}
                </p>
                <p className="mt-6 font-display text-4xl font-bold">
                  {formatXof(plan.monthlyPrice)}
                  <span
                    className={`text-base font-medium ${featured ? 'text-ivory/70' : 'text-muted'}`}
                  >
                    {' '}
                    / mois
                  </span>
                </p>
                {plan.setupFee > 0 && (
                  <p className={`mt-1 text-sm ${featured ? 'text-ivory/80' : 'text-muted'}`}>
                    + {formatXof(plan.setupFee)} de mise en service (une seule fois)
                  </p>
                )}
                <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                  {[
                    'Gestion des établissements et des employés',
                    'Rôles et journal d’audit',
                    ...p.points,
                  ].map((pt) => (
                    <li key={pt} className="flex gap-2.5">
                      <Check
                        className={`h-4 w-4 shrink-0 ${featured ? 'text-savanna' : 'text-forest'}`}
                        aria-hidden
                      />
                      {pt}
                    </li>
                  ))}
                </ul>
                <ButtonLink
                  href={`/inscription?metier=${plan.businessType}`}
                  variant={featured ? 'accent' : 'primary'}
                  className="mt-7"
                >
                  Choisir {plan.name}
                </ButtonLink>
              </article>
            );
          })}
        </div>
      )}
      <p className="mt-6 text-sm text-muted">
        Les modules marqués « à venir » sont inclus dans l’offre de votre métier dès leur mise à
        disposition.
      </p>
    </div>
  );
}
