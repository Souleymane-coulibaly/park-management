import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import { type PassRules, localMoment, periodEndDate, renewalStartDate } from '@ocall/shared';

type Tx = Prisma.TransactionClient;

/** Date locale (AAAA-MM-JJ) d'une colonne `@db.Date`. */
export const dbDay = (d: Date): string => d.toISOString().slice(0, 10);
export const toDay = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

/** Conservation de la photo d'un titulaire : un an après la fin de validité du pass. */
export const PHOTO_RETENTION_AFTER_END_DAYS = 365;

/**
 * Verrou de ligne d'un pass (SELECT … FOR UPDATE) : sérialise les passages simultanés (quotas partagés
 * entre parcs), les renouvellements et les changements de statut d'un même pass.
 */
export async function lockPass(tx: Tx, passId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Pass" WHERE id = ${passId}::uuid FOR UPDATE`;
}

/** La photo d'un titulaire est conservée tant que le pass est valable, puis un an. */
export async function retainHolderPhoto(tx: Tx, photoFileId: string | null, endDate: string) {
  if (!photoFileId) return;
  const until = new Date(toDay(endDate).getTime() + PHOTO_RETENTION_AFTER_END_DAYS * 86_400_000);
  await tx.storedFile.updateMany({
    where: { id: photoFileId, deletedAt: null },
    data: { retentionUntil: until },
  });
}

/**
 * Ocall Parc sprint 8 — activation des pass d'une vente, appelée dans la transaction qui confirme le
 * paiement (comme l'émission des billets) : aucun pass n'est utilisable avant. Première période : le
 * pass devient actif aux dates choisies à la vente. Renouvellement : la période est datée maintenant,
 * à l'échéance précédente ou au jour du paiement si le pass a expiré (décision D6), sans chevauchement.
 * Idempotente : seules les périodes encore en attente sont traitées.
 */
export async function activatePassesForPaidSale(
  tx: Tx,
  actor: { userId: string; membershipId: string },
  saleId: string,
): Promise<number> {
  const periods = await tx.passPeriod.findMany({
    where: { saleId, status: 'PENDING' },
    select: { id: true, passId: true, isRenewal: true, price: true },
    orderBy: { createdAt: 'asc' },
  });
  if (periods.length === 0) return 0;
  const sale = await tx.sale.findUniqueOrThrow({
    where: { id: saleId },
    select: { number: true, establishment: { select: { timezone: true } } },
  });
  const now = new Date();
  const paymentDay = localMoment(now, sale.establishment.timezone).date;

  for (const period of periods) {
    await lockPass(tx, period.passId);
    const pass = await tx.pass.findUniqueOrThrow({
      where: { id: period.passId },
      select: {
        id: true,
        organizationId: true,
        status: true,
        startDate: true,
        endDate: true,
        rules: true,
        photoFileId: true,
      },
    });
    if (pass.status === 'CANCELLED') {
      throw new ConflictException({
        code: 'PASS_CANCELLED',
        message: 'Ce pass a été annulé : annulez la vente au lieu de l’encaisser.',
      });
    }
    const rules = pass.rules as unknown as PassRules;
    let startDate: string;
    let endDate: string;
    if (!period.isRenewal) {
      startDate = dbDay(pass.startDate);
      endDate = dbDay(pass.endDate);
      if (endDate < paymentDay) {
        throw new ConflictException({
          code: 'PASS_DATES_PASSED',
          message: 'La période choisie pour ce pass est déjà terminée : annulez la vente.',
        });
      }
    } else {
      startDate = renewalStartDate(dbDay(pass.endDate), paymentDay);
      endDate = periodEndDate(startDate, rules.durationUnit, rules.durationValue);
    }
    await tx.passPeriod.update({
      where: { id: period.id },
      data: { status: 'PAID', paidAt: now, startDate: toDay(startDate), endDate: toDay(endDate) },
    });
    await tx.pass.update({
      where: { id: pass.id },
      data: period.isRenewal
        ? { endDate: toDay(endDate) }
        : { status: pass.status === 'PENDING' ? 'ACTIVE' : pass.status },
    });
    await retainHolderPhoto(tx, pass.photoFileId, endDate);
    await tx.passEvent.create({
      data: {
        organizationId: pass.organizationId,
        passId: pass.id,
        type: period.isRenewal ? 'RENEWED' : 'ACTIVATED',
        actorMembershipId: actor.membershipId,
        metadata: { saleNumber: sale.number, startDate, endDate, price: period.price },
      },
    });
  }
  return periods.length;
}

/**
 * Annulation d'une vente non payée : ses périodes de pass en attente sont annulées ; un pass dont
 * c'était la première période (jamais activé) est annulé avec elle. Rien n'est supprimé.
 */
export async function cancelPendingPassesForSale(
  tx: Tx,
  actor: { membershipId: string },
  saleId: string,
): Promise<void> {
  const periods = await tx.passPeriod.findMany({
    where: { saleId, status: 'PENDING' },
    select: { id: true, passId: true, isRenewal: true },
  });
  for (const period of periods) {
    await lockPass(tx, period.passId);
    await tx.passPeriod.update({ where: { id: period.id }, data: { status: 'CANCELLED' } });
    if (period.isRenewal) continue;
    const { count } = await tx.pass.updateMany({
      where: { id: period.passId, status: 'PENDING' },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledById: actor.membershipId,
        cancelReason: 'Vente annulée avant paiement',
        linkTokenHash: null,
      },
    });
    if (count > 0) {
      const pass = await tx.pass.findUniqueOrThrow({
        where: { id: period.passId },
        select: { organizationId: true },
      });
      await tx.passEvent.create({
        data: {
          organizationId: pass.organizationId,
          passId: period.passId,
          type: 'CANCELLED',
          actorMembershipId: actor.membershipId,
          reason: 'Vente annulée avant paiement',
        },
      });
    }
  }
}
