import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { STOCK_DOCUMENT_MAX_BYTES, STOCK_DOCUMENT_MAX_COUNT } from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
  privateKey,
} from '../../common/storage/storage-provider';
import { type StockContext, stockSiteAllowed } from './ocall-stock-access';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';

export type StockDocumentOwner = 'PURCHASE_ORDER' | 'RECEIPT' | 'SUPPLIER_RETURN';

export interface StockDocumentUpload {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

/** Signature réelle du fichier (les premiers octets), jamais le type annoncé par le navigateur. */
function detectType(buffer: Buffer): { mime: string; ext: 'pdf' | 'jpg' | 'png' } | null {
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-')
    return { mime: 'application/pdf', ext: 'pdf' };
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return { mime: 'image/jpeg', ext: 'jpg' };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' };
  }
  return null;
}

/** Nom affiché : sans chemin ni caractères de contrôle, 160 caractères au plus. */
const safeName = (name: string) =>
  (name.split(/[\\/]/).pop() ?? 'document')
    .replace(/[\p{Cc}"]/gu, '')
    .trim()
    .slice(0, 160) || 'document';

/**
 * Documents joints aux commandes, réceptions et retours (bons de livraison, factures fournisseur, photos) :
 * PDF, JPEG ou PNG de 10 Mo au plus, 10 par pièce ; type vérifié par la signature du fichier ; stockage
 * privé ; téléchargement réservé à l'organisation et au site.
 */
@Injectable()
export class OcallStockDocumentsService {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async list(ctx: StockContext, ownerType: StockDocumentOwner, ownerId: string) {
    await this.assertOwner(ctx, ownerType, ownerId);
    return this.db.stockDocument.findMany({
      where: { organizationId: ctx.organizationId, ownerType, ownerId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, fileName: true, mimeType: true, bytes: true, createdAt: true },
    });
  }

  async add(
    ctx: StockContext,
    ownerType: StockDocumentOwner,
    ownerId: string,
    file: StockDocumentUpload | undefined,
  ) {
    await this.assertOwner(ctx, ownerType, ownerId);
    const type = file && file.size <= STOCK_DOCUMENT_MAX_BYTES ? detectType(file.buffer) : null;
    if (!file || !type) {
      throw new BadRequestException({
        code: 'STOCK_DOCUMENT_REFUSED',
        message: 'Document refusé : PDF, JPEG ou PNG de 10 Mo au plus.',
      });
    }
    const count = await this.db.stockDocument.count({
      where: { organizationId: ctx.organizationId, ownerType, ownerId },
    });
    if (count >= STOCK_DOCUMENT_MAX_COUNT) {
      throw new ConflictException({
        code: 'STOCK_DOCUMENTS_LIMIT',
        message: `${STOCK_DOCUMENT_MAX_COUNT} documents au plus par pièce.`,
      });
    }
    const key = privateKey(ctx.organizationId, null, randomUUID(), type.ext);
    await this.storage.put(key, file.buffer, type.mime);
    try {
      const doc = await this.db.stockDocument.create({
        data: {
          organizationId: ctx.organizationId,
          ownerType,
          ownerId,
          fileName: safeName(file.originalname),
          mimeType: type.mime,
          bytes: file.size,
          storageKey: key,
          createdByUserId: ctx.userId,
        },
        select: { id: true, fileName: true, mimeType: true, bytes: true, createdAt: true },
      });
      await this.audit.record({
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: 'stock.document_added',
        targetType: ownerType,
        targetId: ownerId,
        metadata: { documentId: doc.id, bytes: file.size },
      });
      return doc;
    } catch (e) {
      await this.storage.delete(key).catch(() => undefined);
      throw e;
    }
  }

  async body(ctx: StockContext, id: string) {
    const doc = await this.db.stockDocument.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
    });
    if (!doc)
      throw new NotFoundException({
        code: 'STOCK_DOCUMENT_NOT_FOUND',
        message: 'Document introuvable.',
      });
    await this.assertOwner(ctx, doc.ownerType, doc.ownerId);
    const body = await this.storage.get(doc.storageKey);
    if (!body)
      throw new NotFoundException({
        code: 'STOCK_DOCUMENT_NOT_FOUND',
        message: 'Document introuvable.',
      });
    return { body, fileName: doc.fileName, mimeType: doc.mimeType };
  }

  async remove(ctx: StockContext, id: string) {
    const doc = await this.db.stockDocument.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
    });
    if (!doc)
      throw new NotFoundException({
        code: 'STOCK_DOCUMENT_NOT_FOUND',
        message: 'Document introuvable.',
      });
    await this.assertOwner(ctx, doc.ownerType, doc.ownerId);
    await this.db.stockDocument.delete({ where: { id } });
    await this.storage.delete(doc.storageKey).catch(() => undefined);
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'stock.document_removed',
      targetType: doc.ownerType,
      targetId: doc.ownerId,
      metadata: { documentId: id },
    });
  }

  /** La pièce existe dans l'organisation et son site est accessible au membre. */
  private async assertOwner(ctx: StockContext, ownerType: StockDocumentOwner, ownerId: string) {
    const where = { organizationId_id: { organizationId: ctx.organizationId, id: ownerId } };
    const siteId =
      ownerType === 'PURCHASE_ORDER'
        ? (await this.db.stockPurchaseOrder.findUnique({ where, select: { siteId: true } }))?.siteId
        : ownerType === 'RECEIPT'
          ? (await this.db.stockReceipt.findUnique({ where, select: { siteId: true } }))?.siteId
          : (await this.db.stockSupplierReturn.findUnique({ where, select: { siteId: true } }))
              ?.siteId;
    if (!siteId || !stockSiteAllowed(ctx, siteId)) {
      throw new NotFoundException({
        code: 'STOCK_DOCUMENT_OWNER_NOT_FOUND',
        message: 'Pièce introuvable.',
      });
    }
  }
}
