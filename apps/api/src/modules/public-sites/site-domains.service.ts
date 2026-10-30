import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import {
  SITE_DOMAIN_ERRORS,
  SITE_DOMAIN_TXT_PREFIX,
  SITE_DOMAIN_TXT_VALUE_PREFIX,
  type SiteDomainStatus,
  normalizeCustomDomain,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext, TenantContext } from '../../common/auth-context';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { DOMAIN_VERIFIER, type DomainVerifier } from './domain-verifier';
import { SitesService } from './sites.service';

/**
 * Domaines personnalisés (Sprint 10), procédure en deux temps :
 * 1. le propriétaire de l'organisation saisit son domaine ; le serveur fournit le TXT de preuve et la
 *    cible CNAME ; la vérification lit le TXT dans le DNS public → VERIFIED (sinon PENDING) ;
 * 2. Ocall ajoute le domaine chez l'hébergeur (procédure administrative documentée : Railway limite
 *    le nombre de domaines par service), puis le Super Admin lance l'activation : nouvelle lecture du
 *    TXT et contrôle HTTPS réel de la page de contrôle → ACTIVE, ou ERROR avec le motif.
 * Jamais ACTIVE sans preuve de propriété ; un domaine n'appartient qu'à un site (unicité en base).
 */
@Injectable()
export class SiteDomainsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sites: SitesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DOMAIN_VERIFIER) private readonly verifier: DomainVerifier,
  ) {}

  private platformDomains(): string[] {
    const c = this.config.sites;
    return [c.baseDomain, new URL(c.publicOrigin).hostname].filter((d): d is string => !!d);
  }

  async add(tenant: TenantContext, siteId: string, input: string) {
    const site = await this.sites.findSite(tenant, siteId);
    const normalized = normalizeCustomDomain(input, this.platformDomains());
    if ('error' in normalized) {
      throw new BadRequestException({
        code: normalized.error,
        message: SITE_DOMAIN_ERRORS[normalized.error],
      });
    }
    if (site.domains.some((d) => d.status !== 'ERROR')) {
      throw new ConflictException({
        code: 'DOMAIN_ALREADY_SET',
        message: 'Ce site a déjà un domaine : supprimez-le avant d’en ajouter un autre.',
      });
    }
    const token = randomBytes(18).toString('base64url');
    try {
      await this.prisma.$transaction(async (tx) => {
        const d = await tx.publicSiteDomain.create({
          data: {
            organizationId: tenant.membership.organizationId,
            siteId,
            hostname: normalized.hostname,
            verificationToken: token,
          },
          select: { id: true },
        });
        await this.audit.record(
          {
            organizationId: tenant.membership.organizationId,
            actorUserId: tenant.user.id,
            action: 'site.domain_requested',
            targetType: 'PublicSiteDomain',
            targetId: d.id,
            metadata: { siteId, hostname: normalized.hostname },
          },
          tx,
        );
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Message neutre : ne révèle pas quelle organisation détient le domaine.
        throw new ConflictException({
          code: 'DOMAIN_TAKEN',
          message: 'Ce domaine est déjà associé à un site Ocall.',
        });
      }
      throw e;
    }
    return this.sites.get(tenant, siteId);
  }

  private async findDomain(tenant: TenantContext, siteId: string, domainId: string) {
    await this.sites.findSite(tenant, siteId);
    const domain = await this.prisma.publicSiteDomain.findFirst({
      where: { id: domainId, siteId },
    });
    if (!domain)
      throw new NotFoundException({ code: 'DOMAIN_NOT_FOUND', message: 'Domaine introuvable.' });
    return domain;
  }

  private async ownershipProven(hostname: string, token: string): Promise<boolean> {
    const values = await this.verifier.resolveTxt(`${SITE_DOMAIN_TXT_PREFIX}.${hostname}`);
    return values.includes(`${SITE_DOMAIN_TXT_VALUE_PREFIX}${token}`);
  }

  /** Vérification de propriété par le client : TXT trouvé → VERIFIED ; sinon reste PENDING. */
  async verify(tenant: TenantContext, siteId: string, domainId: string) {
    const domain = await this.findDomain(tenant, siteId, domainId);
    if (domain.status === 'ACTIVE' || domain.status === 'VERIFIED')
      return this.sites.get(tenant, siteId);
    await this.prisma.publicSiteDomain.update({
      where: { id: domainId },
      data: { status: 'VERIFYING' },
    });
    let status: SiteDomainStatus = 'PENDING';
    let lastError: string | null = null;
    try {
      if (await this.ownershipProven(domain.hostname, domain.verificationToken))
        status = 'VERIFIED';
      else
        lastError =
          'Enregistrement TXT introuvable (la propagation DNS peut prendre jusqu’à 72 h).';
    } catch (e) {
      status = 'ERROR';
      lastError = `Lecture DNS impossible (${(e as NodeJS.ErrnoException).code ?? 'erreur'}).`;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.publicSiteDomain.update({
        where: { id: domainId },
        data: {
          status,
          lastError,
          lastCheckedAt: new Date(),
          ...(status === 'VERIFIED' ? { verifiedAt: new Date() } : {}),
        },
      });
      await this.audit.record(
        {
          organizationId: tenant.membership.organizationId,
          actorUserId: tenant.user.id,
          action: 'site.domain_verification',
          targetType: 'PublicSiteDomain',
          targetId: domainId,
          metadata: { hostname: domain.hostname, result: status },
        },
        tx,
      );
    });
    return this.sites.get(tenant, siteId);
  }

  async remove(tenant: TenantContext, siteId: string, domainId: string) {
    const domain = await this.findDomain(tenant, siteId, domainId);
    await this.prisma.$transaction(async (tx) => {
      await tx.publicSiteDomain.delete({ where: { id: domainId } });
      await this.audit.record(
        {
          organizationId: tenant.membership.organizationId,
          actorUserId: tenant.user.id,
          action: 'site.domain_removed',
          targetType: 'PublicSiteDomain',
          targetId: domainId,
          metadata: { hostname: domain.hostname, status: domain.status },
        },
        tx,
      );
    });
    const site = await this.sites.findSite(tenant, siteId);
    void this.sites.revalidate([site.slug]);
    return this.sites.get(tenant, siteId);
  }

  // ─── Super Admin ───

  async platformList(status?: SiteDomainStatus) {
    const rows = await this.prisma.publicSiteDomain.findMany({
      where: status ? { status } : {},
      select: {
        id: true,
        hostname: true,
        status: true,
        verifiedAt: true,
        activatedAt: true,
        lastCheckedAt: true,
        lastError: true,
        createdAt: true,
        site: {
          select: {
            id: true,
            slug: true,
            organization: { select: { name: true } },
            establishment: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return {
      customDomainTarget: this.config.sites.customDomainTarget,
      verifierMode: this.verifier.mode,
      domains: rows.map((d) => ({
        id: d.id,
        hostname: d.hostname,
        status: d.status,
        verifiedAt: d.verifiedAt?.toISOString() ?? null,
        activatedAt: d.activatedAt?.toISOString() ?? null,
        lastCheckedAt: d.lastCheckedAt?.toISOString() ?? null,
        lastError: d.lastError,
        createdAt: d.createdAt.toISOString(),
        site: {
          id: d.site.id,
          slug: d.site.slug,
          organization: d.site.organization.name,
          establishment: d.site.establishment.name,
        },
      })),
    };
  }

  /**
   * Activation par le Super Admin, après ajout du domaine chez l'hébergeur : la propriété est
   * revérifiée (TXT toujours présent), puis le contrôle HTTPS réel doit répondre l'identifiant du
   * site. Sinon : ERROR avec le motif, le domaine ne sert rien.
   */
  async activate(auth: AuthContext, domainId: string) {
    const domain = await this.prisma.publicSiteDomain.findUnique({
      where: { id: domainId },
      include: { site: { select: { id: true, slug: true } } },
    });
    if (!domain)
      throw new NotFoundException({ code: 'DOMAIN_NOT_FOUND', message: 'Domaine introuvable.' });
    if (!domain.verifiedAt) {
      throw new ConflictException({
        code: 'DOMAIN_NOT_VERIFIED',
        message: 'Propriété non vérifiée : activation impossible.',
      });
    }
    let error: string | null = null;
    if (
      !(await this.ownershipProven(domain.hostname, domain.verificationToken).catch(() => false))
    ) {
      error = 'Enregistrement TXT de propriété absent : le domaine n’est plus prouvé.';
    } else {
      const https = await this.verifier.checkHttps(domain.hostname, domain.site.id);
      if (!https.ok) error = https.error;
    }
    const status: SiteDomainStatus = error ? 'ERROR' : 'ACTIVE';
    await this.prisma.$transaction(async (tx) => {
      await tx.publicSiteDomain.update({
        where: { id: domainId },
        data: {
          status,
          lastError: error,
          lastCheckedAt: new Date(),
          ...(status === 'ACTIVE' ? { activatedAt: new Date() } : {}),
        },
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.site_domain_activation',
          targetType: 'PublicSiteDomain',
          targetId: domainId,
          metadata: {
            hostname: domain.hostname,
            result: status,
            error,
            verifier: this.verifier.mode,
          },
        },
        tx,
      );
    });
    void this.sites.revalidate([domain.site.slug]);
    return { id: domainId, hostname: domain.hostname, status, error };
  }

  /** Mise hors service manuelle par le Super Admin (incident, litige). */
  async suspend(auth: AuthContext, domainId: string, reason: string) {
    const domain = await this.prisma.publicSiteDomain.findUnique({
      where: { id: domainId },
      include: { site: { select: { slug: true } } },
    });
    if (!domain)
      throw new NotFoundException({ code: 'DOMAIN_NOT_FOUND', message: 'Domaine introuvable.' });
    await this.prisma.$transaction(async (tx) => {
      await tx.publicSiteDomain.update({
        where: { id: domainId },
        data: { status: 'ERROR', lastError: reason, lastCheckedAt: new Date() },
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.site_domain_suspended',
          targetType: 'PublicSiteDomain',
          targetId: domainId,
          metadata: { hostname: domain.hostname, reason },
        },
        tx,
      );
    });
    void this.sites.revalidate([domain.site.slug]);
    return { id: domainId, status: 'ERROR' as const };
  }
}
