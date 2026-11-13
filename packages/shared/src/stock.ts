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
  // ─── S2 : sites, stocks, transferts, inventaires ───
  /** Créer et modifier les sites ; rattacher les membres aux sites. */
  'stock.sites.manage',
  /** Créer et modifier les emplacements d'un site, imprimer leurs QR codes. */
  'stock.locations.manage',
  /** Consulter les quantités en stock. */
  'stock.levels.read',
  /** Consulter le registre des mouvements, les transferts et les inventaires. */
  'stock.movements.read',
  /** Entrées, sorties et déplacements internes. */
  'stock.movements.create',
  /** Ajustements manuels (correction motivée). */
  'stock.adjust',
  /** Demander, préparer, expédier et annuler un transfert. */
  'stock.transfers.manage',
  /** Réceptionner un transfert, déclarer un manque. */
  'stock.transfers.receive',
  /** Ouvrir un inventaire et compter. */
  'stock.counts.count',
  /** Valider (ajustements) ou annuler un inventaire. */
  'stock.counts.validate',
  // ─── S3 : achats ───
  /** Consulter les commandes fournisseurs, réceptions et retours. */
  'stock.purchases.read',
  /** Créer, passer, clore ou annuler une commande ; annuler une réception. */
  'stock.purchases.manage',
  /** Réceptionner une commande (entrées en stock). */
  'stock.purchases.receive',
  /** Retourner de la marchandise au fournisseur (sorties de stock). */
  'stock.returns.manage',
  // ─── S4 : caisse ───
  /** Créer et configurer les caisses (site, emplacement vendu, imprimante). */
  'stock.registers.manage',
  /** Ouvrir et clôturer une session de caisse. */
  'stock.cash.session',
  /** Encaisser des ventes, mettre des paniers en attente. */
  'stock.sales.create',
  /** Consulter l'historique des ventes, les sessions et réimprimer un ticket. */
  'stock.sales.read',
  /** Accorder des remises, dans la limite du plafond des réglages. */
  'stock.sales.discount',
  /** Accorder des remises au-delà du plafond. */
  'stock.sales.discount.unlimited',
  /** Retours et remboursements en caisse. */
  'stock.sales.refund',
  'stock.customers.read',
  /** Créer et modifier les clients. */
  'stock.customers.manage',
  /** S7 : site vitrine (contenu, publication, domaine, articles publiés). */
  'stock.showcase.manage',
  /** S7 : demandes reçues par le site vitrine. */
  'stock.showcase.requests',
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
  'stock.sites.manage': 'Gérer les sites et leurs équipes',
  'stock.locations.manage': 'Gérer les emplacements',
  'stock.levels.read': 'Consulter les stocks',
  'stock.movements.read': 'Consulter les mouvements, transferts et inventaires',
  'stock.movements.create': 'Saisir entrées, sorties et déplacements',
  'stock.adjust': 'Ajuster le stock',
  'stock.transfers.manage': 'Préparer et expédier les transferts',
  'stock.transfers.receive': 'Réceptionner les transferts',
  'stock.counts.count': 'Compter un inventaire',
  'stock.counts.validate': 'Valider un inventaire',
  'stock.purchases.read': 'Consulter les achats',
  'stock.purchases.manage': 'Gérer les commandes fournisseurs',
  'stock.purchases.receive': 'Réceptionner les commandes',
  'stock.returns.manage': 'Retourner aux fournisseurs',
  'stock.registers.manage': 'Gérer les caisses',
  'stock.cash.session': 'Ouvrir et clôturer la caisse',
  'stock.sales.create': 'Encaisser des ventes',
  'stock.sales.read': 'Consulter les ventes et sessions',
  'stock.sales.discount': 'Accorder des remises (plafonnées)',
  'stock.sales.discount.unlimited': 'Accorder des remises sans plafond',
  'stock.sales.refund': 'Retours et remboursements',
  'stock.customers.read': 'Consulter les clients',
  'stock.customers.manage': 'Gérer les clients',
  'stock.showcase.manage': 'Gérer le site vitrine',
  'stock.showcase.requests': 'Traiter les demandes du site vitrine',
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
    'stock.locations.manage',
    'stock.levels.read',
    'stock.movements.read',
    'stock.movements.create',
    'stock.adjust',
    'stock.transfers.manage',
    'stock.transfers.receive',
    'stock.counts.count',
    'stock.counts.validate',
    'stock.purchases.read',
    'stock.purchases.manage',
    'stock.purchases.receive',
    'stock.returns.manage',
    'stock.registers.manage',
    'stock.cash.session',
    'stock.sales.create',
    'stock.sales.read',
    'stock.sales.discount',
    'stock.sales.discount.unlimited',
    'stock.sales.refund',
    'stock.customers.read',
    'stock.customers.manage',
    'stock.showcase.manage',
    'stock.showcase.requests',
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
    'stock.locations.manage',
    'stock.levels.read',
    'stock.movements.read',
    'stock.movements.create',
    'stock.adjust',
    'stock.transfers.manage',
    'stock.transfers.receive',
    'stock.counts.count',
    'stock.counts.validate',
    'stock.purchases.read',
    'stock.purchases.manage',
    'stock.purchases.receive',
    'stock.returns.manage',
    'stock.sales.read',
    'stock.customers.read',
  ],
  STOREKEEPER: [
    'stock.access',
    'stock.catalog.read',
    'stock.suppliers.read',
    'stock.labels.print',
    'stock.levels.read',
    'stock.movements.read',
    'stock.movements.create',
    'stock.transfers.manage',
    'stock.transfers.receive',
    'stock.counts.count',
    'stock.purchases.read',
    'stock.purchases.receive',
  ],
  CASHIER: [
    'stock.access',
    'stock.catalog.read',
    'stock.levels.read',
    'stock.cash.session',
    'stock.sales.create',
    'stock.sales.read',
    'stock.customers.read',
    'stock.customers.manage',
  ],
  SALES: [
    'stock.access',
    'stock.catalog.read',
    'stock.labels.print',
    'stock.levels.read',
    'stock.cash.session',
    'stock.sales.create',
    'stock.sales.read',
    'stock.sales.discount',
    'stock.customers.read',
    'stock.customers.manage',
    'stock.showcase.requests',
  ],
  AUDITOR: [
    'stock.access',
    'stock.members.read',
    'stock.catalog.read',
    'stock.prices.purchase.read',
    'stock.suppliers.read',
    'stock.levels.read',
    'stock.movements.read',
    'stock.purchases.read',
    'stock.sales.read',
    'stock.customers.read',
  ],
};

/** Droits d'administration et accès : toujours liés au rôle, jamais ajustés membre par membre. */
const ROLE_ONLY: readonly StockPermission[] = [
  'stock.access',
  'stock.settings.manage',
  'stock.members.manage',
  'stock.sites.manage',
  'stock.registers.manage',
];

/**
 * Permissions qu'un administrateur peut accorder ou retirer à un membre en plus de son rôle. Les droits
 * d'administration (réglages, équipe, sites) et l'accès lui-même restent liés au rôle.
 */
export const STOCK_ADJUSTABLE_PERMISSIONS: readonly StockPermission[] = STOCK_PERMISSIONS.filter(
  (p) => !ROLE_ONLY.includes(p),
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
