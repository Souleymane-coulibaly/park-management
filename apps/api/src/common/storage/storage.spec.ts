import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { signFileToken, verifyFileToken } from './signed-url';
import {
  LocalStorageProvider,
  assertStorageKey,
  isPrivateKey,
  privateKey,
} from './storage-provider';

const ORG = '0b2f6c1e-1d2a-4b4e-9a7c-2f1d3c4b5a69';
const EST = '1c3e7d2f-2e3b-4c5f-8b6d-3e2f4d5c6b7a';
const FILE = '2d4f8e3a-3f4c-4d6a-9c7e-4f3a5e6d7c8b';

describe('Stockage — clés générées par le serveur uniquement', () => {
  it('clés privées isolées par organisation et établissement', () => {
    expect(privateKey(ORG, EST, FILE, 'pdf')).toBe(`org/${ORG}/${EST}/${FILE}.pdf`);
    expect(privateKey(ORG, null, FILE, 'png')).toBe(`org/${ORG}/_/${FILE}.png`);
    expect(isPrivateKey(`org/${ORG}/_/${FILE}.png`)).toBe(true);
    expect(isPrivateKey(`${FILE}.png`)).toBe(false);
  });

  it('refuse toute clé non conforme (traversée, extension, structure)', () => {
    for (const bad of [
      `org/${ORG}/../${FILE}.pdf`,
      `org/${ORG}/_/${FILE}.svg`,
      `org/${ORG}/${FILE}.pdf`,
      `org/not-a-uuid/_/${FILE}.pdf`,
      `/org/${ORG}/_/${FILE}.pdf`,
      `org\\${ORG}\\_\\${FILE}.pdf`,
    ]) {
      expect(() => assertStorageKey(bad)).toThrow('Clé de média invalide.');
    }
  });

  it('local : fichiers privés en sous-répertoires, sans écrasement, suppression', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ocall-private-'));
    const storage = new LocalStorageProvider(dir);
    const key = privateKey(ORG, EST, FILE, 'pdf');
    await storage.put(key, Buffer.from('%PDF-'));
    expect((await storage.get(key))?.toString()).toBe('%PDF-');
    await expect(storage.put(key, Buffer.from('autre'))).rejects.toThrow();
    expect(await storage.check()).toBe(true);
    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
    expect(await readdir(join(dir, 'org', ORG, EST))).toEqual([]);
  });
});

describe('Stockage — liens temporaires signés', () => {
  const key = randomBytes(32);
  const now = 1_800_000_000;
  const claims = { f: FILE, o: ORG, u: EST, e: now + 300 };

  it('jeton valide avant expiration, refusé après', () => {
    const token = signFileToken(claims, key);
    expect(verifyFileToken(token, key, now)).toEqual(claims);
    expect(verifyFileToken(token, key, now + 301)).toBeNull();
  });

  it('refuse une signature d’une autre clé, une charge modifiée, un jeton malformé', () => {
    const token = signFileToken(claims, key);
    expect(verifyFileToken(token, randomBytes(32), now)).toBeNull();
    const [, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims, o: EST })).toString('base64url');
    expect(verifyFileToken(`${forged}.${sig}`, key, now)).toBeNull();
    for (const bad of ['', 'abc', 'a.b.c', `${token}x`, 'x'.repeat(2000)]) {
      expect(verifyFileToken(bad, key, now)).toBeNull();
    }
  });
});
