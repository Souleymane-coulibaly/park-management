import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import { computeSaleTotals } from '@ocall/shared';
import type { CartLineDto } from './pos.dto';

export interface PricedSaleLine {
  /** Article de restaurant. */
  variantId?: string;
  /** Billetterie : catégorie, billets par unité et prénoms des visiteurs. */
  ticketCategoryId?: string;
  peoplePerUnit?: number;
  visitorNames?: string[];
  /** Restaurant : instruction de préparation de la ligne. */
  notes?: string | null;
  productName: string;
  variantName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface PricedSale {
  lines: PricedSaleLine[];
  total: number;
}

type Db = Pick<Prisma.TransactionClient, 'productVariant' | 'productCategory'>;

/**
 * Valorisation d'un panier, seule source de vérité des montants : prix lus en base pour
 * l'établissement, puis calcul des totaux par les règles partagées. Utilisé à l'identique
 * pour l'aperçu (devis) et pour l'enregistrement de la vente.
 */
@Injectable()
export class SalePricingService {
  async price(
    db: Db,
    organizationId: string,
    establishmentId: string,
    lines: CartLineDto[],
  ): Promise<PricedSale> {
    // Un même article peut figurer sur deux lignes seulement si leurs instructions diffèrent
    // (« burger » et « burger sans oignon ») ; sinon les quantités doivent être regroupées.
    const keys = lines.map((l) => `${l.variantId}|${l.notes?.trim() ?? ''}`);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException({
        code: 'DUPLICATE_LINE',
        message: 'Un même article apparaît sur plusieurs lignes : regroupez les quantités.',
      });
    }
    const ids = [...new Set(lines.map((l) => l.variantId))];

    // Variantes vendables : de l'organisation, actives, produit et catégorie actifs, tarif disponible.
    const variants = await db.productVariant.findMany({
      where: {
        id: { in: ids },
        organizationId,
        isActive: true,
        product: { isActive: true, category: { isActive: true } },
      },
      select: {
        id: true,
        name: true,
        product: { select: { name: true } },
        prices: { where: { establishmentId, isAvailable: true }, select: { price: true } },
      },
    });
    const byId = new Map(variants.filter((v) => v.prices.length > 0).map((v) => [v.id, v]));
    const unavailable = ids.filter((id) => !byId.has(id));
    if (unavailable.length > 0) {
      throw new BadRequestException({
        code: 'PRODUCT_UNAVAILABLE',
        message: 'Un ou plusieurs articles ne sont pas disponibles dans cet établissement.',
        details: unavailable,
      });
    }

    const resolved = lines.map((l) => {
      const v = byId.get(l.variantId)!;
      return {
        variantId: v.id,
        productName: v.product.name,
        variantName: v.name,
        unitPrice: v.prices[0]!.price,
        quantity: l.quantity,
        notes: l.notes?.trim() || null,
      };
    });
    let totals;
    try {
      totals = computeSaleTotals(resolved);
    } catch (error) {
      throw new BadRequestException({ code: 'INVALID_AMOUNT', message: (error as Error).message });
    }
    return {
      lines: resolved.map((l, i) => ({ ...l, lineTotal: totals.lineTotals[i]! })),
      total: totals.total,
    };
  }
}
