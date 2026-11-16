/**
 * Ocall Suite étape 6 : facturation par site activé. Règles uniques, partagées par l'API (émission des
 * factures, revenu mensuel, devis) et le site (devis du portail, page tarifs).
 *
 * - Une offre FLAT (historique) garde son prix mensuel unique : rien ne change pour elle.
 * - Une offre PER_SITE facture le premier site au prix mensuel de l'offre, chaque site supplémentaire
 *   à son prix, et le supplément vitrine une fois par application. Toujours au moins un site.
 * - Un site partagé par plusieurs fiches d'une même application n'est compté qu'une fois.
 */

export const PRICING_MODES = ['FLAT', 'PER_SITE'] as const;
export type PricingMode = (typeof PRICING_MODES)[number];
export const PRICING_MODE_LABELS: Record<PricingMode, string> = {
  FLAT: 'Forfait mensuel',
  PER_SITE: 'Par site activé',
};

/** Grille de l'étape 6 (FCFA). Les montants appliqués viennent toujours des offres puis des prix figés. */
export const SITE_PRICING = {
  firstSiteMonthly: 17_500,
  extraSiteMonthly: 7_500,
  showcaseMonthly: 5_000,
  firstAppSetupFee: 150_000,
  extraAppSetupFee: 112_500,
} as const;

/** Applications sources des activations de sites (activité parc et activité restaurant séparées). */
export const SITE_SOURCE_PARK = 'OCALL_PARK';
export const SITE_SOURCE_RESTAURANT = 'OCALL_RESTAURANT';
/** Clé de site de Facture : l'application compte toujours un seul site (décision D3). */
export const ORGANIZATION_SITE_KEY = 'organization';

/**
 * Séparation commerciale de Parc et Restaurant (décision D2 adaptée) : préparée, NON activée avant le
 * sprint de retrait de l'offre « Parc + Restaurant ». Tant qu'elle ne l'est pas, Ocall Park couvre les
 * établissements avec activité parc ou restaurant, chacun compté une seule fois.
 */
export const PARK_RESTAURANT_SEPARATED = false;

/** Applications dont les activations comptent pour un abonnement au produit `productCode`. */
export function billedSiteSources(
  productCode: string,
  separated: boolean = PARK_RESTAURANT_SEPARATED,
): string[] {
  if (productCode === SITE_SOURCE_PARK) {
    return separated ? [SITE_SOURCE_PARK] : [SITE_SOURCE_PARK, SITE_SOURCE_RESTAURANT];
  }
  // Produit combiné historique : ses contrats restent combinés (jamais d'offre par site).
  if (productCode === 'OCALL_PARK_RESTAURANT') return [SITE_SOURCE_PARK, SITE_SOURCE_RESTAURANT];
  return [productCode];
}

/** Sites facturés : distincts par clé de site, au moins un. */
export function billedSiteCount(siteKeys: Iterable<string>): number {
  return Math.max(1, new Set(siteKeys).size);
}

export interface PerSitePrices {
  /** Prix mensuel du premier site (prix mensuel de l'offre). */
  firstSite: number;
  extraSite: number;
  /** Supplément vitrine mensuel ; 0 sans vitrine. */
  showcase: number;
}

/** Mensualité d'un abonnement par site pour `sites` sites facturés (au moins un). */
export function perSiteMonthlyAmount(prices: PerSitePrices, sites: number): number {
  return prices.firstSite + prices.extraSite * Math.max(0, sites - 1) + prices.showcase;
}

/** Forme minimale d'un abonnement pour son revenu mensuel (un seul calcul pour tous les écrans). */
export interface MonthlyAmountInput {
  agreedMonthlyPrice: number | null;
  agreedExtraSitePrice?: number | null;
  agreedShowcasePrice?: number | null;
  billedSiteCount?: number | null;
  plan: {
    monthlyPrice: number;
    pricingMode?: PricingMode | string | null;
    extraSiteMonthlyPrice?: number | null;
    showcaseMonthlyPrice?: number | null;
    includesShowcase?: boolean | null;
  };
}

/** Prix par site applicables : figés s'ils le sont, sinon ceux de l'offre ; null pour une offre FLAT. */
export function perSitePricesOf(sub: MonthlyAmountInput): PerSitePrices | null {
  if (sub.plan.pricingMode !== 'PER_SITE') return null;
  const frozen = sub.agreedMonthlyPrice !== null && sub.agreedExtraSitePrice != null;
  return frozen
    ? {
        firstSite: sub.agreedMonthlyPrice!,
        extraSite: sub.agreedExtraSitePrice!,
        showcase: sub.agreedShowcasePrice ?? 0,
      }
    : {
        firstSite: sub.plan.monthlyPrice,
        extraSite: sub.plan.extraSiteMonthlyPrice ?? 0,
        showcase: sub.plan.includesShowcase ? (sub.plan.showcaseMonthlyPrice ?? 0) : 0,
      };
}

/**
 * Revenu mensuel d'un abonnement : prix figé (sinon celui de l'offre) pour une offre FLAT ; premier site
 * + sites supplémentaires + vitrine pour une offre PER_SITE, sur le dernier décompte de sites.
 */
export function subscriptionMonthlyAmount(sub: MonthlyAmountInput): number {
  const prices = perSitePricesOf(sub);
  if (!prices) return sub.agreedMonthlyPrice ?? sub.plan.monthlyPrice;
  return perSiteMonthlyAmount(prices, sub.billedSiteCount ?? 1);
}

/**
 * Mise en service d'une offre (décision D5) : la première application installée de l'organisation au
 * prix de l'offre, les suivantes au prix « application supplémentaire » quand l'offre en a un. Une
 * application est installée quand sa mise en service est facturée, payée ou exonérée.
 */
export function planSetupFee(
  plan: { setupFee: number; extraAppSetupFee?: number | null },
  otherAppInstalled: boolean,
): number {
  return otherAppInstalled && plan.extraAppSetupFee != null ? plan.extraAppSetupFee : plan.setupFee;
}

export const SITE_PRORATA_DAYS_PER_MONTH = 30;
const DAY_MS = 86_400_000;

export interface SiteProrataInput {
  /** Prix figé d'un site supplémentaire. */
  extraSitePrice: number;
  /** Sites facturés par la facture précédente (au moins 1) et date de son émission. */
  previous: { billedSites: number; issuedAt: Date } | null;
  /** Activations ouvertes au moment de l'émission. */
  open: { siteKey: string; label: string; startedAt: Date }[];
  /** Échéance de la période en cours (fin de la couverture payée), null sans couverture. */
  coverageEnd: Date | null;
  now: Date;
}

export interface SiteProrataItem {
  siteKey: string;
  label: string;
  from: string;
  to: string;
  days: number;
  amount: number;
}

/**
 * Ajout de site en cours de période (décision D6) : chaque site facturable au-delà de ceux de la facture
 * précédente est facturé au prorata, du jour de son activation jusqu'à l'échéance (jours entamés,
 * mois de 30 jours, prix d'un site supplémentaire). Les plus récentes activations portent l'écart, de
 * sorte qu'un site simplement rattaché à un autre établissement (une fin, une ouverture) n'est jamais
 * facturé deux fois. Un retrait prend effet à l'échéance : il ne réduit jamais la période en cours.
 */
export function computeSiteProrata(input: SiteProrataInput): SiteProrataItem[] {
  const { previous, coverageEnd, now } = input;
  if (!previous || !coverageEnd || coverageEnd <= now) return [];
  const extra = billedSiteCount(input.open.map((s) => s.siteKey)) - previous.billedSites;
  if (extra <= 0) return [];
  const added = input.open
    .filter((s) => s.startedAt > previous.issuedAt && s.startedAt < coverageEnd)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, extra);
  return added.map((s) => {
    const days = Math.ceil((coverageEnd.getTime() - s.startedAt.getTime()) / DAY_MS);
    return {
      siteKey: s.siteKey,
      label: s.label,
      from: s.startedAt.toISOString(),
      to: coverageEnd.toISOString(),
      days,
      amount: Math.round((input.extraSitePrice * days) / SITE_PRORATA_DAYS_PER_MONTH),
    };
  });
}

/** Photographie des sites d'une facture par site (enregistrée à l'émission, jamais recalculée). */
export interface InvoiceSitesSnapshot {
  pricingMode: 'PER_SITE';
  billedSites: number;
  sites: { siteKey: string; label: string; sources: string[] }[];
  prices: PerSitePrices;
  prorata: SiteProrataItem[];
}

/** Contrat Park historique (forfait) à examiner pour la séparation Parc / Restaurant. */
export interface ParkContractInput {
  subscriptionId: string;
  organizationId: string;
  organizationName: string;
  productCode: string;
  status: string;
  planName: string;
  monthlyAmount: number;
  expiresAt: string | null;
  parkSites: number;
  restaurantSites: number;
}

export interface ParkRestaurantSplitProposal extends ParkContractInput {
  /** Contrat qui couvre aujourd'hui parc ET restaurant (combiné ou Ocall Park sur un client mixte). */
  combined: boolean;
  /** Abonnements cibles après séparation, avec leur mensualité à la grille par site (indicative). */
  targets: { productCode: string; sites: number; indicativeMonthly: number }[];
}

/**
 * Migration des contrats combinés (décision D2 adaptée), EN APERÇU SEULEMENT : aucune écriture, aucun
 * changement de prix. Le contrat actuel est conservé avec son prix figé jusqu'à une bascule explicite,
 * prévue au sprint de retrait de l'offre « Parc + Restaurant ». Cibles : Ocall Park pour les sites avec
 * activité parc, Ocall Restaurant pour ceux avec activité restaurant (un établissement « parc et
 * restaurant » apparaît dans les deux, une fois chacun).
 */
export function proposeParkRestaurantSplit(c: ParkContractInput): ParkRestaurantSplitProposal {
  const combined =
    c.productCode === 'OCALL_PARK_RESTAURANT' || (c.parkSites > 0 && c.restaurantSites > 0);
  const grid = (sites: number) =>
    perSiteMonthlyAmount(
      {
        firstSite: SITE_PRICING.firstSiteMonthly,
        extraSite: SITE_PRICING.extraSiteMonthly,
        showcase: 0,
      },
      sites,
    );
  const targets = [
    { productCode: SITE_SOURCE_PARK, sites: c.parkSites },
    { productCode: SITE_SOURCE_RESTAURANT, sites: c.restaurantSites },
  ]
    .filter((t) => t.sites > 0)
    .map((t) => ({ ...t, indicativeMonthly: grid(t.sites) }));
  return { ...c, combined, targets };
}
