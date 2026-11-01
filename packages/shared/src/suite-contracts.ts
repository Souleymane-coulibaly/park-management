/**
 * Contrats B2B Ocall Suite : un produit vendu sur contrat (Ocall School) n'a ni tarif public ni offre à
 * prix fixe. Règles partagées par l'API (contrôle) et l'administration (affichage).
 *
 * Règle absolue : un contrat suspendu, expiré ou résilié n'entraîne jamais de suppression de données.
 */

export const SUITE_CONTRACT_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'SUSPENDED',
  'EXPIRED',
  'TERMINATED',
] as const;
export type SuiteContractStatus = (typeof SUITE_CONTRACT_STATUSES)[number];

export const SUITE_CONTRACT_STATUS_LABELS: Record<SuiteContractStatus, string> = {
  DRAFT: 'Brouillon',
  ACTIVE: 'Actif',
  SUSPENDED: 'Suspendu',
  EXPIRED: 'Expiré',
  TERMINATED: 'Résilié',
};

/** Transitions manuelles autorisées. Le renouvellement passe par son propre parcours. */
export const SUITE_CONTRACT_TRANSITIONS: Record<
  SuiteContractStatus,
  readonly SuiteContractStatus[]
> = {
  DRAFT: ['ACTIVE', 'TERMINATED'],
  ACTIVE: ['SUSPENDED', 'EXPIRED', 'TERMINATED'],
  SUSPENDED: ['ACTIVE', 'TERMINATED'],
  EXPIRED: ['TERMINATED'],
  TERMINATED: [],
};

export function canTransitionContract(from: SuiteContractStatus, to: SuiteContractStatus): boolean {
  return SUITE_CONTRACT_TRANSITIONS[from].includes(to);
}

/** full : lecture et écriture ; read_only : lecture et export ; none : produit non ouvert. */
export type ProductAccess = 'full' | 'read_only' | 'none';

export interface ContractWindow {
  status: SuiteContractStatus;
  startsOn: Date | string;
  endsOn: Date | string;
}

/** Application du portail Ocall Suite accessible à un membre. */
export interface AuthProductApp {
  code: string;
  name: string;
  href: string;
  access: ProductAccess;
}

const DAY_MS = 86_400_000;

/**
 * Accès donné par un contrat. Un contrat actif dont la date de fin est passée vaut lecture seule sans
 * attendre de traitement planifié ; le dernier jour reste entier (dates du contrat en UTC).
 */
export function contractAccess(contract: ContractWindow, now: Date = new Date()): ProductAccess {
  if (contract.status === 'DRAFT') return 'none';
  if (contract.status !== 'ACTIVE') return 'read_only';
  if (now.getTime() < new Date(contract.startsOn).getTime()) return 'none';
  if (now.getTime() >= new Date(contract.endsOn).getTime() + DAY_MS) return 'read_only';
  return 'full';
}

/** Accès le plus large parmi les contrats d'un client pour un produit (ex. pendant un renouvellement). */
export function bestContract<T extends ContractWindow>(
  contracts: readonly T[],
  now: Date = new Date(),
): { contract: T; access: ProductAccess } | null {
  const rank: Record<ProductAccess, number> = { full: 2, read_only: 1, none: 0 };
  let best: { contract: T; access: ProductAccess } | null = null;
  for (const contract of contracts) {
    const access = contractAccess(contract, now);
    if (!best || rank[access] > rank[best.access]) best = { contract, access };
  }
  return best;
}
