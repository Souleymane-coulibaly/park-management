import { HttpException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@ocall/stock-database';
import { STOCK_PRODUCT_CODE } from '@ocall/shared';
import { loadAppAccess } from '../../common/app-access';
import {
  type StockMovementGateway,
  type StockMovementRequest,
  type StockMovementResult,
  type StockMovementSource,
  StockMovementError,
} from '../../common/integration/stock-movements';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrismaService } from '../../prisma/prisma.service';
import { type LedgerEntry, OcallStockLedgerService } from './ocall-stock-ledger.service';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';

const KIND: Record<StockMovementSource, LedgerEntry['kind'] & LedgerEntry['sourceType']> = {
  INVOICE: 'FACTURE_INVOICE',
  INTERVENTION: 'FACTURE_PART',
  CREDIT_NOTE: 'FACTURE_CREDIT',
};
const MAX_LINES = 200;

/**
 * Implémentation Stock du contrat de mouvements (voir `common/integration/stock-movements.ts`).
 *
 * Une demande est appliquée en une transaction : verrou sur sa clé, rejeu détecté par le journal des
 * demandes reçues, lignes écrites par le moteur de stock (seule porte d'écriture des quantités, avec sa
 * politique de stock négatif) à l'emplacement des ventes Facture. Les articles non stockés (services)
 * sont ignorés. Un refus n'écrit rien.
 */
@Injectable()
export class OcallStockFactureGateway implements StockMovementGateway {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly core: PrismaService,
    private readonly ledger: OcallStockLedgerService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canWrite(organizationId: string): Promise<boolean> {
    if (!this.config.stock.enabled) return false;
    return (await loadAppAccess(this.core, organizationId, STOCK_PRODUCT_CODE)) === 'full';
  }

  async apply(req: StockMovementRequest): Promise<StockMovementResult> {
    if (!(await this.canWrite(req.organizationId))) {
      throw new StockMovementError('STOCK_UNAVAILABLE', 'Ocall Stock est indisponible.');
    }
    if (req.lines.length > MAX_LINES || req.lines.some((l) => !Number.isFinite(l.quantity))) {
      throw new StockMovementError('STOCK_VARIANT_NOT_FOUND', 'Demande de mouvement invalide.');
    }
    const organizationId = req.organizationId;
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${organizationId}:inbound:${req.key}`}, 0))`;
        const done = await tx.stockInboundEvent.findUnique({
          where: { organizationId_key: { organizationId, key: req.key } },
          select: { id: true },
        });
        if (done) return { replayed: true };
        const settings = await tx.stockSettings.findUnique({
          where: { organizationId },
          select: { factureLocationId: true },
        });
        const locationId = settings?.factureLocationId;
        if (!locationId) {
          throw new StockMovementError(
            'STOCK_LOCATION_NOT_SET',
            'Réglez l’emplacement des ventes Facture dans Ocall Stock.',
          );
        }
        const ids = [...new Set(req.lines.map((l) => l.variantId))];
        const variants = await tx.stockVariant.findMany({
          where: { organizationId, id: { in: ids } },
          select: { id: true, product: { select: { isStockable: true } } },
        });
        if (variants.length !== ids.length) {
          throw new StockMovementError('STOCK_VARIANT_NOT_FOUND', 'Article Stock introuvable.');
        }
        const stockable = new Set(variants.filter((v) => v.product.isStockable).map((v) => v.id));
        const lines = req.lines.filter((l) => stockable.has(l.variantId) && l.quantity !== 0);
        const kind = KIND[req.source];
        await this.ledger.apply(
          tx,
          { organizationId, userId: req.actorUserId },
          `facture:${req.key}`,
          lines.map((l) => ({
            variantId: l.variantId,
            locationId,
            kind,
            quantity: new Prisma.Decimal(l.quantity),
            idempotencyKey: `${req.key}:${l.variantId}`,
            sourceType: kind,
            sourceId: req.sourceId,
            reason: req.reference,
          })),
        );
        await tx.stockInboundEvent.create({
          data: {
            organizationId,
            origin: 'FACTURE',
            key: req.key,
            source: req.source,
            sourceId: req.sourceId,
            reference: req.reference,
            locationId,
            lines: lines as unknown as Prisma.InputJsonValue,
            actorUserId: req.actorUserId,
          },
        });
        return { replayed: false };
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  /** Refus du moteur de stock → refus du contrat ; une erreur inattendue reste passagère (réessayée). */
  private translate(error: unknown): unknown {
    if (error instanceof StockMovementError) return error;
    if (error instanceof HttpException) {
      const body = error.getResponse() as { code?: string; message?: string };
      if (body.code === 'STOCK_INSUFFICIENT') {
        return new StockMovementError('STOCK_INSUFFICIENT', body.message ?? 'Stock insuffisant.');
      }
      if (body.code === 'STOCK_VARIANT_NOT_FOUND' || body.code === 'STOCK_LOCATION_NOT_FOUND') {
        return new StockMovementError('STOCK_VARIANT_NOT_FOUND', 'Article Stock introuvable.');
      }
    }
    return error;
  }
}
