export const SubscriptionStatus = {
  NOT_ACTIVATED: 'NOT_ACTIVATED',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  EXPIRED: 'EXPIRED',
  CANCELED: 'CANCELED',
  SUSPENDED: 'SUSPENDED',
  PENDING_ACTIVATION: 'PENDING_ACTIVATION',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  NOT_ACTIVATED: 'Non activé',
  ACTIVE: 'Actif',
  PAST_DUE: 'Paiement en retard',
  EXPIRED: 'Expiré',
  CANCELED: 'Résilié',
  SUSPENDED: 'Suspendu',
  PENDING_ACTIVATION: 'Payé, activation en attente',
};

/**
 * Abonnement en cours de validité : actif et non échu. Un renouvellement payé en ligne en mode
 * ADMIN_APPROVAL ne retire jamais cet état (seule la prolongation attend l'approbation).
 */
export function isSubscriptionCurrent(
  sub: { status: SubscriptionStatus; expiresAt: Date | string | null },
  now: Date = new Date(),
): boolean {
  if (sub.status !== 'ACTIVE') return false;
  return sub.expiresAt === null || new Date(sub.expiresAt).getTime() > now.getTime();
}

/** Formate un montant entier en FCFA : 25000 → « 25 000 FCFA » (espace fine insécable). */
export function formatXof(amount: number): string {
  const grouped = Math.trunc(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${grouped} FCFA`;
}
