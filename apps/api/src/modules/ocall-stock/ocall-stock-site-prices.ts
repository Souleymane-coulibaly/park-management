import type { Prisma } from '@ocall/stock-database';

type Db = { stockSitePrice: Prisma.TransactionClient['stockSitePrice'] };

/**
 * Prix de vente TTC propres à une boutique (S10), par variante. Une variante absente de la carte suit le
 * prix commun (variante, sinon article) : `stockEffectivePrice`.
 */
export async function stockSitePrices(
  db: Db,
  organizationId: string,
  siteId: string,
  variantIds: string[],
): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();
  const rows = await db.stockSitePrice.findMany({
    where: { organizationId, siteId, variantId: { in: [...new Set(variantIds)] } },
    select: { variantId: true, salePrice: true },
  });
  return new Map(rows.map((r) => [r.variantId, r.salePrice]));
}

/** Prix appliqué : exception de la boutique, sinon prix de la variante, sinon prix de l'article. */
export const stockEffectivePrice = (
  sitePrices: Map<string, number>,
  v: { id: string; salePrice: number | null; product: { salePrice: number } },
) => sitePrices.get(v.id) ?? v.salePrice ?? v.product.salePrice;
