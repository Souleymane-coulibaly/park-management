import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@ocall/school-database';
import { AUDIT_TARGET_SCOPES, UNSCOPED_AUDIT_TARGETS } from './school-audit-scope';

/** Types de cibles écrits dans le journal par le module School (log, recordDecision, audit.record). */
function auditedTypes(): Set<string> {
  const types = new Set<string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (path.endsWith('.ts') && !path.endsWith('.spec.ts')) {
        const source = readFileSync(path, 'utf8');
        for (const m of source.matchAll(
          /(?:'school\.[a-z_.]+'|`school\.[^`]+`),\s*'([A-Z]\w+)'/g,
        )) {
          types.add(m[1]!);
        }
        for (const m of source.matchAll(/targetType:\s*'([A-Z]\w+)'/g)) types.add(m[1]!);
      }
    }
  };
  walk(__dirname);
  return types;
}

describe('journal d’audit School : rattachement des cibles à leur établissement', () => {
  it('tout type journalisé est rattachable ou déclaré non rattachable', () => {
    const types = auditedTypes();
    expect(types.size).toBeGreaterThan(20);
    const missing = [...types].filter(
      (t) => !(t in AUDIT_TARGET_SCOPES) && !UNSCOPED_AUDIT_TARGETS.includes(t),
    );
    expect(missing).toEqual([]);
  });

  it('chaque rattachement désigne un modèle existant de la base School', () => {
    const delegates = new Set(
      Object.values(Prisma.ModelName).map((m) => m.charAt(0).toLowerCase() + m.slice(1)),
    );
    for (const [type, scope] of Object.entries(AUDIT_TARGET_SCOPES)) {
      expect({ type, exists: delegates.has(scope.model) }).toEqual({ type, exists: true });
    }
  });

  it('filtre toujours borné à l’organisation', () => {
    const filter = { organizationId: 'org', schoolId: { in: ['a'] } };
    for (const scope of Object.values(AUDIT_TARGET_SCOPES)) {
      expect(scope.where(filter)).toMatchObject({ organizationId: 'org' });
    }
  });
});
