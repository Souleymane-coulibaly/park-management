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

/** Contrat d'un produit couvrant des établissements (couverture vide = tous ceux du client). */
export interface CoveringContract extends ContractWindow {
  modules: readonly string[];
  limits: { maxSchools?: number } | null | undefined;
  coveredSchoolIds: readonly string[];
}

/**
 * Droits d'un client sur un produit couvert par PLUSIEURS contrats (renouvellement, avenant, contrats
 * par établissement), sans jamais retenir arbitrairement un seul contrat :
 * - `access` : le plus large parmi tous les contrats (porte d'entrée du produit) ;
 * - `readSchoolIds` : établissements couverts par au moins un contrat actif ou en lecture seule ;
 * - `writeSchoolIds` : établissements couverts par au moins un contrat ACTIF (écriture) ;
 *   `null` = tous les établissements du client (un contrat sans couverture précise), `[]` = aucun ;
 * - `modules` : union des modules des contrats actifs ou en lecture seule ;
 * - `limits.maxSchools` : la plus favorable parmi les contrats actifs (aucune limite si l'un n'en fixe
 *   pas, sinon la plus grande ; jamais de cumul).
 * Indépendant de l'ordre des contrats.
 */
export interface ResolvedProductEntitlement {
  access: ProductAccess;
  readSchoolIds: string[] | null;
  writeSchoolIds: string[] | null;
  modules: string[];
  limits: { maxSchools?: number };
}

export function resolveProductEntitlement(
  contracts: readonly CoveringContract[],
  now: Date = new Date(),
): ResolvedProductEntitlement {
  const rank: Record<ProductAccess, number> = { full: 2, read_only: 1, none: 0 };
  let access: ProductAccess = 'none';
  const read = new Set<string>();
  const write = new Set<string>();
  let readAll = false;
  let writeAll = false;
  const modules = new Set<string>();
  let maxSchools: number | undefined;
  let unlimited = false;
  let anyFull = false;
  for (const c of contracts) {
    const a = contractAccess(c, now);
    if (a === 'none') continue;
    if (rank[a] > rank[access]) access = a;
    for (const m of c.modules) modules.add(m);
    const all = c.coveredSchoolIds.length === 0;
    if (all) readAll = true;
    else for (const id of c.coveredSchoolIds) read.add(id);
    if (a === 'full') {
      anyFull = true;
      if (all) writeAll = true;
      else for (const id of c.coveredSchoolIds) write.add(id);
      const limit = c.limits?.maxSchools;
      if (limit === undefined || limit === null) unlimited = true;
      else maxSchools = Math.max(maxSchools ?? 0, limit);
    }
  }
  return {
    access,
    readSchoolIds: readAll ? null : [...read].sort(),
    writeSchoolIds: writeAll ? null : [...write].sort(),
    modules: [...modules].sort(),
    limits: anyFull && !unlimited && maxSchools !== undefined ? { maxSchools } : {},
  };
}

/** Accès d'un établissement donné : écriture, lecture seule ou aucun (périmètre nul = tous). */
export function schoolAccessIn(
  entitlement: Pick<ResolvedProductEntitlement, 'readSchoolIds' | 'writeSchoolIds'>,
  schoolId: string,
): ProductAccess {
  const inScope = (scope: string[] | null) => scope === null || scope.includes(schoolId);
  if (inScope(entitlement.writeSchoolIds)) return 'full';
  if (inScope(entitlement.readSchoolIds)) return 'read_only';
  return 'none';
}
