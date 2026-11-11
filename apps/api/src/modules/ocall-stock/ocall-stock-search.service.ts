import { Injectable } from '@nestjs/common';
import { Prisma } from '@ocall/stock-database';
import { normalizeScannedCode } from '@ocall/shared';
import { type StockContext, stockCan } from './ocall-stock-access';
import { FUZZY_THRESHOLD, OcallStockCatalogService } from './ocall-stock-catalog.service';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';

const PER_GROUP = 8;

/**
 * Recherche globale d'Ocall Stock (S1) : articles (nom, référence, code-barres), catégories, marques et
 * fournisseurs, sans accents ni casse, tolérante aux fautes de frappe (trigrammes PostgreSQL). Toujours
 * limitée à l'organisation et aux droits de l'utilisateur. Les sites, ventes et commandes s'y ajoutent
 * avec leurs sprints.
 */
@Injectable()
export class OcallStockSearchService {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly catalog: OcallStockCatalogService,
  ) {}

  async search(ctx: StockContext, raw: string) {
    const q = raw.trim();
    const code = normalizeScannedCode(q);
    const lookup = code ? await this.catalog.lookup(ctx, code) : null;
    const ids = await this.catalog.searchProductIds(ctx.organizationId, q, PER_GROUP);
    const products = ids.length
      ? await this.db.stockProduct.findMany({
          where: { organizationId: ctx.organizationId, id: { in: ids } },
          select: { id: true, sku: true, name: true, isArchived: true },
        })
      : [];
    const [categories, brands] = await Promise.all([
      this.byName(ctx.organizationId, 'StockCategory', q),
      this.byName(ctx.organizationId, 'StockBrand', q),
    ]);
    const suppliers = stockCan(ctx, 'stock.suppliers.read')
      ? await this.byName(ctx.organizationId, 'StockSupplier', q)
      : [];
    return {
      // Un code lu exactement (scanner) mène directement à sa fiche.
      exact: lookup?.found ? lookup : null,
      products: ids
        .map((id) => products.find((p) => p.id === id))
        .filter((p): p is (typeof products)[number] => Boolean(p)),
      categories,
      brands,
      suppliers,
    };
  }

  /** Noms proches (contient, ou trigrammes) ; table choisie dans une liste fermée, valeurs paramétrées. */
  private byName(
    organizationId: string,
    table: 'StockCategory' | 'StockBrand' | 'StockSupplier',
    q: string,
  ): Promise<{ id: string; name: string; isArchived: boolean }[]> {
    const source = Prisma.raw(`"${table}"`);
    return this.db.$queryRaw<{ id: string; name: string; isArchived: boolean }[]>`
      SELECT id, name, "isArchived" FROM ${source}
      WHERE "organizationId" = ${organizationId}::uuid
        AND ("stock_search_text"(name) LIKE '%' || "stock_search_text"(${q}) || '%'
             OR word_similarity("stock_search_text"(${q}), "stock_search_text"(name)) >= ${FUZZY_THRESHOLD})
      ORDER BY "isArchived", word_similarity("stock_search_text"(${q}), "stock_search_text"(name)) DESC, name
      LIMIT ${PER_GROUP}`;
  }
}
