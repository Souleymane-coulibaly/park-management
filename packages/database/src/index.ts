/**
 * Point d'entrée unique du client Prisma : les applications importent
 * `@ocall/database` et jamais `@prisma/client` directement.
 */
export * from '@prisma/client';
export { findDestructiveStatements, schoolMigrationTargetProblem } from './migration-safety';
export {
  type TestDatabase,
  TEST_MARKER_QUERY,
  assertTestDatabaseMarker,
  isLocalDatabase,
  resolveTestDatabase,
} from './test-database';
