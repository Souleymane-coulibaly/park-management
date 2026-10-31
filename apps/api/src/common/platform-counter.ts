import type { Prisma } from '@ocall/database';
import { localMoment } from '@ocall/shared';

/** Fuseau de référence de la plateforme (Ocall, Mali) : numérotation annuelle, statistiques. */
export const PLATFORM_TIMEZONE = 'Africa/Bamako';

/**
 * Numéro séquentiel annuel de la plateforme (factures, demandes de support), atomique : deux
 * transactions simultanées obtiennent des numéros distincts. À appeler dans la transaction qui
 * crée l'objet numéroté.
 */
export async function nextPlatformSequence(
  tx: Prisma.TransactionClient,
  prefix: 'invoice' | 'support' | 'receipt' | 'remittance' | 'demo' | 'payout',
): Promise<{ year: number; sequence: number }> {
  const year = Number(localMoment(new Date(), PLATFORM_TIMEZONE).date.slice(0, 4));
  const [counter] = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "PlatformCounter" ("key", "value") VALUES (${`${prefix}:${year}`}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "PlatformCounter"."value" + 1
    RETURNING "value"`;
  return { year, sequence: Number(counter!.value) };
}
