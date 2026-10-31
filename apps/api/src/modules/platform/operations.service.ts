import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PARK_APP_PRODUCT_CODES, bytesToMb } from '@ocall/shared';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth-context';
import { organizationQuotas, organizationsQuotas } from '../../common/quotas';
import { StorageService } from '../../common/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { platformPeriod } from './platform-period';

/**
 * Exploitation de la plateforme Ocall Suite (Sprint 11B) : consommation IA et stockage par
 * organisation, dérogations de quotas, paramètres techniques (sans aucun secret).
 */
@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Organisations du filtre produit, avec leur produit Ocall Park (contexte des quotas). */
  private async organizations(productCode?: string) {
    const orgs = await this.prisma.organization.findMany({
      where: productCode ? { subscriptions: { some: { product: { code: productCode } } } } : {},
      select: {
        id: true,
        name: true,
        subscriptions: {
          where: { product: { code: { in: [...PARK_APP_PRODUCT_CODES] } } },
          select: {
            product: { select: { code: true, name: true } },
            plan: { select: { name: true } },
          },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    });
    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      product: o.subscriptions[0]?.product ?? null,
      plan: o.subscriptions[0]?.plan.name ?? null,
    }));
  }

  /**
   * Consommation IA : par organisation, fonctionnalité et établissement sur la période ; appels
   * du mois en cours face au plafond Ocall. Coûts ESTIMÉS (le fournisseur facture séparément).
   */
  async aiUsage(filters: { productCode?: string; from?: string; to?: string }) {
    const { from, to, range, monthStart } = platformPeriod(filters);
    const orgs = await this.organizations(filters.productCode);
    const ids = orgs.map((o) => o.id);
    // Requêtes groupées (nombre constant, quel que soit le nombre d'organisations).
    const [byFeature, byEstablishment, month, establishments, quotas] = await Promise.all([
      this.prisma.aiUsage.groupBy({
        by: ['organizationId', 'feature', 'status'],
        where: { organizationId: { in: ids }, createdAt: range },
        _count: { _all: true },
        _sum: { estimatedCostMicroUsd: true },
      }),
      this.prisma.aiUsage.groupBy({
        by: ['organizationId', 'establishmentId'],
        where: { organizationId: { in: ids }, createdAt: range },
        _count: { _all: true },
      }),
      this.prisma.aiUsage.groupBy({
        by: ['organizationId'],
        where: { organizationId: { in: ids }, createdAt: { gte: monthStart } },
        _count: { _all: true },
      }),
      this.prisma.establishment.findMany({
        where: { organizationId: { in: ids } },
        select: { id: true, name: true },
      }),
      organizationsQuotas(this.prisma, ids),
    ]);
    const estName = new Map(establishments.map((e) => [e.id, e.name]));
    const monthUsed = new Map(month.map((m) => [m.organizationId, m._count._all]));
    const rows = orgs.map((o) => {
      const feats = byFeature.filter((r) => r.organizationId === o.id);
      const quota = quotas.get(o.id);
      const features: Record<string, number> = {};
      for (const f of feats) features[f.feature] = (features[f.feature] ?? 0) + f._count._all;
      return {
        organization: { id: o.id, name: o.name },
        product: o.product,
        plan: o.plan,
        calls: feats.reduce((s, f) => s + f._count._all, 0),
        failed: feats.filter((f) => f.status === 'FAILED').reduce((s, f) => s + f._count._all, 0),
        estimatedCostUsd:
          feats.reduce((s, f) => s + (f._sum.estimatedCostMicroUsd ?? 0), 0) / 1_000_000,
        features,
        establishments: byEstablishment
          .filter((r) => r.organizationId === o.id)
          .map((r) => ({
            id: r.establishmentId,
            name: r.establishmentId ? (estName.get(r.establishmentId) ?? '—') : 'Organisation',
            calls: r._count._all,
          })),
        monthUsed: monthUsed.get(o.id) ?? 0,
        monthQuota: quota?.aiMonthlyCalls ?? 0,
        quotaSource: quota?.aiSource ?? 'default',
      };
    });
    return {
      period: { from, to },
      provider: this.config.ai.provider,
      usdXofRate: this.config.ai.usdXofRate,
      totals: {
        calls: rows.reduce((s, r) => s + r.calls, 0),
        estimatedCostUsd: rows.reduce((s, r) => s + r.estimatedCostUsd, 0),
      },
      rows,
    };
  }

  /** Stockage utilisé par organisation face à son quota ; fournisseur et état. */
  async storageUsage(productCode?: string) {
    const orgs = await this.organizations(productCode);
    const ids = orgs.map((o) => o.id);
    // Requêtes groupées (nombre constant, quel que soit le nombre d'organisations).
    const [media, files, quotas] = await Promise.all([
      this.prisma.publicSiteMedia.groupBy({
        by: ['organizationId'],
        where: { organizationId: { in: ids } },
        _sum: { bytes: true },
      }),
      this.prisma.storedFile.groupBy({
        by: ['organizationId'],
        where: { organizationId: { in: ids }, deletedAt: null },
        _sum: { bytes: true },
        _count: { _all: true },
      }),
      organizationsQuotas(this.prisma, ids),
    ]);
    const mediaBytes = new Map(media.map((m) => [m.organizationId, m._sum.bytes ?? 0]));
    const fileStats = new Map(files.map((f) => [f.organizationId, f]));
    const rows = orgs.map((o) => {
      const siteMediaBytes = mediaBytes.get(o.id) ?? 0;
      const privateBytes = fileStats.get(o.id)?._sum.bytes ?? 0;
      const usedBytes = siteMediaBytes + privateBytes;
      const quota = quotas.get(o.id);
      const quotaMb = quota?.storageMb ?? 0;
      return {
        organization: { id: o.id, name: o.name },
        product: o.product,
        plan: o.plan,
        usedBytes,
        usedMb: bytesToMb(usedBytes),
        quotaMb,
        siteMediaBytes,
        privateBytes,
        files: fileStats.get(o.id)?._count._all ?? 0,
        quotaSource: quota?.storageSource ?? 'default',
        percent: quotaMb > 0 ? Math.round((usedBytes / (quotaMb * 1048576)) * 100) : 100,
      };
    });
    const expired = await this.prisma.storedFile.count({
      where: { deletedAt: null, retentionUntil: { lt: new Date() } },
    });
    return {
      driver: this.storage.driver,
      healthy: await this.storage.check(),
      totalMb: bytesToMb(rows.reduce((s, r) => s + r.usedBytes, 0)),
      expiredFiles: expired,
      rows,
    };
  }

  /** Dérogations de quotas d'une organisation (null = revenir au quota de l'offre). */
  async setQuotas(
    auth: AuthContext,
    organizationId: string,
    dto: { aiMonthlyCalls?: number | null; storageMb?: number | null },
  ) {
    const before = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { aiMonthlyQuotaOverride: true, storageQuotaMbOverride: true },
    });
    if (!before)
      throw new NotFoundException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organisation introuvable.',
      });
    const data = {
      ...(dto.aiMonthlyCalls !== undefined ? { aiMonthlyQuotaOverride: dto.aiMonthlyCalls } : {}),
      ...(dto.storageMb !== undefined ? { storageQuotaMbOverride: dto.storageMb } : {}),
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id: organizationId }, data });
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'platform.quotas_changed',
          targetType: 'Organization',
          targetId: organizationId,
          metadata: { before, after: data },
        },
        tx,
      );
    });
    return organizationQuotas(this.prisma, organizationId);
  }

  /** Paramètres techniques en lecture seule : jamais de secret, seulement leur présence. */
  async settings() {
    const s = this.config.sites;
    return {
      environment: this.config.nodeEnv,
      ai: { provider: this.config.ai.provider, models: this.config.ai.models },
      storage: {
        driver: this.storage.driver,
        healthy: await this.storage.check(),
        bucket: s.storage.driver === 's3' ? s.storage.bucket : null,
      },
      security: {
        mfaConfigured: this.config.mfaEncryptionKey !== null,
        cookieSecure: this.config.cookieSecure,
        sessionTtlHours: this.config.sessionTtlHours,
        accountLockThreshold: this.config.accountLockThreshold,
      },
      sites: {
        publicOrigin: s.publicOrigin,
        baseDomain: s.baseDomain,
        subdomainsEnabled: s.subdomainsEnabled,
      },
      logFormat: this.config.logFormat,
      payments: 'Manuels uniquement : aucun prestataire de paiement des abonnements.',
    };
  }
}
