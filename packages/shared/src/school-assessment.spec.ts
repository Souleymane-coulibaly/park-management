import {
  DEFAULT_SCHOOL_GRADING_RULES,
  type SchoolGradingRules,
  validateGradingRules,
} from './school';
import {
  type ResultsInput,
  computeClassResults,
  gradeEntryError,
  policyForPeriod,
  resolveGradingRules,
  roundScore,
} from './school-assessment';

const rules = (patch: Partial<SchoolGradingRules> = {}): SchoolGradingRules => ({
  ...DEFAULT_SCHOOL_GRADING_RULES,
  ...patch,
  ranking: { ...DEFAULT_SCHOOL_GRADING_RULES.ranking, ...patch.ranking },
});

/** Deux matières : maths (coef 3), français (coef 2) ; évaluations notées sur 20 sauf mention. */
function input(patch: Partial<ResultsInput> = {}): ResultsInput {
  return {
    rules: rules(),
    subjects: [
      { id: 'maths', coefficient: 3 },
      { id: 'fr', coefficient: 2 },
    ],
    evaluations: [
      { id: 'm1', subjectId: 'maths', maxScore: 20, coefficient: 1, groupId: null },
      { id: 'm2', subjectId: 'maths', maxScore: 10, coefficient: 2, groupId: null },
      { id: 'f1', subjectId: 'fr', maxScore: 20, coefficient: 1, groupId: null },
    ],
    grades: [],
    students: [{ id: 'a', groupIds: [] }],
    ...patch,
  };
}

const scored = (evaluationId: string, studentId: string, score: number) => ({
  evaluationId,
  studentId,
  status: 'SCORED' as const,
  score,
});

describe('Ocall School — moyennes et coefficients', () => {
  it('moyenne de matière pondérée par les coefficients des évaluations, ramenée au barème', () => {
    const r = computeClassResults(
      input({ grades: [scored('m1', 'a', 12), scored('m2', 'a', 8), scored('f1', 'a', 15)] }),
    );
    const [maths, fr] = r.students[0]!.subjects;
    // m1 = 12/20, m2 = 8/10 → 16/20 ; (12×1 + 16×2) / 3 = 14,666… → 14,67
    expect(maths!.average).toBe(14.67);
    expect(fr!.average).toBe(15);
    // Moyenne générale sur les moyennes arrondies : (14,67×3 + 15×2) / 5 = 14,802 → 14,8
    expect(r.students[0]!.generalAverage).toBe(14.8);
    expect(r.students[0]!.passed).toBe(true);
  });

  it('barème de l’établissement : sur 10, une note de 15/20 vaut 7,5', () => {
    const r = computeClassResults(
      input({ rules: rules({ scale: 10, passMark: 5 }), grades: [scored('f1', 'a', 15)] }),
    );
    expect(r.students[0]!.subjects[1]!.average).toBe(7.5);
    expect(r.students[0]!.generalAverage).toBe(7.5);
  });

  it('une matière de coefficient 0 n’entre pas dans la moyenne générale', () => {
    const r = computeClassResults(
      input({
        subjects: [
          { id: 'maths', coefficient: 0 },
          { id: 'fr', coefficient: 2 },
        ],
        grades: [scored('m1', 'a', 2), scored('f1', 'a', 16)],
      }),
    );
    expect(r.students[0]!.subjects[0]!.average).toBe(2);
    expect(r.students[0]!.generalAverage).toBe(16);
  });

  it('nombre de décimales réglable, arrondi au plus proche', () => {
    const grades = [scored('m1', 'a', 12), scored('m2', 'a', 8)];
    expect(
      computeClassResults(input({ rules: rules({ decimals: 0 }), grades })).students[0]!
        .subjects[0]!.average,
    ).toBe(15);
    expect(
      computeClassResults(input({ rules: rules({ decimals: 3 }), grades })).students[0]!
        .subjects[0]!.average,
    ).toBe(14.667);
    expect(roundScore(1.005, 2)).toBe(1.01);
    expect(roundScore(2.675, 2)).toBe(2.68);
    expect(roundScore(10.075, 2)).toBe(10.08);
    expect(roundScore(1.0049999, 2)).toBe(1);
    expect(roundScore(14.666666666666666, 2)).toBe(14.67);
    expect(roundScore(16, 0)).toBe(16);
    expect(roundScore(0.5, 0)).toBe(1);
    // Notation scientifique : jamais NaN.
    expect(roundScore(1.9998e-8, 2)).toBe(0);
    expect(roundScore(1e21, 2)).toBe(1e21);
    expect(Object.is(roundScore(-1e-9, 2), -0)).toBe(false);
  });

  it('sans aucune note : moyennes nulles, élève ni admis ni refusé, non classé', () => {
    const r = computeClassResults(input());
    expect(r.students[0]!.generalAverage).toBeNull();
    expect(r.students[0]!.passed).toBeNull();
    expect(r.students[0]!.rank).toBeNull();
    expect(r.students[0]!.subjects[0]!.missing).toBe(2);
    expect(r.classAverage).toBeNull();
  });

  it('moyenne de passage : à la valeur exacte, l’élève est admis', () => {
    const r = computeClassResults(input({ grades: [scored('f1', 'a', 10)] }));
    expect(r.students[0]!.passed).toBe(true);
    const below = computeClassResults(input({ grades: [scored('f1', 'a', 9.99)] }));
    expect(below.students[0]!.passed).toBe(false);
  });
});

it('moyenne minuscule sur un barème de 1 000 : arrondie à zéro, jamais NaN', () => {
  const r = computeClassResults(
    input({
      subjects: [{ id: 'maths', coefficient: 1 }],
      evaluations: [
        { id: 'a', subjectId: 'maths', maxScore: 1000, coefficient: 0.01, groupId: null },
        { id: 'b', subjectId: 'maths', maxScore: 20, coefficient: 100, groupId: null },
      ],
      grades: [scored('a', 'a', 0.01), scored('b', 'a', 0)],
    }),
  );
  expect(r.students[0]!.subjects[0]!.average).toBe(0);
  expect(r.students[0]!.generalAverage).toBe(0);
});

describe('Ocall School — absences et dispenses', () => {
  const grades = [
    scored('m1', 'a', 16),
    { evaluationId: 'm2', studentId: 'a', status: 'ABSENT' as const, score: null },
  ];

  it('par défaut, une absence est écartée : elle ne vaut pas zéro', () => {
    const maths = computeClassResults(input({ grades })).students[0]!.subjects[0]!;
    expect(maths.average).toBe(16);
    expect(maths.absent).toBe(1);
  });

  it('règle « ZERO » : l’absence compte zéro avec le coefficient de l’évaluation', () => {
    const maths = computeClassResults(input({ rules: rules({ absences: 'ZERO' }), grades }))
      .students[0]!.subjects[0]!;
    // (16×1 + 0×2) / 3 = 5,33
    expect(maths.average).toBe(5.33);
  });

  it('une dispense est toujours écartée, même avec la règle « ZERO »', () => {
    const exempt = [
      scored('m1', 'a', 16),
      { evaluationId: 'm2', studentId: 'a', status: 'EXEMPT' as const, score: null },
    ];
    const maths = computeClassResults(input({ rules: rules({ absences: 'ZERO' }), grades: exempt }))
      .students[0]!.subjects[0]!;
    expect(maths.average).toBe(16);
    expect(maths.exempt).toBe(1);
  });

  it('une matière où l’élève n’a que des absences écartées reste sans moyenne', () => {
    const r = computeClassResults(
      input({
        grades: [
          { evaluationId: 'f1', studentId: 'a', status: 'ABSENT', score: null },
          scored('m1', 'a', 12),
        ],
      }),
    );
    expect(r.students[0]!.subjects[1]!.average).toBeNull();
    expect(r.students[0]!.generalAverage).toBe(12);
  });

  it('une note zéro reste une note : elle compte', () => {
    const r = computeClassResults(input({ grades: [scored('m1', 'a', 0), scored('m2', 'a', 10)] }));
    // (0×1 + 20×2) / 3 = 13,33
    expect(r.students[0]!.subjects[0]!.average).toBe(13.33);
  });
});

describe('Ocall School — groupes', () => {
  it('une évaluation de groupe ne concerne que les élèves du groupe', () => {
    const r = computeClassResults(
      input({
        evaluations: [{ id: 'g1', subjectId: 'fr', maxScore: 20, coefficient: 1, groupId: 'G' }],
        students: [
          { id: 'a', groupIds: ['G'] },
          { id: 'b', groupIds: [] },
        ],
        grades: [scored('g1', 'a', 14)],
      }),
    );
    expect(r.students[0]!.subjects[1]!.average).toBe(14);
    expect(r.students[1]!.subjects[1]!.missing).toBe(0);
    expect(r.students[1]!.subjects[1]!.average).toBeNull();
  });
});

describe('Ocall School — classements et ex æquo', () => {
  const four = input({
    subjects: [{ id: 'fr', coefficient: 1 }],
    evaluations: [{ id: 'f1', subjectId: 'fr', maxScore: 20, coefficient: 1, groupId: null }],
    students: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, groupIds: [] })),
    grades: [
      scored('f1', 'a', 15),
      scored('f1', 'b', 17),
      scored('f1', 'c', 15),
      scored('f1', 'd', 12),
    ],
  });

  it('SHARED : 1, 2, 2, 4 — l’élève sans moyenne n’est pas classé', () => {
    const r = computeClassResults(four);
    const rankOf = (id: string) => r.students.find((s) => s.studentId === id)!;
    expect(rankOf('b').rank).toBe(1);
    expect(rankOf('a').rank).toBe(2);
    expect(rankOf('c').rank).toBe(2);
    expect(rankOf('a').tied).toBe(true);
    expect(rankOf('b').tied).toBe(false);
    expect(rankOf('d').rank).toBe(4);
    expect(rankOf('e').rank).toBeNull();
  });

  it('DENSE : 1, 2, 2, 3', () => {
    const r = computeClassResults({
      ...four,
      rules: rules({ ranking: { enabled: true, ties: 'DENSE', excludedSubjectIds: [] } }),
    });
    expect(r.students.find((s) => s.studentId === 'd')!.rank).toBe(3);
  });

  it('les ex æquo se jugent sur la moyenne arrondie affichée', () => {
    const r = computeClassResults({
      ...four,
      rules: rules({ decimals: 0 }),
      grades: [scored('f1', 'a', 14.6), scored('f1', 'b', 15.4)],
    });
    expect(r.students[0]!.rank).toBe(1);
    expect(r.students[1]!.rank).toBe(1);
    expect(r.students[0]!.tied).toBe(true);
  });

  it('classement désactivé : aucun rang', () => {
    const r = computeClassResults({
      ...four,
      rules: rules({ ranking: { enabled: false, ties: 'SHARED', excludedSubjectIds: [] } }),
    });
    expect(r.rankingEnabled).toBe(false);
    expect(r.students.every((s) => s.rank === null)).toBe(true);
  });

  it('une matière exclue du classement compte dans la moyenne générale, pas dans le rang', () => {
    const r = computeClassResults(
      input({
        rules: rules({ ranking: { enabled: true, ties: 'SHARED', excludedSubjectIds: ['fr'] } }),
        students: [
          { id: 'a', groupIds: [] },
          { id: 'b', groupIds: [] },
        ],
        grades: [
          scored('m1', 'a', 10),
          scored('f1', 'a', 20),
          scored('m1', 'b', 12),
          scored('f1', 'b', 0),
        ],
      }),
    );
    const [a, b] = r.students;
    expect(a!.generalAverage).toBeGreaterThan(b!.generalAverage!);
    expect(b!.rank).toBe(1);
    expect(a!.rank).toBe(2);
  });

  it('moyennes de classe, minimum et maximum par matière', () => {
    const r = computeClassResults(four);
    expect(r.subjects[0]).toEqual({ subjectId: 'fr', classAverage: 14.75, min: 12, max: 17 });
    expect(r.classAverage).toBe(14.75);
  });
});

describe('Ocall School — saisie et règles', () => {
  it('contrôle de saisie selon le barème', () => {
    expect(gradeEntryError({ status: 'SCORED', score: 12.5 }, 20)).toBeNull();
    expect(gradeEntryError({ status: 'SCORED', score: 0 }, 20)).toBeNull();
    expect(gradeEntryError({ status: 'SCORED', score: 20 }, 20)).toBeNull();
    expect(gradeEntryError({ status: 'SCORED', score: 20.5 }, 20)).toMatch(/entre 0 et 20/);
    expect(gradeEntryError({ status: 'SCORED', score: -1 }, 20)).toMatch(/entre 0/);
    expect(gradeEntryError({ status: 'SCORED', score: 12.345 }, 20)).toMatch(/deux décimales/);
    expect(gradeEntryError({ status: 'SCORED', score: null }, 20)).toMatch(/obligatoire/);
    expect(gradeEntryError({ status: 'SCORED', score: Number.NaN }, 20)).toMatch(/obligatoire/);
    expect(gradeEntryError({ status: 'ABSENT', score: null }, 20)).toBeNull();
    expect(gradeEntryError({ status: 'EXEMPT', score: 0 }, 20)).toMatch(/ne porte pas de note/);
  });

  it('une version de règles antérieure au Sprint 4 reçoit la règle d’absence par défaut', () => {
    const old = { scale: 10, passMark: 5, decimals: 1, ranking: { enabled: false, ties: 'DENSE' } };
    const resolved = resolveGradingRules(old as unknown as SchoolGradingRules);
    expect(resolved.absences).toBe('EXCLUDED');
    expect(resolved.ranking.excludedSubjectIds).toEqual([]);
    expect(resolved.scale).toBe(10);
  });

  it('classement : liste d’exclusions mal formée refusée, et tolérée à la lecture', () => {
    const bad = rules({
      ranking: { enabled: true, ties: 'SHARED', excludedSubjectIds: {} as unknown as string[] },
    });
    expect(validateGradingRules(bad)).toContain(
      'Les matières exclues du classement doivent être une liste d’identifiants.',
    );
    expect(
      validateGradingRules(
        rules({
          ranking: { enabled: 'oui' as unknown as boolean, ties: 'SHARED', excludedSubjectIds: [] },
        }),
      ),
    ).toContain('L’activation du classement doit être un booléen.');
    expect(resolveGradingRules(bad).ranking.excludedSubjectIds).toEqual([]);
    const upper = rules({
      ranking: {
        enabled: true,
        ties: 'SHARED',
        excludedSubjectIds: ['ABCDEF00-0000-4000-8000-000000000001'],
      },
    });
    expect(resolveGradingRules(upper).ranking.excludedSubjectIds).toEqual([
      'abcdef00-0000-4000-8000-000000000001',
    ]);
    expect(() => computeClassResults(input({ rules: bad }))).not.toThrow();
  });

  it('règle d’absence inconnue refusée', () => {
    expect(validateGradingRules(rules({ absences: 'ZERO' }))).toEqual([]);
    expect(validateGradingRules(rules({ absences: 'MAYBE' as unknown as 'ZERO' }))).toContain(
      'La règle des absences est invalide.',
    );
  });

  it('version applicable : la plus récente entrée en vigueur à la fin de la période', () => {
    const policies = [
      { version: 1, effectiveFrom: '2026-09-01' },
      { version: 2, effectiveFrom: '2026-12-01' },
      { version: 3, effectiveFrom: '2027-03-01' },
    ];
    expect(policyForPeriod(policies, '2026-12-20')?.version).toBe(2);
    expect(policyForPeriod(policies, '2026-11-30')?.version).toBe(1);
    expect(policyForPeriod(policies, '2026-08-01')).toBeNull();
  });
});
