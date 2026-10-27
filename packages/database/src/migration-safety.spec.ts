import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DESTRUCTIVE_APPROVAL_MARKER, findDestructiveStatements } from './migration-safety';

describe('findDestructiveStatements', () => {
  it.each([
    ['DROP TABLE "Organization";', 'DROP TABLE'],
    ['ALTER TABLE "User" DROP COLUMN "email";', 'DROP COLUMN'],
    ['TRUNCATE "AuditLog";', 'TRUNCATE'],
    ['DELETE FROM "Session";', 'DELETE FROM'],
    ['ALTER TABLE "User" ALTER COLUMN "loginId" SET DATA TYPE INTEGER;', 'ALTER COLUMN … TYPE'],
  ])('signale %s', (sql, label) => {
    expect(findDestructiveStatements(sql)).toContain(label);
  });

  it('accepte les migrations additives', () => {
    const sql = `CREATE TABLE "Ticket" ("id" UUID NOT NULL);
      ALTER TABLE "User" ADD COLUMN "phone" TEXT;
      CREATE INDEX "Ticket_id_idx" ON "Ticket"("id");
      ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_fk"; DROP INDEX "Old_idx";`;
    expect(findDestructiveStatements(sql)).toEqual([]);
  });

  it('ignore une instruction citée dans un commentaire', () => {
    expect(findDestructiveStatements('-- ne jamais faire DROP TABLE ici\nSELECT 1;')).toEqual([]);
  });

  it('accepte une suppression explicitement validée', () => {
    expect(
      findDestructiveStatements(`${DESTRUCTIVE_APPROVAL_MARKER}\nDROP TABLE "Legacy";`),
    ).toEqual([]);
  });

  it('aucune migration existante du dépôt n’est destructrice', () => {
    const root = join(__dirname, '..', 'prisma', 'migrations');
    for (const dir of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const sql = readFileSync(join(root, dir.name, 'migration.sql'), 'utf8');
      expect({ migration: dir.name, destructive: findDestructiveStatements(sql) }).toEqual({
        migration: dir.name,
        destructive: [],
      });
    }
  });
});
