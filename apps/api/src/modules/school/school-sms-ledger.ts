import type { Prisma } from '@ocall/school-database';

type Tx = Prisma.TransactionClient;

export type SmsLedgerKind = 'TOPUP' | 'RESERVE' | 'CAPTURE' | 'RELEASE' | 'ADJUSTMENT';

export interface SmsLedgerWrite {
  organizationId: string;
  schoolId: string;
  kind: SmsLedgerKind;
  /** Effet sur le solde disponible (positif : crédit, négatif : débit). */
  availableDelta: number;
  /** Effet sur les crédits réservés. */
  reservedDelta: number;
  /** Une même opération n'est jamais appliquée deux fois. */
  idempotencyKey: string;
  messageId?: string | null;
  topUpRequestId?: string | null;
  actorUserId?: string | null;
  reason?: string | null;
}

export type SmsLedgerResult =
  | { status: 'APPLIED'; balance: number; reserved: number; entryId: string }
  | { status: 'DUPLICATE' }
  | { status: 'INSUFFICIENT' };

/**
 * Seule écriture autorisée sur un portefeuille SMS (à appeler dans une transaction) : mise à jour
 * conditionnelle du solde (jamais négatif, verrou de ligne implicite : deux envois simultanés ne
 * dépensent jamais le même crédit) et écriture du registre en ajout seul, dans la même transaction.
 * Clé d'idempotence déjà connue : rien n'est appliqué. Une concurrence sur la même clé échoue à
 * l'insertion (unicité) et annule la transaction entière, solde compris.
 */
export async function applySmsLedger(tx: Tx, w: SmsLedgerWrite): Promise<SmsLedgerResult> {
  const known = await tx.schoolSmsLedgerEntry.findUnique({
    where: {
      organizationId_idempotencyKey: {
        organizationId: w.organizationId,
        idempotencyKey: w.idempotencyKey,
      },
    },
    select: { id: true },
  });
  if (known) return { status: 'DUPLICATE' };
  const now = new Date();
  // Portefeuille créé à la première opération ; la clé étrangère (client, établissement) refuse un
  // établissement d'un autre client.
  await tx.$executeRaw`
    INSERT INTO "SchoolSmsWallet" ("schoolId", "organizationId", "createdAt", "updatedAt")
    VALUES (${w.schoolId}::uuid, ${w.organizationId}::uuid,
            (${now}::timestamptz AT TIME ZONE 'UTC'), (${now}::timestamptz AT TIME ZONE 'UTC'))
    ON CONFLICT ("schoolId") DO NOTHING`;
  const rows = await tx.$queryRaw<{ balance: number; reserved: number }[]>`
    UPDATE "SchoolSmsWallet"
    SET "balance" = "balance" + ${w.availableDelta}::int,
        "reserved" = "reserved" + ${w.reservedDelta}::int,
        "updatedAt" = (${now}::timestamptz AT TIME ZONE 'UTC')
    WHERE "schoolId" = ${w.schoolId}::uuid AND "organizationId" = ${w.organizationId}::uuid
      AND "balance" + ${w.availableDelta}::int >= 0
      AND "reserved" + ${w.reservedDelta}::int >= 0
    RETURNING "balance", "reserved"`;
  const after = rows[0];
  if (!after) return { status: 'INSUFFICIENT' };
  const entry = await tx.schoolSmsLedgerEntry.create({
    data: {
      organizationId: w.organizationId,
      schoolId: w.schoolId,
      kind: w.kind,
      availableDelta: w.availableDelta,
      reservedDelta: w.reservedDelta,
      balanceAfter: after.balance,
      reservedAfter: after.reserved,
      messageId: w.messageId ?? null,
      topUpRequestId: w.topUpRequestId ?? null,
      actorUserId: w.actorUserId ?? null,
      reason: w.reason ?? null,
      idempotencyKey: w.idempotencyKey,
    },
    select: { id: true },
  });
  return { status: 'APPLIED', balance: after.balance, reserved: after.reserved, entryId: entry.id };
}

/**
 * Règle les crédits réservés de messages : consommés (envoi accepté par le fournisseur) ou rendus
 * (échec définitif, annulation). Le passage d'état du message est conditionnel : un message n'est
 * réglé qu'une fois, même si deux traitements se recouvrent.
 */
export async function settleSmsCredits(
  tx: Tx,
  ids: string[],
  outcome: 'CAPTURE' | 'RELEASE',
): Promise<number> {
  if (ids.length === 0) return 0;
  const reserved = await tx.schoolSmsMessage.findMany({
    where: { id: { in: ids }, creditState: 'RESERVED' },
    select: { id: true, organizationId: true, schoolId: true, creditsReserved: true },
  });
  let settled = 0;
  for (const m of reserved) {
    const moved = await tx.schoolSmsMessage.updateMany({
      where: { id: m.id, creditState: 'RESERVED' },
      data: { creditState: outcome === 'CAPTURE' ? 'CAPTURED' : 'RELEASED' },
    });
    if (moved.count !== 1 || m.creditsReserved === 0) continue;
    const n = m.creditsReserved;
    await applySmsLedger(tx, {
      organizationId: m.organizationId,
      schoolId: m.schoolId,
      kind: outcome,
      availableDelta: outcome === 'CAPTURE' ? 0 : n,
      reservedDelta: -n,
      idempotencyKey: `${outcome.toLowerCase()}:${m.id}`,
      messageId: m.id,
    });
    settled += 1;
  }
  return settled;
}
