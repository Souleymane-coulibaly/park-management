import { Injectable, NotFoundException } from '@nestjs/common';
import {
  STOCK_DEFAULT_MAX_DISCOUNT_PERCENT,
  STOCK_DEFAULT_SLOW_MOVING_DAYS,
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
      this.db.stockSettings.findUnique({
        where: { organizationId: ctx.organizationId },
        include: {
          factureLocation: {
            select: {
              id: true,
              code: true,
              name: true,
              site: { select: { id: true, name: true } },
            },
          },
        },
      }),
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
      slowMovingDays: settings?.slowMovingDays ?? STOCK_DEFAULT_SLOW_MOVING_DAYS,
      receiptPhone: settings?.receiptPhone ?? null,
      receiptAddress: settings?.receiptAddress ?? null,
      receiptFooter: settings?.receiptFooter ?? null,
      factureLocationId: settings?.factureLocationId ?? null,
      factureLocation: settings?.factureLocation ?? null,
      currency: organization.currency,
      saved: Boolean(settings),
    };
  }

  async updateSettings(ctx: StockContext, dto: StockSettingsDto) {
    if (dto.factureLocationId) {
      const location = await this.db.stockLocation.findUnique({
        where: {
          organizationId_id: { organizationId: ctx.organizationId, id: dto.factureLocationId },
        },
        select: { isArchived: true },
      });
      if (!location || location.isArchived) {
        throw new NotFoundException({
          code: 'STOCK_LOCATION_NOT_FOUND',
          message: 'Emplacement introuvable.',
        });
      }
    }
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

  /** Demandes appliquées pour Ocall Facture (200 dernières), avec le libellé des articles. */
  async factureEvents(ctx: StockContext) {
    // Membre rattaché à certains sites : seulement les mouvements arrivés à leurs emplacements.
    const locations =
      ctx.siteIds === null
        ? null
        : (
            await this.db.stockLocation.findMany({
              where: { organizationId: ctx.organizationId, siteId: { in: ctx.siteIds } },
              select: { id: true },
            })
          ).map((l) => l.id);
    const events = await this.db.stockInboundEvent.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(locations ? { locationId: { in: locations } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const ids = [
      ...new Set(
        events.flatMap((e) =>
          (e.lines as unknown as { variantId: string }[]).map((l) => l.variantId),
        ),
      ),
    ];
    const variants = new Map(
      (
        await this.db.stockVariant.findMany({
          where: { organizationId: ctx.organizationId, id: { in: ids } },
          select: { id: true, sku: true, name: true, product: { select: { name: true } } },
        })
      ).map((v) => [
        v.id,
        { sku: v.sku, label: v.name ? `${v.product.name} — ${v.name}` : v.product.name },
      ]),
    );
    return events.map((e) => ({
      id: e.id,
      source: e.source,
      reference: e.reference,
      createdAt: e.createdAt,
      lines: (e.lines as unknown as { variantId: string; quantity: number }[]).map((l) => ({
        variantId: l.variantId,
        quantity: l.quantity,
        sku: variants.get(l.variantId)?.sku ?? null,
        label: variants.get(l.variantId)?.label ?? 'Article',
      })),
    }));
  }
}
