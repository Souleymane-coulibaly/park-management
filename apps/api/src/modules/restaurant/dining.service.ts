import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@ocall/database';
import { type TableStatus, coversActivity, publicMenuPath } from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { establishmentScope } from '../../common/tenant-scope';
import { findSellingEstablishment } from '../pos/pos-scope';
import type {
  CreateTableDto,
  CreateZoneDto,
  UpdateTableDto,
  UpdateZoneDto,
} from './restaurant.dto';

/** Jeton aléatoire de 128 bits (base64url, 22 caractères) : seul contenu de l'URL du QR code. */
export function newDiningQrToken(): string {
  return randomBytes(16).toString('base64url');
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const NAME_TAKEN = {
  code: 'NAME_TAKEN',
  message: 'Ce nom est déjà utilisé dans cet établissement.',
};
const ZONE_NOT_FOUND = { code: 'ZONE_NOT_FOUND', message: 'Zone introuvable.' };
const TABLE_NOT_FOUND = { code: 'TABLE_NOT_FOUND', message: 'Table introuvable.' };

/** Fenêtre « réservée » : une réservation confirmée qui commence dans l'heure ou est en cours. */
const RESERVED_SOON_MS = 60 * 60 * 1000;
/** Une commande ouverte depuis plus de 24 h n'occupe plus la table (oubli de clôture). */
const OCCUPANCY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Salles, zones et tables d'un établissement restaurant. Les zones sont facultatives : un restaurant
 * fonctionne sans zone, et sans bord de piscine. Chaque table et chaque zone a un QR code dont l'URL
 * ne contient qu'un jeton aléatoire, révocable (régénération).
 */
@Injectable()
export class DiningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Établissements actifs avec une activité restaurant, dans le périmètre du membre. */
  async establishments(auth: TenantContext) {
    const rows = await this.prisma.establishment.findMany({
      where: { ...establishmentScope(auth), isActive: true },
      select: { id: true, name: true, businessType: true },
      orderBy: { name: 'asc' },
    });
    return rows
      .filter((e) => coversActivity(e.businessType, 'RESTAURANT'))
      .map(({ id, name }) => ({ id, name }));
  }

  async overview(auth: TenantContext, establishmentId: string) {
    const establishment = await findSellingEstablishment(
      this.prisma,
      auth,
      establishmentId,
      'RESTAURANT',
    );
    const now = new Date();
    const [zones, tables, occupied, reserved] = await Promise.all([
      this.prisma.diningZone.findMany({
        where: { establishmentId: establishment.id },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          kind: true,
          sortOrder: true,
          isActive: true,
          qrToken: true,
        },
      }),
      this.prisma.diningTable.findMany({
        where: { establishmentId: establishment.id },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          seats: true,
          isActive: true,
          qrToken: true,
          zoneId: true,
        },
      }),
      this.prisma.sale.groupBy({
        by: ['tableId'],
        where: {
          establishmentId: establishment.id,
          activity: 'RESTAURANT',
          status: 'OPEN',
          tableId: { not: null },
          createdAt: { gte: new Date(now.getTime() - OCCUPANCY_WINDOW_MS) },
          OR: [{ paymentStatus: 'UNPAID' }, { preparationStatus: { not: 'SERVED' } }],
        },
        _count: { _all: true },
      }),
      this.prisma.reservation.findMany({
        where: {
          establishmentId: establishment.id,
          status: 'CONFIRMED',
          tableId: { not: null },
          startsAt: { lte: new Date(now.getTime() + RESERVED_SOON_MS) },
          endsAt: { gt: now },
        },
        select: { tableId: true },
      }),
    ]);
    const activeOrders = new Map(occupied.map((o) => [o.tableId!, o._count._all]));
    const reservedIds = new Set(reserved.map((r) => r.tableId!));
    const status = (t: { id: string; isActive: boolean }): TableStatus => {
      if (!t.isActive) return 'OUT_OF_SERVICE';
      if (activeOrders.has(t.id)) return 'OCCUPIED';
      if (reservedIds.has(t.id)) return 'RESERVED';
      return 'FREE';
    };
    return {
      zones: zones.map(({ qrToken, ...z }) => ({ ...z, qrPath: publicMenuPath(qrToken) })),
      tables: tables.map(({ qrToken, ...t }) => ({
        ...t,
        status: status(t),
        activeOrders: activeOrders.get(t.id) ?? 0,
        qrPath: publicMenuPath(qrToken),
      })),
    };
  }

  async createZone(auth: TenantContext, dto: CreateZoneDto) {
    await findSellingEstablishment(this.prisma, auth, dto.establishmentId, 'RESTAURANT');
    try {
      const zone = await this.prisma.diningZone.create({
        data: {
          organizationId: auth.membership.organizationId,
          establishmentId: dto.establishmentId,
          name: dto.name,
          kind: dto.kind,
          sortOrder: dto.sortOrder ?? 0,
          qrToken: newDiningQrToken(),
        },
        select: { id: true },
      });
      await this.record(auth, 'dining.zone_created', 'DiningZone', zone.id, { name: dto.name });
      return zone;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(NAME_TAKEN);
      throw error;
    }
  }

  async updateZone(auth: TenantContext, id: string, dto: UpdateZoneDto) {
    await this.findZone(auth, id);
    try {
      await this.prisma.diningZone.update({ where: { id }, data: dto });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(NAME_TAKEN);
      throw error;
    }
    await this.record(auth, 'dining.zone_updated', 'DiningZone', id, { ...dto });
    return { id };
  }

  async createTable(auth: TenantContext, dto: CreateTableDto) {
    await findSellingEstablishment(this.prisma, auth, dto.establishmentId, 'RESTAURANT');
    if (dto.zoneId) await this.assertZoneOf(auth, dto.zoneId, dto.establishmentId);
    try {
      const table = await this.prisma.diningTable.create({
        data: {
          organizationId: auth.membership.organizationId,
          establishmentId: dto.establishmentId,
          zoneId: dto.zoneId ?? null,
          name: dto.name,
          seats: dto.seats ?? 4,
          qrToken: newDiningQrToken(),
        },
        select: { id: true },
      });
      await this.record(auth, 'dining.table_created', 'DiningTable', table.id, { name: dto.name });
      return table;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(NAME_TAKEN);
      throw error;
    }
  }

  async updateTable(auth: TenantContext, id: string, dto: UpdateTableDto) {
    const table = await this.findTable(auth, id);
    if (dto.zoneId) await this.assertZoneOf(auth, dto.zoneId, table.establishmentId);
    try {
      await this.prisma.diningTable.update({ where: { id }, data: dto });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(NAME_TAKEN);
      throw error;
    }
    await this.record(auth, 'dining.table_updated', 'DiningTable', id, { ...dto });
    return { id };
  }

  /** Nouveau QR code : l'ancien (imprimé, photographié) cesse immédiatement de fonctionner. */
  async regenerateQr(auth: TenantContext, kind: 'table' | 'zone', id: string) {
    if (kind === 'table') await this.findTable(auth, id);
    else await this.findZone(auth, id);
    const qrToken = newDiningQrToken();
    if (kind === 'table')
      await this.prisma.diningTable.update({ where: { id }, data: { qrToken } });
    else await this.prisma.diningZone.update({ where: { id }, data: { qrToken } });
    await this.record(
      auth,
      'dining.qr_regenerated',
      kind === 'table' ? 'DiningTable' : 'DiningZone',
      id,
      {},
    );
    return { qrPath: publicMenuPath(qrToken) };
  }

  /**
   * Table et zone d'une commande, contrôlées dans l'établissement : une table d'un autre
   * établissement ou d'une autre organisation est « introuvable ». La zone d'une table est déduite.
   */
  async resolveLocation(
    auth: TenantContext,
    establishmentId: string,
    tableId?: string | null,
    zoneId?: string | null,
  ): Promise<{ tableId: string | null; zoneId: string | null }> {
    if (tableId) {
      const table = await this.prisma.diningTable.findFirst({
        where: {
          id: tableId,
          organizationId: auth.membership.organizationId,
          establishmentId,
          isActive: true,
        },
        select: { id: true, zoneId: true },
      });
      if (!table) throw new NotFoundException(TABLE_NOT_FOUND);
      if (zoneId && table.zoneId !== zoneId) {
        throw new BadRequestException({
          code: 'TABLE_ZONE_MISMATCH',
          message: 'Cette table n’appartient pas à la zone indiquée.',
        });
      }
      return { tableId: table.id, zoneId: table.zoneId };
    }
    if (zoneId) {
      const zone = await this.prisma.diningZone.findFirst({
        where: {
          id: zoneId,
          organizationId: auth.membership.organizationId,
          establishmentId,
          isActive: true,
        },
        select: { id: true },
      });
      if (!zone) throw new NotFoundException(ZONE_NOT_FOUND);
      return { tableId: null, zoneId: zone.id };
    }
    return { tableId: null, zoneId: null };
  }

  private async findZone(auth: TenantContext, id: string) {
    const zone = await this.prisma.diningZone.findFirst({
      where: { id, organizationId: auth.membership.organizationId },
      select: { id: true, establishmentId: true },
    });
    if (!zone) throw new NotFoundException(ZONE_NOT_FOUND);
    await findSellingEstablishment(this.prisma, auth, zone.establishmentId, 'RESTAURANT');
    return zone;
  }

  private async findTable(auth: TenantContext, id: string) {
    const table = await this.prisma.diningTable.findFirst({
      where: { id, organizationId: auth.membership.organizationId },
      select: { id: true, establishmentId: true },
    });
    if (!table) throw new NotFoundException(TABLE_NOT_FOUND);
    await findSellingEstablishment(this.prisma, auth, table.establishmentId, 'RESTAURANT');
    return table;
  }

  private async assertZoneOf(auth: TenantContext, zoneId: string, establishmentId: string) {
    const zone = await this.prisma.diningZone.count({
      where: { id: zoneId, organizationId: auth.membership.organizationId, establishmentId },
    });
    if (!zone) throw new NotFoundException(ZONE_NOT_FOUND);
  }

  private record(
    auth: TenantContext,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Prisma.InputJsonObject,
  ) {
    return this.audit.record({
      organizationId: auth.membership.organizationId,
      actorUserId: auth.user.id,
      action,
      targetType,
      targetId,
      metadata,
    });
  }
}
