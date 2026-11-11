import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DESTRUCTIVE_APPROVAL_MARKER,
  databaseIdentity,
  findDestructiveStatements,
  factureMigrationTargetProblem,
  schoolMigrationTargetProblem,
} from './migration-safety';

describe('schoolMigrationTargetProblem', () => {
  const suite = 'postgresql://u:p@ep-suite-pooler.neon.tech/neondb';
  const school = 'postgresql://u:p@ep-school-pooler.neon.tech/neondb';
  const schoolDirect = 'postgresql://u:p@ep-school.neon.tech/neondb';

  it('accepte une base School distincte, en URL poolée et directe', () => {
    expect(
      schoolMigrationTargetProblem({
        DATABASE_URL: suite,
        SCHOOL_DATABASE_URL: school,
        SCHOOL_DIRECT_URL: schoolDirect,
      }),
    ).toBeNull();
  });

  it('refuse une URL directe qui désigne la base Suite', () => {
    expect(
      schoolMigrationTargetProblem({
        DATABASE_URL: suite,
        SCHOOL_DATABASE_URL: school,
        SCHOOL_DIRECT_URL: 'postgresql://u:p@ep-suite.neon.tech/neondb',
      }),
    ).toContain('différentes');
  });

  it('reconnaît la même base malgré le port explicite ou l’écriture de l’hôte', () => {
    expect(
      schoolMigrationTargetProblem({
        DATABASE_URL: 'postgresql://u:p@db/suite',
        SCHOOL_DATABASE_URL: 'postgresql://u:p@DB:5432/suite',
      }),
    ).toContain('distincte');
    expect(databaseIdentity('postgresql://u:p@localhost/a')).toBe(
      databaseIdentity('postgresql://v:q@127.0.0.1:5432/a?sslmode=disable'),
    );
    expect(databaseIdentity('postgresql://u:p@db:5433/a')).not.toBe(
      databaseIdentity('postgresql://u:p@db:5432/a'),
    );
  });

  it('refuse deux URL School identiques à la base Suite', () => {
    expect(
      schoolMigrationTargetProblem({ DIRECT_URL: suite, SCHOOL_DATABASE_URL: suite }),
    ).toContain('distincte');
  });
});

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

describe('factureMigrationTargetProblem', () => {
  const suite = 'postgresql://u:p@ep-suite-pooler.neon.tech/neondb';
  const school = 'postgresql://u:p@ep-school-pooler.neon.tech/neondb';
  const facture = 'postgresql://u:p@ep-facture-pooler.neon.tech/neondb';

  it('accepte une base Facture distincte des bases Suite et School', () => {
    expect(
      factureMigrationTargetProblem({
        DATABASE_URL: suite,
        SCHOOL_DATABASE_URL: school,
        FACTURE_DATABASE_URL: facture,
        FACTURE_DIRECT_URL: 'postgresql://u:p@ep-facture.neon.tech/neondb',
      }),
    ).toBeNull();
  });

  it('refuse une base absente, deux URL divergentes, ou la base Suite ou School', () => {
    expect(factureMigrationTargetProblem({ DATABASE_URL: suite })).toContain('obligatoire');
    expect(
      factureMigrationTargetProblem({
        FACTURE_DATABASE_URL: facture,
        FACTURE_DIRECT_URL: 'postgresql://u:p@ep-autre.neon.tech/neondb',
      }),
    ).toContain('différentes');
    expect(
      factureMigrationTargetProblem({ DATABASE_URL: suite, FACTURE_DATABASE_URL: suite }),
    ).toContain('distincte');
    expect(
      factureMigrationTargetProblem({
        DATABASE_URL: suite,
        SCHOOL_DATABASE_URL: school,
        FACTURE_DATABASE_URL: 'postgresql://v:q@EP-SCHOOL-POOLER.neon.tech:5432/neondb',
      }),
    ).toContain('distincte');
  });
});
