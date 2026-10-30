import type { Prisma } from '@ocall/database';

type Db = Pick<Prisma.TransactionClient, 'productCategory'>;

export interface SellableCategory {
  id: string;
  name: string;
  products: {
    id: string;
    name: string;
    description: string | null;
    /** Photo (URL https) ; null si aucune. */
    imageUrl: string | null;
    variants: { id: string; name: string; price: number }[];
  }[];
}

/**
 * Catalogue vendable d'un établissement : catégories et produits actifs, variantes actives avec un
 * tarif disponible dans l'établissement. Partagé par la caisse et par le menu public (QR code).
 */
export async function loadSellableCatalog(
  db: Db,
  organizationId: string,
  establishmentId: string,
): Promise<SellableCategory[]> {
  const categories = await db.productCategory.findMany({
    where: { organizationId, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      products: {
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
          imageUrl: true,
          variants: {
            where: {
              isActive: true,
              prices: { some: { establishmentId, isAvailable: true } },
            },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            select: {
              id: true,
              name: true,
              prices: { where: { establishmentId }, select: { price: true } },
            },
          },
        },
      },
    },
  });
  return categories
    .map((c) => ({
      id: c.id,
      name: c.name,
      products: c.products
        .filter((p) => p.variants.length > 0)
        .map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          imageUrl: p.imageUrl,
          variants: p.variants.map((v) => ({ id: v.id, name: v.name, price: v.prices[0]!.price })),
        })),
    }))
    .filter((c) => c.products.length > 0);
}
