import type { INestApplication } from '@nestjs/common';
import type { Response } from 'supertest';
import { SchoolPrismaService } from '../src/modules/school/school-prisma.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  type Agent,
  type InternalAccount,
  PASSWORD,
  RUN,
  cleanup,
  createTestApp,
  email,
  internalAccount,
  login,
} from './helpers';

/**
 * Ocall School, Sprint 8 : Ocall School AI sur Ocall AI Core (copilote de direction, assistant
 * pédagogique, analyse scolaire), avec le fournisseur SIMULÉ (aucun appel payant). Données fictives.
 * Bases de test locales jetables uniquement (garde bloquante de `createTestApp`).
 */
const suite =
  (process.env.SCHOOL_TEST_DATABASE_URL ?? process.env.TEST_SCHOOL_DATABASE_URL)
    ? describe
    : describe.skip;

const CLEANUP = [
  'schoolAiMessage',
  'schoolAiConversation',
  'schoolAiDocument',
  'schoolAiUsage',
  'schoolAiSettings',
  'schoolReportView',
  'schoolNotification',
  'schoolResultValidation',
  'schoolReportComment',
  'schoolAppreciation',
  'schoolGradeEvent',
  'schoolGrade',
  'schoolEvaluation',
  'academicPeriod',
  'schoolTeachingAssignment',
  'schoolTeacherSubject',
  'subjectLevel',
  'subject',
  'schoolStudentEvent',
  'schoolClassAssignment',
  'schoolEnrollment',
  'schoolStudentGuardian',
  'schoolGuardian',
  'schoolStudent',
  'schoolNumberCounter',
  'schoolStudentSettings',
  'schoolClassTeacher',
  'schoolClass',
  'level',
  'cycle',
  'schoolAccessDecision',
  'schoolYear',
  'schoolMember',
  'school',
  'schoolGroup',
];

const TERMS = { startsOn: '2026-01-01', endsOn: '2099-12-31' };

interface Structure {
  schoolId: string;
  yearId: string;
  level1: string;
  class1: string;
  class2: string;
}

interface Member {
  id: string;
  agent: Agent;
}

function binary(res: Response, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

suite('Ocall School — Sprint 8, Ocall School AI (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: SchoolPrismaService;
  let platform: InternalAccount;
  let ownerA: Agent;
  let ownerB: Agent;
  let a1: Structure;
  let b1: Structure;
  let director: Member;
  let secretary: Member;
  let teacher: Member;
  let accountant: Member;
  let maths: string;
  let french: string;
  let s1: string;
  let s2: string;
  let p1: string;
  let p2: string;
  const organizations: string[] = [];
  let counter = 0;

  async function connect(identifier: string, temporaryPassword: string): Promise<Agent> {
    const session = await login(app, identifier, temporaryPassword);
    expect(session.status).toBe(200);
    await session.agent
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return session.agent;
  }

  async function client(label: string): Promise<Agent> {
    const res = await platform.agent
      .post('/api/v1/platform/contracts/clients')
      .send({
        organizationName: `Test ${label} ${RUN}`,
        countryCode: 'SN',
        ownerFirstName: 'Mariama',
        ownerLastName: 'Sow',
        ownerEmail: email(`owner8-${label}`),
        reference: `OCS8-${RUN}-${++counter}`,
        ...TERMS,
      })
      .expect(201);
    organizations.push(res.body.contract.organizationId);
    await platform.agent
      .post(`/api/v1/platform/contracts/${res.body.contract.id}/status`)
      .send({ status: 'ACTIVE', reason: 'Décision de test' })
      .expect(200);
    return connect(res.body.loginId, res.body.temporaryPassword);
  }

  async function member(owner: Agent, role: string, schoolIds: string[]): Promise<Member> {
    const res = await owner
      .post('/api/v1/school/members')
      .send({ firstName: 'Ibrahima', lastName: `${role}${++counter}`, role, schoolIds })
      .expect(201);
    return {
      id: res.body.member.id,
      agent: await connect(res.body.member.loginId, res.body.temporaryPassword),
    };
  }

  async function structure(owner: Agent, name: string): Promise<Structure> {
    const school = await owner
      .post('/api/v1/school/schools')
      .send({ name: `${name} ${RUN}`, type: 'PRIMARY', countryCode: 'SN' })
      .expect(201);
    const schoolId = school.body.id as string;
    const year = await owner
      .post('/api/v1/school/years')
      .send({ schoolId, label: '2026-2027', startsOn: '2026-10-01', endsOn: '2027-06-30' })
      .expect(201);
    await owner
      .post(`/api/v1/school/years/${year.body.id}/status`)
      .send({ status: 'ACTIVE' })
      .expect(200);
    const cycle = await owner
      .post('/api/v1/school/cycles')
      .send({ schoolId, name: 'Primaire' })
      .expect(201);
    const level1 = (
      await owner
        .post('/api/v1/school/levels')
        .send({ cycleId: cycle.body.id, name: 'CM1' })
        .expect(201)
    ).body.id as string;
    const cls = async (n: string) =>
      (
        await owner
          .post('/api/v1/school/classes')
          .send({ schoolYearId: year.body.id, levelId: level1, name: n, capacity: 30 })
          .expect(201)
      ).body.id as string;
    return {
      schoolId,
      yearId: year.body.id,
      level1,
      class1: await cls('CM1 A'),
      class2: await cls('CM1 B'),
    };
  }

  async function enrolled(owner: Agent, s: Structure, classId: string, lastName: string) {
    const created = await owner
      .post('/api/v1/school/students')
      .send({ schoolId: s.schoolId, lastName, firstName: 'Awa', birthDate: '2016-02-14' })
      .expect(201);
    const tutor = await owner
      .post('/api/v1/school/guardians')
      .send({ schoolId: s.schoolId, lastName, firstName: 'Tuteur', phone: '+221 77 000 00 01' })
      .expect(201);
    await owner
      .post(`/api/v1/school/students/${created.body.id}/guardians`)
      .send({ guardianId: tutor.body.id, relation: 'OTHER' })
      .expect(201);
    const enrollment = await owner
      .post('/api/v1/school/enrollments')
      .send({
        studentId: created.body.id,
        schoolYearId: s.yearId,
        levelId: s.level1,
        classId,
        submit: true,
      })
      .expect(201);
    await owner
      .post(`/api/v1/school/enrollments/${enrollment.body.id}/status`)
      .send({ status: 'VALIDATED' })
      .expect(200);
    return created.body.id as string;
  }

  async function graded(periodId: string, heldOn: string, scores: [string, number][]) {
    const evaluation = await ownerA
      .post('/api/v1/school/evaluations')
      .send({
        classId: a1.class1,
        periodId,
        subjectId: maths,
        kind: 'HOMEWORK',
        title: `Devoir ${heldOn}`,
        heldOn,
        maxScore: 20,
      })
      .expect(201);
    await ownerA
      .put(`/api/v1/school/evaluations/${evaluation.body.id}/grades`)
      .send({
        grades: scores.map(([studentId, score]) => ({ studentId, status: 'SCORED', score })),
      })
      .expect(200);
  }

  const API_KEY_SENTINEL = 'sk-ocall-test-never-exposed-1234567890';
  const responses: string[] = [];
  const track = <T extends { body: unknown; text?: string }>(res: T) => {
    responses.push(JSON.stringify(res.body ?? ''));
    return res;
  };
  const ask = (agent: Agent, question: string, extra: Record<string, unknown> = {}) =>
    agent
      .post('/api/v1/school/ai/copilot/ask')
      .send({ schoolId: a1.schoolId, question, ...extra })
      .then(track);
  const sim = (value: unknown) => `OCALL-SIM:${JSON.stringify(value)}:FIN`;
  const settings = (agent: Agent, body: Record<string, unknown>, schoolId = a1.schoolId) =>
    agent.put(`/api/v1/school/ai/settings?schoolId=${schoolId}`).send(body);
  const generate = (agent: Agent, body: Record<string, unknown> = {}) =>
    agent
      .post('/api/v1/school/ai/teaching/contents')
      .send({
        schoolId: a1.schoolId,
        classId: a1.class1,
        subjectId: maths,
        kind: 'QCM',
        language: 'FR',
        difficulty: 'MEDIUM',
        topic: 'Les fractions',
        objectives: 'Comparer deux fractions simples',
        ...body,
      })
      .then(track);

  beforeAll(async () => {
    // Clé fictive : aucune réponse de l'API ne doit jamais la contenir (fournisseur simulé).
    process.env.OPENAI_API_KEY = API_KEY_SENTINEL;
    ({ app, prisma } = await createTestApp());
    db = app.get(SchoolPrismaService);
    platform = await internalAccount(app, prisma, `sc8ai-owner-${RUN}`, 'PLATFORM_OWNER');
    ownerA = await client('a');
    ownerB = await client('b');
    a1 = await structure(ownerA, 'Ecole IA');
    b1 = await structure(ownerB, 'Ecole Autre IA');
    director = await member(ownerA, 'SCHOOL_DIRECTOR', [a1.schoolId]);
    secretary = await member(ownerA, 'SECRETARY', [a1.schoolId]);
    teacher = await member(ownerA, 'TEACHER', [a1.schoolId]);
    accountant = await member(ownerA, 'ACCOUNTANT', [a1.schoolId]);
    const activate = async (key: string) => {
      const id = (
        await ownerA
          .post(`/api/v1/school/subjects/catalog/${key}/activate`)
          .send({ schoolId: a1.schoolId })
          .expect(201)
      ).body.id as string;
      await ownerA
        .put(`/api/v1/school/subjects/${id}/levels`)
        .send({ levels: [{ levelId: a1.level1, coefficient: 1, weeklyHours: 4 }] })
        .expect(200);
      return id;
    };
    maths = await activate('mathematiques');
    french = await activate('francais');
    s1 = await enrolled(ownerA, a1, a1.class1, 'Ba');
    s2 = await enrolled(ownerA, a1, a1.class1, 'Diop');
    await ownerA
      .post('/api/v1/school/teaching-assignments')
      .send({ classId: a1.class1, subjectId: maths, memberId: teacher.id })
      .expect(201);
    const period = async (label: string, startsOn: string, endsOn: string) =>
      (
        await ownerA
          .post('/api/v1/school/periods')
          .send({ schoolYearId: a1.yearId, kind: 'TRIMESTER', label, startsOn, endsOn })
          .expect(201)
      ).body.id as string;
    p1 = await period('Trimestre 1', '2026-10-01', '2026-12-20');
    p2 = await period('Trimestre 2', '2027-01-04', '2027-03-31');
    await graded(p1, '2026-10-20', [
      [s1, 12],
      [s2, 8],
    ]);
    await graded(p2, '2027-01-20', [
      [s1, 15],
      [s2, 11],
    ]);
  }, 300_000);

  afterAll(async () => {
    delete process.env.OPENAI_API_KEY;
    const where = { organizationId: { in: organizations } };
    for (const t of CLEANUP) {
      await (db as unknown as Record<string, { deleteMany: (a: unknown) => Promise<unknown> }>)[
        t
      ]!.deleteMany({ where });
    }
    await cleanup(prisma);
    await app.close();
  });

  describe('activation et réglages', () => {
    it('désactivée par défaut : refus explicite ; état sans aucune clé', async () => {
      const status = track(
        await director.agent.get(`/api/v1/school/ai/status?schoolId=${a1.schoolId}`).expect(200),
      );
      expect(status.body).toMatchObject({ configured: true, simulated: true, enabled: false });
      expect(status.body.features.SCHOOL_COPILOT).toBe(false);
      const refused = await ask(ownerA, 'Combien d’élèves sont inscrits cette année ?').then(
        (r) => r,
      );
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('AI_SCHOOL_DISABLED');
      expect(await db.schoolAiUsage.count({ where: { schoolId: a1.schoolId } })).toBe(0);
    });

    it('seule la direction règle ; activation par établissement', async () => {
      await settings(teacher.agent, { enabled: true }).expect(403);
      await settings(secretary.agent, { enabled: true }).expect(403);
      await settings(ownerB, { enabled: true }).expect(404);
      const saved = await settings(ownerA, { enabled: true, monthlyCallLimit: 50 }).expect(200);
      expect(saved.body).toMatchObject({ enabled: true, monthlyCallLimit: 50 });
      const status = await teacher.agent
        .get(`/api/v1/school/ai/status?schoolId=${a1.schoolId}`)
        .expect(200);
      // Enseignant : assistant pédagogique seulement.
      expect(status.body.features).toEqual({
        SCHOOL_COPILOT: false,
        SCHOOL_TEACHING: true,
        SCHOOL_ANALYSIS: false,
      });
    });
  });

  describe('copilote de direction', () => {
    let conversationId: string;

    it('question chiffrée : rapport du Sprint 8, période et sources affichées, chiffres vérifiés', async () => {
      const res = await ask(ownerA, 'Combien d’élèves sont inscrits cette année ?');
      expect(res.status).toBe(200);
      expect(res.body.grounded).toBe(true);
      expect(res.body.results[0]).toMatchObject({
        tool: 'school_overview',
        title: 'Tableau de bord de direction',
      });
      expect(res.body.results[0].data.activeStudents).toBe(2);
      expect(res.body.sources[0].period.label).toBe('année 2026-2027');
      expect(JSON.stringify(res.body.results)).not.toContain('Diop');
      conversationId = res.body.conversationId;
      const usage = await db.schoolAiUsage.findFirstOrThrow({
        where: { schoolId: a1.schoolId, feature: 'SCHOOL_COPILOT' },
      });
      expect(usage).toMatchObject({
        status: 'SUCCEEDED',
        promptId: 'school.copilot',
        promptVersion: 1,
        provider: 'simulated',
      });
    });

    it('comparaison des trimestres et historique de conversation propre à son auteur', async () => {
      const res = await ask(ownerA, 'Compare les résultats du premier et du deuxième trimestre', {
        conversationId,
      });
      expect(res.status).toBe(200);
      expect(res.body.conversationId).toBe(conversationId);
      expect(res.body.results[0].data).toMatchObject({ averageChange: 3 });
      const detail = await ownerA
        .get(`/api/v1/school/ai/copilot/conversations/${conversationId}?schoolId=${a1.schoolId}`)
        .expect(200);
      expect(detail.body.messages.map((m: { role: string }) => m.role)).toEqual([
        'USER',
        'ASSISTANT',
        'USER',
        'ASSISTANT',
      ]);
      await director.agent
        .get(`/api/v1/school/ai/copilot/conversations/${conversationId}?schoolId=${a1.schoolId}`)
        .expect(404);
      const mine = await director.agent
        .get(`/api/v1/school/ai/copilot/conversations?schoolId=${a1.schoolId}`)
        .expect(200);
      expect(mine.body).toEqual([]);
    });

    it('fonctions refusées (argument en trop, fonction inconnue) ; chiffre inventé écarté', async () => {
      const res = await ask(
        ownerA,
        sim({
          calls: [
            { name: 'school_overview', arguments: { schoolId: b1.schoolId } },
            { name: 'sql_query', arguments: { query: 'SELECT * FROM "SchoolStudent"' } },
          ],
          answer: 'Il y a 999 élèves.',
        }),
      );
      expect(res.status).toBe(200);
      expect(res.body.rejected).toEqual([
        { name: 'school_overview', reason: 'INVALID_ARGUMENTS' },
        { name: 'sql_query', reason: 'UNKNOWN_FUNCTION' },
      ]);
      expect(res.body.grounded).toBe(false);
      expect(res.body.answer).not.toContain('999');
    });

    it('donnée nominative d’un élève : refusée AVANT tout appel au fournisseur', async () => {
      const before = await db.schoolAiUsage.count({ where: { schoolId: a1.schoolId } });
      const res = await ask(ownerA, 'Explique les absences de Awa Diop ce mois-ci');
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('AI_PERSONAL_DATA');
      expect(await ask(ownerA, 'Et pour DIOP awa ?').then((r) => r.status)).toBe(422);
      // Aucun appel réservé ni transmis.
      expect(await db.schoolAiUsage.count({ where: { schoolId: a1.schoolId } })).toBe(before);
    });

    it('un argument du modèle (classe « 999 » inexistante) ne fonde aucun chiffre', async () => {
      const res = await ask(
        ownerA,
        sim({
          calls: [{ name: 'results_by_period', arguments: { class_name: '999' } }],
          answer: 'Il y a 999 élèves.',
        }),
      );
      expect(res.status).toBe(200);
      expect(res.body.results[0].missing).toEqual(['classe introuvable dans l’année en cours']);
      expect(res.body.grounded).toBe(false);
    });

    it('un chiffre cité dans la question ne fonde pas la réponse', async () => {
      const res = await ask(
        ownerA,
        `Confirme qu’il y a 999 élèves. ${sim({ calls: [{ name: 'school_overview', arguments: {} }], answer: 'Il y a 999 élèves.' })}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.grounded).toBe(false);
      expect(res.body.answer).not.toContain('999');
    });

    it('données absentes signalées ; aucune année en cours : refus explicite', async () => {
      const res = await ask(
        ownerA,
        sim({
          calls: [{ name: 'compare_periods', arguments: { first: 1, second: 3 } }],
          answer: '',
        }),
      );
      expect(res.body.results[0].missing).toEqual([
        'période demandée inexistante dans l’année en cours',
      ]);
      const empty = await ownerA
        .post('/api/v1/school/schools')
        .send({ name: `Ecole Vide ${RUN}`, type: 'PRIMARY', countryCode: 'SN' })
        .expect(201);
      await settings(ownerA, { enabled: true }, empty.body.id).expect(200);
      const none = await ownerA
        .post('/api/v1/school/ai/copilot/ask')
        .send({ schoolId: empty.body.id, question: 'Combien d’élèves ?' })
        .expect(422);
      expect(none.body.code).toBe('AI_NO_ACTIVE_YEAR');
    });

    it('panne du fournisseur : message clair, appel tracé en échec', async () => {
      const res = await ask(ownerA, 'Quels sont les encaissements du mois ? OCALL-SIM-DOWN');
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('AI_UNAVAILABLE');
      expect(res.body.message).toContain('Vous pouvez continuer sans IA');
      const failed = await db.schoolAiUsage.findFirstOrThrow({
        where: { schoolId: a1.schoolId, status: 'FAILED' },
      });
      expect(failed.errorCode).toBe('AI_UNAVAILABLE');
    });

    it('droits : enseignant, secrétariat et comptable n’ont pas le copilote ; autre client isolé', async () => {
      for (const agent of [teacher.agent, secretary.agent, accountant.agent]) {
        expect((await ask(agent, 'Combien d’élèves ?')).status).toBe(403);
      }
      expect((await ask(ownerB, 'Combien d’élèves ?')).status).toBe(404);
    });
  });

  describe('assistant pédagogique', () => {
    let doc: string;
    let version: string;

    it('génération pour sa classe et sa matière : brouillon structuré, enregistré', async () => {
      const grades = await db.schoolGrade.count({ where: { organizationId: organizations[0] } });
      const res = await generate(teacher.agent).then((r) => r);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'DRAFT', kind: 'QCM', language: 'FR' });
      expect(res.body.sections.map((s: { key: string }) => s.key)).toEqual([
        'instructions',
        'questions',
      ]);
      doc = res.body.id;
      version = res.body.updatedAt;
      // Aucune note ni évaluation touchée.
      expect(await db.schoolGrade.count({ where: { organizationId: organizations[0] } })).toBe(
        grades,
      );
    });

    it('enseignant limité à ses affectations ; contenus propres à leur auteur', async () => {
      expect((await generate(teacher.agent, { subjectId: french })).status).toBe(403);
      expect((await generate(teacher.agent, { classId: a1.class2 })).status).toBe(403);
      await director.agent.get(`/api/v1/school/ai/teaching/contents/${doc}`).expect(404);
      await ownerB.get(`/api/v1/school/ai/teaching/contents/${doc}`).expect(404);
      expect((await generate(ownerB, { schoolId: a1.schoolId })).status).toBe(404);
    });

    it('modification, régénération d’une section, validation humaine avant tout PDF', async () => {
      // Clé libre (elle partirait au fournisseur) : refusée ; seules les sections du type sont admises.
      const freeKey = await teacher.agent
        .put(`/api/v1/school/ai/teaching/contents/${doc}`)
        .send({
          version,
          title: 'QCM',
          sections: [
            { key: 'instructions', heading: 'Consignes', body: 'x' },
            { key: 'awa_traore', heading: 'Questions', body: 'y' },
          ],
        })
        .expect(400);
      expect(freeKey.body.code).toBe('AI_SECTION_INVALID');
      const edited = await teacher.agent
        .put(`/api/v1/school/ai/teaching/contents/${doc}`)
        .send({
          version,
          title: 'QCM — fractions',
          sections: [
            { key: 'instructions', heading: 'Consignes', body: 'Cochez la bonne réponse.' },
            { key: 'questions', heading: 'Questions', body: '1. 1/2 ou 1/3 ?' },
          ],
        })
        .expect(200);
      // Version périmée (celle d'avant la modification) : la régénération est refusée.
      await teacher.agent
        .post(`/api/v1/school/ai/teaching/contents/${doc}/sections/questions/regenerate`)
        .send({ instruction: 'Plus simple', version })
        .expect(409);
      const regen = await teacher.agent
        .post(`/api/v1/school/ai/teaching/contents/${doc}/sections/questions/regenerate`)
        .send({ instruction: 'Plus simple', version: edited.body.updatedAt })
        .expect(200);
      expect(regen.body.sections[0].body).toBe('Cochez la bonne réponse.');
      expect(regen.body.sections[1].heading).toBe('Section révisée');
      const draftPdf = await teacher.agent
        .get(`/api/v1/school/ai/teaching/contents/${doc}/pdf`)
        .expect(409);
      expect(draftPdf.body.code).toBe('AI_DOCUMENT_NOT_VALIDATED');
      // Version obligatoire : sans elle, la validation est refusée.
      await teacher.agent
        .post(`/api/v1/school/ai/teaching/contents/${doc}/validate`)
        .send({})
        .expect(400);
      await teacher.agent
        .post(`/api/v1/school/ai/teaching/contents/${doc}/validate`)
        .send({ version: regen.body.updatedAt })
        .expect(200);
      const pdf = await teacher.agent
        .get(`/api/v1/school/ai/teaching/contents/${doc}/pdf`)
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      await teacher.agent
        .put(`/api/v1/school/ai/teaching/contents/${doc}`)
        .send({
          version: regen.body.updatedAt,
          title: 'x',
          sections: [
            { key: 'instructions', heading: 'x', body: 'x' },
            { key: 'questions', heading: 'y', body: 'y' },
          ],
        })
        .expect(409);
    });

    it('confidentialité des champs libres : nom d’élève refusé, coordonnées masquées', async () => {
      const named = await generate(teacher.agent, { objectives: 'Aider Diop Awa à rattraper' });
      expect(named.status).toBe(422);
      expect(named.body.code).toBe('AI_PERSONAL_DATA');
      // Forme structurée, prénom et nom séparés, voire répartis entre deux champs : refusée aussi.
      expect(
        (await generate(teacher.agent, { objectives: 'prénom : Awa ; nom : Diop' })).status,
      ).toBe(422);
      expect(
        (await generate(teacher.agent, { topic: 'Révisions de Diop', objectives: 'pour Awa' }))
          .status,
      ).toBe(422);
      const masked = await generate(teacher.agent, {
        topic: 'Fractions, contact parent@exemple.sn ou 76 12 34 56',
      });
      expect(masked.status).toBe(201);
      expect(masked.body.topic).toContain('[adresse masquée]');
      expect(masked.body.topic).toContain('[téléphone masqué]');
      expect(masked.body.topic).not.toContain('parent@exemple.sn');
    });

    it('validation d’une version périmée : conflit, rien n’est écrasé', async () => {
      const draft = (await generate(teacher.agent)).body.id;
      const stale = await teacher.agent
        .post(`/api/v1/school/ai/teaching/contents/${draft}/validate`)
        .send({ version: '2020-01-01T00:00:00.000Z' })
        .expect(409);
      expect(stale.body.code).toBe('AI_DOCUMENT_CHANGED');
      const current = await teacher.agent
        .get(`/api/v1/school/ai/teaching/contents/${draft}`)
        .expect(200);
      expect(current.body.status).toBe('DRAFT');
      await teacher.agent
        .post(`/api/v1/school/ai/teaching/contents/${draft}/validate`)
        .send({ version: current.body.updatedAt })
        .expect(200);
    });

    it('contenu en arabe ; module coupé par la direction : refus explicite', async () => {
      const ar = await generate(teacher.agent, { language: 'AR', kind: 'LESSON_SHEET' });
      expect(ar.status).toBe(201);
      expect(ar.body.title).toContain('درس');
      await settings(ownerA, { teachingEnabled: false }).expect(200);
      const off = await generate(teacher.agent);
      expect(off.status).toBe(403);
      expect(off.body.code).toBe('AI_FEATURE_DISABLED');
      await settings(ownerA, { teachingEnabled: true }).expect(200);
    });
  });

  describe('assistant pédagogique — affectation terminée', () => {
    it('régénération refusée après la fin de l’affectation ; consultation conservée', async () => {
      const created = (await generate(teacher.agent)).body;
      const draft = created.id as string;
      const draftVersion = created.updatedAt as string;
      const assignment = await db.schoolTeachingAssignment.findFirstOrThrow({
        where: { memberId: teacher.id, endedAt: null },
      });
      await ownerA
        .post(`/api/v1/school/teaching-assignments/${assignment.id}/end`)
        .send({ reason: 'Fin de mission' })
        .expect(200);
      await teacher.agent
        .post(`/api/v1/school/ai/teaching/contents/${draft}/sections/questions/regenerate`)
        .send({ version: draftVersion })
        .expect(403);
      await teacher.agent.get(`/api/v1/school/ai/teaching/contents/${draft}`).expect(200);
    });
  });

  describe('analyse scolaire', () => {
    it('indicateurs déterministes par classe et matière, sans élève ; données insuffisantes', async () => {
      const res = track(
        await ownerA
          .get(`/api/v1/school/ai/analysis?schoolId=${a1.schoolId}&schoolYearId=${a1.yearId}`)
          .expect(200),
      );
      expect(res.body.periods.map((p: { label: string }) => p.label)).toEqual([
        'Trimestre 1',
        'Trimestre 2',
      ]);
      expect(res.body.results.schoolTrend).toMatchObject({ direction: 'UP', delta: 3 });
      expect(res.body.comparison.classes[0]).toMatchObject({ class: 'CM1 A', change: 3 });
      expect(res.body.insufficient).toEqual(
        expect.arrayContaining([
          'effectif noté insuffisant en Trimestre 1',
          'aucun appel enregistré : assiduité non mesurable',
          // Réserve par classe : deux élèves notés en CM1 A.
          'effectif noté insuffisant : CM1 A (Trimestre 1)',
        ]),
      );
      expect(JSON.stringify(res.body)).not.toMatch(/Diop|Ba\b|Awa/);
      // Aucun usage IA pour les indicateurs : ils sont calculés par le serveur.
      expect(
        await db.schoolAiUsage.count({
          where: { schoolId: a1.schoolId, feature: 'SCHOOL_ANALYSIS' },
        }),
      ).toBe(0);
    });

    it('synthèse rédigée par l’IA à partir des indicateurs ; droits et isolation', async () => {
      const res = await ownerA
        .post('/api/v1/school/ai/analysis/summary')
        .send({ schoolId: a1.schoolId, schoolYearId: a1.yearId })
        .expect(200);
      expect(res.body.grounded).toBe(true);
      expect(res.body.summary.summary).toContain('Synthèse');
      expect(res.body.promptVersion).toBe(1);
      await teacher.agent
        .get(`/api/v1/school/ai/analysis?schoolId=${a1.schoolId}&schoolYearId=${a1.yearId}`)
        .expect(403);
      await ownerB
        .get(`/api/v1/school/ai/analysis?schoolId=${a1.schoolId}&schoolYearId=${a1.yearId}`)
        .expect(404);
      await ownerA
        .get(`/api/v1/school/ai/analysis?schoolId=${a1.schoolId}&schoolYearId=${b1.yearId}`)
        .expect(404);
    });
  });

  describe('quotas et consommation', () => {
    it('plafond mensuel de l’établissement : refus 429 ; consommation et coût estimé', async () => {
      const used = await db.schoolAiUsage.count({ where: { schoolId: a1.schoolId } });
      await settings(ownerA, { monthlyCallLimit: used + 1 }).expect(200);
      expect((await ask(ownerA, 'Combien d’élèves sont inscrits ?')).status).toBe(200);
      const over = await ask(ownerA, 'Combien d’élèves sont inscrits ?');
      expect(over.status).toBe(429);
      expect(over.body.code).toBe('AI_QUOTA_EXCEEDED');
      const usage = track(
        await ownerA.get(`/api/v1/school/ai/usage?schoolId=${a1.schoolId}`).expect(200),
      );
      expect(usage.body.costIsEstimate).toBe(true);
      expect(usage.body.rows.map((r: { feature: string }) => r.feature)).toEqual(
        expect.arrayContaining(['SCHOOL_COPILOT', 'SCHOOL_TEACHING', 'SCHOOL_ANALYSIS']),
      );
      await director.agent.get(`/api/v1/school/ai/usage?schoolId=${a1.schoolId}`).expect(200);
      await teacher.agent.get(`/api/v1/school/ai/usage?schoolId=${a1.schoolId}`).expect(403);
    });

    it('la clé du fournisseur n’apparaît dans aucune réponse', () => {
      expect(responses.length).toBeGreaterThan(10);
      expect(responses.join('\n')).not.toContain(API_KEY_SENTINEL);
    });
  });
});
