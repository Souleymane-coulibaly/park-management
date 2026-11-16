/**
 * Ocall Suite sprint 7 : séparation commerciale Ocall Parc / Ocall Restaurant. Règles pures, partagées
 * par l'API (droits, souscription, bascule) et le site (portail, Super Admin).
 *
 * - Ocall Parc (`OCALL_PARK`) donne les droits sur l'activité parc, Ocall Restaurant (`OCALL_RESTAURANT`)
 *   sur l'activité restaurant : deux applications, deux abonnements, deux droits distincts.
 * - Un contrat combiné (abonnement historique de la famille Park, ou souscrit avant l'ouverture d'Ocall
 *   Restaurant) garde ses droits sur les DEUX activités et son tarif jusqu'à une bascule explicite.
 * - Le produit historique « Parc + Restaurant » couvre toujours les deux activités.
 */
import type { Activity, BusinessType } from './business';
import type { ProductAccess } from './suite-contracts';

export const PARK_COMMERCIAL_CODE = 'OCALL_PARK';
export const RESTAURANT_COMMERCIAL_CODE = 'OCALL_RESTAURANT';
export const PARK_RESTAURANT_LEGACY_CODE = 'OCALL_PARK_RESTAURANT';

/** Activités couvertes par un abonnement de la famille Park (`combined` : contrat combiné actif). */
export function subscriptionActivities(productCode: string, combined: boolean): Activity[] {
  if (combined || productCode === PARK_RESTAURANT_LEGACY_CODE) {
    return [PARK_COMMERCIAL_CODE, RESTAURANT_COMMERCIAL_CODE, PARK_RESTAURANT_LEGACY_CODE].includes(
      productCode,
    )
      ? ['PARK', 'RESTAURANT']
      : [];
  }
  if (productCode === PARK_COMMERCIAL_CODE) return ['PARK'];
  if (productCode === RESTAURANT_COMMERCIAL_CODE) return ['RESTAURANT'];
  return [];
}

/** Application commerciale d'une activité. */
export const activityProductCode = (activity: Activity): string =>
  activity === 'PARK' ? PARK_COMMERCIAL_CODE : RESTAURANT_COMMERCIAL_CODE;

/** Applications à souscrire pour un métier, une fois Ocall Restaurant ouvert (décision D2). */
export function productsForBusinessType(businessType: BusinessType): string[] {
  if (businessType === 'PARK') return [PARK_COMMERCIAL_CODE];
  if (businessType === 'RESTAURANT') return [RESTAURANT_COMMERCIAL_CODE];
  if (businessType === 'PARK_RESTAURANT') return [PARK_COMMERCIAL_CODE, RESTAURANT_COMMERCIAL_CODE];
  return [];
}

const ACCESS_RANK: Record<ProductAccess, number> = { none: 0, read_only: 1, full: 2 };

/** Meilleur droit parmi plusieurs abonnements couvrant la même activité. */
export function bestAccess(list: readonly ProductAccess[]): ProductAccess {
  return list.reduce<ProductAccess>(
    (best, a) => (ACCESS_RANK[a] > ACCESS_RANK[best] ? a : best),
    'none',
  );
}

/**
 * Nom commercial présenté au client : Ocall Restaurant sous son nom, le reste de la famille Park
 * (Ocall Parc, contrat combiné historique) sous « Ocall Park ».
 */
export function commercialAppName(code: string, name: string): string {
  return [PARK_COMMERCIAL_CODE, PARK_RESTAURANT_LEGACY_CODE].includes(code) ? 'Ocall Park' : name;
}

/** Application du portail d'un produit (le combiné historique s'affiche sous Ocall Park). */
export const commercialAppCode = (code: string): string =>
  code === PARK_RESTAURANT_LEGACY_CODE ? PARK_COMMERCIAL_CODE : code;
