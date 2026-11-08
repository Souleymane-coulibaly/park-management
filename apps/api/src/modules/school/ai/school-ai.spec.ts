import { numbersAreGrounded } from '@ocall/shared';
import { declaredPrompts } from '../../../ai-core/ai-prompts';
import type { SchoolContext } from '../school-access';
import { buildReportDocument } from '../school-report-builders';
import { groundTruthOf } from './school-ai-copilot.service';
import { mentionsPerson, redactContacts } from './school-ai-privacy.service';
import { SchoolAiAnalysisService } from './school-ai-analysis.service';
import { normalizeContent } from './school-ai-teaching.service';
import { SCHOOL_AI_TOOLS, allowedSchoolTools, pct } from './school-ai-tools';
import {
  SCHOOL_ANALYSIS_PROMPT,
  SCHOOL_COPILOT_PROMPT,
  SCHOOL_TEACHING_PROMPT,
} from './school-ai.prompts';

/** Tests unitaires d'Ocall School AI : sans base, sans réseau. */

const tool = (name: string) => SCHOOL_AI_TOOLS.find((t) => t.name === name)!;
const ctx = (role: SchoolContext['role']) => ({ role }) as SchoolContext;

describe('Outils du copilote de direction', () => {
  it('registre fermé de lectures du reporting du Sprint 8', () => {
    expect(SCHOOL_AI_TOOLS.map((t) => t.name)).toEqual([
      'school_overview',
      'results_by_period',
      'compare_periods',
      'attendance_summary',
      'finance_summary',
    ]);
  });

  it('arguments stricts : toute clé en plus (établissement, organisation) est refusée', () => {
    expect(tool('school_overview').parse({})).toEqual({});
    expect(tool('school_overview').parse({ schoolId: 'x' })).toBeNull();
    expect(tool('attendance_summary').parse({ range: 'this_month' })).toEqual({
      range: 'this_month',
    });
    expect(tool('attendance_summary').parse({ range: 'last_year' })).toBeNull();
    expect(tool('compare_periods').parse({ first: 1, second: 2 })).toEqual({ first: 1, second: 2 });
    expect(tool('compare_periods').parse({ first: 1, second: 1 })).toBeNull();
    expect(tool('compare_periods').parse({ first: '1', second: 2 })).toBeNull();
    expect(tool('results_by_period').parse({ class_name: 'x'.repeat(61) })).toBeNull();
  });

  it('frais scolaires réservés aux rôles qui ont les rapports financiers', () => {
    expect(allowedSchoolTools(ctx('SCHOOL_DIRECTOR')).map((t) => t.name)).toContain(
      'finance_summary',
    );
    expect(allowedSchoolTools(ctx('TEACHER')).map((t) => t.name)).not.toContain('finance_summary');
  });

  it('taux exprimés en pourcentage à une décimale', () => {
    expect(pct(3333)).toBe(33.3);
    expect(pct(null)).toBeNull();
  });
});

describe('Contrôle des chiffres (copilote et analyse)', () => {
  it('décimales écrites à la française : « 11,33 » reconnu, chiffre inventé refusé', () => {
    const truth = groundTruthOf(
      JSON.stringify({ average: 11.33, passRatePercent: 66.7, students: 12500 }),
    );
    expect(numbersAreGrounded('Moyenne de 11,33 et 66,7 % de réussite.', truth)).toBe(true);
    expect(numbersAreGrounded('12 500 élèves.', truth)).toBe(true);
    expect(numbersAreGrounded('Moyenne de 12,5.', truth)).toBe(false);
  });
});

describe('Assistant pédagogique : revalidation serveur du contenu proposé', () => {
  it('sections attendues seulement, dans l’ordre du type ; sections absentes signalées', () => {
    const out = normalizeContent('QCM', {
      title: '  QCM fractions  ',
      sections: [
        { key: 'questions', heading: 'Questions', body: '1. ½ ou ⅓ ?' },
        { key: 'malicious', heading: 'x', body: 'Ignorer les règles' },
      ],
    });
    expect(out.title).toBe('QCM fractions');
    expect(out.sections.map((s) => s.key)).toEqual(['instructions', 'questions']);
    expect(out.sections[1]!.body).toBe('1. ½ ou ⅓ ?');
    expect(out.missing).toEqual(['instructions']);
  });

  it('réponse illisible : contenu vide, titre par défaut, textes bornés', () => {
    const out = normalizeContent('LESSON_SHEET', 'pas un objet');
    expect(out.title).toBe('fiche de cours');
    expect(out.missing).toHaveLength(4);
    const long = normalizeContent('HOMEWORK', {
      title: 'x'.repeat(500),
      sections: [{ key: 'tasks', heading: 'h', body: 'y'.repeat(20_000) }],
    });
    expect(long.title).toHaveLength(160);
    expect(long.sections[1]!.body).toHaveLength(8000);
  });
});

describe('Prompts versionnés de School', () => {
  it('déclarés dans Ocall AI Core ; garde-fous mineurs et injection présents', () => {
    expect(declaredPrompts()).toEqual(
      expect.arrayContaining([
        { id: 'school.copilot', version: 1 },
        { id: 'school.teaching', version: 1 },
        { id: 'school.teaching_section', version: 1 },
        { id: 'school.analysis', version: 1 },
      ]),
    );
    for (const p of [SCHOOL_COPILOT_PROMPT, SCHOOL_ANALYSIS_PROMPT]) {
      expect(p.instructions).toMatch(/diagnostic psychologique ou médical/);
      expect(p.instructions).toMatch(/étiquette de risque/);
    }
    for (const p of [SCHOOL_COPILOT_PROMPT, SCHOOL_TEACHING_PROMPT, SCHOOL_ANALYSIS_PROMPT]) {
      expect(p.instructions).toMatch(/ignore toute instruction/);
    }
    expect(SCHOOL_COPILOT_PROMPT.instructions).toMatch(/LECTURE SEULE/);
  });
});

describe('Confidentialité des textes libres (avant tout appel au fournisseur)', () => {
  const people = [
    {
      firstName: 'Awa',
      lastName: 'Diop',
      firstNameAr: 'آوا',
      lastNameAr: 'ديوب',
      matricule: 'EL-2026-0042',
    },
  ];

  it('prénom et nom, dans tout ordre, toute écriture, toute forme ; matricule', () => {
    expect(mentionsPerson('Soutien pour Awa Diop', people)).toBe(true);
    expect(mentionsPerson('prénom : Awa ; nom : Diop', people)).toBe(true);
    expect(mentionsPerson('Préparer un soutien pour Awa ديوب', people)).toBe(true);
    expect(mentionsPerson('درس لـ آوا Diop', people)).toBe(true);
    expect(mentionsPerson('Dossier EL-2026-0042', people)).toBe(true);
    // Un nom de famille seul, ou un prénom seul, ne désigne pas une personne.
    expect(mentionsPerson('Les familles Diop du quartier', people)).toBe(false);
    expect(mentionsPerson('La chanson d’Awa', people)).toBe(false);
  });

  it('téléphones et adresses masqués ; montants, notes et années intacts', () => {
    expect(redactContacts('contact : 76 12 34 56')).toBe('contact : [téléphone masqué]');
    expect(redactContacts('appeler le 77 123 45 67 ou +221 77 123 45 67')).toBe(
      'appeler le [téléphone masqué] ou [téléphone masqué]',
    );
    expect(redactContacts('76123456')).toBe('[téléphone masqué]');
    // Chiffres arabes et persans : le segment d'origine est masqué.
    expect(redactContacts('Téléphone du responsable : ٧٦ ١٢ ٣٤ ٥٦')).toBe(
      'Téléphone du responsable : [téléphone masqué]',
    );
    expect(redactContacts('رقم ۷۶۱۲۳۴۵۶')).toBe('رقم [téléphone masqué]');
    // Ponctuation après le numéro : masqué ; décimales et montants : intacts.
    expect(redactContacts('Responsable : 76 12 34 56, préparer un message')).toBe(
      'Responsable : [téléphone masqué], préparer un message',
    );
    expect(redactContacts('76123456, merci')).toBe('[téléphone masqué], merci');
    // Espaces insécables (U+00A0, U+202F) et parenthèses : masqués, segment d'origine compris.
    expect(redactContacts('Téléphone du responsable : 76 12 34 56')).toBe(
      'Téléphone du responsable : [téléphone masqué]',
    );
    expect(redactContacts('tél. 77 123 45 67.')).toBe('tél. [téléphone masqué].');
    expect(redactContacts('appeler le +221 (77) 123 45 67')).toBe('appeler le [téléphone masqué]');
    expect(redactContacts('ou (77) 123 45 67, merci')).toBe('ou [téléphone masqué], merci');
    expect(redactContacts('total 1 234 567,89 FCFA')).toBe('total 1 234 567,89 FCFA');
    expect(redactContacts('moyenne 11,33 ; total 1 234 567,89 FCFA')).toBe(
      'moyenne 11,33 ; total 1 234 567,89 FCFA',
    );
    // Moins de huit chiffres : pas un téléphone.
    expect(redactContacts('Comparer 12 14 16')).toBe('Comparer 12 14 16');
    expect(redactContacts('écrire à parent@exemple.sn')).toBe('écrire à [adresse masquée]');
    expect(redactContacts('12 élèves, 12 500 FCFA, moyenne 11,33, année 2026-2027')).toBe(
      '12 élèves, 12 500 FCFA, moyenne 11,33, année 2026-2027',
    );
  });
});

describe('Montants exportés dans l’unité de la devise', () => {
  it('EUR : unités mineures converties (10000 → 100) ; libellé de la devise conservé', () => {
    const doc = buildReportDocument(
      'finance',
      {
        school: { id: 's', name: 'École', nameAr: null, defaultLocale: 'FR' },
        year: { id: 'y', label: '2026-2027', startsOn: '2026-09-01', endsOn: '2027-06-30' },
        from: '2026-09-01',
        to: '2026-11-30',
        filters: { classId: null, periodId: null },
        filterNames: { class: null, period: null },
        generatedOn: '2026-11-06',
        currency: 'EUR',
        today: '2026-11-06',
        expected: 10_000,
        collected: 2_550,
        periodCollected: null,
        balance: 7_450,
        discounts: 0,
        overdueCharges: 0,
        overdueAmount: 0,
        studentsInArrears: 0,
        collectionsByMonth: [{ month: '2026-10', amount: 2_550 }],
        collectionsByMethod: [],
        byClass: [
          {
            classId: 'c',
            className: 'CM1 A',
            levelName: 'CM1',
            expected: 10_000,
            collected: 2_550,
            balance: 7_450,
            periodCollected: null,
          },
        ],
      } as never,
      'FR',
      [],
    );
    const key = doc.sections[0]!.table.rows;
    expect(key[0]).toEqual(['Facturé (EUR)', 100]);
    expect(key[1]).toEqual(['Encaissé (cumul de l’année) (EUR)', 25.5]);
    expect(doc.sections[1]!.table.rows[0]).toEqual(['CM1 A', 'CM1', 100, 25.5, 74.5]);
    expect(doc.sections[2]!.table.rows[0]).toEqual(['2026-10', 25.5]);
  });
});

describe('Changement de barème entre deux périodes', () => {
  it('comparaison : aucun écart calculé, signalement explicite', async () => {
    const periods = [
      { id: 'p1', label: 'T1', labelAr: null, startsOn: '2026-10-01', endsOn: '2026-12-20' },
      { id: 'p2', label: 'T2', labelAr: null, startsOn: '2027-01-04', endsOn: '2027-03-31' },
    ];
    const reporting = {
      pedagogy: async () => ({
        scale: null,
        scaleMixed: true,
        periods,
        schoolByPeriod: [
          {
            periodId: 'p1',
            average: 60,
            scale: 100,
            passRate: 5000,
            graded: 10,
            insufficient: false,
          },
          {
            periodId: 'p2',
            average: 12,
            scale: 20,
            passRate: 5000,
            graded: 10,
            insufficient: false,
          },
        ],
        classes: [
          {
            name: 'CM1 A',
            periods: [
              { periodId: 'p1', classAverage: 60, scale: 100 },
              { periodId: 'p2', classAverage: 12, scale: 20 },
            ],
          },
        ],
        subjects: [
          {
            name: 'Mathématiques',
            byPeriod: [
              { periodId: 'p1', average: 60, scale: 100, scaleMixed: false },
              { periodId: 'p2', average: 12, scale: 20, scaleMixed: false },
            ],
          },
          {
            name: 'Français',
            byPeriod: [
              { periodId: 'p1', average: null, scale: null, scaleMixed: true },
              { periodId: 'p2', average: 11, scale: 20, scaleMixed: false },
            ],
          },
        ],
      }),
    };
    const result = await tool('compare_periods').run({ reporting } as never, {
      first: 1,
      second: 2,
    });
    expect(result.data.averageChange).toBeNull();
    expect(result.data.classes).toEqual([
      {
        class: 'CM1 A',
        first: 60,
        second: 12,
        firstScale: 100,
        secondScale: 20,
        firstGraded: 0,
        secondGraded: 0,
        scaleChanged: true,
        change: null,
      },
    ]);
    // Matières : écart suspendu (barème changé, ou moyenne de période mélangeant des barèmes).
    expect(result.data.subjects).toEqual([
      {
        subject: 'Mathématiques',
        first: 60,
        second: 12,
        firstScale: 100,
        secondScale: 20,
        firstGraded: 0,
        secondGraded: 0,
        scaleChanged: true,
        change: null,
      },
      {
        subject: 'Français',
        first: null,
        second: 11,
        firstScale: 'barèmes différents',
        secondScale: 20,
        firstGraded: 0,
        secondGraded: 0,
        scaleChanged: true,
        change: null,
      },
    ]);
  });
});

describe('Effectif propre à chaque matière', () => {
  it('baisse de matière fondée sur un seul élève : réserve sur l’alerte, la moyenne et les limites', async () => {
    const periods = [
      { id: 'p1', label: 'T1', labelAr: null, startsOn: '2026-10-01', endsOn: '2026-12-20' },
      { id: 'p2', label: 'T2', labelAr: null, startsOn: '2027-01-04', endsOn: '2027-03-31' },
    ];
    const school = { id: 's', name: 'École' };
    const reporting = {
      pedagogy: async () => ({
        school,
        year: { id: 'y', label: '2026-2027' },
        filters: {},
        scale: 20,
        scaleMixed: false,
        periods,
        schoolByPeriod: [
          { periodId: 'p1', average: 12, passRate: 6000, graded: 30, insufficient: false },
          { periodId: 'p2', average: 12, passRate: 6000, graded: 30, insufficient: false },
        ],
        schoolTrend: null,
        // Classe de trente élèves notés : aucune réserve de classe.
        classes: [
          {
            name: 'CM1 A',
            trend: { direction: 'STABLE', delta: 0 },
            scaleChanged: false,
            periods: [
              { periodId: 'p1', classAverage: 12, scale: 20, graded: 30, insufficient: false },
              { periodId: 'p2', classAverage: 12, scale: 20, graded: 30, insufficient: false },
            ],
          },
        ],
        // Un seul élève noté en mathématiques : 16 puis 8.
        subjects: [
          {
            name: 'Mathématiques',
            trend: { direction: 'DOWN', delta: -8 },
            byPeriod: [
              {
                periodId: 'p1',
                average: 16,
                scale: 20,
                scaleMixed: false,
                graded: 1,
                insufficient: true,
              },
              {
                periodId: 'p2',
                average: 8,
                scale: 20,
                scaleMixed: false,
                graded: 1,
                insufficient: true,
              },
            ],
          },
        ],
      }),
      attendance: async () => ({
        from: '2026-09-01',
        to: '2027-03-31',
        insufficient: false,
        total: { sessions: 100, absenceRate: 500, lateRate: 100 },
        byClass: [],
        byMonth: [],
      }),
    };
    const ai = { scope: async () => school };
    const service = new SchoolAiAnalysisService(ai as never, reporting as never);
    const r = await service.indicators({} as never, { schoolId: 's', schoolYearId: 'y' } as never);
    expect(r.support).toEqual([
      {
        scope: 'subject',
        name: 'Mathématiques',
        reason: 'DOWN_TREND',
        value: -8,
        period: null,
        insufficient: true,
      },
    ]);
    expect(
      r.results.subjects[0]!.averages.map((a) => [a.average, a.scale, a.insufficient]),
    ).toEqual([
      [16, 20, true],
      [8, 20, true],
    ]);
    expect(r.insufficient).toContain('effectif noté insuffisant en Mathématiques (T2)');
  });

  it('exports : barème, effectif et réserve par matière ; barèmes mélangés signalés', () => {
    const doc = buildReportDocument(
      'pedagogy',
      {
        school: { id: 's', name: 'École', nameAr: null, defaultLocale: 'FR' },
        year: { id: 'y', label: '2026-2027', startsOn: '2026-09-01', endsOn: '2027-06-30' },
        from: '2026-09-01',
        to: '2027-03-31',
        filters: { classId: null, periodId: null },
        filterNames: { class: null, period: null },
        generatedOn: '2026-11-06',
        periods: [{ id: 'p1', label: 'T1', labelAr: null }],
        schoolByPeriod: [
          {
            periodId: 'p1',
            average: null,
            scale: null,
            scaleMixed: true,
            passRate: null,
            graded: 31,
            insufficient: false,
          },
        ],
        classes: [],
        subjects: [
          {
            name: 'Mathématiques',
            nameAr: null,
            trend: null,
            byPeriod: [
              {
                periodId: 'p1',
                average: 12,
                scale: 20,
                scaleMixed: false,
                graded: 1,
                insufficient: true,
              },
            ],
          },
        ],
      } as never,
      'FR',
      [],
    );
    const school = doc.sections[0]!.table;
    expect(school.headers.slice(0, 3)).toEqual(['Période', 'Moyenne', 'Barème']);
    expect(school.rows[0]!.slice(0, 3)).toEqual(['T1', '', 'barèmes différents']);
    const subjects = doc.sections[2]!.table;
    expect(subjects.headers).toEqual([
      'Matière',
      'Période',
      'Moyenne',
      'Barème',
      'Élèves notés',
      'Effectif insuffisant',
      'Tendance',
    ]);
    expect(subjects.rows[0]).toEqual(['Mathématiques', 'T1', 12, 20, 1, 'Oui', '']);
  });
});

describe('Comparaison du copilote : effectif propre à chaque classe', () => {
  it('baisse d’une classe à un seul élève noté : effectifs, réserve et limite explicites', async () => {
    const periods = [
      { id: 'p1', label: 'T1', labelAr: null, startsOn: '2026-10-01', endsOn: '2026-12-20' },
      { id: 'p2', label: 'T2', labelAr: null, startsOn: '2027-01-04', endsOn: '2027-03-31' },
    ];
    const reporting = {
      pedagogy: async () => ({
        scale: 20,
        scaleMixed: false,
        periods,
        // Établissement : 31 élèves notés, aucune réserve globale.
        schoolByPeriod: [
          { periodId: 'p1', average: 12, passRate: 6000, graded: 31, insufficient: false },
          { periodId: 'p2', average: 11, passRate: 6000, graded: 31, insufficient: false },
        ],
        classes: [
          {
            name: 'CM1 A',
            periods: [
              { periodId: 'p1', classAverage: 16, scale: 20, graded: 1, insufficient: true },
              { periodId: 'p2', classAverage: 8, scale: 20, graded: 1, insufficient: true },
            ],
          },
          {
            name: 'CM1 B',
            periods: [
              { periodId: 'p1', classAverage: 12, scale: 20, graded: 30, insufficient: false },
              { periodId: 'p2', classAverage: 11, scale: 20, graded: 30, insufficient: false },
            ],
          },
        ],
        subjects: [],
      }),
    };
    const result = await tool('compare_periods').run({ reporting } as never, {
      first: 1,
      second: 2,
    });
    expect(result.data.classes).toEqual([
      {
        class: 'CM1 A',
        first: 16,
        second: 8,
        firstScale: 20,
        secondScale: 20,
        firstGraded: 1,
        secondGraded: 1,
        insufficient: true,
        change: -8,
      },
      {
        class: 'CM1 B',
        first: 12,
        second: 11,
        firstScale: 20,
        secondScale: 20,
        firstGraded: 30,
        secondGraded: 30,
        change: -1,
      },
    ]);
    expect(result.missing).toEqual([
      'effectif insuffisant : CM1 A (T1)',
      'effectif insuffisant : CM1 A (T2)',
    ]);
  });
});

describe('Copilote : réserves d’effectif et bornes des sources', () => {
  const periods = [
    { id: 'p1', label: 'T1', labelAr: null, startsOn: '2026-10-01', endsOn: '2026-12-20' },
    { id: 'p2', label: 'T2', labelAr: null, startsOn: '2027-01-04', endsOn: '2027-03-31' },
  ];

  it('school_overview : un seul élève noté → effectif, barème et réserve transmis', async () => {
    const reporting = {
      overview: async () => ({
        year: { label: '2026-2027' },
        from: '2026-09-01',
        to: '2027-03-31',
        students: { active: 30, unplaced: 0 },
        classCount: 1,
        teachers: 2,
        byClass: [{ name: 'CM1 A', students: 30 }],
        attendance: { sessions: 100, presenceRate: 9000, absenceRate: 1000 },
        results: {
          period: { label: 'T1', labelAr: null },
          average: 8,
          scale: 20,
          scaleMixed: false,
          passRate: 0,
          graded: 1,
          insufficient: true,
          byClass: [{ name: 'CM1 A', classAverage: 8, scale: 20, graded: 1, insufficient: true }],
        },
        finance: null,
      }),
    };
    const r = await tool('school_overview').run({ reporting } as never, {});
    expect(r.data.latestResults).toMatchObject({
      schoolAverage: 8,
      scale: 20,
      gradedStudents: 1,
      insufficient: true,
      classes: [{ class: 'CM1 A', average: 8, scale: 20, gradedStudents: 1, insufficient: true }],
    });
    expect(r.missing).toEqual([
      'effectif noté insuffisant en T1',
      'effectif noté insuffisant : CM1 A (T1)',
    ]);
  });

  it('compare_periods : ordre inversé → plage chronologique ; période sans note signalée à part', async () => {
    const reporting = {
      pedagogy: async () => ({
        scale: 20,
        scaleMixed: false,
        periods,
        schoolByPeriod: [
          {
            periodId: 'p1',
            average: 12,
            scale: 20,
            passRate: 6000,
            graded: 30,
            insufficient: false,
          },
          {
            periodId: 'p2',
            average: null,
            scale: 20,
            passRate: null,
            graded: 0,
            insufficient: true,
          },
        ],
        classes: [],
        subjects: [],
      }),
    };
    const r = await tool('compare_periods').run({ reporting } as never, { first: 2, second: 1 });
    expect(r.period).toEqual({ label: 'T2 et T1', from: '2026-10-01', to: '2027-03-31' });
    expect(r.missing).toEqual(['aucun élève noté en T2']);
  });

  /** Établissement noté sur 20 aux deux trimestres ; `yearScale` : barème global de l'année. */
  const pedagogyWith = (
    second: { scale: number | null; scaleMixed?: boolean },
    yearScale: number | null,
  ) => ({
    pedagogy: async () => ({
      school: { id: 's', name: 'École' },
      year: { id: 'y', label: '2026-2027' },
      filters: {},
      scale: yearScale,
      scaleMixed: yearScale === null,
      periods,
      schoolByPeriod: [
        {
          periodId: 'p1',
          average: 12,
          scale: 20,
          scaleMixed: false,
          passRate: 6000,
          graded: 30,
          insufficient: false,
        },
        {
          periodId: 'p2',
          average: 14,
          scale: second.scale,
          scaleMixed: second.scaleMixed ?? false,
          passRate: 7000,
          graded: 30,
          insufficient: false,
        },
      ],
      schoolTrend: null,
      classes: [],
      subjects: [],
    }),
  });

  it('compare_periods : écart calculé sur le barème des deux périodes, même si l’année en mélange d’autres', async () => {
    const r = await tool('compare_periods').run(
      { reporting: pedagogyWith({ scale: 20 }, null) } as never,
      {
        first: 1,
        second: 2,
      },
    );
    expect(r.data.averageChange).toBe(2);
    expect(r.data).not.toHaveProperty('scaleChanged');
  });

  it('compare_periods : barème différent ou mélangé sur une des deux périodes → aucun écart, signalé', async () => {
    for (const second of [{ scale: 10 }, { scale: null, scaleMixed: true }]) {
      const r = await tool('compare_periods').run(
        { reporting: pedagogyWith(second, 20) } as never,
        {
          first: 1,
          second: 2,
        },
      );
      expect(r.data.averageChange).toBeNull();
      expect(r.data.scaleChanged).toBe(true);
    }
  });

  it('results_by_period : période sans note → absence de résultats, jamais « effectif insuffisant »', async () => {
    const reporting = {
      pedagogy: async () => ({
        year: { id: 'y', label: '2026-2027' },
        from: '2026-10-01',
        to: '2027-03-31',
        periods,
        schoolByPeriod: [
          {
            periodId: 'p1',
            average: 12,
            scale: 20,
            scaleMixed: false,
            passRate: 6000,
            graded: 2,
            insufficient: true,
          },
          {
            periodId: 'p2',
            average: null,
            scale: null,
            scaleMixed: false,
            passRate: null,
            graded: 0,
            insufficient: true,
          },
        ],
        classes: [],
        subjects: [],
      }),
    };
    const r = await tool('results_by_period').run(
      { reporting, classes: [{ id: 'c1', name: 'CM1 A', nameAr: null }] } as never,
      { className: 'CM1 A' },
    );
    expect((r.data.school as { insufficient: boolean }[]).map((p) => p.insufficient)).toEqual([
      true,
      false,
    ]);
    expect(r.missing).toEqual(['aucun élève noté en T2']);
  });
});

describe('Analyse : période sans note', () => {
  it('limite « aucun élève noté », jamais « effectif insuffisant »', async () => {
    const periods = [
      { id: 'p1', label: 'T1', labelAr: null, startsOn: '2026-10-01', endsOn: '2026-12-20' },
      { id: 'p2', label: 'T2', labelAr: null, startsOn: '2027-01-04', endsOn: '2027-03-31' },
    ];
    const school = { id: 's', name: 'École' };
    const reporting = {
      pedagogy: async () => ({
        school,
        year: { id: 'y', label: '2026-2027' },
        filters: {},
        scale: 20,
        scaleMixed: false,
        periods,
        schoolByPeriod: [
          {
            periodId: 'p1',
            average: 12,
            scale: 20,
            passRate: 6000,
            graded: 30,
            insufficient: false,
          },
          {
            periodId: 'p2',
            average: null,
            scale: null,
            passRate: null,
            graded: 0,
            insufficient: true,
          },
        ],
        schoolTrend: null,
        classes: [],
        subjects: [],
      }),
      attendance: async () => ({
        from: '2026-09-01',
        to: '2027-03-31',
        insufficient: false,
        total: { sessions: 100, absenceRate: 500, lateRate: 100 },
        byClass: [],
        byMonth: [],
      }),
    };
    const service = new SchoolAiAnalysisService(
      { scope: async () => school } as never,
      reporting as never,
    );
    const r = await service.indicators({} as never, { schoolId: 's', schoolYearId: 'y' } as never);
    expect(r.results.school.map((p) => p.insufficient)).toEqual([false, false]);
    expect(r.insufficient).toContain('aucun élève noté en T2');
    expect(r.insufficient).not.toContain('effectif noté insuffisant en T2');
  });
});
