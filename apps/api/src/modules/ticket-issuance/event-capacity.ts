import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import { placesLeft } from '@ocall/shared';

type Db = Pick<Prisma.TransactionClient, 'ticket'>;

/** Places vendues d'une séance : billets émis non annulés (une place = un billet individuel). */
export interface SessionSales {
  total: number;
  byCategory: Map<string, number>;
}

/**
 * Billets non annulés par séance et par tarif. Un billet annulé (individuellement ou par l'annulation
 * de la séance) libère sa place.
 */
export async function soldBySession(
  db: Db,
  sessionIds: string[],
): Promise<Map<string, SessionSales>> {
  const result = new Map<string, SessionSales>();
  for (const id of sessionIds) result.set(id, { total: 0, byCategory: new Map() });
  if (sessionIds.length === 0) return result;
  const rows = await db.ticket.groupBy({
    by: ['eventSessionId', 'ticketCategoryId'],
    where: { eventSessionId: { in: sessionIds }, status: { not: 'CANCELLED' } },
    _count: { _all: true },
  });
  for (const r of rows) {
    const entry = result.get(r.eventSessionId!)!;
    entry.total += r._count._all;
    entry.byCategory.set(r.ticketCategoryId, r._count._all);
  }
  return result;
}

/**
 * Verrou de la séance pour la durée de la transaction : deux encaissements simultanés pour la même
 * séance sont traités l'un après l'autre, le second voit les billets émis par le premier.
 */
export async function lockEventSession(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "ParkEventSession" WHERE id = ${id}::uuid FOR UPDATE`;
}

/**
 * Refuse une demande qui dépasse la capacité de la séance ou le quota d'un tarif. Les places sont
 * comptées en billets individuels (une formule famille de 4 = 4 places).
 */
export function assertPlaces(
  session: { capacity: number },
  sold: SessionSales,
  requested: Map<string, number>,
  tariffs: Map<string, { name: string; sessionQuota: number | null }>,
): void {
  const wanted = [...requested.values()].reduce((a, b) => a + b, 0);
  const left = placesLeft(session.capacity, sold.total);
  if (wanted > left) {
    throw new ConflictException({
      code: 'EVENT_SOLD_OUT',
      message:
        left === 0
          ? 'Cette séance est complète.'
          : `Il ne reste que ${left} place(s) pour cette séance.`,
      details: { placesLeft: left },
    });
  }
  for (const [categoryId, count] of requested) {
    const tariff = tariffs.get(categoryId);
    if (!tariff?.sessionQuota) continue;
    const tariffLeft = placesLeft(tariff.sessionQuota, sold.byCategory.get(categoryId) ?? 0);
    if (count > tariffLeft) {
      throw new ConflictException({
        code: 'EVENT_TARIFF_SOLD_OUT',
        message:
          tariffLeft === 0
            ? `« ${tariff.name} » : plus aucune place à ce tarif pour cette séance.`
            : `« ${tariff.name} » : il ne reste que ${tariffLeft} place(s) à ce tarif pour cette séance.`,
        details: { ticketCategoryId: categoryId, placesLeft: tariffLeft },
      });
    }
  }
}
