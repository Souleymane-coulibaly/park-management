/**
 * Client de la base Ocall Stock. Généré à part (`node_modules/.prisma/stock-client`) : il ne partage ni
 * schéma, ni migrations, ni identifiants de connexion avec les bases Ocall Suite, School et Facture.
 */
export * from '.prisma/stock-client';
export { PrismaClient as StockPrismaClient } from '.prisma/stock-client';
export { purgeStockOrganizations } from './purge';
