import { randomUUID } from 'node:crypto';
import type { SchoolPrismaService } from '../src/modules/school/school-prisma.service';
import { applySmsLedger } from '../src/modules/school/school-sms-ledger';

/**
 * Crédite le portefeuille SMS d'un établissement pour un essai (Sprint S2 : aucun SMS sans solde).
 * Passe par l'écriture unique du registre, comme une correction Ocall.
 */
export async function creditSmsWallet(
  db: SchoolPrismaService,
  organizationId: string,
  schoolId: string,
  credits: number,
): Promise<void> {
  const result = await db.$transaction((tx) =>
    applySmsLedger(tx, {
      organizationId,
      schoolId,
      kind: 'ADJUSTMENT',
      availableDelta: credits,
      reservedDelta: 0,
      idempotencyKey: `test:${randomUUID()}`,
      reason: 'Crédits de test',
    }),
  );
  if (result.status !== 'APPLIED') throw new Error(`Crédit de test refusé : ${result.status}`);
}

/** Nettoyage des tables du portefeuille SMS (avant la suppression des établissements). */
export async function purgeSmsWallets(
  db: SchoolPrismaService,
  where: { organizationId: string | { in: string[] } },
): Promise<void> {
  await db.schoolSmsLedgerEntry.deleteMany({ where });
  await db.schoolSmsTopUpRequest.deleteMany({ where });
  await db.schoolSmsWallet.deleteMany({ where });
}
