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
 * Applications dont les activations comptent pour un abonnement au produit `productCode` (sprint 7) :
 * Ocall Parc = activité parc, Ocall Restaurant = activité restaurant. Un contrat Ocall Park combiné
 * (historique ou souscrit avant l'ouverture d'Ocall Restaurant, `combined`) et le produit combiné
 * historique couvrent les deux activités, chaque établissement compté une seule fois.
 */
export function billedSiteSources(productCode: string, combined = false): string[] {
  if (combined || productCode === 'OCALL_PARK_RESTAURANT') {
    if ([SITE_SOURCE_PARK, SITE_SOURCE_RESTAURANT, 'OCALL_PARK_RESTAURANT'].includes(productCode)) {
      return [SITE_SOURCE_PARK, SITE_SOURCE_RESTAURANT];
    }
  }
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

/** Facture par site précédente, vue par le prorata. */
export interface SiteProrataPrevious {
  issuedAt: Date;
  /** Sites facturés par cette facture (au moins 1). */
  billedSites: number;
  /**
   * Sites (unités) déjà payés jusqu'à l'échéance à son émission : sites facturés, sites portés au prorata
   * et site couvert par le minimum d'un site.
   */
  coveredUnits: string[];
}

export interface SiteProrataInput {
  /** Prix figé d'un site supplémentaire. */
  extraSitePrice: number;
  /** Facture par site précédente du même tarif ; null sans facture (ou après un changement d'offre). */
  previous: SiteProrataPrevious | null;
  /**
   * Activations de l'abonnement, OUVERTES OU FERMÉES depuis : un retrait ne prend effet qu'à l'échéance,
   * un site ajouté puis retiré dans la période reste donc dû jusqu'à l'échéance.
   */
  activations: { unitKey: string; label: string; startedAt: Date }[];
  /** Échéance de la période en cours (fin de la couverture payée), null sans couverture. */
  coverageEnd: Date | null;
  now: Date;
}

export interface SiteProrataItem {
  /** Identité stable du site (établissement, ou fiche de l'application) : jamais facturé deux fois. */
  unitKey: string;
  label: string;
  from: string;
  to: string;
  days: number;
  amount: number;
}

export interface SiteProrataResult {
  items: SiteProrataItem[];
  /** Sites ajoutés couverts par le minimum d'un site déjà payé (aucun montant). */
  freeUnits: string[];
}

/**
 * Ajout de site en cours de période (décision D6) : chaque site activé depuis la facture précédente et
 * pas encore payé pour la période est facturé au prorata, de son activation jusqu'à l'échéance (jours
 * entamés, mois de 30 jours, prix d'un site supplémentaire), UNE seule fois — même s'il a été retiré
 * depuis (le retrait ne prend effet qu'à l'échéance) ou ajouté, retiré puis rajouté (première activation
 * retenue). Un site déjà payé pour la période (facturé, au prorata ou couvert par le minimum) n'est jamais
 * refacturé : un retrait suivi d'un retour, ou un rattachement à un autre établissement, est gratuit.
 * Sans facture précédente, sans couverture en cours, ou après un changement d'offre : aucun prorata.
 */
export function computeSiteProrata(input: SiteProrataInput): SiteProrataResult {
  const { previous, coverageEnd, now } = input;
  if (!previous || !coverageEnd || coverageEnd <= now) return { items: [], freeUnits: [] };
  const covered = new Set(previous.coveredUnits);
  // Minimum d'un site payé sans site réel : le premier site ajouté est déjà couvert.
  let free = Math.max(0, previous.billedSites - covered.size);
  const first = new Map<string, { unitKey: string; label: string; startedAt: Date }>();
  for (const a of [...input.activations].sort(
    (x, y) => x.startedAt.getTime() - y.startedAt.getTime(),
  )) {
    if (a.startedAt <= previous.issuedAt || a.startedAt >= coverageEnd) continue;
    if (covered.has(a.unitKey) || first.has(a.unitKey)) continue;
    first.set(a.unitKey, a);
  }
  const items: SiteProrataItem[] = [];
  const freeUnits: string[] = [];
  for (const a of first.values()) {
    if (free > 0) {
      free -= 1;
      freeUnits.push(a.unitKey);
      continue;
    }
    const days = Math.ceil((coverageEnd.getTime() - a.startedAt.getTime()) / DAY_MS);
    items.push({
      unitKey: a.unitKey,
      label: a.label,
      from: a.startedAt.toISOString(),
      to: coverageEnd.toISOString(),
      days,
      amount: Math.round((input.extraSitePrice * days) / SITE_PRORATA_DAYS_PER_MONTH),
    });
  }
  return { items, freeUnits };
}

/** Photographie des sites d'une facture par site (enregistrée à l'émission, jamais recalculée). */
export interface InvoiceSitesSnapshot {
  pricingMode: 'PER_SITE';
  billedSites: number;
  sites: { siteKey: string; unitKeys: string[]; label: string; sources: string[] }[];
  prices: PerSitePrices;
  prorata: SiteProrataItem[];
  /** Sites ajoutés couverts par le minimum d'un site (aucun montant). */
  freeUnits: string[];
  /** Sites payés pour la période en cours à l'émission : base du prorata de la facture suivante. */
  coveredUnits: string[];
  /** Échéance de la période en cours à l'émission (null sans couverture). */
  coverageEnd: string | null;
}

/**
 * Sites déjà payés pour la période en cours, d'après la facture par site précédente. Même période (aucun
 * règlement n'a déplacé l'échéance depuis) : tout ce qu'elle tenait pour payé, cumulé. Nouvelle période
 * (sa mensualité a été réglée) : les seuls sites portés par ses mensualités, c'est-à-dire ouverts à son
 * émission — un site retiré avant n'est plus payé au-delà de l'ancienne échéance.
 */
export function coveredUnitsForPeriod(
  previous: Partial<Pick<InvoiceSitesSnapshot, 'coveredUnits' | 'coverageEnd' | 'sites'>>,
  coverageEnd: Date | null,
): string[] {
  const samePeriod = (previous.coverageEnd ?? null) === (coverageEnd?.toISOString() ?? null);
  return samePeriod
    ? (previous.coveredUnits ?? [])
    : (previous.sites ?? []).flatMap((x) => x.unitKeys ?? []);
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
  /** Sprint 7 : contrat combiné actif (droits parc et restaurant) ; absent = déduit du produit. */
  contractCombined?: boolean;
}

export interface ParkRestaurantSplitProposal extends ParkContractInput {
  /** Contrat combiné qui couvre aujourd'hui parc ET restaurant d'un client qui exerce les deux. */
  combined: boolean;
  /** Abonnements cibles après séparation, avec leur mensualité à la grille par site (indicative). */
  targets: { productCode: string; sites: number; indicativeMonthly: number }[];
  /** Répartition par défaut à la bascule : montant mensuel total conservé (décision D3). */
  defaultSplit: { park: number; restaurant: number } | null;
}

/**
 * Migration des contrats combinés (décision D2 adaptée), EN APERÇU SEULEMENT : aucune écriture, aucun
 * changement de prix. Le contrat actuel est conservé avec son prix figé jusqu'à une bascule explicite,
 * prévue au sprint de retrait de l'offre « Parc + Restaurant ». Cibles : Ocall Park pour les sites avec
 * activité parc, Ocall Restaurant pour ceux avec activité restaurant (un établissement « parc et
 * restaurant » apparaît dans les deux, une fois chacun).
 */
export function proposeParkRestaurantSplit(c: ParkContractInput): ParkRestaurantSplitProposal {
  const coversBoth = c.contractCombined ?? c.productCode === 'OCALL_PARK_RESTAURANT';
  const combined =
    coversBoth &&
    (c.productCode === 'OCALL_PARK_RESTAURANT' || (c.parkSites > 0 && c.restaurantSites > 0));
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
  return {
    ...c,
    combined,
    targets,
    defaultSplit: combined
      ? defaultSwitchSplit(c.monthlyAmount, c.parkSites, c.restaurantSites)
      : null,
  };
}

/**
 * Répartition par défaut du montant mensuel d'un contrat combiné à sa bascule (décision D3) : le total est
 * CONSERVÉ et réparti au prorata de la grille par site de chaque application (au moins un site chacune),
 * à l'unité près ; parc + restaurant = total.
 */
export function defaultSwitchSplit(
  total: number,
  parkSites: number,
  restaurantSites: number,
): { park: number; restaurant: number } {
  const grid = (sites: number) =>
    perSiteMonthlyAmount(
      {
        firstSite: SITE_PRICING.firstSiteMonthly,
        extraSite: SITE_PRICING.extraSiteMonthly,
        showcase: 0,
      },
      Math.max(1, sites),
    );
  const wp = grid(parkSites);
  const wr = grid(restaurantSites);
  const park = Math.round((total * wp) / (wp + wr));
  return { park, restaurant: total - park };
}

/** Une répartition explicite est valide si ses deux parts sont des entiers positifs qui somment au total. */
export function isValidSwitchSplit(
  total: number,
  split: { park: number; restaurant: number },
): boolean {
  return (
    Number.isInteger(split.park) &&
    Number.isInteger(split.restaurant) &&
    split.park >= 0 &&
    split.restaurant >= 0 &&
    split.park + split.restaurant === total
  );
}
