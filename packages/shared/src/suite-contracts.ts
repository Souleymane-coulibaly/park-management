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

/**
 * Limites d'un contrat. Absence d'une limite = aucune limite. Offre Ocall School Free (socle S1) :
 * contrat actif sans échéance réelle avec `tier: 'FREE'`, `maxStudents: 50`,
 * `aiMonthlyCallsPerSchool: 20` et `sms: false`.
 */
export interface ContractLimits {
  maxSchools?: number;
  /** Élèves actifs (inscrits ou scolarisés) par organisation. */
  maxStudents?: number;
  /** Requêtes IA par mois et par établissement. */
  aiMonthlyCallsPerSchool?: number;
  /** Envoi de SMS autorisé ; `false` = aucun SMS (offre gratuite, crédits SMS au Sprint S2). */
  sms?: boolean;
  /** Nature du contrat : payant (défaut), essai ou offre gratuite. */
  tier?: ContractTier;
}
export const CONTRACT_TIERS = ['PAID', 'TRIAL', 'FREE'] as const;
export type ContractTier = (typeof CONTRACT_TIERS)[number];
export const CONTRACT_TIER_LABELS: Record<ContractTier, string> = {
  PAID: 'Payant',
  TRIAL: 'Essai gratuit',
  FREE: 'Offre gratuite',
};
/** Limites de l'offre Ocall School Free (décision client du 07/11/2026). */
export const SCHOOL_FREE_LIMITS = {
  tier: 'FREE',
  maxStudents: 50,
  aiMonthlyCallsPerSchool: 20,
  sms: false,
} as const satisfies ContractLimits;

/** Contrat d'un produit couvrant des établissements (couverture vide = tous ceux du client). */
export interface CoveringContract extends ContractWindow {
  modules: readonly string[];
  limits: ContractLimits | null | undefined;
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
 * - `limits` (`maxSchools`, `maxStudents`, `aiMonthlyCallsPerSchool`) : chacune la plus favorable
 *   parmi les contrats actifs (aucune limite si l'un n'en fixe pas, sinon la plus grande ; jamais de
 *   cumul) ; `sms` autorisé si un contrat actif ne l'interdit pas ;
 * - `tier` : la nature la plus favorable parmi les contrats actifs (payant, puis essai, puis gratuit).
 * Indépendant de l'ordre des contrats.
 */
export interface ResolvedProductEntitlement {
  access: ProductAccess;
  readSchoolIds: string[] | null;
  writeSchoolIds: string[] | null;
  modules: string[];
  limits: Omit<ContractLimits, 'tier'>;
  /** Nature du droit en écriture ; null sans contrat actif. */
  tier: ContractTier | null;
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
  const NUMERIC = ['maxSchools', 'maxStudents', 'aiMonthlyCallsPerSchool'] as const;
  const best: Partial<Record<(typeof NUMERIC)[number], number>> = {};
  const unlimited = new Set<string>();
  let smsAllowed = false;
  let anyFull = false;
  const tierRank: Record<ContractTier, number> = { PAID: 3, TRIAL: 2, FREE: 1 };
  let tier: ContractTier | null = null;
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
      for (const key of NUMERIC) {
        const limit = c.limits?.[key];
        if (limit === undefined || limit === null) unlimited.add(key);
        else best[key] = Math.max(best[key] ?? 0, limit);
      }
      if (c.limits?.sms !== false) smsAllowed = true;
      const t = c.limits?.tier ?? 'PAID';
      if (!tier || tierRank[t] > tierRank[tier]) tier = t;
    }
  }
  return {
    access,
    readSchoolIds: readAll ? null : [...read].sort(),
    writeSchoolIds: writeAll ? null : [...write].sort(),
    modules: [...modules].sort(),
    limits: anyFull ? resolvedLimits(best, unlimited, smsAllowed) : {},
    tier,
  };
}

function resolvedLimits(
  best: Partial<Record<'maxSchools' | 'maxStudents' | 'aiMonthlyCallsPerSchool', number>>,
  unlimited: Set<string>,
  smsAllowed: boolean,
): Omit<ContractLimits, 'tier'> {
  const out: Omit<ContractLimits, 'tier'> = {};
  for (const [key, value] of Object.entries(best) as [keyof typeof best, number][]) {
    if (!unlimited.has(key)) out[key] = value;
  }
  if (!smsAllowed) out.sms = false;
  return out;
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
