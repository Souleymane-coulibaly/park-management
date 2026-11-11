/**
 * `pnpm db:stock:mark-test` : pose le marqueur « test » sur la base Stock de test, une seule fois.
 * Les tests refusent ensuite toute base distante qui ne le porte pas.
 */
import { StockPrismaClient } from '../src';

async function main(): Promise<void> {
  const url = process.env.TEST_STOCK_DATABASE_URL;
  if (!url) throw new Error('TEST_STOCK_DATABASE_URL est absente.');
  const client = new StockPrismaClient({ datasourceUrl: url });
  try {
    await client.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS "_ocall_environment" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL)',
    );
    await client.$executeRawUnsafe(
      `INSERT INTO "_ocall_environment" ("key", "value") VALUES ('environment', 'test') ON CONFLICT ("key") DO NOTHING`,
    );
    console.log('Base Stock de test marquée.');
  } finally {
    await client.$disconnect();
  }
}

void main();
