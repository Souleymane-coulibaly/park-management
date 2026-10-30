import type { Prisma } from '@ocall/database';
import type { PreparationStatus } from '@ocall/shared';

export interface OrderEventInput {
  organizationId: string;
  establishmentId: string;
  saleId: string;
  /** created, updated, sent_to_kitchen, preparation_started, ready, served, paid, cancelled, qr_accepted */
  type: string;
  fromStatus?: PreparationStatus | null;
  toStatus?: PreparationStatus | null;
  actorMembershipId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/** Ajoute un évènement à l'historique d'une commande de restaurant (dans la transaction appelante). */
export async function recordOrderEvent(
  tx: Prisma.TransactionClient,
  event: OrderEventInput,
): Promise<void> {
  await tx.orderEvent.create({
    data: {
      organizationId: event.organizationId,
      establishmentId: event.establishmentId,
      saleId: event.saleId,
      type: event.type,
      fromStatus: event.fromStatus ?? null,
      toStatus: event.toStatus ?? null,
      actorMembershipId: event.actorMembershipId ?? null,
      metadata: event.metadata,
    },
  });
}
