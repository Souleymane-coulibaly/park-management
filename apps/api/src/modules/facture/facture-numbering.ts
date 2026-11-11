import type { Prisma } from '@ocall/facture-database';
import { type FactureDocumentType, formatFactureNumber } from '@ocall/shared';

/**
 * Attribue le numéro suivant d'un document, DANS la transaction qui l'émet : unique, séquentiel et
 * chronologique par organisation, type et année. L'incrément est atomique (une ligne de compteur
 * verrouillée par l'upsert) : deux émissions simultanées reçoivent deux rangs consécutifs, et une
 * émission annulée annule aussi son incrément (aucun trou). L'année est celle de l'émission, en UTC
 * (heure du Mali).
 */
export async function allocateFactureNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
  type: FactureDocumentType,
  issuedAt: Date,
): Promise<{ number: string; year: number; sequence: number }> {
  const year = issuedAt.getUTCFullYear();
  const [row] = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "FactureNumberCounter" ("organizationId", "type", "year", "value", "updatedAt")
    VALUES (${organizationId}::uuid, ${type}::"FactureDocumentType", ${year}, 1, now())
    ON CONFLICT ("organizationId", "type", "year")
    DO UPDATE SET "value" = "FactureNumberCounter"."value" + 1, "updatedAt" = now()
    RETURNING "value"`;
  const sequence = Number(row!.value);
  return { number: formatFactureNumber(type, year, sequence), year, sequence };
}
