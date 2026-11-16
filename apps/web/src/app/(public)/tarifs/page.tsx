import type { Metadata } from 'next';
import { Check } from 'lucide-react';
import {
  SITE_PRICING,
  SUITE_PRICING,
  TRIAL_DAYS,
  formatXof,
  perSiteMonthlyAmount,
} from '@ocall/shared';
import { ButtonLink } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/states';
import type { Plan } from '@/lib/types';

export const metadata: Metadata = {
  title: 'Tarifs',
  description:
    'Tarifs Ocall Suite en FCFA : un abonnement mensuel par application, avec ou sans site vitrine, une mise en service unique et un essai gratuit de 14 jours.',
  alternates: { canonical: '/tarifs' },
};
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

/**
 * Exemple chiffré de la grille affichée : deux applications sans vitrine. Étape 6 : avec des offres par
 * site, trois sites chacune (premier site + deux sites supplémentaires) et mise en service dégressive.
 */
function example(perSite: boolean): string {
  if (perSite) {
    const monthly =
      2 *
      perSiteMonthlyAmount(
        {
          firstSite: SITE_PRICING.firstSiteMonthly,
          extraSite: SITE_PRICING.extraSiteMonthly,
          showcase: 0,
        },
        3,
      );
    const setup = SITE_PRICING.firstAppSetupFee + SITE_PRICING.extraAppSetupFee;
    return `Exemple : deux applications sans vitrine, trois sites chacune, c’est ${formatXof(setup)} de mise en service (${formatXof(SITE_PRICING.firstAppSetupFee)} pour la première application, ${formatXof(SITE_PRICING.extraAppSetupFee)} pour la seconde), puis ${formatXof(monthly)} par mois.`;
  }
  return `Exemple : deux applications sans vitrine, c’est ${formatXof(2 * SUITE_PRICING.setupFee + 2 * SUITE_PRICING.monthlyWithoutShowcase)} à la première échéance (mise en service comprise), puis ${formatXof(2 * SUITE_PRICING.monthlyWithoutShowcase)} par mois.`;
}

/**
 * Grille Ocall Suite : prix lus en base, par application commercialisée (jamais en dur). Étape 6 : une
 * offre par site affiche le premier site, le site supplémentaire, le supplément vitrine et la mise en
 * service dégressive ; elle apparaît dès qu'Ocall l'active.
 */
export default async function TarifsPage() {
  const plans = await loadPlans();
  const perSiteGrid = (plans ?? []).some((p) => p.pricingMode === 'PER_SITE');
  const byProduct = new Map<string, { name: string; plans: Plan[] }>();
  for (const plan of plans ?? []) {
    const key = plan.product?.code ?? plan.id;
    const group = byProduct.get(key) ?? { name: plan.product?.name ?? plan.name, plans: [] };
    group.plans.push(plan);
    byProduct.set(key, group);
  }
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <PageHeader
        eyebrow="Tarifs"
        title="Un tarif simple par application, en FCFA"
        description={`Chaque application Ocall a son propre contrat : un abonnement mensuel${perSiteGrid ? ' selon le nombre de sites où elle est activée' : ''}, avec ou sans site vitrine, et une mise en service unique. Essai gratuit de ${TRIAL_DAYS} jours, sans carte bancaire. Règlement sur facture, sans prélèvement automatique.`}
      />
      {!plans ? (
        <Alert tone="info" title="Tarifs momentanément indisponibles">
          Nous n’arrivons pas à charger les offres pour le moment. Réessayez dans quelques instants.
        </Alert>
      ) : (
        <div className="space-y-10">
          {[...byProduct.entries()].map(([code, group]) => (
            <section key={code} aria-labelledby={`tarifs-${code}`}>
              <h2 id={`tarifs-${code}`} className="font-display text-2xl font-bold">
                {group.name}
              </h2>
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                {group.plans.map((plan) => {
                  const featured = plan.includesShowcase === true;
                  const perSite = plan.pricingMode === 'PER_SITE';
                  return (
                    <article
                      key={plan.id}
                      className={`flex flex-col rounded-2xl border p-6 shadow-card ${featured ? 'border-forest bg-forest text-ivory' : 'border-line bg-surface'}`}
                    >
                      <h3 className="text-lg font-bold">
                        {featured ? 'Avec site vitrine' : 'Sans site vitrine'}
                      </h3>
                      <p className="mt-6 font-display text-4xl font-bold">
                        {formatXof(plan.monthlyPrice)}
                        <span
                          className={`text-base font-medium ${featured ? 'text-ivory/70' : 'text-muted'}`}
                        >
                          {' '}
                          {perSite ? ' / mois, premier site' : ' / mois'}
                        </span>
                      </p>
                      {perSite && (
                        <p
                          className={`mt-1 text-sm ${featured ? 'text-ivory/80' : 'text-muted'}`}
                          data-testid="tarif-extra-site"
                        >
                          + {formatXof(plan.extraSiteMonthlyPrice ?? 0)} / mois par site
                          supplémentaire
                          {featured && plan.showcaseMonthlyPrice
                            ? ` · site vitrine + ${formatXof(plan.showcaseMonthlyPrice)} / mois`
                            : ''}
                        </p>
                      )}
                      {plan.setupFee > 0 && (
                        <p className={`mt-1 text-sm ${featured ? 'text-ivory/80' : 'text-muted'}`}>
                          {perSite && plan.extraAppSetupFee != null
                            ? `+ ${formatXof(plan.setupFee)} de mise en service et formation pour votre première application, ${formatXof(plan.extraAppSetupFee)} pour chaque application suivante (une seule fois)`
                            : `+ ${formatXof(plan.setupFee)} de mise en service et formation (une seule fois par application)`}
                        </p>
                      )}
                      <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                        {[
                          `Essai gratuit de ${plan.trialDays ?? TRIAL_DAYS} jours`,
                          ...(perSite
                            ? [
                                'Un site partagé par plusieurs applications n’est jamais facturé deux fois pour la même application',
                              ]
                            : []),
                          'Toutes les fonctionnalités de l’application',
                          'Rôles, équipes et journal d’audit',
                          featured
                            ? 'Site vitrine publié à votre nom'
                            : 'Site vitrine disponible en passant à l’offre avec vitrine, sans nouveaux frais de mise en service',
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
                        href="/inscription"
                        variant={featured ? 'accent' : 'primary'}
                        className="mt-7"
                      >
                        Démarrer l’essai gratuit
                      </ButtonLink>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
          <p className="text-sm text-muted" data-testid="tarifs-example">
            {example(perSiteGrid)} Les applications en préproduction ou à venir ne sont pas encore
            proposées à la souscription.
          </p>
        </div>
      )}
    </div>
  );
}
