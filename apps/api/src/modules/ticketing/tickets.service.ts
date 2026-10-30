import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ticketQrPayload } from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { establishmentScope } from '../../common/tenant-scope';
import { visibleSalesWhere } from '../pos/pos-scope';

const TICKET_NOT_FOUND = { code: 'TICKET_NOT_FOUND', message: 'Billet introuvable.' };

/** Billets émis : consultation (avec QR) par le vendeur, annulation contrôlée. */
@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Billets d'une vente visible du membre (un caissier ne voit que ses ventes). */
  async forSale(auth: TenantContext, saleId: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { ...visibleSalesWhere(auth), id: saleId, activity: 'PARK' },
      select: { id: true },
    });
    if (!sale)
      throw new NotFoundException({ code: 'SALE_NOT_FOUND', message: 'Vente introuvable.' });
    const now = new Date();
    const tickets = await this.prisma.ticket.findMany({
      where: { saleId },
      orderBy: [{ saleLine: { lineNo: 'asc' } }, { saleLine: { id: 'asc' } }, { position: 'asc' }],
      select: {
        id: true,
        visitorName: true,
        status: true,
        pricePaid: true,
        validFrom: true,
        validUntil: true,
        usedAt: true,
        cancelledAt: true,
        cancelReason: true,
        token: true,
        ticketCategory: { select: { id: true, name: true, kind: true } },
      },
    });
    return tickets.map(({ token, ...t }) => ({
      ...t,
      // Expiration constatée à la lecture : le statut en base est mis à jour au prochain scan.
      status: t.status === 'VALID' && t.validUntil < now ? ('EXPIRED' as const) : t.status,
      // Le QR ne contient que le jeton aléatoire : ni nom, ni prix, ni secret applicatif.
      qr: ticketQrPayload(token),
    }));
  }

  /** Annulation d'un billet encore valide. Atomique : un billet scanné entre-temps ne s'annule pas. */
  async cancel(auth: TenantContext, id: string, reason: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: {
        id,
        organizationId: auth.membership.organizationId,
        establishment: establishmentScope(auth),
      },
      select: { id: true, saleId: true, visitorName: true, sale: { select: { number: true } } },
    });
    if (!ticket) throw new NotFoundException(TICKET_NOT_FOUND);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.ticket.updateMany({
        where: { id, status: 'VALID' },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledById: auth.membership.id,
          cancelReason: reason,
        },
      });
      if (count === 0) {
        throw new ConflictException({
          code: 'TICKET_NOT_CANCELLABLE',
          message: 'Seul un billet valide (non utilisé, non expiré) peut être annulé.',
        });
      }
      await this.audit.record(
        {
          organizationId: auth.membership.organizationId,
          actorUserId: auth.user.id,
          action: 'ticket.cancelled',
          targetType: 'Ticket',
          targetId: id,
          metadata: { saleId: ticket.saleId, saleNumber: ticket.sale.number, reason },
        },
        tx,
      );
    });
    return this.prisma.ticket.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        saleId: true,
        visitorName: true,
        status: true,
        cancelledAt: true,
        cancelReason: true,
      },
    });
  }
}
