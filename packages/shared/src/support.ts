/**
 * Ocall Suite — support, fichiers privés et quotas (Sprint 11B). Règles partagées par l'API
 * (contrôle) et les interfaces (affichage).
 */

// ─── Support ───

export const SUPPORT_TICKET_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
  'RESOLVED',
  'CLOSED',
] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];
export const SUPPORT_TICKET_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  OPEN: 'Nouvelle',
  IN_PROGRESS: 'En cours',
  WAITING_CUSTOMER: 'En attente de votre réponse',
  RESOLVED: 'Résolue',
  CLOSED: 'Fermée',
};
/** Statuts où la demande est encore à traiter par Ocall. */
export const SUPPORT_OPEN_STATUSES: readonly SupportTicketStatus[] = ['OPEN', 'IN_PROGRESS'];

export const SUPPORT_TICKET_CATEGORIES = [
  'BILLING',
  'TECHNICAL',
  'ACCOUNT',
  'HARDWARE',
  'OTHER',
] as const;
export type SupportTicketCategory = (typeof SUPPORT_TICKET_CATEGORIES)[number];
export const SUPPORT_TICKET_CATEGORY_LABELS: Record<SupportTicketCategory, string> = {
  BILLING: 'Abonnement et facturation',
  TECHNICAL: 'Problème technique',
  ACCOUNT: 'Compte et accès',
  HARDWARE: 'Matériel (caisse, imprimante, scanner)',
  OTHER: 'Autre',
};

export const SUPPORT_TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type SupportTicketPriority = (typeof SUPPORT_TICKET_PRIORITIES)[number];
export const SUPPORT_TICKET_PRIORITY_LABELS: Record<SupportTicketPriority, string> = {
  LOW: 'Faible',
  NORMAL: 'Normale',
  HIGH: 'Haute',
  URGENT: 'Urgente (activité bloquée)',
};

/** Référence lisible : SUP-2026-00042. */
export function formatSupportNumber(year: number, sequence: number): string {
  return `SUP-${year}-${String(sequence).padStart(5, '0')}`;
}

/**
 * Statut après un message : une réponse du client relance la demande ; une réponse publique
 * d'Ocall la met en attente du client (sauf statut choisi explicitement).
 */
export function statusAfterMessage(
  current: SupportTicketStatus,
  from: 'customer' | 'ocall',
): SupportTicketStatus {
  if (from === 'customer') return current === 'OPEN' ? 'OPEN' : 'IN_PROGRESS';
  return current === 'CLOSED' ? 'CLOSED' : 'WAITING_CUSTOMER';
}

// ─── Fichiers privés ───

/** Pièces jointes : images et PDF uniquement, vérifiés par signature (pas par extension). */
export const SUPPORT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const SUPPORT_ATTACHMENTS_PER_MESSAGE = 3;
/** Conservation des pièces jointes du support, puis purge. */
export const SUPPORT_ATTACHMENT_RETENTION_DAYS = 365;
/** Durée de validité d'un lien temporaire de téléchargement. */
export const SIGNED_URL_TTL_SECONDS = 300;

/** Nom affiché d'un fichier : caractères sûrs, 80 au plus (jamais utilisé comme clé). */
export function safeDisplayName(name: string): string {
  const cleaned = Array.from(name.normalize('NFC'), (c) =>
    c.charCodeAt(0) < 0x20 || '\\/:*?"<>|'.includes(c) ? '_' : c,
  )
    .join('')
    .trim()
    .slice(0, 80);
  return cleaned || 'fichier';
}

// ─── Quotas ───

export const DEFAULT_AI_MONTHLY_QUOTA = 500;
export const DEFAULT_STORAGE_QUOTA_MB = 1024;
export const MAX_QUOTA_VALUE = 1_000_000;

/** Quota effectif : dérogation du Super Admin, sinon quota de l'offre, sinon valeur par défaut. */
export function effectiveQuota(
  override: number | null | undefined,
  planQuota: number | null | undefined,
  fallback: number,
): number {
  return override ?? planQuota ?? fallback;
}

export const bytesToMb = (bytes: number) => Math.round((bytes / (1024 * 1024)) * 10) / 10;
