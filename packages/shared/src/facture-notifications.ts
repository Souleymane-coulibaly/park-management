/**
 * Ocall Facture — notifications de rendez-vous (F4) : confirmation, report, rappels et annulation d'une
 * intervention, par WhatsApp (consentement du client) ou par e-mail en secours. Règles partagées par
 * l'API et le web.
 */

export const FACTURE_NOTIFICATION_KINDS = [
  'CONFIRMATION',
  'RESCHEDULED',
  'REMINDER',
  'CANCELLATION',
] as const;
export type FactureNotificationKind = (typeof FACTURE_NOTIFICATION_KINDS)[number];

export const FACTURE_NOTIFICATION_KIND_LABELS: Record<FactureNotificationKind, string> = {
  CONFIRMATION: 'Confirmation',
  RESCHEDULED: 'Report',
  REMINDER: 'Rappel',
  CANCELLATION: 'Annulation',
};

export const FACTURE_NOTIFICATION_CHANNELS = ['WHATSAPP', 'EMAIL'] as const;
export type FactureNotificationChannel = (typeof FACTURE_NOTIFICATION_CHANNELS)[number];

export const FACTURE_NOTIFICATION_CHANNEL_LABELS: Record<FactureNotificationChannel, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'E-mail',
};

export const FACTURE_NOTIFICATION_STATUSES = [
  'PENDING',
  'SENT',
  'FAILED',
  'CANCELLED',
  'UNKNOWN',
] as const;
export type FactureNotificationStatus = (typeof FACTURE_NOTIFICATION_STATUSES)[number];

export const FACTURE_NOTIFICATION_STATUS_LABELS: Record<FactureNotificationStatus, string> = {
  PENDING: 'Programmée',
  SENT: 'Envoyée',
  FAILED: 'Échec',
  CANCELLED: 'Annulée',
  /** Envoi peut-être parti (interruption) : jamais renvoyé, pour ne pas doubler le message. */
  UNKNOWN: 'Résultat inconnu',
};

/** Tentatives d'envoi d'une notification (erreur passagère du fournisseur). */
export const FACTURE_NOTIFICATION_MAX_ATTEMPTS = 4;

/** Délai avant la tentative suivante : 1 min, 5 min, 15 min. */
export function factureNotificationRetryDelayMs(attempts: number): number {
  return [60_000, 5 * 60_000, 15 * 60_000][Math.max(0, attempts - 1)] ?? 15 * 60_000;
}

/** Rappel « quelques heures avant » : 1 à 12 heures. */
export const FACTURE_REMINDER_HOURS = [1, 2, 3, 4, 6, 12] as const;

export interface FactureReminderSettings {
  reminderDayBefore: boolean;
  /** Heures avant le rendez-vous, ou null : pas de rappel le jour même. */
  reminderHoursBefore: number | null;
}

const HOUR = 3_600_000;

/**
 * Rappels d'un rendez-vous : la veille (24 h avant) et quelques heures avant. Un rappel dont l'heure est
 * déjà passée n'est pas programmé ; deux rappels trop proches (moins d'une heure d'écart) n'en font qu'un.
 */
export function factureReminderTimes(
  appointmentAt: Date,
  settings: FactureReminderSettings,
  now: Date,
): { key: string; at: Date }[] {
  const start = appointmentAt.getTime();
  const times: { key: string; at: Date }[] = [];
  if (settings.reminderDayBefore) times.push({ key: 'J-1', at: new Date(start - 24 * HOUR) });
  if (settings.reminderHoursBefore) {
    const at = new Date(start - settings.reminderHoursBefore * HOUR);
    if (!times.some((t) => Math.abs(t.at.getTime() - at.getTime()) < HOUR)) {
      times.push({ key: `H-${settings.reminderHoursBefore}`, at });
    }
  }
  return times.filter((t) => t.at.getTime() > now.getTime());
}

export interface FactureAppointmentMessage {
  /** Entreprise qui intervient. */
  business: string;
  businessPhone: string | null;
  /** Personne prévenue (contact sur place ou client). */
  recipientName: string;
  reference: string;
  title: string;
  appointmentAt: Date;
  place: string | null;
}

/** « mardi 11 novembre à 08:00 » (heure du Mali = UTC). */
export function formatFactureAppointment(at: Date): string {
  const day = at.toLocaleDateString('fr-FR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const time = at.toLocaleTimeString('fr-FR', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${day} à ${time}`;
}

/**
 * Texte d'une notification (corps WhatsApp et e-mail). Les modèles WhatsApp soumis à Meta reprendront
 * ces textes, avec les mêmes paramètres.
 */
export function renderFactureAppointmentMessage(
  kind: FactureNotificationKind,
  m: FactureAppointmentMessage,
): string {
  const when = formatFactureAppointment(m.appointmentAt);
  const where = m.place ? ` (${m.place})` : '';
  const contact = m.businessPhone ? ` Pour toute question : ${m.businessPhone}.` : '';
  const head = `Bonjour ${m.recipientName},`;
  switch (kind) {
    case 'CONFIRMATION':
      return `${head} ${m.business} confirme votre rendez-vous « ${m.title} » le ${when}${where}. Réf. ${m.reference}.${contact}`;
    case 'RESCHEDULED':
      return `${head} votre rendez-vous « ${m.title} » avec ${m.business} est reporté au ${when}${where}. Réf. ${m.reference}.${contact}`;
    case 'REMINDER':
      return `${head} rappel : ${m.business} intervient le ${when}${where} pour « ${m.title} ». Réf. ${m.reference}.${contact}`;
    case 'CANCELLATION':
      return `${head} votre rendez-vous « ${m.title} » du ${when} avec ${m.business} est annulé. Réf. ${m.reference}.${contact}`;
  }
}

/** Code du modèle WhatsApp correspondant (à faire approuver par Meta avant le branchement réel). */
export const FACTURE_WHATSAPP_TEMPLATES: Record<FactureNotificationKind, string> = {
  CONFIRMATION: 'ocall_rdv_confirmation',
  RESCHEDULED: 'ocall_rdv_report',
  REMINDER: 'ocall_rdv_rappel',
  CANCELLATION: 'ocall_rdv_annulation',
};
