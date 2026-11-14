import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/stock-database';
import {
  SITE_DOMAIN_ERRORS,
  SITE_DOMAIN_TXT_PREFIX,
  SITE_DOMAIN_TXT_VALUE_PREFIX,
  normalizeCustomDomain,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { DomainVerifier } from '../../common/sites/domain-verifier';
import { SiteDomainRegistry } from '../../common/sites/site-domain-registry';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrismaService } from '../../prisma/prisma.service';
import type { StockContext } from './ocall-stock-access';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';

const NOT_FOUND = { code: 'DOMAIN_NOT_FOUND', message: 'Domaine introuvable.' };

/** Un domaine déclaré mais jamais vérifié est libéré au bout de 7 jours (pas de réservation sans fin). */
export const STOCK_DOMAIN_PENDING_DAYS = 7;
const pendingCutoff = () => new Date(Date.now() - STOCK_DOMAIN_PENDING_DAYS * 86_400_000);
/** Domaine qui retient encore son nom : tout sauf une déclaration en attente expirée. */
const holding = () => ({ NOT: { status: 'PENDING' as const, createdAt: { lt: pendingCutoff() } } });

/**
 * Preuve servie par la page de contrôle HTTPS : dérivée du jeton du domaine, jamais l'identifiant de
 * l'organisation (la page est publique).
 */
export function stockDomainHttpsProof(verificationToken: string): string {
  return createHash('sha256')
    .update(`ocall-stock-site:${verificationToken}`)
    .digest('base64url')
    .slice(0, 32);
}

/**
 * Vérificateur des domaines des vitrines Stock : même implémentation que les sites Park et Facture, jeton
 * d'injection propre (une instance par application, jamais confondue avec celle d'une autre).
 */
export const STOCK_DOMAIN_VERIFIER = Symbol('STOCK_DOMAIN_VERIFIER');

/**
 * Domaines personnalisés des vitrines Stock (S7), même procédure que les sites Park et Facture, avec le
 * vérificateur commun : propriété prouvée par un enregistrement TXT, puis activation par le Super Admin
 * (TXT revérifié et page de contrôle HTTPS répondant l'identifiant du site). Un nom de domaine n'est
 * jamais servi par deux applications : un domaine déjà déclaré pour un site Park ou une vitrine Facture
 * est refusé (registre commun des domaines).
 */
@Injectable()
export class OcallStockShowcaseDomainsService {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly core: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(STOCK_DOMAIN_VERIFIER) private readonly verifier: DomainVerifier,
    private readonly registry: SiteDomainRegistry,
  ) {
    // Domaines déclarés pour une vitrine Stock : consultés par les autres applications (Facture).
    registry.register('STOCK', async (hostname) =>
      this.config.stock.enabled
        ? (await this.db.stockShowcaseDomain.count({ where: { hostname, ...holding() } })) > 0
        : false,
    );
  }

  /** Instructions DNS d'un domaine (affichées dans le back-office). */
  instructions(domain: { hostname: string; verificationToken: string }) {
    return {
      txtName: `${SITE_DOMAIN_TXT_PREFIX}.${domain.hostname}`,
      txtValue: `${SITE_DOMAIN_TXT_VALUE_PREFIX}${domain.verificationToken}`,
      cnameTarget: this.config.sites.customDomainTarget,
    };
  }

  async add(ctx: StockContext, input: string) {
    const site = await this.db.stockShowcase.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { organizationId: true },
    });
    if (!site) {
      throw new ConflictException({
        code: 'STOCK_SHOWCASE_REQUIRED',
        message: 'Choisissez d’abord l’adresse de votre site.',
      });
    }
    const platform = [
      this.config.sites.baseDomain,
      this.config.facture.sites.baseDomain,
      this.config.stock.sites.baseDomain,
      new URL(this.config.sites.publicOrigin).hostname,
    ].filter((d): d is string => !!d);
    const normalized = normalizeCustomDomain(input, platform);
    if ('error' in normalized) {
      throw new BadRequestException({
        code: normalized.error,
        message: SITE_DOMAIN_ERRORS[normalized.error],
      });
    }
    const existing = await this.db.stockShowcaseDomain.count({
      where: { organizationId: ctx.organizationId, status: { not: 'ERROR' } },
    });
    if (existing > 0) {
      throw new ConflictException({
        code: 'DOMAIN_ALREADY_SET',
        message: 'Votre site a déjà un domaine : supprimez-le avant d’en ajouter un autre.',
      });
    }
    // Déclaration en attente expirée (jamais vérifiée en 7 jours, quelle que soit l'organisation) : libérée.
    const expired = await this.db.stockShowcaseDomain.findMany({
      where: {
        hostname: normalized.hostname,
        status: 'PENDING',
        createdAt: { lt: pendingCutoff() },
      },
      select: { id: true, organizationId: true },
    });
    for (const old of expired) {
      const { count } = await this.db.stockShowcaseDomain.deleteMany({
        where: { id: old.id, status: 'PENDING', createdAt: { lt: pendingCutoff() } },
      });
      if (count > 0) {
        await this.record(old.organizationId, ctx.userId, 'stock.showcase_domain_expired', old.id, {
          hostname: normalized.hostname,
        });
      }
    }
    // Unicité entre applications : un domaine déclaré pour un site Park n'est jamais repris.
    if (
      await this.core.publicSiteDomain.findUnique({
        where: { hostname: normalized.hostname },
        select: { id: true },
      })
    ) {
      throw this.taken();
    }
    // Ni une vitrine d'une autre application (Ocall Facture).
    if (await this.registry.takenElsewhere('STOCK', normalized.hostname)) throw this.taken();
    try {
      const domain = await this.db.stockShowcaseDomain.create({
        data: {
          organizationId: ctx.organizationId,
          hostname: normalized.hostname,
          verificationToken: randomBytes(18).toString('base64url'),
          createdByUserId: ctx.userId,
        },
      });
      await this.record(ctx.organizationId, ctx.userId, 'stock.showcase_domain_added', domain.id, {
        hostname: domain.hostname,
      });
      return { ...domain, ...this.instructions(domain) };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw this.taken();
      throw e;
    }
  }

  /** Vérification de propriété par l'entreprise (enregistrement TXT). */
  async verify(ctx: StockContext, id: string) {
    const domain = await this.find(ctx.organizationId, id);
    this.assertNotSuspended(domain);
    // Domaine déjà actif : rien à vérifier (son activation reste celle du Super Admin).
    if (domain.status === 'ACTIVE') return { ...domain, ...this.instructions(domain) };
    const proven = await this.ownershipProven(domain.hostname, domain.verificationToken).catch(
      () => false,
    );
    const updated = await this.db.stockShowcaseDomain.update({
      where: { id },
      data: {
        status: proven ? 'VERIFIED' : 'PENDING',
        lastCheckedAt: new Date(),
        lastError: proven
          ? null
          : 'Enregistrement TXT introuvable : vérifiez votre configuration DNS.',
      },
    });
    return { ...updated, ...this.instructions(updated) };
  }

  async remove(ctx: StockContext, id: string) {
    const domain = await this.find(ctx.organizationId, id);
    // Supprimer puis redéclarer contournerait la suspension : seul le Super Admin la lève.
    this.assertNotSuspended(domain);
    await this.db.stockShowcaseDomain.delete({ where: { id: domain.id } });
    await this.record(ctx.organizationId, ctx.userId, 'stock.showcase_domain_removed', id, {
      hostname: domain.hostname,
    });
  }

  // ─── Super Admin ───

  platformList(status?: string) {
    return this.db.stockShowcaseDomain.findMany({
      where: status ? { status: status as never } : {},
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  /** Activation : propriété toujours prouvée et page de contrôle HTTPS conforme, sinon erreur. */
  async activate(actorUserId: string, id: string) {
    const domain = await this.db.stockShowcaseDomain.findUnique({ where: { id } });
    if (!domain) throw new NotFoundException(NOT_FOUND);
    if (domain.status !== 'VERIFIED' && domain.status !== 'ERROR') {
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
      const https = await this.verifier.checkHttps(
        domain.hostname,
        stockDomainHttpsProof(domain.verificationToken),
      );
      if (!https.ok) error = https.error;
    }
    const updated = await this.db.stockShowcaseDomain.update({
      where: { id },
      data: error
        ? { status: 'ERROR', lastError: error, lastCheckedAt: new Date() }
        : {
            status: 'ACTIVE',
            lastError: null,
            lastCheckedAt: new Date(),
            activatedAt: new Date(),
            activatedByUserId: actorUserId,
          },
    });
    await this.record(null, actorUserId, 'platform.stock_showcase_domain_activation', id, {
      hostname: domain.hostname,
      result: updated.status,
      verifier: this.verifier.mode,
    });
    return { id, hostname: domain.hostname, status: updated.status, error };
  }

  async suspend(actorUserId: string, id: string, reason: string) {
    const domain = await this.db.stockShowcaseDomain.findUnique({ where: { id } });
    if (!domain) throw new NotFoundException(NOT_FOUND);
    await this.db.stockShowcaseDomain.update({
      where: { id },
      data: { status: 'SUSPENDED', activatedAt: null, lastError: reason },
    });
    await this.record(null, actorUserId, 'platform.stock_showcase_domain_suspended', id, {
      hostname: domain.hostname,
    });
    return { id, status: 'SUSPENDED' as const };
  }

  // ─── Outils ───

  private assertNotSuspended(domain: { status: string }) {
    if (domain.status === 'SUSPENDED') {
      throw new ConflictException({
        code: 'DOMAIN_SUSPENDED',
        message: 'Domaine mis hors service par Ocall : contactez le support.',
      });
    }
  }

  private async ownershipProven(hostname: string, token: string) {
    const values = await this.verifier.resolveTxt(`${SITE_DOMAIN_TXT_PREFIX}.${hostname}`);
    return values.includes(`${SITE_DOMAIN_TXT_VALUE_PREFIX}${token}`);
  }

  private async find(organizationId: string, id: string) {
    const domain = await this.db.stockShowcaseDomain.findUnique({
      where: { organizationId_id: { organizationId, id } },
    });
    if (!domain) throw new NotFoundException(NOT_FOUND);
    return domain;
  }

  private taken() {
    return new ConflictException({
      code: 'DOMAIN_TAKEN',
      message: 'Ce domaine est déjà utilisé par un autre site Ocall.',
    });
  }

  private record(
    organizationId: string | null,
    actorUserId: string,
    action: string,
    targetId: string,
    metadata: Record<string, string | null>,
  ) {
    return this.audit.record({
      organizationId,
      actorUserId,
      action,
      targetType: 'StockShowcaseDomain',
      targetId,
      metadata,
    });
  }
}
