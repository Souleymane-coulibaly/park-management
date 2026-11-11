import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { StockContext } from './ocall-stock-access';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';
import type {
  StockListQueryDto,
  StockSupplierDto,
  UpdateStockSupplierDto,
} from './ocall-stock.dto';

const NOT_FOUND = { code: 'STOCK_SUPPLIER_NOT_FOUND', message: 'Fournisseur introuvable.' };
const LIST_LIMIT = 500;

/** Fournisseurs (fiches, S1). Commandes, réceptions et retours : sprint S3. Rien n'est supprimé. */
@Injectable()
export class OcallStockSuppliersService {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: StockContext, query: StockListQueryDto) {
    const q = query.q?.trim();
    return this.db.stockSupplier.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(query.archived ? {} : { isArchived: false }),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { contactName: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q } },
                { city: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
      take: LIST_LIMIT,
    });
  }

  async get(ctx: StockContext, id: string) {
    const supplier = await this.db.stockSupplier.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
    });
    if (!supplier) throw new NotFoundException(NOT_FOUND);
    return supplier;
  }

  async create(ctx: StockContext, dto: StockSupplierDto) {
    const supplier = await this.db.stockSupplier.create({
      data: { organizationId: ctx.organizationId, ...dto },
    });
    await this.record(ctx, 'stock.supplier_created', supplier.id);
    return supplier;
  }

  async update(ctx: StockContext, id: string, dto: UpdateStockSupplierDto) {
    await this.get(ctx, id);
    const supplier = await this.db.stockSupplier.update({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      data: dto,
    });
    await this.record(ctx, 'stock.supplier_updated', id, Object.keys(dto));
    return supplier;
  }

  private async record(ctx: StockContext, action: string, id: string, fields?: string[]) {
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action,
      targetType: 'StockSupplier',
      targetId: id,
      ...(fields ? { metadata: { fields } } : {}),
    });
  }
}
