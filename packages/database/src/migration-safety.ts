/**
 * Détection des instructions SQL destructrices dans les migrations Prisma.
 * Les migrations d'Ocall Park doivent être additives : une instruction qui supprime des données
 * ou une structure (table, colonne, schéma) bloque le déploiement, sauf validation explicite
 * marquée dans le fichier par le commentaire `-- ocall:destructive-approved`.
 */
export const DESTRUCTIVE_APPROVAL_MARKER = '-- ocall:destructive-approved';

const DESTRUCTIVE_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: 'DROP TABLE', pattern: /\bDROP\s+TABLE\b/i },
  { label: 'DROP SCHEMA', pattern: /\bDROP\s+SCHEMA\b/i },
  { label: 'DROP DATABASE', pattern: /\bDROP\s+DATABASE\b/i },
  { label: 'DROP TYPE', pattern: /\bDROP\s+TYPE\b/i },
  { label: 'DROP COLUMN', pattern: /\bDROP\s+COLUMN\b/i },
  { label: 'TRUNCATE', pattern: /\bTRUNCATE\b/i },
  { label: 'DELETE FROM', pattern: /\bDELETE\s+FROM\b/i },
  { label: 'ALTER COLUMN … TYPE', pattern: /\bALTER\s+COLUMN\s+"?\w+"?\s+(SET\s+DATA\s+)?TYPE\b/i },
];

/** Retire les commentaires SQL pour ne pas signaler une instruction simplement mentionnée. */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

export function findDestructiveStatements(sql: string): string[] {
  if (sql.includes(DESTRUCTIVE_APPROVAL_MARKER)) return [];
  const code = stripComments(sql);
  return DESTRUCTIVE_PATTERNS.filter(({ pattern }) => pattern.test(code)).map(({ label }) => label);
}
