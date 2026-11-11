/**
 * Ocall Stock (V1) — règles partagées par l'API et le web : rôles, permissions et leurs ajustements par
 * membre, TVA, montants. Aucune donnée métier d'Ocall Park, School ni Facture.
 */

export const STOCK_PRODUCT_CODE = 'OCALL_STOCK';

// ─── Rôles et permissions ───

export const STOCK_ROLES = [
  'ADMIN',
  'STORE_MANAGER',
  'WAREHOUSE_MANAGER',
  'STOREKEEPER',
  'CASHIER',
  'SALES',
  'AUDITOR',
] as const;
export type StockRole = (typeof STOCK_ROLES)[number];

export const STOCK_ROLE_LABELS: Record<StockRole, string> = {
  ADMIN: 'Administrateur',
  STORE_MANAGER: 'Responsable de magasin',
  WAREHOUSE_MANAGER: 'Responsable d’entrepôt',
  STOREKEEPER: 'Magasinier',
  CASHIER: 'Caissier',
  SALES: 'Commercial',
  AUDITOR: 'Lecteur / auditeur',
};

/**
 * Permissions du sprint S1. Chaque sprint ajoute les siennes (stocks, achats, caisse…) : une permission
 * n'existe que si une fonction l'exige.
 */
export const STOCK_PERMISSIONS = [
  /** Entrer dans l'application (contexte, réglages en lecture). */
  'stock.access',
  'stock.settings.manage',
  'stock.members.read',
  /** Équipe : comptes, rôles et ajustements de permissions. */
  'stock.members.manage',
  'stock.catalog.read',
  /** Articles, variantes, codes-barres, photos, catégories et marques (hors prix). */
  'stock.catalog.manage',
  /** Voir les prix d'achat (marges internes). */
  'stock.prices.purchase.read',
  /** Fixer ou changer les prix de vente et d'achat. */
  'stock.prices.manage',
  'stock.suppliers.read',
  'stock.suppliers.manage',
  /** Imprimer les étiquettes autocollantes. */
  'stock.labels.print',
] as const;
export type StockPermission = (typeof STOCK_PERMISSIONS)[number];

export const STOCK_PERMISSION_LABELS: Record<StockPermission, string> = {
  'stock.access': 'Accéder à Ocall Stock',
  'stock.settings.manage': 'Modifier les réglages',
  'stock.members.read': 'Voir l’équipe',
  'stock.members.manage': 'Gérer l’équipe et les permissions',
  'stock.catalog.read': 'Consulter le catalogue',
  'stock.catalog.manage': 'Gérer le catalogue (hors prix)',
  'stock.prices.purchase.read': 'Voir les prix d’achat',
  'stock.prices.manage': 'Modifier les prix',
  'stock.suppliers.read': 'Consulter les fournisseurs',
  'stock.suppliers.manage': 'Gérer les fournisseurs',
  'stock.labels.print': 'Imprimer les étiquettes',
};

const ALL: readonly StockPermission[] = STOCK_PERMISSIONS;

const ROLE_PERMISSIONS: Record<StockRole, readonly StockPermission[]> = {
  ADMIN: ALL,
  STORE_MANAGER: [
    'stock.access',
    'stock.members.read',
    'stock.catalog.read',
    'stock.catalog.manage',
    'stock.prices.purchase.read',
    'stock.prices.manage',
    'stock.suppliers.read',
    'stock.suppliers.manage',
    'stock.labels.print',
  ],
  WAREHOUSE_MANAGER: [
    'stock.access',
    'stock.members.read',
    'stock.catalog.read',
    'stock.catalog.manage',
    'stock.prices.purchase.read',
    'stock.suppliers.read',
    'stock.suppliers.manage',
    'stock.labels.print',
  ],
  STOREKEEPER: ['stock.access', 'stock.catalog.read', 'stock.suppliers.read', 'stock.labels.print'],
  CASHIER: ['stock.access', 'stock.catalog.read'],
  SALES: ['stock.access', 'stock.catalog.read', 'stock.labels.print'],
  AUDITOR: [
    'stock.access',
    'stock.members.read',
    'stock.catalog.read',
    'stock.prices.purchase.read',
    'stock.suppliers.read',
  ],
};

/**
 * Permissions qu'un administrateur peut accorder ou retirer à un membre en plus de son rôle. Les droits
 * d'administration (réglages, équipe) et l'accès lui-même restent liés au rôle.
 */
export const STOCK_ADJUSTABLE_PERMISSIONS: readonly StockPermission[] = STOCK_PERMISSIONS.filter(
  (p) => p !== 'stock.access' && p !== 'stock.settings.manage' && p !== 'stock.members.manage',
);

export const isStockPermission = (value: unknown): value is StockPermission =>
  typeof value === 'string' && (STOCK_PERMISSIONS as readonly string[]).includes(value);

export function stockRolePermissions(role: StockRole): StockPermission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

/** Ajustement enregistré pour un membre : permission accordée (true) ou retirée (false). */
export interface StockPermissionOverride {
  permission: string;
  granted: boolean;
}

/**
 * Permissions effectives : celles du rôle, plus les ajustements accordés, moins les ajustements retirés.
 * Un ajustement sur une permission non ajustable (ou inconnue) est ignoré.
 */
export function stockEffectivePermissions(
  role: StockRole,
  overrides: readonly StockPermissionOverride[] = [],
): StockPermission[] {
  const set = new Set<StockPermission>(ROLE_PERMISSIONS[role] ?? []);
  for (const o of overrides) {
    if (!isStockPermission(o.permission)) continue;
    if (!STOCK_ADJUSTABLE_PERMISSIONS.includes(o.permission)) continue;
    if (o.granted) set.add(o.permission);
    else set.delete(o.permission);
  }
  return STOCK_PERMISSIONS.filter((p) => set.has(p));
}

/** Rôles qu'un membre peut attribuer : seul l'administrateur (ou le propriétaire) gère l'équipe. */
export function assignableStockRoles(role: StockRole): StockRole[] {
  return role === 'ADMIN' ? [...STOCK_ROLES] : [];
}

// ─── TVA et montants ───

/** Taux proposés : 0 à 30 % (Mali 18 %, autres pays de la zone jusqu'à 19 %, marge pour d'autres pays). */
export const STOCK_VAT_RATES: readonly number[] = Array.from({ length: 31 }, (_, i) => i);
export const STOCK_DEFAULT_VAT_RATE = 18;
export const STOCK_MAX_PRICE = 1_000_000_000;

export const isStockVatRate = (rate: unknown): rate is number =>
  typeof rate === 'number' && Number.isInteger(rate) && rate >= 0 && rate <= 30;

/**
 * Montant entier dans l'unité de la devise de l'organisation : « 25 000 FCFA » pour le franc CFA (XOF,
 * XAF), « 25 000 GNF »… sinon. Groupes de trois chiffres séparés par une espace fine insécable.
 */
export function formatStockMoney(amount: number, currency = 'XOF'): string {
  const grouped = Math.trunc(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const unit = currency === 'XOF' || currency === 'XAF' ? 'FCFA' : currency;
  return `${grouped} ${unit}`;
}

/** Unités de vente proposées (saisie libre possible). */
export const STOCK_SALE_UNITS: readonly string[] = [
  'unité',
  'pièce',
  'paquet',
  'carton',
  'sac',
  'kg',
  'g',
  'litre',
  'mètre',
  'm²',
  'rouleau',
  'boîte',
];

/** Format d'une référence (SKU) : lettres, chiffres, point, tiret, barre, soulignement ; 40 au plus. */
export const STOCK_SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/;

/** Préfixe des références et des codes internes : 2 à 4 lettres majuscules. */
export const STOCK_PREFIX_PATTERN = /^[A-Z]{2,4}$/;

/** Référence générée : préfixe, tiret, numéro continu sur 6 chiffres (OC-000123). */
export function stockGeneratedSku(prefix: string, value: number): string {
  return `${prefix}-${String(value).padStart(6, '0')}`;
}
