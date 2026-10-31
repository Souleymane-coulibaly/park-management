import { JsonLogger, redact } from './json-logger';

describe('Journaux structurés : aucun secret écrit', () => {
  it('masque identifiants de base, jetons, clés d’API, mots de passe, liens signés, cookie', () => {
    const line = redact(
      'db postgresql://neondb_owner:S3cr3t@ep-x.neon.tech/neondb ' +
        'Authorization: Bearer abc.def.ghi key sk-proj_ABCDEFGH1234 ' +
        '{"password":"Bamako2026","token":"t0k"} GET /api/v1/files/eyJmIjoi.c2ln ocp_session=zzz',
    );
    for (const secret of [
      'S3cr3t',
      'abc.def.ghi',
      'sk-proj_ABCDEFGH1234',
      'Bamako2026',
      't0k',
      'eyJmIjoi',
      'zzz',
    ]) {
      expect(line).not.toContain(secret);
    }
    expect(line).toContain('postgresql://***:***@ep-x.neon.tech');
    expect(line).toContain('/api/v1/files/***');
  });

  it('une ligne JSON par événement, avec niveau et contexte', () => {
    const lines: string[] = [];
    const logger = new JsonLogger((l) => lines.push(l));
    logger.log('API prête', 'Bootstrap');
    logger.error('Échec postgresql://u:p@h/db', 'stack', 'Prisma');
    const [first, second] = lines.map((l) => JSON.parse(l) as Record<string, string>);
    expect(first).toMatchObject({ level: 'log', context: 'Bootstrap', message: 'API prête' });
    expect(second).toMatchObject({ level: 'error', context: 'Prisma', detail: 'stack' });
    expect(second?.message).not.toContain(':p@');
  });
});
