/**
 * Ocall Print — moteur COMMUN de personnalisation, de commande et de suivi des cartes (cartes scolaires,
 * badges du personnel), réutilisé par Ocall School, Ocall Parc et Sabatii, et accessible gratuitement en
 * autonome. L'impression physique est centralisée dans l'atelier Ocall de Bamako. Règles partagées par
 * l'API (contrôle) et l'interface (affichage).
 */

export const PRINT_PRODUCT_CODE = 'OCALL_PRINT';

/** Applications qui confient des cartes à Ocall Print (OCALL_PRINT : accès autonome). */
export const PRINT_SOURCE_APPS = ['OCALL_PRINT', 'OCALL_SCHOOL'] as const;
export type PrintSourceApp = (typeof PRINT_SOURCE_APPS)[number];

export const PRINT_SOURCE_APP_LABELS: Record<PrintSourceApp, string> = {
  OCALL_PRINT: 'Ocall Print',
  OCALL_SCHOOL: 'Ocall School',
};

export const PRINT_CARD_KINDS = ['STUDENT', 'STAFF'] as const;
export type PrintCardKind = (typeof PRINT_CARD_KINDS)[number];

export const PRINT_CARD_KIND_LABELS: Record<PrintCardKind, string> = {
  STUDENT: 'Carte scolaire',
  STAFF: 'Badge du personnel',
};

/** Prix d'une carte scolaire ou d'un badge (décision du 19/11/2026), figé dans chaque commande. */
export const PRINT_CARD_UNIT_PRICE = 3000;
export const PRINT_CURRENCY = 'XOF';

/** Conservation des fichiers de production après la clôture d'une commande, puis purge automatique. */
export const PRINT_RETENTION_DAYS = 90;

/** Format CR80 (ISO/IEC 7810 ID-1), celui d'une carte bancaire, en millimètres. */
export const PRINT_CARD_SIZE_MM = { width: 85.6, height: 53.98 } as const;
/** Fond perdu du fichier de production (le fond déborde, la coupe se fait au format). */
export const PRINT_BLEED_MM = 2;

/** Bornes d'une commande et d'une création en série. */
export const PRINT_ORDER_MAX_ITEMS = 500;
export const PRINT_BATCH_MAX = 500;

/** Format versionné des données d'une carte, confiées par l'application source. */
export const PRINT_CARD_FORMAT = 'ocall-print/card@1';

/**
 * Données d'une carte (`ocall-print/card@1`). Liste FERMÉE de champs : l'application source ne fournit
 * jamais de texte de mise en page ; seuls les libellés du modèle sont libres. Dates au format AAAA-MM-JJ.
 * La photo n'en fait pas partie : elle est transmise à part, puis copiée dans le stockage Print.
 */
export interface PrintCardData {
  format: typeof PRINT_CARD_FORMAT;
  kind: PrintCardKind;
  issuer: { name: string; nameAr: string | null; contact: string | null };
  holder: {
    firstName: string;
    lastName: string;
    firstNameAr: string | null;
    lastNameAr: string | null;
    /** Matricule (élève) ou numéro de personnel. */
    reference: string | null;
    /** Classe (élève), service (personnel). */
    group: string | null;
    jobTitle: string | null;
    birthDate: string | null;
  };
  /** Année scolaire (« 2026-2027 ») ou période de validité affichée. */
  period: string | null;
  validUntil: string | null;
  cardNumber: string;
  qr: string;
}

// ─── Champs imprimables ───

export const PRINT_FIELDS = [
  'fullName',
  'fullNameAr',
  'reference',
  'group',
  'jobTitle',
  'period',
  'birthDate',
  'validUntil',
] as const;
export type PrintField = (typeof PRINT_FIELDS)[number];

export const PRINT_FIELDS_BY_KIND: Record<PrintCardKind, readonly PrintField[]> = {
  STUDENT: ['fullName', 'fullNameAr', 'reference', 'group', 'period', 'birthDate', 'validUntil'],
  STAFF: ['fullName', 'fullNameAr', 'reference', 'jobTitle', 'group', 'period', 'validUntil'],
};

export function printFieldLabel(field: PrintField, kind: PrintCardKind): string {
  switch (field) {
    case 'fullName':
      return 'Nom et prénom';
    case 'fullNameAr':
      return 'Nom en arabe';
    case 'reference':
      return kind === 'STUDENT' ? 'Matricule' : 'N° personnel';
    case 'group':
      return kind === 'STUDENT' ? 'Classe' : 'Service';
    case 'jobTitle':
      return 'Fonction';
    case 'period':
      return kind === 'STUDENT' ? 'Année scolaire' : 'Période';
    case 'birthDate':
      return 'Né(e) le';
    case 'validUntil':
      return 'Valable jusqu’au';
  }
}

/** Valeur d'un champ pour une carte ; null s'il n'y a rien à imprimer. */
export function printFieldValue(field: PrintField, data: PrintCardData): string | null {
  const h = data.holder;
  switch (field) {
    case 'fullName':
      return `${h.lastName.toUpperCase()} ${h.firstName}`.trim() || null;
    case 'fullNameAr': {
      const ar = [h.firstNameAr, h.lastNameAr].filter(Boolean).join(' ').trim();
      return ar || null;
    }
    case 'reference':
      return h.reference;
    case 'group':
      return h.group;
    case 'jobTitle':
      return h.jobTitle;
    case 'period':
      return data.period;
    case 'birthDate':
      return h.birthDate ? frenchDate(h.birthDate) : null;
    case 'validUntil':
      return data.validUntil ? frenchDate(data.validUntil) : null;
  }
}

const frenchDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

// ─── Mise en page recto verso ───

export const PRINT_ORIENTATIONS = ['LANDSCAPE', 'PORTRAIT'] as const;
export type PrintOrientation = (typeof PRINT_ORIENTATIONS)[number];

export interface PrintLayout {
  orientation: PrintOrientation;
  colors: { primary: string; text: string; background: string };
  front: {
    /** Bandeau du recto : « CARTE SCOLAIRE », « BADGE »… */
    title: string;
    showLogo: boolean;
    showIssuer: boolean;
    photo: 'LEFT' | 'RIGHT';
    fields: PrintField[];
  };
  back: {
    showQr: boolean;
    /** Lignes libres du verso (règlement, « en cas de perte… »). */
    lines: string[];
    showValidity: boolean;
    showIssuerContact: boolean;
    showCardNumber: boolean;
  };
}

export const PRINT_LAYOUT_LIMITS = {
  titleMax: 40,
  linesMax: 4,
  lineMax: 90,
  fieldsMin: 1,
  fieldsMax: 6,
  nameMax: 80,
} as const;

export function defaultPrintLayout(kind: PrintCardKind): PrintLayout {
  return {
    orientation: 'LANDSCAPE',
    colors: { primary: '#0F5132', text: '#1F2937', background: '#FFFFFF' },
    front: {
      title: kind === 'STUDENT' ? 'CARTE SCOLAIRE' : 'BADGE DU PERSONNEL',
      showLogo: true,
      showIssuer: true,
      photo: 'LEFT',
      fields:
        kind === 'STUDENT'
          ? ['fullName', 'reference', 'group', 'period']
          : ['fullName', 'jobTitle', 'reference', 'period'],
    },
    back: {
      showQr: true,
      lines: [
        'Cette carte est strictement personnelle.',
        'En cas de perte, prévenir l’établissement.',
      ],
      showValidity: true,
      showIssuerContact: true,
      showCardNumber: true,
    },
  };
}

const HEX = /^#[0-9A-Fa-f]{6}$/;
/** Caractère de contrôle (saut de ligne, tabulation, NUL…) : refusé dans tout texte imprimé. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/;
export const hasControlChars = (value: string) => CONTROL.test(value);

type ParseResult = { ok: true; layout: PrintLayout } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Valide et normalise une mise en page reçue (formulaire ou API). Refuse toute clé ou valeur inconnue :
 * le moteur de rendu ne reçoit qu'une forme fermée.
 */
export function parsePrintLayout(input: unknown, kind: PrintCardKind): ParseResult {
  const fail = (error: string): ParseResult => ({ ok: false, error });
  if (!isObject(input)) return fail('Mise en page invalide.');
  const { orientation, colors, front, back } = input;
  if (!PRINT_ORIENTATIONS.includes(orientation as PrintOrientation))
    return fail('Orientation invalide.');
  if (!isObject(colors)) return fail('Couleurs invalides.');
  for (const key of ['primary', 'text', 'background'] as const) {
    if (typeof colors[key] !== 'string' || !HEX.test(colors[key] as string))
      return fail('Couleur invalide : format #RRGGBB attendu.');
  }
  if (!isObject(front) || !isObject(back)) return fail('Recto ou verso manquant.');
  const title = typeof front.title === 'string' ? front.title.trim() : null;
  if (title === null || title.length > PRINT_LAYOUT_LIMITS.titleMax || CONTROL.test(title))
    return fail(`Titre du recto : ${PRINT_LAYOUT_LIMITS.titleMax} caractères au plus.`);
  if (front.photo !== 'LEFT' && front.photo !== 'RIGHT')
    return fail('Position de la photo invalide.');
  if (!Array.isArray(front.fields)) return fail('Champs du recto invalides.');
  const allowed = PRINT_FIELDS_BY_KIND[kind];
  const fields: PrintField[] = [];
  for (const f of front.fields) {
    if (!allowed.includes(f as PrintField)) return fail('Champ non disponible pour cette carte.');
    if (fields.includes(f as PrintField)) return fail('Champ en double.');
    fields.push(f as PrintField);
  }
  if (
    fields.length < PRINT_LAYOUT_LIMITS.fieldsMin ||
    fields.length > PRINT_LAYOUT_LIMITS.fieldsMax
  )
    return fail(
      `Recto : de ${PRINT_LAYOUT_LIMITS.fieldsMin} à ${PRINT_LAYOUT_LIMITS.fieldsMax} champs.`,
    );
  if (!Array.isArray(back.lines) || back.lines.length > PRINT_LAYOUT_LIMITS.linesMax)
    return fail(`Verso : ${PRINT_LAYOUT_LIMITS.linesMax} lignes au plus.`);
  const lines: string[] = [];
  for (const line of back.lines) {
    if (typeof line !== 'string') return fail('Ligne du verso invalide.');
    const text = line.trim();
    if (text.length > PRINT_LAYOUT_LIMITS.lineMax || CONTROL.test(text))
      return fail(`Ligne du verso : ${PRINT_LAYOUT_LIMITS.lineMax} caractères au plus.`);
    if (text) lines.push(text);
  }
  const bool = (o: Record<string, unknown>, k: string) => o[k] === true;
  for (const [o, keys] of [
    [front, ['showLogo', 'showIssuer']],
    [back, ['showQr', 'showValidity', 'showIssuerContact', 'showCardNumber']],
  ] as const) {
    for (const k of keys)
      if (typeof o[k] !== 'boolean') return fail('Option de mise en page invalide.');
  }
  return {
    ok: true,
    layout: {
      orientation: orientation as PrintOrientation,
      colors: {
        primary: (colors.primary as string).toUpperCase(),
        text: (colors.text as string).toUpperCase(),
        background: (colors.background as string).toUpperCase(),
      },
      front: {
        title,
        showLogo: bool(front, 'showLogo'),
        showIssuer: bool(front, 'showIssuer'),
        photo: front.photo,
        fields,
      },
      back: {
        showQr: bool(back, 'showQr'),
        lines,
        showValidity: bool(back, 'showValidity'),
        showIssuerContact: bool(back, 'showIssuerContact'),
        showCardNumber: bool(back, 'showCardNumber'),
      },
    },
  };
}

// ─── Commandes ───

export const PRINT_ORDER_STATUSES = [
  'SUBMITTED',
  'ACCEPTED',
  'IN_PRODUCTION',
  'READY',
  'DELIVERED',
  'CANCELLED',
  'REJECTED',
] as const;
export type PrintOrderStatus = (typeof PRINT_ORDER_STATUSES)[number];

export const PRINT_ORDER_STATUS_LABELS: Record<PrintOrderStatus, string> = {
  SUBMITTED: 'Envoyée',
  ACCEPTED: 'Acceptée',
  IN_PRODUCTION: 'En production',
  READY: 'Prête',
  DELIVERED: 'Livrée',
  CANCELLED: 'Annulée',
  REJECTED: 'Refusée',
};

export const PRINT_ITEM_STATUSES = ['PENDING', 'PRINTED', 'REJECTED', 'CANCELLED'] as const;
export type PrintItemStatus = (typeof PRINT_ITEM_STATUSES)[number];

export const PRINT_ITEM_STATUS_LABELS: Record<PrintItemStatus, string> = {
  PENDING: 'À imprimer',
  PRINTED: 'Imprimée',
  REJECTED: 'Refusée',
  CANCELLED: 'Annulée',
};

export const PRINT_PAYMENT_STATUS_LABELS = { UNPAID: 'À régler', PAID: 'Réglée' } as const;

/** Étapes de production, dans l'ordre (atelier Ocall). */
export const PRINT_ORDER_FLOW: Partial<Record<PrintOrderStatus, PrintOrderStatus>> = {
  SUBMITTED: 'ACCEPTED',
  ACCEPTED: 'IN_PRODUCTION',
  IN_PRODUCTION: 'READY',
  READY: 'DELIVERED',
};

/** Le client annule tant que la production n'a pas commencé ; l'atelier refuse avant la production. */
export const PRINT_ORDER_CANCELLABLE: readonly PrintOrderStatus[] = ['SUBMITTED', 'ACCEPTED'];
export const PRINT_ORDER_REJECTABLE: readonly PrintOrderStatus[] = ['SUBMITTED', 'ACCEPTED'];
/** Une ligne se refuse (photo illisible…) jusqu'à la fin de la production. */
export const PRINT_ITEM_REJECTABLE: readonly PrintOrderStatus[] = [
  'SUBMITTED',
  'ACCEPTED',
  'IN_PRODUCTION',
];
export const PRINT_ORDER_CLOSED: readonly PrintOrderStatus[] = [
  'DELIVERED',
  'CANCELLED',
  'REJECTED',
];

export const printOrderTotal = (quantity: number, unitPrice: number) => quantity * unitPrice;

/** Numéro lisible d'une commande : IMP-2026-00001. */
export const printOrderNumber = (year: number, value: number) =>
  `IMP-${year}-${String(value).padStart(5, '0')}`;

// ─── Fiches de l'accès autonome ───

export const PRINT_PERSON_LIMITS = {
  nameMax: 80,
  referenceMax: 40,
  groupMax: 60,
  jobMax: 80,
} as const;

/** Texte de recherche normalisé : minuscules, sans accents. */
export function printSearchText(...parts: (string | null | undefined)[]): string {
  return parts
    .filter((p): p is string => Boolean(p))
    .join(' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Préfixe des QR de carte Ocall Print (version 1) ; la signature est vérifiée par l'API seule. */
export const PRINT_CARD_QR_PREFIX = 'OCP1.';
