import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type SuiteNotificationKind,
  type SuiteNotificationParams,
  suiteNotificationText,
} from '@ocall/shared';
import type { TenantContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';

const PAGE = 30;
const ADMIN_PAGE = 100;

/**
 * Centre de notifications du portail Ocall Suite (Sprint S2). Un compte ne voit que ses propres
 * notifications, pour l'organisation de sa session : aucun identifiant d'organisation ni de compte n'est
 * accepté du client.
 */
@Injectable()
export class SuiteNotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  private scope(auth: TenantContext) {
    return { userId: auth.user.id, organizationId: auth.membership.organizationId };
  }

  async list(auth: TenantContext, unreadOnly: boolean, cursor?: string) {
    const where = { ...this.scope(auth), ...(unreadOnly ? { readAt: null } : {}) };
    const [rows, unread] = await Promise.all([
      this.prisma.suiteNotification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: PAGE + 1,
        select: {
          id: true,
          kind: true,
          productCode: true,
          params: true,
          href: true,
          readAt: true,
          createdAt: true,
        },
      }),
      this.prisma.suiteNotification.count({ where: { ...this.scope(auth), readAt: null } }),
    ]);
    const items = rows.slice(0, PAGE).map((n) => ({
      ...n,
      params: (n.params ?? {}) as SuiteNotificationParams,
      ...suiteNotificationText(
        n.kind as SuiteNotificationKind,
        (n.params ?? {}) as SuiteNotificationParams,
      ),
    }));
    return {
      items,
      unread,
      nextCursor: rows.length > PAGE ? items[items.length - 1]!.id : null,
    };
  }

  async unreadCount(auth: TenantContext) {
    return {
      unread: await this.prisma.suiteNotification.count({
        where: { ...this.scope(auth), readAt: null },
      }),
    };
  }

  /** Marque une notification lue ; celle d'un autre compte ou d'une autre organisation est introuvable. */
  async markRead(auth: TenantContext, id: string): Promise<void> {
    const found = await this.prisma.suiteNotification.findFirst({
      where: { ...this.scope(auth), id },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: 'Notification introuvable.',
      });
    }
    await this.prisma.suiteNotification.updateMany({
      where: { id, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(auth: TenantContext): Promise<void> {
    await this.prisma.suiteNotification.updateMany({
      where: { ...this.scope(auth), readAt: null },
      data: { readAt: new Date() },
    });
  }

  // ─── Super Admin ───

  /**
   * Notifications émises, regroupées par fait (une ligne par organisation et clé de déduplication) :
   * destinataires et lectures, sans contenu personnel.
   */
  async adminList(filter: { organizationId?: string; kind?: SuiteNotificationKind }) {
    const groups = await this.prisma.suiteNotification.groupBy({
      by: ['organizationId', 'dedupeKey', 'kind', 'productCode'],
      where: {
        ...(filter.organizationId ? { organizationId: filter.organizationId } : {}),
        ...(filter.kind ? { kind: filter.kind } : {}),
      },
      _count: { _all: true, readAt: true },
      _min: { createdAt: true },
      orderBy: { _min: { createdAt: 'desc' } },
      take: ADMIN_PAGE,
    });
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: [...new Set(groups.map((g) => g.organizationId))] } },
      select: { id: true, name: true, code: true },
    });
    const byId = new Map(orgs.map((o) => [o.id, o]));
    return groups.map((g) => ({
      organization: byId.get(g.organizationId) ?? { id: g.organizationId, name: '—', code: '' },
      kind: g.kind,
      productCode: g.productCode,
      dedupeKey: g.dedupeKey,
      recipients: g._count._all,
      read: g._count.readAt,
      createdAt: g._min.createdAt,
    }));
  }

  async jobRuns() {
    const rows = await this.prisma.suiteJobRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        job: true,
        status: true,
        trigger: true,
        stats: true,
        error: true,
        startedAt: true,
        finishedAt: true,
      },
    });
    return rows.map((r) => ({ ...r, stats: (r.stats ?? null) as Record<string, number> | null }));
  }
}
