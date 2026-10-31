import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEMO_REQUEST_RETENTION_MONTHS,
  PROSPECT_PROTECTION_DAYS,
  formatDemoRequestNumber,
  invoiceRemaining,
  normalizeCompanyName,
  normalizeEmail,
  phoneMatchKey,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { PartnerContext } from '../../common/auth-context';
import { nextPlatformSequence } from '../../common/platform-counter';
import type { CreateProspectDto, UpdateProspectDto } from './partners.dto';

const DAY_MS = 86_400_000;

/**
 * Portail des partenaires commerciaux (Sprint 12B). Toutes les requêtes sont filtrées sur le
 * partenaire DE LA SESSION (jamais sur un identifiant envoyé par le navigateur). Un partenaire ne
 * voit de ses clients apportés que le nom et les montants encaissés ; aucune donnée métier.
 */
@Injectable()
export class PartnerPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async profile(auth: PartnerContext) {
    return this.prisma.partner.findUniqueOrThrow({
      where: { id: auth.partner.id },
      select: {
        code: true,
        companyName: true,
        contactName: true,
        phone: true,
        country: true,
        territories: true,
        status: true,
        cashCollectionEnabled: true,
        cashCollectionLimit: true,
        verifiedAt: true,
      },
    });
  }

  async dashboard(auth: PartnerContext) {
    const partnerId = auth.partner.id;
    const [prospects, clients, commissions, payouts] = await Promise.all([
      this.prisma.prospect.groupBy({
        by: ['status'],
        where: { partnerId },
        _count: { _all: true },
      }),
      this.prisma.attribution.count({ where: { partnerId, status: 'CONFIRMED' } }),
      this.prisma.commission.groupBy({
        by: ['status'],
        where: { partnerId },
        _sum: { amount: true },
      }),
      this.prisma.commissionPayout.findMany({
        where: { partnerId, status: 'CONFIRMED' },
        orderBy: { paidAt: 'desc' },
        take: 5,
        select: { number: true, total: true, paidAt: true },
      }),
    ]);
    const sum = (status: string) => commissions.find((c) => c.status === status)?._sum.amount ?? 0;
    return {
      prospects: Object.fromEntries(prospects.map((p) => [p.status, p._count._all])),
      clients,
      commissions: {
        accrued: sum('ACCRUED'),
        validated: sum('VALIDATED'),
        paid: sum('PAID'),
        reversed: sum('REVERSED'),
      },
      recentPayouts: payouts,
    };
  }

  /** Produits commercialisables (statut actif) et leurs offres publiques. */
  products() {
    return this.prisma.saasProduct.findMany({
      where: { status: 'ACTIVE', listed: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        slug: true,
        name: true,
        tagline: true,
        plans: {
          where: { isActive: true },
          select: { name: true, monthlyPrice: true, setupFee: true, currency: true },
        },
      },
    });
  }

  prospects(auth: PartnerContext) {
    return this.prisma.prospect.findMany({
      where: { partnerId: auth.partner.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        companyName: true,
        contactName: true,
        phone: true,
        email: true,
        country: true,
        city: true,
        status: true,
        notes: true,
        protectedUntil: true,
        createdAt: true,
        product: { select: { slug: true, name: true } },
      },
    });
  }

  /**
   * Enregistrement d'un prospect. Doublons détectés côté serveur (téléphone, e-mail, nom
   * d'entreprise normalisés) : un prospect encore réservé par un autre partenaire est refusé sans
   * révéler lequel ; un client déjà attribué aussi.
   */
  async createProspect(auth: PartnerContext, dto: CreateProspectDto) {
    const partnerId = auth.partner.id;
    const keys = {
      normalizedName: normalizeCompanyName(dto.companyName),
      phoneNormalized: phoneMatchKey(dto.phone),
      emailNormalized: normalizeEmail(dto.email),
    };
    return this.prisma.$transaction(async (tx) => {
      // Verrou global léger : deux partenaires enregistrant le même prospect sont sérialisés.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`prospect:${keys.phoneNormalized}`}))`;
      const now = new Date();
      const matches = await tx.prospect.findMany({
        where: {
          OR: [
            { phoneNormalized: keys.phoneNormalized },
            ...(keys.emailNormalized ? [{ emailNormalized: keys.emailNormalized }] : []),
            ...(keys.normalizedName ? [{ normalizedName: keys.normalizedName }] : []),
          ],
        },
        select: { partnerId: true, protectedUntil: true, organizationId: true, status: true },
      });
      if (matches.some((m) => m.partnerId === partnerId && m.status !== 'LOST')) {
        throw new ConflictException({
          code: 'PROSPECT_DUPLICATE',
          message: 'Vous avez déjà enregistré ce prospect.',
        });
      }
      if (
        matches.some(
          (m) =>
            m.partnerId !== partnerId &&
            (m.organizationId !== null || (m.protectedUntil > now && m.status !== 'LOST')),
        )
      ) {
        throw new ConflictException({
          code: 'PROSPECT_ALREADY_ATTRIBUTED',
          message: 'Ce prospect est déjà suivi par un autre partenaire.',
        });
      }
      const product = dto.product
        ? await tx.saasProduct.findFirst({
            where: { slug: dto.product, status: 'ACTIVE' },
            select: { id: true },
          })
        : null;
      const prospect = await tx.prospect.create({
        data: {
          partnerId,
          companyName: dto.companyName,
          contactName: dto.contactName,
          phone: dto.phone,
          email: dto.email ?? null,
          country: dto.country,
          city: dto.city ?? null,
          productId: product?.id ?? null,
          notes: dto.notes ?? null,
          protectedUntil: new Date(now.getTime() + PROSPECT_PROTECTION_DAYS * DAY_MS),
          ...keys,
        },
        select: { id: true, companyName: true, status: true, protectedUntil: true },
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'partner.prospect_created',
          targetType: 'Prospect',
          targetId: prospect.id,
          metadata: { partnerId },
        },
        tx,
      );
      return prospect;
    });
  }

  async updateProspect(auth: PartnerContext, id: string, dto: UpdateProspectDto) {
    const updated = await this.prisma.prospect.updateMany({
      where: { id, partnerId: auth.partner.id, status: { not: 'WON' } },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
    if (updated.count === 0) {
      throw new NotFoundException({ code: 'PROSPECT_NOT_FOUND', message: 'Prospect introuvable.' });
    }
    return { id, ...dto };
  }

  /** Demande de démonstration pour un de ses prospects (suivie par Ocall). */
  async requestDemo(auth: PartnerContext, prospectId: string, message: string) {
    const prospect = await this.prisma.prospect.findFirst({
      where: { id: prospectId, partnerId: auth.partner.id },
    });
    if (!prospect) {
      throw new NotFoundException({ code: 'PROSPECT_NOT_FOUND', message: 'Prospect introuvable.' });
    }
    const retentionUntil = new Date();
    retentionUntil.setUTCMonth(retentionUntil.getUTCMonth() + DEMO_REQUEST_RETENTION_MONTHS);
    return this.prisma.$transaction(async (tx) => {
      const { year, sequence } = await nextPlatformSequence(tx, 'demo');
      const demo = await tx.demoRequest.create({
        data: {
          number: formatDemoRequestNumber(year, sequence),
          name: prospect.contactName,
          company: prospect.companyName,
          country: prospect.country,
          phone: prospect.phone,
          email: prospect.email ?? 'non-renseigne@invalid',
          productId: prospect.productId,
          message,
          partnerId: auth.partner.id,
          prospectId: prospect.id,
          retentionUntil,
        },
        select: { id: true, number: true },
      });
      await tx.prospect.update({ where: { id: prospect.id }, data: { status: 'DEMO_REQUESTED' } });
      return demo;
    });
  }

  demoRequests(auth: PartnerContext) {
    return this.prisma.demoRequest.findMany({
      where: { partnerId: auth.partner.id, anonymizedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, number: true, company: true, status: true, createdAt: true },
    });
  }

  /**
   * Clients apportés (attributions confirmées) : nom de l'organisation et montants encaissés
   * depuis l'attribution. Aucune donnée métier du client.
   */
  async clients(auth: PartnerContext) {
    const attributions = await this.prisma.attribution.findMany({
      where: { partnerId: auth.partner.id, status: 'CONFIRMED' },
      select: {
        confirmedAt: true,
        organization: {
          select: {
            id: true,
            name: true,
            subscriptionPayments: {
              where: { status: 'CONFIRMED' },
              select: { amount: true, paidAt: true },
            },
            subscriptions: { select: { product: { select: { name: true } } } },
          },
        },
      },
    });
    return attributions.map((a) => ({
      name: a.organization.name,
      products: a.organization.subscriptions.map((s) => s.product.name),
      attributedAt: a.confirmedAt,
      collected: a.organization.subscriptionPayments.reduce((t, p) => t + p.amount, 0),
    }));
  }

  commissions(auth: PartnerContext) {
    return this.prisma.commission.findMany({
      where: { partnerId: auth.partner.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        kind: true,
        baseAmount: true,
        rateBps: true,
        amount: true,
        currency: true,
        status: true,
        createdAt: true,
        reversalReason: true,
        organization: { select: { name: true } },
        product: { select: { name: true } },
        payout: { select: { number: true } },
      },
    });
  }

  payouts(auth: PartnerContext) {
    return this.prisma.commissionPayout.findMany({
      where: { partnerId: auth.partner.id, status: 'CONFIRMED' },
      orderBy: { paidAt: 'desc' },
      select: {
        number: true,
        total: true,
        currency: true,
        method: true,
        reference: true,
        paidAt: true,
      },
    });
  }

  /**
   * Factures à payer de ses clients apportés (pour une collecte d'espèces, si le partenaire y est
   * habilité) : numéro, client, reste dû. Rien d'autre.
   */
  async collectibleInvoices(auth: PartnerContext) {
    const orgIds = (
      await this.prisma.attribution.findMany({
        where: { partnerId: auth.partner.id, status: 'CONFIRMED' },
        select: { organizationId: true },
      })
    ).map((a) => a.organizationId);
    const invoices = await this.prisma.invoice.findMany({
      where: { organizationId: { in: orgIds }, status: 'ISSUED' },
      select: {
        id: true,
        number: true,
        total: true,
        currency: true,
        organization: { select: { id: true, name: true } },
        payments: { select: { amount: true, status: true } },
      },
    });
    return invoices.map(({ payments, ...i }) => ({
      ...i,
      remaining: invoiceRemaining(i.total, payments),
    }));
  }

  /** Collectes d'espèces déclarées par le partenaire. */
  cashCollections(auth: PartnerContext) {
    return this.prisma.subscriptionPayment.findMany({
      where: { collectedByPartnerId: auth.partner.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        paidAt: true,
        receiptNumber: true,
        receiptReference: true,
        organization: { select: { name: true } },
        invoice: { select: { number: true } },
      },
    });
  }
}
