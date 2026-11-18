import { ConflictException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@ocall/database';
import { addDays, eventTicketWindow, localMoment, splitPrice, zonedMidnight } from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { assertPlaces, lockEventSession, soldBySession } from './event-capacity';
import { activatePassesForPaidSale } from './pass-activation';

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
            eventSessionId: true,
            ticketCategory: { select: { validityDays: true, name: true, sessionQuota: true } },
          },
        },
      },
    });

    // Sprint 8 : les pass de la vente sont activés dans la même transaction que le paiement.
    await activatePassesForPaidSale(
      tx,
      { userId: auth.user.id, membershipId: auth.membership.id },
      saleId,
    );

    if (sale._count.tickets > 0 || sale.lines.length === 0) return 0;

    // Validité : du début du jour de la visite (heure locale) à la fin du dernier jour de validité.
    const now = new Date();
    const visitDay = localMoment(now, sale.establishment.timezone).date;
    const validFrom = zonedMidnight(visitDay, sale.establishment.timezone);

    const windows = await this.reserveEventPlaces(tx, sale.lines, now);

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
      // Billet d'événement : valable pour sa séance (tolérance d'entrée comprise), pas le jour de la vente.
      const eventWindow = line.eventSessionId ? windows.get(line.eventSessionId)! : null;
      const lineValidFrom = eventWindow?.validFrom ?? validFrom;
      const validUntil =
        eventWindow?.validUntil ??
        new Date(
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
          validFrom: lineValidFrom,
          validUntil,
          eventSessionId: line.eventSessionId,
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
        metadata: {
          number: sale.number,
          tickets: data.length,
          ...(windows.size > 0 ? { eventSessionIds: [...windows.keys()] } : {}),
        },
      },
      tx,
    );
    return data.length;
  }

  /**
   * Réservation des places des séances vendues, atomique avec l'encaissement : chaque séance est
   * verrouillée (ordre stable, sans interblocage), puis la capacité et les quotas de tarif sont
   * vérifiés sur les billets déjà émis. Un refus annule toute la transaction : rien n'est encaissé,
   * aucun billet n'est émis. Renvoie la fenêtre de validité des billets de chaque séance.
   */
  private async reserveEventPlaces(
    tx: Prisma.TransactionClient,
    lines: {
      eventSessionId: string | null;
      ticketCategoryId: string | null;
      quantity: number;
      peoplePerUnit: number;
      ticketCategory: { name: string; sessionQuota: number | null } | null;
    }[],
    now: Date,
  ): Promise<Map<string, { validFrom: Date; validUntil: Date }>> {
    const windows = new Map<string, { validFrom: Date; validUntil: Date }>();
    const sessionIds = [
      ...new Set(lines.map((l) => l.eventSessionId).filter((id): id is string => !!id)),
    ].sort();
    for (const id of sessionIds) await lockEventSession(tx, id);
    if (sessionIds.length === 0) return windows;
    const sessions = await tx.parkEventSession.findMany({
      where: { id: { in: sessionIds } },
      select: {
        id: true,
        status: true,
        capacity: true,
        startsAt: true,
        endsAt: true,
        event: { select: { entryOpensBeforeMinutes: true, entryClosesAfterMinutes: true } },
      },
    });
    const sold = await soldBySession(tx, sessionIds);
    for (const session of sessions) {
      if (session.status !== 'SCHEDULED') {
        throw new ConflictException({
          code: 'EVENT_SESSION_CANCELLED',
          message: 'Cette séance a été annulée : la vente ne peut pas être encaissée.',
        });
      }
      if (session.endsAt <= now) {
        throw new ConflictException({
          code: 'EVENT_SESSION_ENDED',
          message: 'Cette séance est terminée : la vente ne peut pas être encaissée.',
        });
      }
      const requested = new Map<string, number>();
      const tariffs = new Map<string, { name: string; sessionQuota: number | null }>();
      for (const line of lines.filter((l) => l.eventSessionId === session.id)) {
        const people = line.quantity * line.peoplePerUnit;
        requested.set(
          line.ticketCategoryId!,
          (requested.get(line.ticketCategoryId!) ?? 0) + people,
        );
        if (line.ticketCategory) tariffs.set(line.ticketCategoryId!, line.ticketCategory);
      }
      assertPlaces(session, sold.get(session.id)!, requested, tariffs);
      windows.set(
        session.id,
        eventTicketWindow(
          session,
          session.event.entryOpensBeforeMinutes,
          session.event.entryClosesAfterMinutes,
        ),
      );
    }
    return windows;
  }
}
