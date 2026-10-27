import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import { assertKeepsAnActiveOwner } from './owner-protection';

function fakeTx(remainingOwners: number) {
  const queryRaw = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(remainingOwners);
  const tx = {
    $queryRaw: queryRaw,
    organizationMembership: { count },
  } as unknown as Prisma.TransactionClient;
  return { tx, queryRaw, count };
}

describe('assertKeepsAnActiveOwner', () => {
  it("refuse (409 LAST_OWNER) s'il ne resterait aucun propriétaire actif", async () => {
    const { tx } = fakeTx(0);
    await expect(assertKeepsAnActiveOwner(tx, 'org-1', 'm-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("autorise s'il reste au moins un autre propriétaire actif", async () => {
    const { tx } = fakeTx(1);
    await expect(assertKeepsAnActiveOwner(tx, 'org-1', 'm-1')).resolves.toBeUndefined();
  });

  it("verrouille l'organisation avant de compter, et exclut le membre concerné", async () => {
    const { tx, queryRaw, count } = fakeTx(2);
    await assertKeepsAnActiveOwner(tx, 'org-1', 'm-1');
    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(count.mock.invocationCallOrder[0]!);
    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: 'org-1',
        role: 'OWNER',
        isActive: true,
        id: { not: 'm-1' },
      }),
    });
  });
});
