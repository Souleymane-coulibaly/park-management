/**
 * Identité légale de l'éditeur Ocall (commercialisation J2) : saisie par Ocall dans l'administration,
 * jamais inventée. Elle alimente les pages légales du site et les factures et reçus d'abonnement Ocall.
 *
 * La facturation Ocall reste indépendante de celle des organisations clientes (Ocall Facture) : cette
 * identité n'est jamais celle d'une organisation.
 *
 * Une facture d'abonnement n'est DÉFINITIVE que si toutes les mentions obligatoires sont renseignées à
 * son émission : l'identité est alors copiée sur la facture (figée, jamais relue). Sinon la facture est
 * PROVISOIRE et son document le dit.
 */

export const OCALL_LEGAL_FIELDS = [
  'legalName',
  'tradeName',
  'legalForm',
  'shareCapital',
  'address',
  'city',
  'country',
  'rccm',
  'nif',
  'taxRegime',
  'publicationDirector',
  'phone',
  'whatsapp',
  'email',
  'privacyEmail',
  'hostingProvider',
  'bankDetails',
] as const;
export type OcallLegalField = (typeof OCALL_LEGAL_FIELDS)[number];

export type OcallLegalIdentity = Record<OcallLegalField, string | null>;

export const OCALL_LEGAL_FIELD_LABELS: Record<OcallLegalField, string> = {
  legalName: 'Raison sociale',
  tradeName: 'Nom commercial',
  legalForm: 'Forme juridique',
  shareCapital: 'Capital social',
  address: 'Adresse du siège',
  city: 'Ville',
  country: 'Pays',
  rccm: 'RCCM',
  nif: 'NIF',
  taxRegime: 'Régime fiscal (mention imprimée sur les factures)',
  publicationDirector: 'Directeur de la publication (nom et fonction)',
  phone: 'Téléphone',
  whatsapp: 'WhatsApp',
  email: 'E-mail de contact',
  privacyEmail: 'E-mail des demandes sur les données personnelles',
  hostingProvider: 'Hébergeur(s) : raison sociale et adresse',
  bankDetails: 'Coordonnées bancaires (factures uniquement)',
};

/**
 * Mentions obligatoires d'une facture d'abonnement définitive. Liste à faire valider par le conseil
 * d'Ocall : la modifier ici suffit, l'API et l'administration la relisent.
 */
export const OCALL_INVOICE_REQUIRED_FIELDS: readonly OcallLegalField[] = [
  'legalName',
  'legalForm',
  'address',
  'city',
  'country',
  'rccm',
  'nif',
  'taxRegime',
];

/** Champs jamais publiés sur le site (imprimés seulement sur les factures). */
export const OCALL_PRIVATE_LEGAL_FIELDS: readonly OcallLegalField[] = ['bankDetails'];

export const OCALL_LEGAL_FIELD_MAX_LENGTH = 400;

export const EMPTY_OCALL_LEGAL_IDENTITY: OcallLegalIdentity = Object.fromEntries(
  OCALL_LEGAL_FIELDS.map((f) => [f, null]),
) as OcallLegalIdentity;

/** Valeur saisie nettoyée : espaces retirés, chaîne vide = non renseigné. */
export function cleanLegalValue(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/** Mentions obligatoires manquantes pour émettre une facture définitive. */
export function missingInvoiceLegalFields(
  identity: Partial<OcallLegalIdentity> | null | undefined,
): OcallLegalField[] {
  return OCALL_INVOICE_REQUIRED_FIELDS.filter((f) => !cleanLegalValue(identity?.[f]));
}

/** Identité publiable (pages légales) : sans les champs privés. */
export type OcallPublicLegalIdentity = Omit<OcallLegalIdentity, 'bankDetails'>;

export function publicLegalIdentity(identity: OcallLegalIdentity): OcallPublicLegalIdentity {
  const { bankDetails: _private, ...rest } = identity;
  return rest;
}
