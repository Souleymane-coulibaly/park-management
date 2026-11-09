/**
 * Sprint S2 — facturation des SMS School en crédits prépayés.
 *
 * Unité : 1 crédit = 1 segment SMS vers un numéro national. Un message long est découpé en plusieurs
 * segments (multipart) : 160 caractères GSM-7 pour un segment seul, 153 par segment au-delà ; 70
 * caractères UCS-2 (arabe, emoji, caractères hors GSM-7) pour un segment seul, 67 au-delà. Vers
 * l'international, chaque segment coûte le nombre de crédits fixé par le tarif en vigueur ; sans valeur
 * fixée, les envois internationaux sont refusés. Aucun prix commercial n'est défini ici : il est versionné
 * en base par Ocall (SchoolSmsTariff).
 */

/** Alphabet GSM 03.38 de base : un caractère = un septet. */
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
/** Extension GSM 03.38 : un caractère = deux septets (échappement). */
const GSM7_EXTENDED = '^{}\\[~]|€\f';

const BASIC = new Set(GSM7_BASIC);
const EXTENDED = new Set(GSM7_EXTENDED);

export type SmsEncoding = 'GSM7' | 'UCS2';

export interface SmsSegmentation {
  encoding: SmsEncoding;
  /** Septets (GSM-7) ou unités UTF-16 (UCS-2). */
  units: number;
  segments: number;
}

/** Découpage d'un texte en segments SMS, selon l'encodage que le texte impose. */
export function smsSegments(text: string): SmsSegmentation {
  let septets = 0;
  let gsm = true;
  for (const ch of text) {
    if (BASIC.has(ch)) septets += 1;
    else if (EXTENDED.has(ch)) septets += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) {
    return {
      encoding: 'GSM7',
      units: septets,
      segments: septets <= 160 ? 1 : Math.ceil(septets / 153),
    };
  }
  // UCS-2 : longueur en unités UTF-16 (un emoji hors plan de base compte pour deux).
  const units = text.length;
  return { encoding: 'UCS2', units, segments: units <= 70 ? 1 : Math.ceil(units / 67) };
}

/** Indicatifs téléphoniques des pays desservis (établissements School). */
export const SMS_CALLING_CODES: Readonly<Record<string, string>> = {
  ML: '223',
  CI: '225',
  SN: '221',
  BF: '226',
  NE: '227',
  GN: '224',
  TG: '228',
  BJ: '229',
  MR: '222',
  GM: '220',
  CM: '237',
  TD: '235',
  GA: '241',
  CG: '242',
  CD: '243',
  MA: '212',
  DZ: '213',
  TN: '216',
  FR: '33',
  BE: '32',
};

/**
 * Destination internationale : numéro au format international (+ ou 00) dont l'indicatif n'est pas
 * celui du pays de l'établissement. Un numéro sans indicatif est national. Pays sans indicatif connu :
 * tout numéro au format international est traité comme international (jamais sous-facturé).
 */
export function isInternationalSms(phone: string, schoolCountryCode: string): boolean {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/[^0-9]/g, '');
  let international: string | null = null;
  if (trimmed.startsWith('+')) international = digits;
  else if (digits.startsWith('00')) international = digits.slice(2);
  if (international === null) return false;
  const code = SMS_CALLING_CODES[schoolCountryCode.toUpperCase()];
  return !code || !international.startsWith(code);
}

export interface SmsTariffRules {
  /** Crédits par segment vers l'international ; nul = international refusé. */
  internationalCreditsPerSegment: number | null;
}

export interface SmsCost {
  encoding: SmsEncoding;
  segments: number;
  international: boolean;
  /** Crédits à réserver ; nul = destination refusée par le tarif. */
  credits: number | null;
}

/** Coût en crédits d'un message vers un destinataire. */
export function smsCost(
  text: string,
  phone: string,
  schoolCountryCode: string,
  tariff: SmsTariffRules | null,
): SmsCost {
  const { encoding, segments } = smsSegments(text);
  const international = isInternationalSms(phone, schoolCountryCode);
  const perSegment = international ? (tariff?.internationalCreditsPerSegment ?? null) : 1;
  return {
    encoding,
    segments,
    international,
    credits: perSegment === null ? null : perSegment * segments,
  };
}

/** Bornes d'une demande de recharge et d'une correction administrative, en crédits. */
export const SMS_TOPUP_MIN_CREDITS = 50;
export const SMS_TOPUP_MAX_CREDITS = 100_000;
export const SMS_ADJUSTMENT_MAX_CREDITS = 100_000;

/** Montant indicatif d'une recharge ; nul tant qu'aucun prix n'est publié. */
export function smsTopUpQuote(credits: number, creditPriceXof: number | null): number | null {
  return creditPriceXof === null ? null : credits * creditPriceXof;
}

export const SCHOOL_SMS_LEDGER_KINDS = [
  'TOPUP',
  'RESERVE',
  'CAPTURE',
  'RELEASE',
  'ADJUSTMENT',
] as const;
export type SchoolSmsLedgerKind = (typeof SCHOOL_SMS_LEDGER_KINDS)[number];

export const SCHOOL_SMS_LEDGER_LABELS: Record<SchoolSmsLedgerKind, string> = {
  TOPUP: 'Recharge validée',
  RESERVE: 'Réservation avant envoi',
  CAPTURE: 'SMS envoyé',
  RELEASE: 'Crédits rendus',
  ADJUSTMENT: 'Correction Ocall',
};

export const SCHOOL_SMS_TOPUP_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type SchoolSmsTopUpStatus = (typeof SCHOOL_SMS_TOPUP_STATUSES)[number];

export const SCHOOL_SMS_TOPUP_LABELS: Record<SchoolSmsTopUpStatus, string> = {
  PENDING: 'En attente de validation',
  APPROVED: 'Validée',
  REJECTED: 'Refusée',
  CANCELLED: 'Annulée',
};

/** Motifs d'annulation ou d'échec d'un SMS, affichés à la direction. */
export const SCHOOL_SMS_ERROR_LABELS: Record<string, string> = {
  RECIPIENT_INELIGIBLE: 'Destinataire retiré ou SMS refusés',
  SMS_NOT_IN_CONTRACT: 'SMS non inclus dans l’offre',
  SMS_INSUFFICIENT_CREDITS: 'Solde SMS insuffisant',
  SMS_DESTINATION_NOT_ALLOWED: 'Destination internationale non autorisée',
  ATTEMPTS_EXHAUSTED: 'Tentatives épuisées',
  INVALID_NUMBER: 'Numéro invalide',
  PROVIDER_UNAVAILABLE: 'Fournisseur indisponible',
  PROVIDER_ERROR: 'Erreur du fournisseur',
  SENDING: 'Envoi en cours',
  OUTCOME_UNKNOWN: 'Résultat inconnu après interruption (crédits consommés, non renvoyé)',
};
