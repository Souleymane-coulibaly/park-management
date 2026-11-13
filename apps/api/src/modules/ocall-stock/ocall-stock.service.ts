import { Injectable } from '@nestjs/common';
import {
  STOCK_DEFAULT_MAX_DISCOUNT_PERCENT,
  STOCK_DEFAULT_VAT_RATE,
  STOCK_ROLE_LABELS,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { StockContext } from './ocall-stock-access';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';
import type { StockSettingsDto } from './ocall-stock.dto';

/** Ocall Stock — contexte de l'utilisateur et réglages de l'organisation. */
@Injectable()
export class OcallStockService {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly core: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async context(ctx: StockContext) {
    const organization = await this.core.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { name: true, currency: true },
    });
    return {
      organization: { id: ctx.organizationId, name: organization.name },
      currency: organization.currency,
      access: ctx.access,
      role: ctx.role,
      roleLabel: ctx.isOwner ? 'Propriétaire (administrateur)' : STOCK_ROLE_LABELS[ctx.role],
      permissions: ctx.permissions,
    };
  }

  /** Réglages enregistrés, ou valeurs proposées (nom de l'organisation, TVA 18 %, préfixe OC). */
  async settings(ctx: StockContext) {
    const [settings, organization] = await Promise.all([
      this.db.stockSettings.findUnique({ where: { organizationId: ctx.organizationId } }),
      this.core.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
        select: { name: true, currency: true },
      }),
    ]);
    return {
      storeName: settings?.storeName ?? organization.name.slice(0, 80),
      defaultVatRate: settings?.defaultVatRate ?? STOCK_DEFAULT_VAT_RATE,
      internalCodePrefix: settings?.internalCodePrefix ?? 'OC',
      allowNegativeStock: settings?.allowNegativeStock ?? false,
      maxDiscountPercent: settings?.maxDiscountPercent ?? STOCK_DEFAULT_MAX_DISCOUNT_PERCENT,
      receiptPhone: settings?.receiptPhone ?? null,
      receiptAddress: settings?.receiptAddress ?? null,
      receiptFooter: settings?.receiptFooter ?? null,
      currency: organization.currency,
      saved: Boolean(settings),
    };
  }

  async updateSettings(ctx: StockContext, dto: StockSettingsDto) {
    const data = { ...dto, updatedByUserId: ctx.userId };
    await this.db.stockSettings.upsert({
      where: { organizationId: ctx.organizationId },
      create: { organizationId: ctx.organizationId, ...data },
      update: data,
    });
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'stock.settings_updated',
      targetType: 'StockSettings',
      targetId: ctx.organizationId,
      metadata: { fields: Object.keys(dto) },
    });
    return this.settings(ctx);
  }
}
