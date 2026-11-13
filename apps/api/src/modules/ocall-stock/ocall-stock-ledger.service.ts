import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@ocall/stock-database';
import { formatStockQuantity } from '@ocall/shared';

type Tx = Prisma.TransactionClient;
type Decimal = Prisma.Decimal;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export type LedgerKind =
  | 'IN'
  | 'OUT'
  | 'ADJUSTMENT'
  | 'MOVE_OUT'
  | 'MOVE_IN'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'COUNT'
  | 'RECEIPT'
  | 'RECEIPT_CANCEL'
  | 'SUPPLIER_RETURN'
  | 'SALE'
  | 'SALE_RETURN';

/** Une écriture du registre : quantité signée à un emplacement. */
export interface LedgerEntry {
  variantId: string;
  locationId: string;
  kind: LedgerKind;
  /** Positive = entrée, négative = sortie ; jamais nulle (ignorée si `setTo` est donné). */
  quantity: Decimal;
  /**
   * Inventaire : quantité à atteindre. L'écart (setTo − stock) est calculé sous le verrou, au moment même
   * de l'écriture ; aucun mouvement s'il est nul.
   */
  setTo?: Decimal;
  /** Unique dans l'organisation : une même écriture n'est jamais appliquée deux fois. */
  idempotencyKey: string;
  sourceType:
    'MANUAL' | 'TRANSFER' | 'COUNT' | 'RECEIPT' | 'SUPPLIER_RETURN' | 'SALE' | 'SALE_RETURN';
  sourceId?: string | null;
  reason?: string | null;
  unitCost?: number | null;
  /** Réservation consommée par la sortie (expédition d'un transfert préparé). */
  releaseReserved?: Decimal;
}

export interface LedgerContext {
  organizationId: string;
  userId: string;
}

export interface LedgerResult {
  /** Vrai si l'opération avait déjà été enregistrée (rejeu) : rien n'a été modifié. */
  replayed: boolean;
  movements: {
    id: string;
    variantId: string;
    locationId: string;
    quantity: Decimal;
    quantityAfter: Decimal;
  }[];
  /** Stock avant écriture, par « emplacement:variante » (inventaire : quantité attendue). */
  before: Map<string, Decimal>;
}

interface LockedLevel {
  siteId: string;
  onHand: Decimal;
  reserved: Decimal;
}

/**
 * Moteur de stock : seule porte d'écriture des quantités. Dans la transaction de l'appelant :
 * 1. verrou consultatif sur la clé de l'opération (deux requêtes identiques simultanées s'attendent) ;
 * 2. rejeu détecté par la clé d'idempotence : rien n'est réécrit ;
 * 3. niveaux verrouillés (FOR UPDATE) dans un ordre fixe, sans interblocage ;
 * 4. refus d'un stock négatif sauf si l'organisation l'autorise (disponible = en stock − réservé) ;
 * 5. niveau mis à jour et mouvement inséré (registre en ajout seul, garanti par la base).
 * Deux caisses qui vendent le dernier article : la seconde attend le verrou, puis est refusée.
 */
@Injectable()
export class OcallStockLedgerService {
  async apply(
    tx: Tx,
    ctx: LedgerContext,
    operationKey: string,
    entries: LedgerEntry[],
  ): Promise<LedgerResult> {
    if (entries.length === 0) return { replayed: false, movements: [], before: new Map() };
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${ctx.organizationId}:${operationKey}`}, 0))`;
    const existing = await tx.stockMovement.findMany({
      where: {
        organizationId: ctx.organizationId,
        idempotencyKey: { in: entries.map((e) => e.idempotencyKey) },
      },
      select: {
        id: true,
        variantId: true,
        locationId: true,
        quantity: true,
        quantityAfter: true,
        idempotencyKey: true,
      },
    });
    // Rejeu : toutes les écritures de l'opération existent déjà. Un inventaire n'écrit que ses écarts non
    // nuls : sa première écriture suffit à le reconnaître.
    if (
      existing.length > 0 &&
      (existing.length === entries.length || entries.some((e) => e.setTo))
    ) {
      return { replayed: true, movements: existing, before: new Map() };
    }
    if (existing.length > 0) {
      // Opération enregistrée en partie : impossible dans une transaction, signe d'une clé réutilisée.
      throw new ConflictException({
        code: 'STOCK_IDEMPOTENCY_CONFLICT',
        message: 'Cette opération a déjà été enregistrée avec un autre contenu.',
      });
    }
    const allowNegative = await this.allowNegative(tx, ctx.organizationId);
    const ordered = [...entries].sort((a, b) =>
      a.locationId === b.locationId
        ? a.variantId.localeCompare(b.variantId)
        : a.locationId.localeCompare(b.locationId),
    );
    const levels = new Map<string, LockedLevel>();
    for (const e of ordered) {
      const k = `${e.locationId}:${e.variantId}`;
      if (!levels.has(k))
        levels.set(k, await this.lock(tx, ctx.organizationId, e.variantId, e.locationId));
    }
    const movements: LedgerResult['movements'] = [];
    const before = new Map<string, Decimal>();
    for (const e of entries) {
      const level = levels.get(`${e.locationId}:${e.variantId}`)!;
      before.set(`${e.locationId}:${e.variantId}`, level.onHand);
      if (e.setTo) e.quantity = e.setTo.minus(level.onHand);
      if (e.quantity.isZero()) continue;
      const release = e.releaseReserved ?? D(0);
      const onHand = level.onHand.plus(e.quantity);
      const reserved = level.reserved.minus(release);
      if (reserved.isNegative()) {
        throw new ConflictException({
          code: 'STOCK_RESERVATION_MISMATCH',
          message: 'Réservation introuvable.',
        });
      }
      // Une sortie ne puise que dans le disponible (en stock − réservé), sauf stock négatif autorisé.
      if (e.quantity.isNegative() && !allowNegative && onHand.minus(reserved).isNegative()) {
        throw this.insufficient(level.onHand.minus(level.reserved));
      }
      await tx.stockLevel.update({
        where: { locationId_variantId: { locationId: e.locationId, variantId: e.variantId } },
        data: { onHand, reserved },
      });
      level.onHand = onHand;
      level.reserved = reserved;
      const movement = await tx.stockMovement.create({
        data: {
          organizationId: ctx.organizationId,
          variantId: e.variantId,
          siteId: level.siteId,
          locationId: e.locationId,
          kind: e.kind,
          quantity: e.quantity,
          quantityAfter: onHand,
          unitCost: e.unitCost ?? null,
          reason: e.reason ?? null,
          sourceType: e.sourceType,
          sourceId: e.sourceId ?? null,
          idempotencyKey: e.idempotencyKey,
          actorUserId: ctx.userId,
        },
        select: {
          id: true,
          variantId: true,
          locationId: true,
          quantity: true,
          quantityAfter: true,
        },
      });
      movements.push(movement);
    }
    return { replayed: false, movements, before };
  }

  /** Réserve (ou libère, quantité négative) une quantité disponible, sans mouvement (préparation). */
  async reserve(
    tx: Tx,
    organizationId: string,
    variantId: string,
    locationId: string,
    quantity: Decimal,
  ) {
    const level = await this.lock(tx, organizationId, variantId, locationId);
    const reserved = level.reserved.plus(quantity);
    if (reserved.isNegative()) {
      throw new ConflictException({
        code: 'STOCK_RESERVATION_MISMATCH',
        message: 'Réservation introuvable.',
      });
    }
    if (
      quantity.isPositive() &&
      !(await this.allowNegative(tx, organizationId)) &&
      level.onHand.minus(reserved).isNegative()
    ) {
      throw this.insufficient(level.onHand.minus(level.reserved));
    }
    await tx.stockLevel.update({
      where: { locationId_variantId: { locationId, variantId } },
      data: { reserved },
    });
  }

  /** Niveau verrouillé (créé à zéro s'il n'existe pas) ; l'emplacement doit appartenir à l'organisation. */
  private async lock(
    tx: Tx,
    organizationId: string,
    variantId: string,
    locationId: string,
  ): Promise<LockedLevel> {
    const location = await tx.stockLocation.findUnique({
      where: { organizationId_id: { organizationId, id: locationId } },
      select: { siteId: true },
    });
    if (!location)
      throw new NotFoundException({
        code: 'STOCK_LOCATION_NOT_FOUND',
        message: 'Emplacement introuvable.',
      });
    const variant = await tx.stockVariant.findUnique({
      where: { organizationId_id: { organizationId, id: variantId } },
      select: { product: { select: { isStockable: true } } },
    });
    if (!variant)
      throw new NotFoundException({
        code: 'STOCK_VARIANT_NOT_FOUND',
        message: 'Article introuvable.',
      });
    if (!variant.product.isStockable) {
      throw new ConflictException({
        code: 'STOCK_NOT_STOCKABLE',
        message: 'Article non stocké (service) : aucun mouvement de stock.',
      });
    }
    await tx.$executeRaw`
      INSERT INTO "StockLevel" ("organizationId", "variantId", "locationId", "siteId", "onHand", "reserved", "updatedAt")
      VALUES (${organizationId}::uuid, ${variantId}::uuid, ${locationId}::uuid, ${location.siteId}::uuid, 0, 0, now())
      ON CONFLICT ("locationId", "variantId") DO NOTHING`;
    const [row] = await tx.$queryRaw<{ siteId: string; onHand: Decimal; reserved: Decimal }[]>`
      SELECT "siteId", "onHand", "reserved" FROM "StockLevel"
      WHERE "locationId" = ${locationId}::uuid AND "variantId" = ${variantId}::uuid FOR UPDATE`;
    return { siteId: row!.siteId, onHand: D(row!.onHand), reserved: D(row!.reserved) };
  }

  private async allowNegative(tx: Tx, organizationId: string): Promise<boolean> {
    const settings = await tx.stockSettings.findUnique({
      where: { organizationId },
      select: { allowNegativeStock: true },
    });
    return settings?.allowNegativeStock ?? false;
  }

  private insufficient(available: Decimal) {
    return new ConflictException({
      code: 'STOCK_INSUFFICIENT',
      message: `Stock insuffisant : ${formatStockQuantity(available.toString())} disponible(s) à cet emplacement.`,
    });
  }
}
