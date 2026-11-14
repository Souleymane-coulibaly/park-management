import type { StockBarcodeType, StockRole } from '@ocall/shared';
import { ApiError } from '@/lib/api';

/** Vues renvoyées par l'API Ocall Stock (S1). */

export interface StockCategoryView {
  id: string;
  parentId: string | null;
  name: string;
  isArchived: boolean;
}

export interface StockBrandView {
  id: string;
  name: string;
  isArchived: boolean;
}

export interface StockProductListItem {
  id: string;
  sku: string;
  name: string;
  unit: string;
  salePrice: number;
  purchasePrice?: number | null;
  vatRate: number;
  isStockable: boolean;
  isArchived: boolean;
  category: { id: string; name: string } | null;
  brand: { id: string; name: string } | null;
  variantCount: number;
  defaultVariantId: string | null;
  barcode: { code: string; type: StockBarcodeType } | null;
  imageId: string | null;
}

export interface StockProductPage {
  items: StockProductListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StockBarcodeView {
  id: string;
  type: StockBarcodeType;
  code: string;
  createdAt: string;
}

export interface StockVariantView {
  id: string;
  name: string | null;
  isDefault: boolean;
  sku: string;
  salePrice: number | null;
  effectiveSalePrice: number;
  purchasePrice?: number | null;
  isArchived: boolean;
  barcodes: StockBarcodeView[];
  /** S10 : prix propres aux boutiques du membre (exceptions au prix commun). */
  sitePrices?: { siteId: string; salePrice: number }[];
}

export interface StockProductDetail {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  brandId: string | null;
  unit: string;
  salePrice: number;
  purchasePrice?: number | null;
  vatRate: number;
  minStock: number | null;
  isStockable: boolean;
  isArchived: boolean;
  category: { id: string; name: string; parentId: string | null } | null;
  brand: { id: string; name: string } | null;
  variants: StockVariantView[];
  images: { id: string; position: number; aiGenerated?: boolean; showcaseApproved?: boolean }[];
}

export interface StockSupplierView {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  country: string;
  nif: string | null;
  leadTimeDays: number | null;
  notes: string | null;
  isArchived: boolean;
}

export interface StockMemberView {
  id: string;
  firstName: string;
  lastName: string;
  loginId: string;
  role: StockRole;
  isActive: boolean;
  permissions: { permission: string; granted: boolean }[];
  effectivePermissions: string[];
  /** Sites rattachés ; vide = tous les sites. */
  siteIds: string[];
  /** Sprint Suite 2A : rôle propre à certains sites (restreint le rôle principal). */
  siteRoles?: { siteId: string; role: StockRole }[];
}

export type StockLookup =
  | {
      found: true;
      code: string;
      matchedBy: 'barcode' | 'sku';
      product: { id: string; name: string; isArchived: boolean };
      variant: { id: string; name: string | null; sku: string; isArchived: boolean };
    }
  | { found: false; code: string; detectedType: StockBarcodeType | null };

/** Erreur affichable, quelle que soit l'exception reçue. */
export const asApiError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.');

/** Libellé d'une catégorie, précédé de sa catégorie parente (« Peintures › Acryliques »). */
export function categoryLabel(c: StockCategoryView, all: readonly StockCategoryView[]): string {
  const parent = c.parentId ? all.find((p) => p.id === c.parentId) : null;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

// ─── S2 : sites, stocks, mouvements, transferts, inventaires ───

export interface StockSiteRef {
  id: string;
  code: string;
  name: string;
}

export interface StockLocationView {
  id: string;
  parentId: string | null;
  kind: 'DEFAULT' | 'ZONE' | 'AISLE' | 'SHELF' | 'BIN';
  code: string;
  name: string;
  isArchived: boolean;
  qr: string;
}

export interface StockSiteView extends StockSiteRef {
  kind: 'STORE' | 'DEPOT' | 'WAREHOUSE';
  address: string | null;
  city: string | null;
  isArchived: boolean;
  locations?: StockLocationView[];
}

export interface StockVariantRef {
  id: string;
  name: string | null;
  sku: string;
  product: { id: string; name: string; unit?: string };
}

export interface StockLevelRow {
  site: StockSiteRef;
  variant: StockVariantRef;
  onHand: number;
  reserved: number;
  available: number;
  inTransit: number;
  minStock: number | null;
  belowMin: boolean;
}

export interface StockMovementRow {
  id: string;
  kind: string;
  quantity: number;
  quantityAfter: number;
  reason: string | null;
  sourceType: string;
  createdAt: string;
  site: StockSiteRef;
  location: { id: string; code: string };
  variant: StockVariantRef;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StockTransferView {
  id: string;
  label: string;
  status: string;
  note: string | null;
  fromSite: StockSiteRef;
  toSite: StockSiteRef;
  createdAt: string;
  lines: {
    id: string;
    variant: StockVariantRef;
    quantity: number;
    fromLocation: { id: string; code: string; name: string } | null;
    shippedQuantity: number;
    receivedQuantity: number;
    lostQuantity: number;
    inTransit: number;
    lossReason: string | null;
  }[];
}

export interface StockCountView {
  id: string;
  label: string;
  name: string;
  scope: 'FULL' | 'PARTIAL';
  status: 'OPEN' | 'VALIDATED' | 'CANCELLED';
  site: StockSiteRef;
  locationIds: string[];
  lines: {
    lineId: string | null;
    variantId: string;
    locationId: string;
    counted: number | null;
    onHand: number;
    difference: number;
    variant: StockVariantRef;
    location: { id: string; code: string; name: string };
  }[];
}

/** Libellé d'une variante : article, puis déclinaison. */
export const variantLabel = (v: StockVariantRef) =>
  v.name ? `${v.product.name} — ${v.name}` : v.product.name;

/** Clé d'idempotence d'un envoi : un double clic ou un réseau instable ne compte jamais deux fois. */
export const newIdempotencyKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
