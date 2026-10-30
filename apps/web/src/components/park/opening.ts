import type { OpeningVerdict } from '@ocall/shared';

export const WEEKDAY_LABELS = [
  'Dimanche',
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
];

/** Libellé de l'état d'ouverture du parc à l'instant présent. */
export function describeOpening(status: OpeningVerdict): string {
  if (status.open) {
    if (status.source === 'NO_SCHEDULE') return 'Ouvert (aucun horaire configuré)';
    const hours =
      status.opensAt || status.closesAt
        ? ` · ${status.opensAt ?? '00:00'}–${status.closesAt ?? '24:00'}`
        : '';
    return `Ouvert${status.source === 'EXCEPTION' ? ' (horaires spéciaux)' : ''}${hours}`;
  }
  if (status.reason === 'EXCEPTIONAL_CLOSURE')
    return `Fermeture exceptionnelle${status.label ? ` : ${status.label}` : ''}`;
  if (status.reason === 'CLOSED_DAY') return 'Fermé aujourd’hui';
  return 'Fermé à cette heure';
}
