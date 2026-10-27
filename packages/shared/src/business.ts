/**
 * Métiers proposés par Ocall Park. Le métier d'une organisation détermine
 * les modules accessibles, la navigation et l'offre d'abonnement.
 */
export const BusinessType = {
  PARK: 'PARK',
  RESTAURANT: 'RESTAURANT',
  PARK_RESTAURANT: 'PARK_RESTAURANT',
} as const;
export type BusinessType = (typeof BusinessType)[keyof typeof BusinessType];

export const BUSINESS_TYPES: readonly BusinessType[] = Object.values(BusinessType);

/** Activité élémentaire : le métier combiné couvre les deux. */
export type Activity = 'PARK' | 'RESTAURANT';

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  PARK: 'Parc',
  RESTAURANT: 'Restaurant',
  PARK_RESTAURANT: 'Parc + Restaurant',
};

export function activitiesOf(businessType: BusinessType): Activity[] {
  switch (businessType) {
    case 'PARK':
      return ['PARK'];
    case 'RESTAURANT':
      return ['RESTAURANT'];
    case 'PARK_RESTAURANT':
      return ['PARK', 'RESTAURANT'];
  }
}

export function coversActivity(businessType: BusinessType, activity: Activity): boolean {
  return activitiesOf(businessType).includes(activity);
}

/**
 * Un établissement ne peut exercer que des activités couvertes par le métier
 * de son organisation (un établissement RESTAURANT est refusé dans une organisation PARK).
 */
export function isCompatibleBusinessType(
  organizationType: BusinessType,
  establishmentType: BusinessType,
): boolean {
  return activitiesOf(establishmentType).every((a) => coversActivity(organizationType, a));
}

/**
 * Seule évolution autorisée : PARK ou RESTAURANT vers PARK_RESTAURANT.
 * Elle ajoute une activité sans supprimer de données. Les rétrogradations sont
 * refusées car elles rendraient des établissements et des rôles incohérents.
 */
export function canChangeBusinessType(from: BusinessType, to: BusinessType): boolean {
  return from !== to && to === 'PARK_RESTAURANT';
}
