import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { AuditService } from '../../common/audit/audit.service';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
  privateKey,
} from '../../common/storage/storage-provider';
import type { StockContext } from './ocall-stock-access';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';

export const STOCK_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const STOCK_MAX_IMAGES = 4;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface StockUpload {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

const NOT_FOUND = { code: 'STOCK_IMAGE_NOT_FOUND', message: 'Photo introuvable.' };

/**
 * Photos d'articles : quatre au plus par article, réencodées en JPEG (orientation appliquée, métadonnées et
 * position GPS retirées), stockage privé. La première sert de vignette.
 */
@Injectable()
export class OcallStockMediaService {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async add(ctx: StockContext, productId: string, file: StockUpload | undefined) {
    const jpeg = await normalizeProductImage(file);
    const key = privateKey(ctx.organizationId, null, randomUUID(), 'jpg');
    await this.storage.put(key, jpeg, 'image/jpeg');
    try {
      const image = await this.db.$transaction(async (tx) => {
        const [product] = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "StockProduct"
          WHERE id = ${productId}::uuid AND "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`;
        if (!product) {
          throw new NotFoundException({
            code: 'STOCK_PRODUCT_NOT_FOUND',
            message: 'Article introuvable.',
          });
        }
        const used = await tx.stockProductImage.findMany({
          where: { organizationId: ctx.organizationId, productId },
          select: { position: true },
        });
        const free = [0, 1, 2, 3].find((p) => !used.some((u) => u.position === p));
        if (free === undefined) {
          throw new ConflictException({
            code: 'STOCK_IMAGES_LIMIT',
            message: `${STOCK_MAX_IMAGES} photos au plus par article : retirez-en une d’abord.`,
          });
        }
        return tx.stockProductImage.create({
          data: {
            organizationId: ctx.organizationId,
            productId,
            storageKey: key,
            position: free,
            bytes: jpeg.length,
            createdByUserId: ctx.userId,
          },
          select: { id: true, position: true },
        });
      });
      await this.audit.record({
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: 'stock.image_added',
        targetType: 'StockProduct',
        targetId: productId,
        metadata: { bytes: jpeg.length },
      });
      return image;
    } catch (e) {
      await this.storage.delete(key).catch(() => undefined);
      throw e;
    }
  }

  async body(ctx: StockContext, productId: string, imageId: string): Promise<Buffer> {
    const image = await this.db.stockProductImage.findFirst({
      where: { organizationId: ctx.organizationId, productId, id: imageId },
      select: { storageKey: true },
    });
    const body = image ? await this.storage.get(image.storageKey) : null;
    if (!body) throw new NotFoundException(NOT_FOUND);
    return body;
  }

  async remove(ctx: StockContext, productId: string, imageId: string) {
    const image = await this.db.stockProductImage.findFirst({
      where: { organizationId: ctx.organizationId, productId, id: imageId },
      select: { id: true, storageKey: true },
    });
    if (!image) throw new NotFoundException(NOT_FOUND);
    await this.db.stockProductImage.delete({ where: { id: image.id } });
    await this.storage.delete(image.storageKey).catch(() => undefined);
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'stock.image_removed',
      targetType: 'StockProduct',
      targetId: productId,
    });
  }
}

/** Photo vérifiée et réencodée en JPEG, 1600 pixels au plus de côté, sur fond blanc. */
export async function normalizeProductImage(file: StockUpload | undefined): Promise<Buffer> {
  if (!file || !IMAGE_TYPES.has(file.mimetype) || file.size > STOCK_IMAGE_MAX_BYTES) {
    throw new BadRequestException({
      code: 'STOCK_IMAGE_REFUSED',
      message: 'Photo refusée : image JPEG, PNG ou WebP de 8 Mo au plus.',
    });
  }
  try {
    return await sharp(file.buffer, { failOn: 'error', limitInputPixels: 8192 * 8192 })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new BadRequestException({
      code: 'STOCK_IMAGE_REFUSED',
      message: 'Image illisible ou corrompue.',
    });
  }
}
