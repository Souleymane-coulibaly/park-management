/**
 * Point d'entrée unique du client Prisma : les applications importent
 * `@ocall/database` et jamais `@prisma/client` directement.
 */
export * from '@prisma/client';
export {
  databaseIdentity,
  findDestructiveStatements,
  factureMigrationTargetProblem,
  stockMigrationTargetProblem,
  schoolMigrationTargetProblem,
} from './migration-safety';
export {
  type TestDatabase,
  TEST_MARKER_QUERY,
  assertTestDatabaseMarker,
  REMOTE_TEST_OPT_IN,
  EPHEMERAL_OPT_IN,
  assertDisposableTestDatabases,
  isLocalDatabase,
  resolveTestDatabase,
} from './test-database';
