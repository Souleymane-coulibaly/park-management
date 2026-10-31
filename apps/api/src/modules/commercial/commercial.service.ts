import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  DEMO_REQUEST_RETENTION_MONTHS,
  PUBLIC_PRODUCT_STATUS_LABELS,
  type SaasProductStatus,
  demoSpamReason,
  formatDemoRequestNumber,
  isPublicProductStatus,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth-context';
import { nextPlatformSequence } from '../../common/platform-counter';
import type {
  CreateDemoRequestDto,
  DemoRequestsQueryDto,
  UpdateDemoRequestDto,
} from './commercial.dto';

const PUBLIC_PRODUCT_SELECT = {
  code: true,
  slug: true,
  name: true,
  tagline: true,
  description: true,
  status: true,
  appUrl: true,
  availableAt: true,
  features: true,
  sortOrder: true,
  plans: {
    where: { isActive: true },
    orderBy: { monthlyPrice: 'asc' as const },
    select: { name: true, monthlyPrice: true, setupFee: true, currency: true, businessType: true },
  },
} as const;

type PublicProductRow = {
  code: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  status: SaasProductStatus;
  appUrl: string | null;
  availableAt: Date | null;
  features: string[];
  sortOrder: number;
  plans: {
    name: string;
    monthlyPrice: number;
    setupFee: number;
    currency: string;
    businessType: string | null;
  }[];
};

/**
 * Site commercial Ocall Suite (Sprint 12A) : catalogue public et demandes de démonstration.
 * Le catalogue ne publie que les statuts publics ; les tarifs uniquement pour un produit
 * commercialisé (jamais de prix pour un produit « bientôt disponible »).
 */
@Injectable()
export class CommercialService {
  private readonly logger = new Logger('Commercial');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private publicView(p: PublicProductRow) {
    return {
      code: p.code,
      slug: p.slug,
      name: p.name,
      tagline: p.tagline,
      description: p.description,
      status: p.status,
      statusLabel: PUBLIC_PRODUCT_STATUS_LABELS[p.status] ?? '',
      subscribable: p.status === 'ACTIVE',
      appUrl: p.status === 'ACTIVE' || p.status === 'PILOT' ? p.appUrl : null,
      availableAt: p.availableAt ? p.availableAt.toISOString().slice(0, 10) : null,
      plans: p.status === 'ACTIVE' ? p.plans : [],
    };
  }

  async catalog() {
    const rows = await this.prisma.saasProduct.findMany({
      where: { listed: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: PUBLIC_PRODUCT_SELECT,
    });
    return rows.filter((p) => isPublicProductStatus(p.status)).map((p) => this.publicView(p));
  }

  async product(slug: string) {
    const p = await this.prisma.saasProduct.findUnique({
      where: { slug },
      select: { ...PUBLIC_PRODUCT_SELECT, listed: true },
    });
    if (!p || !p.listed || !isPublicProductStatus(p.status)) {
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Produit introuvable.' });
    }
    return this.publicView(p);
  }

  /**
   * Demande de démonstration publique. Un envoi détecté comme automatisé reçoit la même réponse
   * qu'un envoi accepté, sans rien enregistrer (aucun indice pour un robot).
   */
  async createDemoRequest(dto: CreateDemoRequestDto) {
    const spam = demoSpamReason({ website: dto.website, startedAt: dto.startedAt });
    if (spam) {
      this.logger.warn(`Demande de démonstration ignorée (${spam}).`);
      return { received: true };
    }
    const product = dto.product
      ? await this.prisma.saasProduct.findUnique({
          where: { slug: dto.product },
          select: { id: true, listed: true, status: true },
        })
      : null;
    const productId =
      product && product.listed && isPublicProductStatus(product.status) ? product.id : null;
    // Parrainage (Sprint 12B) : rattachée au partenaire actif du code ; l'attribution d'un futur
    // client reste confirmée par Ocall.
    const partner = dto.ref
      ? await this.prisma.partner.findFirst({
          where: { code: dto.ref, status: 'ACTIVE' },
          select: { id: true },
        })
      : null;
    const retentionUntil = new Date();
    retentionUntil.setUTCMonth(retentionUntil.getUTCMonth() + DEMO_REQUEST_RETENTION_MONTHS);
    await this.prisma.$transaction(async (tx) => {
      const { year, sequence } = await nextPlatformSequence(tx, 'demo');
      const created = await tx.demoRequest.create({
        data: {
          number: formatDemoRequestNumber(year, sequence),
          name: dto.name,
          company: dto.company,
          country: dto.country,
          phone: dto.phone,
          email: dto.email,
          productId,
          message: dto.message,
          partnerId: partner?.id ?? null,
          retentionUntil,
        },
        select: { id: true, number: true },
      });
      // Journal sans données personnelles.
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: null,
          action: 'platform.demo_request_received',
          targetType: 'DemoRequest',
          targetId: created.id,
          metadata: { number: created.number, product: dto.product ?? null, referral: !!partner },
        },
        tx,
      );
    });
    return { received: true };
  }

  // ─── Super Admin ───

  async listDemoRequests(query: DemoRequestsQueryDto) {
    return this.prisma.demoRequest.findMany({
      where: {
        anonymizedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.productCode ? { product: { code: query.productCode } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: {
        id: true,
        number: true,
        name: true,
        company: true,
        country: true,
        phone: true,
        email: true,
        message: true,
        status: true,
        notes: true,
        createdAt: true,
        retentionUntil: true,
        product: { select: { code: true, name: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        partner: { select: { id: true, code: true, companyName: true } },
      },
    });
  }

  countNew(): Promise<number> {
    return this.prisma.demoRequest.count({ where: { status: 'NEW', anonymizedAt: null } });
  }

  async updateDemoRequest(auth: AuthContext, id: string, dto: UpdateDemoRequestDto) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.demoRequest.findUnique({
        where: { id },
        select: { status: true, assignedToId: true, anonymizedAt: true },
      });
      if (!before || before.anonymizedAt) {
        throw new NotFoundException({
          code: 'DEMO_REQUEST_NOT_FOUND',
          message: 'Demande introuvable.',
        });
      }
      if (dto.assignedToId) {
        const user = await tx.user.findUnique({
          where: { id: dto.assignedToId },
          select: { platformRole: true, isActive: true },
        });
        if (!user?.platformRole || !user.isActive) {
          throw new NotFoundException({
            code: 'ASSIGNEE_INVALID',
            message: 'Le responsable doit être un compte interne Ocall actif.',
          });
        }
      }
      const updated = await tx.demoRequest.update({
        where: { id },
        data: {
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.assignedToId !== undefined ? { assignedToId: dto.assignedToId } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
        select: { id: true, number: true, status: true, assignedToId: true },
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.demo_request_updated',
          targetType: 'DemoRequest',
          targetId: id,
          metadata: {
            from: { status: before.status, assignedToId: before.assignedToId },
            to: { status: updated.status, assignedToId: updated.assignedToId },
          },
        },
        tx,
      );
      return updated;
    });
  }

  /** Anonymise les demandes dont la conservation est échue (idempotent, journalisé). */
  async purgeExpired(auth: AuthContext | null, now = new Date()) {
    const result = await this.prisma.demoRequest.updateMany({
      where: { retentionUntil: { lt: now }, anonymizedAt: null },
      data: {
        name: 'Anonymisé',
        company: 'Anonymisé',
        phone: '-',
        email: 'anonymise@invalid',
        message: '-',
        notes: null,
        anonymizedAt: now,
      },
    });
    if (result.count > 0) {
      await this.audit.record({
        organizationId: null,
        actorUserId: auth?.user.id ?? null,
        action: 'platform.demo_requests_anonymized',
        targetType: 'DemoRequest',
        targetId: null,
        metadata: { count: result.count },
      });
    }
    return { anonymized: result.count };
  }
}
