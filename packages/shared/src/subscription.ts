export const SubscriptionStatus = {
  NOT_ACTIVATED: 'NOT_ACTIVATED',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  EXPIRED: 'EXPIRED',
  CANCELED: 'CANCELED',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  NOT_ACTIVATED: 'Non activé',
  ACTIVE: 'Actif',
  PAST_DUE: 'Paiement en retard',
  EXPIRED: 'Expiré',
  CANCELED: 'Résilié',
};

/** Formate un montant entier en FCFA : 25000 → « 25 000 FCFA » (espace fine insécable). */
export function formatXof(amount: number): string {
  const grouped = Math.trunc(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${grouped} FCFA`;
}
