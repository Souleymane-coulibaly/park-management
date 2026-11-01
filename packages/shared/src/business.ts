/**
 * Métiers proposés par Ocall Park. Le métier d'une organisation détermine
 * les modules accessibles, la navigation et l'offre d'abonnement.
 */
export const BusinessType = {
  PARK: 'PARK',
  RESTAURANT: 'RESTAURANT',
  PARK_RESTAURANT: 'PARK_RESTAURANT',
  /** Client sans activité Ocall Park (ex. Ocall School sur contrat) ; jamais proposé à l'inscription. */
  NONE: 'NONE',
} as const;
export type BusinessType = (typeof BusinessType)[keyof typeof BusinessType];

/** Métiers Ocall Park proposés à l'inscription et à la création d'établissements. */
export type ParkBusinessType = Exclude<BusinessType, 'NONE'>;
export const BUSINESS_TYPES: readonly ParkBusinessType[] = [
  BusinessType.PARK,
  BusinessType.RESTAURANT,
  BusinessType.PARK_RESTAURANT,
];

/** Activité élémentaire : le métier combiné couvre les deux. */
export type Activity = 'PARK' | 'RESTAURANT';

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  PARK: 'Parc',
  RESTAURANT: 'Restaurant',
  PARK_RESTAURANT: 'Parc + Restaurant',
  NONE: 'Sans activité Park',
};

export function activitiesOf(businessType: BusinessType): Activity[] {
  switch (businessType) {
    case 'PARK':
      return ['PARK'];
    case 'RESTAURANT':
      return ['RESTAURANT'];
    case 'PARK_RESTAURANT':
      return ['PARK', 'RESTAURANT'];
    case 'NONE':
      return [];
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
  // Un client sur contrat n'obtient pas d'activité Park par ce biais.
  return from !== 'NONE' && from !== to && to === 'PARK_RESTAURANT';
}
