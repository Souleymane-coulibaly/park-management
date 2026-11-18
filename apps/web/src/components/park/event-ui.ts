import type { TicketEventRef } from '@/lib/types';

/** Prénom affiché d'un billet ; un billet d'événement non nominatif n'en a pas. */
export const visitorLabel = (name: string | null | undefined) =>
  name && name.trim() ? name : 'Billet non nominatif';

/** « Concert de Noël · séance du 24/12/2026 · 20:00 – 23:30 ». */
export const eventLine = (event: TicketEventRef) => `${event.name} · séance du ${event.session}`;

/** Couleur du badge de statut d'un événement. */
export const EVENT_STATUS_TONE = {
  DRAFT: 'savanna',
  PUBLISHED: 'forest',
  ARCHIVED: 'neutral',
} as const;
