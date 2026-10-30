import { ConflictException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@ocall/database';
import { addDays, localMoment, splitPrice, zonedMidnight } from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';

/** Jeton aléatoire de 128 bits en base64url (22 caractères) : non prédictible, seul contenu du QR. */
export function newTicketToken(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Émission des billets d'une vente de billetterie. Appelée UNIQUEMENT dans la transaction qui
 * confirme le paiement : aucun billet (donc aucun QR utilisable) n'existe avant.
 * Idempotente : la contrainte d'unicité (ligne de vente, rang) interdit toute double émission.
 */
@Injectable()
export class TicketIssuanceService {
  constructor(private readonly audit: AuditService) {}

  async issueForPaidSale(
    tx: Prisma.TransactionClient,
    auth: TenantContext,
    saleId: string,
  ): Promise<number> {
    const sale = await tx.sale.findUniqueOrThrow({
      where: { id: saleId },
      select: {
        _count: { select: { tickets: true } },
        organizationId: true,
        establishmentId: true,
        number: true,
        establishment: { select: { timezone: true } },
        lines: {
          where: { ticketCategoryId: { not: null } },
          select: {
            id: true,
            ticketCategoryId: true,
            unitPrice: true,
            quantity: true,
            peoplePerUnit: true,
            visitorNames: true,
            ticketCategory: { select: { validityDays: true } },
          },
        },
      },
    });

    if (sale._count.tickets > 0) return 0;

    // Validité : du début du jour de la visite (heure locale) à la fin du dernier jour de validité.
    const now = new Date();
    const visitDay = localMoment(now, sale.establishment.timezone).date;
    const validFrom = zonedMidnight(visitDay, sale.establishment.timezone);

    const data: Prisma.TicketCreateManyInput[] = [];
    for (const line of sale.lines) {
      const people = line.quantity * line.peoplePerUnit;
      if (line.visitorNames.length !== people) {
        throw new ConflictException({
          code: 'VISITOR_NAMES_MISMATCH',
          message: 'Nombre de prénoms incohérent avec la vente.',
        });
      }
      const validityDays = line.ticketCategory?.validityDays ?? 1;
      const validUntil = new Date(
        zonedMidnight(addDays(visitDay, validityDays), sale.establishment.timezone).getTime() - 1,
      );
      const unitShares = splitPrice(line.unitPrice, line.peoplePerUnit);
      for (let position = 0; position < people; position++) {
        data.push({
          organizationId: sale.organizationId,
          establishmentId: sale.establishmentId,
          saleId,
          saleLineId: line.id,
          ticketCategoryId: line.ticketCategoryId!,
          position,
          visitorName: line.visitorNames[position]!,
          token: newTicketToken(),
          pricePaid: unitShares[position % line.peoplePerUnit]!,
          validFrom,
          validUntil,
        });
      }
    }
    await tx.ticket.createMany({ data });
    await this.audit.record(
      {
        organizationId: sale.organizationId,
        actorUserId: auth.user.id,
        action: 'tickets.issued',
        targetType: 'Sale',
        targetId: saleId,
        metadata: { number: sale.number, tickets: data.length },
      },
      tx,
    );
    return data.length;
  }
}
