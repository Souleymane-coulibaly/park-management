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
  images: { id: string; position: number }[];
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
