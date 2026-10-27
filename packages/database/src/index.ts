/**
 * Point d'entrée unique du client Prisma : les applications importent
 * `@ocall/database` et jamais `@prisma/client` directement.
 */
export * from '@prisma/client';
export { type TestDatabase, resolveTestDatabase } from './test-database';
