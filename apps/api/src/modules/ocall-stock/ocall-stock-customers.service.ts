import { Injectable, NotFoundException } from '@nestjs/common';
import { stockSaleNumber } from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import { type StockContext, stockCan, stockSiteWhere } from './ocall-stock-access';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';
import type {
  StockCustomerDto,
  StockListQueryDto,
  UpdateStockCustomerDto,
} from './ocall-stock.dto';

const NOT_FOUND = { code: 'STOCK_CUSTOMER_NOT_FOUND', message: 'Client introuvable.' };
const LIST_LIMIT = 200;

/**
 * Clients du magasin (S4) : nom, téléphone, e-mail, note ; facultatifs sur une vente. Données personnelles :
 * réservées aux membres autorisés, jamais supprimées (archivées) tant que des ventes les citent.
 * Rapprochement avec les clients Ocall Facture : sprint S5.
 */
@Injectable()
export class OcallStockCustomersService {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: StockContext, query: StockListQueryDto) {
    const q = query.q?.trim();
    return this.db.stockCustomer.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(query.archived ? {} : { isArchived: false }),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q.replace(/\s+/g, '') } },
                { phone: { contains: q } },
                { email: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
      take: LIST_LIMIT,
    });
  }

  /** Fiche et dernières ventes (des sites accessibles, si le membre voit les ventes). */
  async get(ctx: StockContext, id: string) {
    const customer = await this.find(ctx, id);
    const sales = stockCan(ctx, 'stock.sales.read')
      ? await this.db.stockSale.findMany({
          where: { organizationId: ctx.organizationId, customerId: id, ...stockSiteWhere(ctx) },
          orderBy: { number: 'desc' },
          take: 20,
          select: { id: true, number: true, total: true, createdAt: true },
        })
      : [];
    return {
      ...customer,
      sales: sales.map((s) => ({ ...s, label: stockSaleNumber(s.number) })),
    };
  }

  async create(ctx: StockContext, dto: StockCustomerDto) {
    const customer = await this.db.stockCustomer.create({
      data: { organizationId: ctx.organizationId, ...dto },
    });
    await this.record(ctx, 'stock.customer_created', customer.id);
    return customer;
  }

  async update(ctx: StockContext, id: string, dto: UpdateStockCustomerDto) {
    await this.find(ctx, id);
    const customer = await this.db.stockCustomer.update({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      data: dto,
    });
    await this.record(ctx, 'stock.customer_updated', id, Object.keys(dto));
    return customer;
  }

  private async find(ctx: StockContext, id: string) {
    const customer = await this.db.stockCustomer.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
    });
    if (!customer) throw new NotFoundException(NOT_FOUND);
    return customer;
  }

  private async record(ctx: StockContext, action: string, id: string, fields?: string[]) {
    // Aucune donnée personnelle dans le journal : seulement les champs modifiés.
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action,
      targetType: 'StockCustomer',
      targetId: id,
      ...(fields ? { metadata: { fields } } : {}),
    });
  }
}
