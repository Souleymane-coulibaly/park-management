/**
 * Sprint S2 — notifications du portail Ocall Suite : rappels d'échéance d'essai et d'abonnement,
 * événements du cycle de vie (activation, suspension, demandes) et recharges SMS School.
 *
 * Les rappels ne décident jamais de l'accès : l'expiration reste appliquée côté serveur par le socle
 * (droits calculés à chaque requête). Toutes les dates sont en UTC.
 */

const DAY_MS = 86_400_000;

/** Politique de rappel par défaut : J-7, J-3, J-1 avant l'échéance, puis le jour J (échéance passée). */
export const SUITE_REMINDER_OFFSETS_DEFAULT: readonly number[] = [7, 3, 1];

/** Une échéance passée depuis plus longtemps n'est plus notifiée (premier passage, reprise tardive). */
export const SUITE_EXPIRED_NOTICE_WINDOW_DAYS = 7;

/**
 * Lit une politique de rappel (« 7,3,1 ») : entiers de 1 à 60, sans doublon, du plus lointain au plus
 * proche. Valeur absente ou invalide : politique par défaut.
 */
export function parseReminderOffsets(raw: string | undefined | null): number[] {
  if (!raw?.trim()) return [...SUITE_REMINDER_OFFSETS_DEFAULT];
  const values = raw.split(',').map((v) => Number(v.trim()));
  if (values.some((v) => !Number.isInteger(v) || v < 1 || v > 60)) {
    return [...SUITE_REMINDER_OFFSETS_DEFAULT];
  }
  return [...new Set(values)].sort((a, b) => b - a);
}

export type ReminderStage =
  { kind: 'ENDING'; offset: number; daysLeft: number } | { kind: 'EXPIRED' };

/**
 * Rappel dû pour une échéance : le seuil le plus proche déjà franchi (jamais les seuils antérieurs
 * manqués, ce qui évite une rafale après une interruption), ou l'échéance passée dans la fenêtre de
 * notification. La clé de déduplication (seuil + échéance) rend l'envoi unique.
 */
export function reminderStage(
  endsAt: Date,
  now: Date,
  offsets: readonly number[] = SUITE_REMINDER_OFFSETS_DEFAULT,
): ReminderStage | null {
  const remaining = endsAt.getTime() - now.getTime();
  if (remaining <= 0) {
    return -remaining <= SUITE_EXPIRED_NOTICE_WINDOW_DAYS * DAY_MS ? { kind: 'EXPIRED' } : null;
  }
  const daysLeft = Math.ceil(remaining / DAY_MS);
  const crossed = offsets.filter((o) => o >= daysLeft);
  if (crossed.length === 0) return null;
  return { kind: 'ENDING', offset: Math.min(...crossed), daysLeft };
}

/** Clé de déduplication d'un rappel : une nouvelle échéance (renouvellement) réarme les rappels. */
export function reminderDedupeKey(
  scope: 'trial' | 'sub',
  id: string,
  endsAt: Date,
  stage: ReminderStage,
): string {
  const step = stage.kind === 'EXPIRED' ? 'J0' : `J-${stage.offset}`;
  return `${scope}:${id}:${endsAt.toISOString()}:${step}`;
}

export const SUITE_NOTIFICATION_KINDS = [
  'TRIAL_STARTED',
  'TRIAL_ENDING',
  'TRIAL_EXPIRED',
  'SUBSCRIPTION_ENDING',
  'SUBSCRIPTION_EXPIRED',
  'REQUEST_RECEIVED',
  'REQUEST_HANDLED',
  'REQUEST_REFUSED',
  'ACTIVATION_CONFIRMED',
  'SUSPENDED',
  'REACTIVATED',
  'SMS_TOPUP_APPROVED',
  'SMS_TOPUP_REJECTED',
] as const;
export type SuiteNotificationKind = (typeof SUITE_NOTIFICATION_KINDS)[number];

export const SUITE_REQUEST_KINDS = ['ACTIVATION', 'RENEWAL', 'PLAN_CHANGE'] as const;
export type SuiteRequestKind = (typeof SUITE_REQUEST_KINDS)[number];

export const SUITE_REQUEST_KIND_LABELS: Record<SuiteRequestKind, string> = {
  ACTIVATION: 'Activation',
  RENEWAL: 'Renouvellement',
  PLAN_CHANGE: 'Changement d’offre',
};

export const SUITE_REQUEST_STATUS_LABELS: Record<'PENDING' | 'HANDLED' | 'CANCELLED', string> = {
  PENDING: 'En attente',
  HANDLED: 'Traitée',
  CANCELLED: 'Refusée',
};

/** Paramètres d'une notification (aucune donnée personnelle : application, dates, quantités). */
export interface SuiteNotificationParams {
  productName?: string;
  endsAt?: string;
  daysLeft?: number;
  requestKind?: SuiteRequestKind;
  note?: string;
  schoolName?: string;
  credits?: number;
}

function day(iso: string | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'UTC' });
}

function days(n: number | undefined): string {
  return n === 1 ? '1 jour' : `${n ?? 0} jours`;
}

/** Titre et texte d'une notification, en français. */
export function suiteNotificationText(
  kind: SuiteNotificationKind,
  p: SuiteNotificationParams,
): { title: string; body: string } {
  const app = p.productName ?? 'votre application';
  const request = p.requestKind
    ? SUITE_REQUEST_KIND_LABELS[p.requestKind].toLowerCase()
    : 'demande';
  switch (kind) {
    case 'TRIAL_STARTED':
      return {
        title: `Essai de ${app} démarré`,
        body: `Votre essai gratuit est ouvert jusqu’au ${day(p.endsAt)}.`,
      };
    case 'TRIAL_ENDING':
      return {
        title: `Essai de ${app} : plus que ${days(p.daysLeft)}`,
        body: `L’essai se termine le ${day(p.endsAt)}. Demandez l’activation pour continuer sans interruption.`,
      };
    case 'TRIAL_EXPIRED':
      return {
        title: `Essai de ${app} terminé`,
        body: `L’essai s’est terminé le ${day(p.endsAt)}. Vos données sont conservées ; demandez l’activation pour reprendre.`,
      };
    case 'SUBSCRIPTION_ENDING':
      return {
        title: `Abonnement ${app} : échéance dans ${days(p.daysLeft)}`,
        body: `L’abonnement arrive à échéance le ${day(p.endsAt)}. Demandez le renouvellement pour éviter une interruption.`,
      };
    case 'SUBSCRIPTION_EXPIRED':
      return {
        title: `Abonnement ${app} expiré`,
        body: `L’abonnement est arrivé à échéance le ${day(p.endsAt)}. Demandez le renouvellement pour rétablir l’accès complet.`,
      };
    case 'REQUEST_RECEIVED':
      return {
        title: `Demande de ${request} enregistrée`,
        body: `Ocall a reçu votre demande pour ${app}. Elle sera traitée après vérification du règlement.`,
      };
    case 'REQUEST_HANDLED':
      return {
        title: `Demande de ${request} traitée`,
        body: `Votre demande pour ${app} a été traitée par Ocall.`,
      };
    case 'REQUEST_REFUSED':
      return {
        title: `Demande de ${request} non retenue`,
        body: `Votre demande pour ${app} n’a pas été retenue.${p.note ? ` Motif : ${p.note}` : ''}`,
      };
    case 'ACTIVATION_CONFIRMED':
      return {
        title: `${app} activé`,
        body: `Règlement confirmé : abonnement actif jusqu’au ${day(p.endsAt)}.`,
      };
    case 'SUSPENDED':
      return {
        title: `${app} suspendu`,
        body: `L’abonnement est suspendu par Ocall : l’application passe en consultation seule.${p.note ? ` Motif : ${p.note}` : ''}`,
      };
    case 'REACTIVATED':
      return {
        title: `${app} réactivé`,
        body: 'L’abonnement est réactivé par Ocall.',
      };
    case 'SMS_TOPUP_APPROVED':
      return {
        title: 'Recharge SMS validée',
        body: `${p.credits ?? 0} crédits SMS ajoutés au solde de ${p.schoolName ?? 'l’établissement'}.`,
      };
    case 'SMS_TOPUP_REJECTED':
      return {
        title: 'Recharge SMS refusée',
        body: `La demande de recharge de ${p.schoolName ?? 'l’établissement'} n’a pas été validée.${p.note ? ` Motif : ${p.note}` : ''}`,
      };
  }
}
