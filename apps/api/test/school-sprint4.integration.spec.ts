import type { INestApplication } from '@nestjs/common';
import request, { type Response } from 'supertest';
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
 * Ocall School, Sprint 4 : périodes, évaluations, notes et moyennes, validation, bulletins PDF,
 * mémorisation du Coran. Données entièrement fictives. Exige TEST_DATABASE_URL et
 * SCHOOL_TEST_DATABASE_URL (ou TEST_SCHOOL_DATABASE_URL).
 */
const suite =
  (process.env.SCHOOL_TEST_DATABASE_URL ?? process.env.TEST_SCHOOL_DATABASE_URL)
    ? describe
    : describe.skip;

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

/** Corps binaire d'une réponse PDF. */
function binary(res: Response, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

suite('Ocall School — Sprint 4, évaluations, bulletins et mémorisation (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: SchoolPrismaService;
  let platform: InternalAccount;
  let ownerA: Agent;
  let ownerB: Agent;
  let a1: Structure;
  let a2: Structure;
  let b1: Structure;
  let t1: Member; // mathématiques, toute la classe 1
  let t2: Member; // français, groupe G de la classe 1
  let t3: Member; // Coran, classe 1
  let idle: Member; // enseignant sans affectation
  let secretary: Member;
  let directorA2: Member;
  let maths: string;
  let francais: string;
  let coran: string;
  let groupG: string;
  let p1: string;
  let p2: string;
  let s1: string;
  let s2: string;
  let s3: string;
  let s4: string;
  let mathsEval: string;
  let t1Assignment: string;
  let otherPeriod: string;
  let sB: string;
  const enrollmentOf = new Map<string, string>();
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
        ownerEmail: email(`owner4-${label}`),
        reference: `OCS4-${RUN}-${++counter}`,
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
      .send({ name: `${name} ${RUN}`, type: 'FRANCO_ARABIC', countryCode: 'SN' })
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
      .send({
        schoolId: s.schoolId,
        lastName,
        firstName: 'Awa',
        birthDate: `2016-02-${String((++counter % 27) + 1).padStart(2, '0')}`,
      })
      .expect(201);
    const parent = await owner
      .post('/api/v1/school/guardians')
      .send({ schoolId: s.schoolId, lastName, firstName: 'Ousmane', phone: '+221 77 000 00 01' })
      .expect(201);
    await owner
      .post(`/api/v1/school/students/${created.body.id}/guardians`)
      .send({ guardianId: parent.body.id, relation: 'FATHER' })
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
    enrollmentOf.set(created.body.id, enrollment.body.id);
    return created.body.id as string;
  }

  const period = (owner: Agent, s: Structure, label: string, startsOn: string, endsOn: string) =>
    owner
      .post('/api/v1/school/periods')
      .send({ schoolYearId: s.yearId, kind: 'TRIMESTER', label, startsOn, endsOn });

  const evaluation = (agent: Agent, body: Record<string, unknown>) =>
    agent.post('/api/v1/school/evaluations').send({
      classId: a1.class1,
      periodId: p1,
      kind: 'HOMEWORK',
      title: 'Devoir',
      heldOn: '2026-10-20',
      maxScore: 20,
      ...body,
    });

  const grades = (agent: Agent, id: string, entries: unknown[], reason?: string) =>
    agent.put(`/api/v1/school/evaluations/${id}/grades`).send({ grades: entries, reason });

  const results = (agent: Agent, classId = a1.class1, periodId = p1) =>
    agent.get(`/api/v1/school/results?classId=${classId}&periodId=${periodId}`);

  const pdf = (agent: Agent, query: string) =>
    agent.get(`/api/v1/school/report-cards/pdf?${query}`).buffer(true).parse(binary);

  const setLocale = (locale: string) =>
    ownerA
      .patch(`/api/v1/school/schools/${a1.schoolId}`)
      .send({ defaultLocale: locale })
      .expect(200);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(SchoolPrismaService);
    platform = await internalAccount(app, prisma, `sc4-owner-${RUN}`, 'PLATFORM_OWNER');
    ownerA = await client('a');
    ownerB = await client('b');
    a1 = await structure(ownerA, 'Ecole Evaluations');
    a2 = await structure(ownerA, 'Ecole Voisine Evaluations');
    b1 = await structure(ownerB, 'Ecole Autre Client Evaluations');
    t1 = await member(ownerA, 'TEACHER', [a1.schoolId]);
    t2 = await member(ownerA, 'TEACHER', [a1.schoolId]);
    t3 = await member(ownerA, 'TEACHER', [a1.schoolId]);
    idle = await member(ownerA, 'TEACHER', [a1.schoolId]);
    secretary = await member(ownerA, 'SECRETARY', [a1.schoolId]);
    directorA2 = await member(ownerA, 'SCHOOL_DIRECTOR', [a2.schoolId]);

    const activate = async (key: string) =>
      (
        await ownerA
          .post(`/api/v1/school/subjects/catalog/${key}/activate`)
          .send({ schoolId: a1.schoolId })
          .expect(201)
      ).body.id as string;
    maths = await activate('mathematiques');
    francais = await activate('francais');
    coran = await activate('coran');
    await ownerA
      .put(`/api/v1/school/subjects/${maths}/levels`)
      .send({ levels: [{ levelId: a1.level1, coefficient: 3 }] })
      .expect(200);
    await ownerA
      .put(`/api/v1/school/subjects/${francais}/levels`)
      .send({ levels: [{ levelId: a1.level1, coefficient: 2 }] })
      .expect(200);
    await ownerA
      .put(`/api/v1/school/subjects/${coran}/levels`)
      .send({ levels: [{ levelId: a1.level1, coefficient: 1 }] })
      .expect(200);

    s1 = await enrolled(ownerA, a1, a1.class1, 'Ba');
    s2 = await enrolled(ownerA, a1, a1.class1, 'Cisse');
    s3 = await enrolled(ownerA, a1, a1.class1, 'Diop');
    s4 = await enrolled(ownerA, a1, a1.class2, 'Fall');
    sB = await enrolled(ownerB, b1, b1.class1, 'Gueye');
    groupG = (
      await ownerA
        .post(`/api/v1/school/classes/${a1.class1}/groups`)
        .send({ name: 'Groupe G' })
        .expect(201)
    ).body.id;
    await ownerA
      .put(`/api/v1/school/groups/${groupG}/students`)
      .send({ studentIds: [s1] })
      .expect(200);

    const assign = (body: Record<string, unknown>) =>
      ownerA.post('/api/v1/school/teaching-assignments').send(body).expect(201);
    t1Assignment = (await assign({ classId: a1.class1, subjectId: maths, memberId: t1.id })).body
      .id;
    await assign({ classId: a1.class1, subjectId: francais, memberId: t2.id, groupId: groupG });
    await assign({ classId: a1.class1, subjectId: coran, memberId: t3.id });

    p1 = (await period(ownerA, a1, 'Trimestre 1', '2026-10-01', '2026-12-20').expect(201)).body.id;
    p2 = (await period(ownerA, a1, 'Trimestre 2', '2027-01-04', '2027-03-31').expect(201)).body.id;
  }, 600_000);

  afterAll(async () => {
    const where = { organizationId: { in: organizations } };
    await db.schoolQuranEvaluation.deleteMany({ where });
    await db.schoolQuranProgress.deleteMany({ where });
    await db.schoolQuranSettings.deleteMany({ where });
    await db.schoolResultValidation.deleteMany({ where });
    await db.schoolReportComment.deleteMany({ where });
    await db.schoolAppreciation.deleteMany({ where });
    await db.schoolGradeEvent.deleteMany({ where });
    await db.schoolGrade.deleteMany({ where });
    await db.schoolEvaluation.deleteMany({ where });
    await db.gradingPolicyVersion.deleteMany({ where });
    await db.academicPeriod.deleteMany({ where });
    await db.schoolTeachingAssignment.deleteMany({ where });
    await db.schoolTeacherSubject.deleteMany({ where });
    await db.schoolClassGroupStudent.deleteMany({ where });
    await db.schoolClassGroup.deleteMany({ where });
    await db.subjectLevel.deleteMany({ where });
    await db.subject.deleteMany({ where });
    await db.schoolStudentEvent.deleteMany({ where });
    await db.schoolClassAssignment.deleteMany({ where });
    await db.schoolEnrollment.deleteMany({ where });
    await db.schoolStudentGuardian.deleteMany({ where });
    await db.schoolGuardian.deleteMany({ where });
    await db.schoolStudent.deleteMany({ where });
    await db.schoolNumberCounter.deleteMany({ where });
    await db.schoolStudentSettings.deleteMany({ where });
    await db.schoolClassTeacher.deleteMany({ where });
    await db.schoolClass.deleteMany({ where });
    await db.level.deleteMany({ where });
    await db.cycle.deleteMany({ where });
    await db.schoolAccessDecision.deleteMany({ where });
    await db.schoolYear.deleteMany({ where });
    await db.schoolMember.deleteMany({ where });
    await db.school.deleteMany({ where });
    await db.schoolGroup.deleteMany({ where });
    await cleanup(prisma);
    await app.close();
  });

  describe('périodes scolaires', () => {
    it('liste, modification, chevauchement refusé, suppression d’une période inutilisée', async () => {
      const list = await ownerA.get(`/api/v1/school/periods?schoolYearId=${a1.yearId}`).expect(200);
      expect(list.body.map((p: { label: string }) => p.label)).toEqual([
        'Trimestre 1',
        'Trimestre 2',
      ]);
      await ownerA
        .patch(`/api/v1/school/periods/${p2}`)
        .send({ label: 'Deuxième trimestre', labelAr: 'الفصل الثاني' })
        .expect(200);
      const overlap = await ownerA
        .patch(`/api/v1/school/periods/${p2}`)
        .send({ startsOn: '2026-12-01' })
        .expect(409);
      expect(overlap.body.code).toBe('PERIOD_OVERLAP');
      const outside = await ownerA
        .patch(`/api/v1/school/periods/${p2}`)
        .send({ endsOn: '2027-08-01' })
        .expect(400);
      expect(outside.body.code).toBe('PERIOD_OUTSIDE_YEAR');
      const spare = (
        await period(ownerA, a1, 'Trimestre 3', '2027-04-06', '2027-06-30').expect(201)
      ).body.id;
      await ownerA.delete(`/api/v1/school/periods/${spare}`).expect(200);
      await secretary.agent.patch(`/api/v1/school/periods/${p2}`).send({ label: 'X' }).expect(403);
      await ownerB.patch(`/api/v1/school/periods/${p2}`).send({ label: 'X' }).expect(404);
    });
  });

  describe('évaluations et permissions des enseignants', () => {
    it('la direction et l’enseignant affecté créent ; dates, matières et groupes contrôlés', async () => {
      mathsEval = (await evaluation(t1.agent, { subjectId: maths, maxScore: 20 }).expect(201)).body
        .id;
      await evaluation(ownerA, {
        subjectId: maths,
        title: 'Composition',
        kind: 'COMPOSITION',
        coefficient: 2,
      }).expect(201);
      // Matière non affectée, ou évaluation de toute la classe pour un enseignant de groupe.
      expect((await evaluation(t1.agent, { subjectId: francais }).expect(403)).body.code).toBe(
        'TEACHER_NOT_ASSIGNED',
      );
      await evaluation(t2.agent, { subjectId: francais }).expect(403);
      await evaluation(t2.agent, { subjectId: francais, groupId: groupG }).expect(201);
      await evaluation(idle.agent, { subjectId: maths }).expect(403);
      await evaluation(secretary.agent, { subjectId: maths }).expect(403);
      const outside = await evaluation(ownerA, { subjectId: maths, heldOn: '2027-01-10' }).expect(
        400,
      );
      expect(outside.body.code).toBe('EVALUATION_OUTSIDE_PERIOD');
      // Période d'une autre année, classe d'un autre client : introuvables.
      otherPeriod = (await period(ownerA, a2, 'T1', '2026-10-01', '2026-12-20').expect(201)).body
        .id;
      await evaluation(ownerA, { subjectId: maths, periodId: otherPeriod }).expect(404);
      await evaluation(ownerB, { subjectId: maths }).expect(404);
      await evaluation(directorA2.agent, { subjectId: maths }).expect(404);
      const zero = await evaluation(ownerA, { subjectId: maths, maxScore: 0 }).expect(400);
      expect(zero.body.code).toBe('VALIDATION_ERROR');
      // Champs obligatoires de la création : un barème absent est refusé dès la validation (jamais 500).
      const missing = await ownerA
        .post('/api/v1/school/evaluations')
        .send({
          classId: a1.class1,
          periodId: p1,
          subjectId: maths,
          kind: 'QUIZ',
          title: 'Sans barème',
          heldOn: '2026-10-20',
        })
        .expect(400);
      expect(missing.body.code).toBe('VALIDATION_ERROR');
      await ownerA
        .post('/api/v1/school/evaluations')
        .send({
          classId: a1.class1,
          periodId: p1,
          subjectId: maths,
          maxScore: 20,
          heldOn: '2026-10-20',
        })
        .expect(400);
    });

    it('chaque enseignant ne voit que les évaluations de ses affectations', async () => {
      const mine = await t1.agent
        .get(`/api/v1/school/evaluations?classId=${a1.class1}&periodId=${p1}`)
        .expect(200);
      expect(
        mine.body.evaluations.every((e: { subject: { id: string } }) => e.subject.id === maths),
      ).toBe(true);
      const group = await t2.agent
        .get(`/api/v1/school/evaluations?classId=${a1.class1}&periodId=${p1}`)
        .expect(200);
      expect(group.body.evaluations).toHaveLength(1);
      expect(group.body.evaluations[0].groupId).toBe(groupG);
      await idle.agent
        .get(`/api/v1/school/evaluations?classId=${a1.class1}&periodId=${p1}`)
        .expect(403);
      const all = await secretary.agent
        .get(`/api/v1/school/evaluations?classId=${a1.class1}&periodId=${p1}`)
        .expect(200);
      expect(all.body.evaluations).toHaveLength(3);
      await t2.agent.get(`/api/v1/school/evaluations/${mathsEval}`).expect(403);
    });

    it('une période qui porte des évaluations ne se supprime pas et ne les laisse pas dehors', async () => {
      expect((await ownerA.delete(`/api/v1/school/periods/${p1}`).expect(409)).body.code).toBe(
        'PERIOD_IN_USE',
      );
      const shrink = await ownerA
        .patch(`/api/v1/school/periods/${p1}`)
        .send({ endsOn: '2026-10-10' })
        .expect(409);
      expect(shrink.body.code).toBe('PERIOD_EVALUATIONS_OUTSIDE');
    });
  });

  describe('notes, absences, dispenses et journal', () => {
    it('saisie en tableau : note, absence et dispense distinctes d’un zéro', async () => {
      const res = await grades(t1.agent, mathsEval, [
        { studentId: s1, status: 'SCORED', score: 15 },
        { studentId: s2, status: 'ABSENT' },
        { studentId: s3, status: 'EXEMPT' },
      ]).expect(200);
      expect(res.body.changed).toBe(3);
      const byId = new Map(res.body.sheet.students.map((s: { id: string }) => [s.id, s])) as Map<
        string,
        { status: string; score: number | null }
      >;
      expect(byId.get(s1)).toMatchObject({ status: 'SCORED', score: 15 });
      expect(byId.get(s2)).toMatchObject({ status: 'ABSENT', score: null });
      expect(byId.get(s3)).toMatchObject({ status: 'EXEMPT', score: null });
      // Rien n'a changé : aucune réécriture, aucune trace.
      const again = await grades(t1.agent, mathsEval, [
        { studentId: s1, status: 'SCORED', score: 15 },
      ]).expect(200);
      expect(again.body.changed).toBe(0);
    });

    it('validation selon le barème ; élève d’une autre classe ou hors du groupe refusé', async () => {
      const above = await grades(t1.agent, mathsEval, [
        { studentId: s1, status: 'SCORED', score: 20.5 },
      ]).expect(400);
      expect(above.body.code).toBe('INVALID_GRADE');
      await grades(t1.agent, mathsEval, [{ studentId: s2, status: 'ABSENT', score: 0 }]).expect(
        400,
      );
      await grades(t1.agent, mathsEval, [
        { studentId: s1, status: 'SCORED', score: 12.345 },
      ]).expect(400);
      const foreign = await grades(t1.agent, mathsEval, [
        { studentId: s4, status: 'SCORED', score: 10 },
      ]).expect(400);
      expect(foreign.body.code).toBe('STUDENT_NOT_CONCERNED');
      await grades(t1.agent, mathsEval, [
        { studentId: s1, status: 'SCORED', score: 10 },
        { studentId: s1, status: 'SCORED', score: 11 },
      ]).expect(400);
      const groupEval = (
        await t2.agent
          .get(`/api/v1/school/evaluations?classId=${a1.class1}&periodId=${p1}`)
          .expect(200)
      ).body.evaluations[0].id;
      const outsideGroup = await grades(t2.agent, groupEval, [
        { studentId: s2, status: 'SCORED', score: 10 },
      ]).expect(400);
      expect(outsideGroup.body.code).toBe('STUDENT_NOT_CONCERNED');
      await grades(t2.agent, groupEval, [{ studentId: s1, status: 'SCORED', score: 16 }]).expect(
        200,
      );
      await grades(t2.agent, mathsEval, [{ studentId: s1, status: 'SCORED', score: 10 }]).expect(
        403,
      );
      await grades(secretary.agent, mathsEval, [
        { studentId: s1, status: 'SCORED', score: 10 },
      ]).expect(403);
      await grades(ownerB, mathsEval, [{ studentId: s1, status: 'SCORED', score: 10 }]).expect(404);
      // Élève d'un autre client dans une saisie locale : introuvable (404), pas une simple erreur de saisie.
      await grades(t1.agent, mathsEval, [{ studentId: sB, status: 'SCORED', score: 10 }]).expect(
        404,
      );
    });

    it('modification et effacement journalisés : avant, après, auteur et motif', async () => {
      await grades(
        t1.agent,
        mathsEval,
        [{ studentId: s1, status: 'SCORED', score: 12 }],
        'Erreur de report',
      ).expect(200);
      await grades(ownerA, mathsEval, [{ studentId: s3, status: null }], 'Dispense annulée').expect(
        200,
      );
      const history = await ownerA
        .get(`/api/v1/school/evaluations/${mathsEval}/grades/${s1}/history`)
        .expect(200);
      expect(history.body.map((e: { action: string }) => e.action)).toEqual(['updated', 'created']);
      expect(history.body[0]).toMatchObject({
        before: { status: 'SCORED', score: 15 },
        after: { status: 'SCORED', score: 12 },
        reason: 'Erreur de report',
      });
      const cleared = await ownerA
        .get(`/api/v1/school/evaluations/${mathsEval}/grades/${s3}/history`)
        .expect(200);
      expect(cleared.body[0]).toMatchObject({ action: 'deleted', after: null });
      // Une évaluation notée, même effacée depuis, ne se supprime plus ; un barème ne descend pas
      // sous une note saisie.
      expect(
        (await ownerA.delete(`/api/v1/school/evaluations/${mathsEval}`).expect(409)).body.code,
      ).toBe('EVALUATION_GRADED');
      expect(
        (
          await ownerA
            .patch(`/api/v1/school/evaluations/${mathsEval}`)
            .send({ maxScore: 10 })
            .expect(409)
        ).body.code,
      ).toBe('GRADES_ABOVE_MAX');
      await t2.agent
        .get(`/api/v1/school/evaluations/${mathsEval}/grades/${s1}/history`)
        .expect(403);
      await ownerA.get(`/api/v1/school/evaluations/${mathsEval}/grades/${sB}/history`).expect(404);
      // Élève sorti du groupe : l'enseignant du groupe ne lit plus son historique (404) ; la direction si.
      const groupEval = (
        await t2.agent
          .get(`/api/v1/school/evaluations?classId=${a1.class1}&periodId=${p1}`)
          .expect(200)
      ).body.evaluations[0].id;
      await t2.agent
        .get(`/api/v1/school/evaluations/${groupEval}/grades/${s1}/history`)
        .expect(200);
      await ownerA
        .put(`/api/v1/school/groups/${groupG}/students`)
        .send({ studentIds: [] })
        .expect(200);
      await t2.agent
        .get(`/api/v1/school/evaluations/${groupEval}/grades/${s1}/history`)
        .expect(404);
      await ownerA.get(`/api/v1/school/evaluations/${groupEval}/grades/${s1}/history`).expect(200);
      await ownerA
        .put(`/api/v1/school/groups/${groupG}/students`)
        .send({ studentIds: [s1] })
        .expect(200);
      await ownerA
        .get(`/api/v1/school/results/validations?classId=${a1.class1}&periodId=${otherPeriod}`)
        .expect(404);
    });
  });

  describe('moyennes, classement et appréciations', () => {
    it('moyennes pondérées, absence écartée, matières de l’enseignant seulement', async () => {
      const composition = (
        await ownerA
          .get(`/api/v1/school/evaluations?classId=${a1.class1}&periodId=${p1}&subjectId=${maths}`)
          .expect(200)
      ).body.evaluations.find((e: { kind: string }) => e.kind === 'COMPOSITION').id;
      await grades(ownerA, composition, [
        { studentId: s1, status: 'SCORED', score: 18 },
        { studentId: s2, status: 'SCORED', score: 14 },
        { studentId: s3, status: 'SCORED', score: 14 },
      ]).expect(200);
      const res = await results(ownerA).expect(200);
      const of = (id: string) =>
        res.body.results.students.find((s: { studentId: string }) => s.studentId === id);
      const mathsOf = (id: string) =>
        of(id).subjects.find((s: { subjectId: string }) => s.subjectId === maths);
      // s1 : (12×1 + 18×2) / 3 = 16 ; s2 : absent au devoir, écarté → 14.
      expect(mathsOf(s1).average).toBe(16);
      expect(mathsOf(s2)).toMatchObject({ average: 14, absent: 1 });
      // s1 : maths 16 (coef 3), français 16 (coef 2, groupe) → 16 ; s2 et s3 ex æquo sur 14.
      expect(of(s1).generalAverage).toBe(16);
      expect(of(s1).rank).toBe(1);
      expect([of(s2).rank, of(s3).rank]).toEqual([2, 2]);
      expect(of(s2).tied).toBe(true);

      const restricted = await results(t1.agent).expect(200);
      expect(restricted.body.restricted).toBe(true);
      expect(restricted.body.subjects.map((s: { id: string }) => s.id)).toEqual([maths]);
      expect(
        restricted.body.results.students.every(
          (s: { generalAverage: null; rank: null }) => s.generalAverage === null && s.rank === null,
        ),
      ).toBe(true);
      await results(idle.agent).expect(403);
      await results(ownerB).expect(404);
      // Classe d’établissement d’un autre client : introuvable, même avec un identifiant valide.
      await results(ownerA, b1.class1, p1).expect(404);
    });

    it('règles de l’établissement : une absence peut valoir zéro, le classement se désactive', async () => {
      await ownerA
        .post('/api/v1/school/grading-policies')
        .send({
          schoolId: a1.schoolId,
          effectiveFrom: '2026-09-01',
          rules: {
            scale: 20,
            passMark: 10,
            decimals: 2,
            ranking: { enabled: false, ties: 'SHARED', excludedSubjectIds: [] },
            absences: 'ZERO',
          },
        })
        .expect(201);
      const res = await results(ownerA).expect(200);
      const s2Maths = res.body.results.students
        .find((s: { studentId: string }) => s.studentId === s2)
        .subjects.find((s: { subjectId: string }) => s.subjectId === maths);
      // (0×1 + 14×2) / 3 = 9,33
      expect(s2Maths.average).toBe(9.33);
      expect(res.body.results.rankingEnabled).toBe(false);
      await ownerA
        .post('/api/v1/school/grading-policies')
        .send({
          schoolId: a1.schoolId,
          effectiveFrom: '2026-09-02',
          rules: {
            scale: 20,
            passMark: 10,
            decimals: 2,
            ranking: { enabled: true, ties: 'SHARED', excludedSubjectIds: [] },
            absences: 'EXCLUDED',
          },
        })
        .expect(201);
    });

    it('règles mal formées ou matière exclue étrangère : refusées avant enregistrement', async () => {
      const policy = (excludedSubjectIds: unknown) =>
        ownerA.post('/api/v1/school/grading-policies').send({
          schoolId: a1.schoolId,
          effectiveFrom: '2026-09-04',
          rules: {
            scale: 20,
            passMark: 10,
            decimals: 2,
            ranking: { enabled: true, ties: 'SHARED', excludedSubjectIds },
          },
        });
      expect((await policy({}).expect(400)).body.code).toBe('INVALID_GRADING_RULES');
      expect((await policy(['pas-un-uuid']).expect(400)).body.code).toBe('INVALID_GRADING_RULES');
      const foreign = (
        await ownerA
          .post(`/api/v1/school/subjects/catalog/mathematiques/activate`)
          .send({ schoolId: a2.schoolId })
          .expect(201)
      ).body.id;
      expect((await policy([foreign]).expect(400)).body.code).toBe('INVALID_GRADING_RULES');
      await results(ownerA).expect(200);
      // Identifiant en majuscules : accepté et enregistré en minuscules, donc réellement appliqué.
      const upper = await policy([francais.toUpperCase()]).expect(201);
      const stored = await db.gradingPolicyVersion.findUniqueOrThrow({
        where: { id: upper.body.id },
      });
      expect(
        (stored.rules as { ranking: { excludedSubjectIds: string[] } }).ranking.excludedSubjectIds,
      ).toEqual([francais]);
      // Version suivante identique aux règles en vigueur avant ce test : la suite n'en dépend pas.
      await ownerA
        .post('/api/v1/school/grading-policies')
        .send({
          schoolId: a1.schoolId,
          effectiveFrom: '2026-09-05',
          rules: {
            scale: 20,
            passMark: 10,
            decimals: 2,
            ranking: { enabled: true, ties: 'SHARED', excludedSubjectIds: [] },
            absences: 'EXCLUDED',
          },
        })
        .expect(201);
    });

    it('appréciations : l’enseignant pour sa matière et ses élèves seulement', async () => {
      const save = (agent: Agent, subjectId: string, items: unknown[]) =>
        agent
          .put('/api/v1/school/results/appreciations')
          .send({ classId: a1.class1, periodId: p1, subjectId, items });
      await save(t1.agent, maths, [
        { studentId: s1, text: 'Très bon trimestre.', textAr: 'فصل جيد جدا.' },
      ]).expect(200);
      await save(t1.agent, francais, [{ studentId: s1, text: 'Hors affectation' }]).expect(403);
      expect(
        (await save(t2.agent, francais, [{ studentId: s2, text: 'Hors groupe' }]).expect(400)).body
          .code,
      ).toBe('STUDENT_NOT_CONCERNED');
      await save(t2.agent, francais, [{ studentId: s1, text: 'Lecture fluide.' }]).expect(200);
      // Arabe absent de la saisie (formulaire en Français) : la traduction conservée n'est pas effacée.
      const stored = () =>
        db.schoolAppreciation.findUnique({
          where: {
            periodId_classId_subjectId_studentId: {
              periodId: p1,
              classId: a1.class1,
              subjectId: maths,
              studentId: s1,
            },
          },
        });
      await save(t1.agent, maths, [
        { studentId: s1, text: 'Très bon trimestre, régulier.' },
      ]).expect(200);
      expect(await stored()).toMatchObject({
        text: 'Très bon trimestre, régulier.',
        textAr: 'فصل جيد جدا.',
      });
      await save(t1.agent, maths, [{ studentId: s1, text: '' }]).expect(200);
      expect((await stored())?.textAr).toBe('فصل جيد جدا.');
      await save(t1.agent, maths, [{ studentId: s1, text: 'Très bon trimestre.' }]).expect(200);
      await save(secretary.agent, maths, [{ studentId: s1, text: 'X' }]).expect(403);
      // Élève d'un autre client : introuvable, jamais verrouillé.
      await save(t1.agent, maths, [{ studentId: sB, text: 'X' }]).expect(404);
    });

    it('enseignant de groupe : ses élèves et ses évaluations seulement, agrégats compris', async () => {
      // Une évaluation de français pour toute la classe, notée par la direction, ne le concerne pas.
      const whole = (
        await evaluation(ownerA, {
          subjectId: francais,
          title: 'Dictée classe',
          heldOn: '2026-10-22',
        }).expect(201)
      ).body.id;
      await grades(ownerA, whole, [
        { studentId: s1, status: 'SCORED', score: 4 },
        { studentId: s2, status: 'SCORED', score: 8 },
      ]).expect(200);
      await ownerA
        .put('/api/v1/school/results/appreciations')
        .send({
          classId: a1.class1,
          periodId: p1,
          subjectId: francais,
          items: [{ studentId: s2, text: 'Hors groupe' }],
        })
        .expect(200);
      const res = await results(t2.agent).expect(200);
      expect(res.body.students.map((s: { id: string }) => s.id)).toEqual([s1]);
      const fr = res.body.results.students[0].subjects.find(
        (x: { subjectId: string }) => x.subjectId === francais,
      );
      // Seule l'évaluation du groupe (16) compte, pas la dictée de la classe.
      expect(fr).toMatchObject({ average: 16, scored: 1 });
      expect(res.body.results.subjects[0]).toMatchObject({ subjectId: francais, classAverage: 16 });
      expect(res.body.appreciations.every((a: { studentId: string }) => a.studentId === s1)).toBe(
        true,
      );
      expect(res.body.appreciationStudents).toEqual({ [francais]: [s1] });
      // La direction voit toute la classe : s1 = (16 + 4) / 2 en français.
      const all = await results(ownerA).expect(200);
      const s1Fr = all.body.results.students
        .find((x: { studentId: string }) => x.studentId === s1)
        .subjects.find((x: { subjectId: string }) => x.subjectId === francais);
      expect(s1Fr.average).toBe(10);
      // Remise en l'état pour la suite : la dictée est effacée de la feuille (sa trace reste au journal).
      await grades(ownerA, whole, [
        { studentId: s1, status: null },
        { studentId: s2, status: null },
      ]).expect(200);
      await ownerA
        .put('/api/v1/school/results/appreciations')
        .send({
          classId: a1.class1,
          periodId: p1,
          subjectId: francais,
          items: [{ studentId: s2, text: '' }],
        })
        .expect(200);
    });
  });

  describe('validation et verrouillage', () => {
    it('réservée à la direction ; ensuite notes, évaluations et appréciations sont refusées', async () => {
      const body = { classId: a1.class1, periodId: p1 };
      await secretary.agent.post('/api/v1/school/results/validate').send(body).expect(403);
      await t1.agent.post('/api/v1/school/results/validate').send(body).expect(403);
      const before = await results(ownerA).expect(200);
      await ownerA.post('/api/v1/school/results/validate').send(body).expect(200);
      expect(
        (await ownerA.post('/api/v1/school/results/validate').send(body).expect(409)).body.code,
      ).toBe('RESULTS_VALIDATED');

      const refused = await grades(t1.agent, mathsEval, [
        { studentId: s1, status: 'SCORED', score: 20 },
      ]).expect(409);
      expect(refused.body.code).toBe('RESULTS_VALIDATED');
      await evaluation(t1.agent, { subjectId: maths }).expect(409);
      await ownerA
        .patch(`/api/v1/school/evaluations/${mathsEval}`)
        .send({ title: 'X' })
        .expect(409);
      await t1.agent
        .put('/api/v1/school/results/appreciations')
        .send({
          classId: a1.class1,
          periodId: p1,
          subjectId: maths,
          items: [{ studentId: s1, text: 'X' }],
        })
        .expect(409);
      // L'appréciation générale de la direction reste possible après validation.
      await ownerA
        .put('/api/v1/school/results/comments')
        .send({ ...body, items: [{ studentId: s1, text: 'Félicitations.', textAr: 'تهانينا.' }] })
        .expect(200);
      await secretary.agent
        .put('/api/v1/school/results/comments')
        .send({ ...body, items: [{ studentId: s1, text: 'X' }] })
        .expect(403);

      // Résultats figés : une nouvelle version des règles ne change rien.
      await ownerA
        .post('/api/v1/school/grading-policies')
        .send({
          schoolId: a1.schoolId,
          effectiveFrom: '2026-09-03',
          rules: {
            scale: 10,
            passMark: 5,
            decimals: 1,
            ranking: { enabled: true, ties: 'DENSE', excludedSubjectIds: [] },
          },
        })
        .expect(201);
      const frozen = await results(ownerA).expect(200);
      expect(frozen.body.validation).not.toBeNull();
      expect(frozen.body.results).toEqual(before.body.results);
      expect(frozen.body.rules.scale).toBe(20);
      const teacherView = await results(t1.agent).expect(200);
      expect(teacherView.body.rules.scale).toBe(20);
      const mathsOf = (body: {
        results: {
          students: {
            studentId: string;
            subjects: { subjectId: string; average: number | null }[];
          }[];
        };
      }) =>
        body.results.students
          .find((x) => x.studentId === s1)!
          .subjects.find((x) => x.subjectId === maths)!.average;
      expect(mathsOf(teacherView.body)).toBe(mathsOf(frozen.body));
    });

    it('réouverture motivée : la saisie reprend, l’historique garde la validation', async () => {
      const body = { classId: a1.class1, periodId: p1 };
      await ownerA.post('/api/v1/school/results/unlock').send(body).expect(400);
      await t1.agent
        .post('/api/v1/school/results/unlock')
        .send({ ...body, reason: 'Erreur' })
        .expect(403);
      await ownerA
        .post('/api/v1/school/results/unlock')
        .send({ ...body, reason: 'Correction d’une note' })
        .expect(200);
      await grades(t1.agent, mathsEval, [{ studentId: s1, status: 'SCORED', score: 13 }]).expect(
        200,
      );
      const history = await ownerA
        .get(`/api/v1/school/results/validations?classId=${a1.class1}&periodId=${p1}`)
        .expect(200);
      expect(history.body).toHaveLength(1);
      expect(history.body[0].unlockReason).toBe('Correction d’une note');
      // Après réouverture, les nouvelles règles (sur 10) s'appliquent au calcul.
      expect((await results(ownerA).expect(200)).body.rules.scale).toBe(10);
      const decisions = await db.schoolAccessDecision.findMany({
        where: { organizationId: organizations[0], targetId: a1.class1 },
        select: { action: true, metadata: true },
      });
      const actions = decisions.map((d) => d.action);
      expect(actions).toEqual(
        expect.arrayContaining(['school.results_validated', 'school.results_unlocked']),
      );
      // Le motif de réouverture ne sort pas dans le journal.
      expect(JSON.stringify(decisions)).not.toContain('Correction');
    });
  });

  describe('vue enseignant d’une feuille validée', () => {
    it('groupes figés : un retrait de groupe après validation ne change pas la moyenne affichée', async () => {
      const body = { classId: a1.class1, periodId: p1 };
      await ownerA.post('/api/v1/school/results/validate').send(body).expect(200);
      const average = async () =>
        (await results(t2.agent).expect(200)).body.results.students
          .find((x: { studentId: string }) => x.studentId === s1)
          ?.subjects.find((x: { subjectId: string }) => x.subjectId === francais)?.average;
      const before = await average();
      // Valeur sur le barème figé à la validation ; seule sa stabilité compte ici.
      expect(typeof before).toBe('number');
      await ownerA
        .put(`/api/v1/school/groups/${groupG}/students`)
        .send({ studentIds: [] })
        .expect(200);
      try {
        expect(await average()).toBe(before);
      } finally {
        await ownerA
          .put(`/api/v1/school/groups/${groupG}/students`)
          .send({ studentIds: [s1] })
          .expect(200);
        await ownerA
          .post('/api/v1/school/results/unlock')
          .send({ ...body, reason: 'Essai des groupes figés' })
          .expect(200);
      }
    });
  });

  describe('bulletins PDF', () => {
    it('direction et secrétariat éditent ; enseignant, autre client et autre école refusés', async () => {
      const res = await pdf(secretary.agent, `classId=${a1.class1}&periodId=${p1}`).expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="bulletins-classe\.pdf"$/,
      );
      const body = res.body as Buffer;
      expect(body.subarray(0, 5).toString()).toBe('%PDF-');
      expect(body.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(3);

      const one = await pdf(ownerA, `classId=${a1.class1}&periodId=${p1}&studentId=${s1}`).expect(
        200,
      );
      expect((one.body as Buffer).toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);
      await pdf(ownerA, `classId=${a1.class1}&periodId=${p1}&studentId=${s4}`).expect(404);
      await pdf(t1.agent, `classId=${a1.class1}&periodId=${p1}`).expect(403);
      await pdf(ownerB, `classId=${a1.class1}&periodId=${p1}`).expect(404);
      await pdf(directorA2.agent, `classId=${a1.class1}&periodId=${p1}`).expect(404);
      // Aucune adresse directe : sans session, refus.
      const anonymous = await request(app.getHttpServer()).get(
        `/api/v1/school/report-cards/pdf?classId=${a1.class1}&periodId=${p1}`,
      );
      expect([401, 403]).toContain(anonymous.status);
    });

    it('français, arabe et bilingue : police arabe incorporée seulement quand il le faut', async () => {
      const fonts = async () => {
        const res = await pdf(ownerA, `classId=${a1.class1}&periodId=${p1}&studentId=${s1}`).expect(
          200,
        );
        return (res.body as Buffer).toString('latin1');
      };
      expect(await fonts()).not.toMatch(/NotoNaskhArabic/);
      await setLocale('AR');
      expect(await fonts()).toMatch(/NotoNaskhArabic/);
      await setLocale('BILINGUAL');
      const bilingual = await fonts();
      expect(bilingual).toMatch(/NotoNaskhArabic/);
      expect(bilingual).toMatch(/NotoSans/);
      await setLocale('FR');
    });

    it('bulletins validés : élèves, effectif et rang figés malgré un changement de classe', async () => {
      const body = { classId: a1.class1, periodId: p1 };
      await ownerA.post('/api/v1/school/results/validate').send(body).expect(200);
      await ownerA
        .post(`/api/v1/school/enrollments/${enrollmentOf.get(s3)}/class`)
        .send({ classId: a1.class2 })
        .expect(200);
      const overview = await ownerA
        .get(`/api/v1/school/report-cards?classId=${a1.class1}&periodId=${p1}`)
        .expect(200);
      expect(overview.body.students.map((s: { id: string }) => s.id)).toContain(s3);
      await pdf(ownerA, `classId=${a1.class1}&periodId=${p1}&studentId=${s3}`).expect(200);
      // Son bulletin reste commentable par la direction, bien qu'il ait changé de classe.
      await ownerA
        .put('/api/v1/school/results/comments')
        .send({ ...body, items: [{ studentId: s3, text: 'Bon trimestre malgré le changement.' }] })
        .expect(200);
      const all = await pdf(ownerA, `classId=${a1.class1}&periodId=${p1}`).expect(200);
      expect((all.body as Buffer).toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(3);
      // Retour à l'état précédent : l'élève revient, la feuille est rouverte.
      await ownerA
        .post(`/api/v1/school/enrollments/${enrollmentOf.get(s3)}/class`)
        .send({ classId: a1.class1 })
        .expect(200);
      await ownerA
        .post('/api/v1/school/results/unlock')
        .send({ ...body, reason: 'Essai de figement' })
        .expect(200);
    });

    it('classement et vue d’ensemble réservés à qui édite les bulletins', async () => {
      const overview = await secretary.agent
        .get(`/api/v1/school/report-cards?classId=${a1.class1}&periodId=${p1}`)
        .expect(200);
      expect(overview.body.students).toHaveLength(3);
      expect(overview.body.students.find((s: { id: string }) => s.id === s1).comment.text).toBe(
        'Félicitations.',
      );
      await t1.agent
        .get(`/api/v1/school/report-cards?classId=${a1.class1}&periodId=${p1}`)
        .expect(403);
    });
  });

  describe('révocation des droits', () => {
    it('fin d’affectation : l’enseignant perd immédiatement saisie et lecture', async () => {
      await ownerA
        .post(`/api/v1/school/teaching-assignments/${t1Assignment}/end`)
        .send({ reason: 'Mutation' })
        .expect(200);
      await grades(t1.agent, mathsEval, [{ studentId: s1, status: 'SCORED', score: 9 }]).expect(
        403,
      );
      await t1.agent
        .get(`/api/v1/school/evaluations?classId=${a1.class1}&periodId=${p1}`)
        .expect(403);
      await results(t1.agent).expect(403);
    });
  });

  describe('mémorisation du Coran', () => {
    const settings = (agent: Agent, body: Record<string, unknown>) =>
      agent.put('/api/v1/school/quran/settings').send({ schoolId: a1.schoolId, ...body });
    const evaluate = (agent: Agent, studentId: string, body: Record<string, unknown>) =>
      agent.post(`/api/v1/school/quran/students/${studentId}/evaluations`).send({
        surah: 112,
        status: 'MEMORIZED',
        evaluatedOn: '2026-10-15',
        ...body,
      });

    it('indisponible hors Bilingue : activation refusée, données masquées', async () => {
      const state = await ownerA
        .get(`/api/v1/school/quran/settings?schoolId=${a1.schoolId}`)
        .expect(200);
      expect(state.body).toMatchObject({ available: false, active: false });
      expect(
        (await settings(ownerA, { enabled: true, subjectId: coran }).expect(409)).body.code,
      ).toBe('QURAN_MODULE_UNAVAILABLE');
      await ownerA.get(`/api/v1/school/quran/classes/${a1.class1}`).expect(404);
      await evaluate(t3.agent, s1, {}).expect(404);
    });

    it('activation en Bilingue par la direction, avec la matière Coran', async () => {
      await setLocale('BILINGUAL');
      await settings(secretary.agent, { enabled: true, subjectId: coran }).expect(403);
      await settings(t3.agent, { enabled: true, subjectId: coran }).expect(403);
      expect((await settings(ownerA, { enabled: true }).expect(400)).body.code).toBe(
        'QURAN_SUBJECT_REQUIRED',
      );
      const on = await settings(ownerA, { enabled: true, subjectId: coran }).expect(200);
      expect(on.body).toMatchObject({ available: true, enabled: true, active: true });
      await settings(ownerB, { enabled: true, subjectId: coran }).expect(404);
    });

    it('saisie par l’enseignant de la matière Coran, consultation par la direction, historique conservé', async () => {
      await evaluate(t3.agent, s1, { status: 'IN_PROGRESS', evaluatedOn: '2026-10-01' }).expect(
        201,
      );
      const res = await evaluate(t3.agent, s1, { remark: 'Récitation fluide' }).expect(201);
      const surah = res.body.surahs.find((s: { number: number }) => s.number === 112);
      expect(surah).toMatchObject({
        status: 'MEMORIZED',
        memorizedOn: '2026-10-15',
        nameAr: 'الإخلاص',
      });
      expect(res.body.history).toHaveLength(2);
      expect(res.body.summary.counts.MEMORIZED).toBe(1);
      // Deux évaluations le même jour : la dernière enregistrée (numéro d’ordre) fait l’état courant.
      const same = await evaluate(t3.agent, s1, {
        status: 'TO_REVIEW',
        evaluatedOn: '2026-10-15',
      }).expect(201);
      expect(same.body.surahs.find((x: { number: number }) => x.number === 112)).toMatchObject({
        status: 'TO_REVIEW',
        memorizedOn: '2026-10-15',
      });

      expect(
        (await evaluate(t3.agent, s1, { evaluatedOn: '2099-01-01' }).expect(400)).body.code,
      ).toBe('DATE_IN_FUTURE');
      await evaluate(t3.agent, s1, { surah: 115 }).expect(400);
      await evaluate(t2.agent, s1, {}).expect(403);
      await evaluate(ownerA, s1, {}).expect(403);
      // Élève hors des classes de l’enseignant : introuvable pour lui.
      await evaluate(t3.agent, s4, {}).expect(404);

      const cls = await ownerA.get(`/api/v1/school/quran/classes/${a1.class1}`).expect(200);
      expect(cls.body.find((s: { id: string }) => s.id === s1)).toMatchObject({
        lastEvaluatedOn: '2026-10-15',
        summary: { memorizedVerses: 4 },
      });
      await secretary.agent.get(`/api/v1/school/quran/classes/${a1.class1}`).expect(403);
      await t2.agent.get(`/api/v1/school/quran/classes/${a1.class1}`).expect(403);
      await ownerB.get(`/api/v1/school/quran/students/${s1}`).expect(404);
      await directorA2.agent.get(`/api/v1/school/quran/students/${s1}`).expect(404);

      // Consultations journalisées (données d'enseignement religieux de mineurs).
      const audit = await prisma.auditLog.findMany({
        where: { organizationId: organizations[0], action: { startsWith: 'school.quran_' } },
        select: { action: true },
      });
      expect(audit.map((a) => a.action)).toEqual(
        expect.arrayContaining(['school.quran_student_viewed', 'school.quran_class_viewed']),
      );
    });

    it('séparé des notes : aucune note, aucune moyenne ne vient de la mémorisation', async () => {
      const graded = await db.schoolGrade.count({
        where: { studentId: s1, evaluation: { subjectId: coran } },
      });
      expect(graded).toBe(0);
      const res = await results(ownerA).expect(200);
      const s1Coran = res.body.results.students
        .find((s: { studentId: string }) => s.studentId === s1)
        .subjects.find((s: { subjectId: string }) => s.subjectId === coran);
      expect(s1Coran.average).toBeNull();
    });

    it('vue de classe : un élève rattaché depuis à un autre établissement n’y figure plus', async () => {
      const before = await ownerA.get(`/api/v1/school/quran/classes/${a1.class1}`).expect(200);
      expect(before.body.map((x: { id: string }) => x.id)).toContain(s2);
      // Rattachement simulé à l'autre établissement du client (comme après une année clôturée puis un
      // transfert) : sa progression actuelle n'est plus exposée par l'ancienne classe.
      await db.schoolStudent.update({ where: { id: s2 }, data: { schoolId: a2.schoolId } });
      try {
        const after = await ownerA.get(`/api/v1/school/quran/classes/${a1.class1}`).expect(200);
        expect(after.body.map((x: { id: string }) => x.id)).not.toContain(s2);
      } finally {
        await db.schoolStudent.update({ where: { id: s2 }, data: { schoolId: a1.schoolId } });
      }
    });

    it('désactivation ou changement de langue : masqué, sans perte de l’historique', async () => {
      await settings(ownerA, { enabled: false }).expect(200);
      await ownerA.get(`/api/v1/school/quran/students/${s1}`).expect(404);
      await settings(ownerA, { enabled: true, subjectId: coran }).expect(200);
      await setLocale('FR');
      await t3.agent.get(`/api/v1/school/quran/students/${s1}`).expect(404);
      expect(await db.schoolQuranEvaluation.count({ where: { studentId: s1 } })).toBe(3);
      await setLocale('BILINGUAL');
      const back = await t3.agent.get(`/api/v1/school/quran/students/${s1}`).expect(200);
      expect(back.body.history).toHaveLength(3);
      await setLocale('FR');
    });
  });

  // Exige plusieurs connexions réelles : ignoré sur PGlite, qui exécute tout en séquence.
  const realDatabase = ![
    process.env.TEST_DATABASE_URL,
    process.env.SCHOOL_TEST_DATABASE_URL ?? process.env.TEST_SCHOOL_DATABASE_URL,
  ].some((url) => url?.includes('connection_limit=1'));
  (realDatabase ? describe : describe.skip)('concurrence', () => {
    async function whileLocked(table: string, id: string, work: () => Promise<void>) {
      let release!: () => void;
      let ready!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const locked = new Promise<void>((resolve) => (ready = resolve));
      const transaction = db.$transaction(
        async (tx) => {
          await tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1::uuid FOR UPDATE`, id);
          ready();
          await held;
        },
        { timeout: 60_000 },
      );
      await locked;
      try {
        await work();
      } finally {
        release();
        await transaction;
      }
    }

    const promptly = <T>(request: PromiseLike<T>) =>
      Promise.race([
        Promise.resolve(request),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('requête bloquée par un verrou étranger')), 5_000),
        ),
      ]);

    it('une saisie attend un transfert ou un changement de classe en cours sur l’élève', async () => {
      const evalP2 = (
        await evaluation(ownerA, {
          subjectId: maths,
          periodId: p2,
          heldOn: '2027-01-20',
          title: 'Attente',
        }).expect(201)
      ).body.id;
      let settled = false;
      let pending!: Promise<Response>;
      await whileLocked('SchoolStudent', s1, async () => {
        pending = Promise.resolve(
          grades(ownerA, evalP2, [{ studentId: s1, status: 'SCORED', score: 11 }]),
        ).finally(() => {
          settled = true;
        });
        await new Promise((r) => setTimeout(r, 1500));
        // Verrou exclusif de l'élève tenu (comme par un transfert) : la saisie ne passe pas avant lui.
        expect(settled).toBe(false);
      });
      expect((await pending).status).toBe(200);
    });

    it('une évaluation coranique attend un changement de groupe en cours dans la classe', async () => {
      await setLocale('BILINGUAL');
      try {
        let settled = false;
        let pending!: Promise<Response>;
        await whileLocked('SchoolClass', a1.class1, async () => {
          pending = Promise.resolve(
            t3.agent
              .post(`/api/v1/school/quran/students/${s1}/evaluations`)
              .send({ surah: 1, status: 'IN_PROGRESS', evaluatedOn: '2026-10-20' }),
          ).finally(() => {
            settled = true;
          });
          await new Promise((r) => setTimeout(r, 1500));
          expect(settled).toBe(false);
        });
        expect((await pending).status).toBe(201);
      } finally {
        await setLocale('FR');
      }
    });

    it('une validation attend la sortie en cours d’un élève de la classe', async () => {
      let settled = false;
      let pending!: Promise<Response>;
      await whileLocked('SchoolStudent', s2, async () => {
        pending = Promise.resolve(
          ownerA.post('/api/v1/school/results/validate').send({ classId: a1.class1, periodId: p2 }),
        ).finally(() => {
          settled = true;
        });
        await new Promise((r) => setTimeout(r, 1500));
        // Élève tenu en exclusif (comme par une sortie) : la validation ne fige rien avant la fin.
        expect(settled).toBe(false);
      });
      expect((await pending).status).toBe(200);
      await ownerA
        .post('/api/v1/school/results/unlock')
        .send({ classId: a1.class1, periodId: p2, reason: 'Essai de sortie concurrente' })
        .expect(200);
    });

    it('une validation envoyée en majuscules attend le même verrou de feuille', async () => {
      let release!: () => void;
      let ready!: () => void;
      const held = new Promise<void>((r) => (release = r));
      const locked = new Promise<void>((r) => (ready = r));
      const key = `school-results:${a1.class1}:${p2}`;
      const holder = db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
          ready();
          await held;
        },
        { timeout: 60_000 },
      );
      await locked;
      let settled = false;
      const pending = Promise.resolve(
        ownerA
          .post('/api/v1/school/results/validate')
          .send({ classId: a1.class1.toUpperCase(), periodId: p2.toUpperCase() }),
      ).finally(() => {
        settled = true;
      });
      await new Promise((r) => setTimeout(r, 1500));
      expect(settled).toBe(false);
      release();
      await holder;
      expect((await pending).status).toBe(200);
      await ownerA
        .post('/api/v1/school/results/unlock')
        .send({ classId: a1.class1, periodId: p2, reason: 'Essai de casse des identifiants' })
        .expect(200);
    });

    it('une évaluation d’un autre client n’est jamais attendue', async () => {
      await whileLocked('SchoolEvaluation', mathsEval, async () => {
        const res = await promptly(
          grades(ownerB, mathsEval, [{ studentId: s1, status: 'SCORED', score: 10 }]),
        );
        expect(res.status).toBe(404);
      });
    });

    it('note et validation simultanées : la note est figée dans la validation, ou refusée', async () => {
      const evalP2 = (
        await evaluation(ownerA, { subjectId: maths, periodId: p2, heldOn: '2027-01-15' }).expect(
          201,
        )
      ).body.id;
      const [save, validation] = await Promise.all([
        grades(ownerA, evalP2, [{ studentId: s2, status: 'SCORED', score: 17 }]),
        ownerA.post('/api/v1/school/results/validate').send({ classId: a1.class1, periodId: p2 }),
      ]);
      expect(validation.status).toBe(200);
      const frozen = await results(ownerA, a1.class1, p2).expect(200);
      const s2Maths = frozen.body.results.students
        .find((s: { studentId: string }) => s.studentId === s2)
        .subjects.find((s: { subjectId: string }) => s.subjectId === maths);
      if (save.status === 200) expect(s2Maths.scored).toBe(1);
      else {
        expect(save.status).toBe(409);
        expect(s2Maths.scored).toBe(0);
      }
      // Deux validations simultanées : une seule aboutit.
      await ownerA
        .post('/api/v1/school/results/unlock')
        .send({ classId: a1.class1, periodId: p2, reason: 'Essai de concurrence' })
        .expect(200);
      const both = await Promise.all([
        ownerA.post('/api/v1/school/results/validate').send({ classId: a1.class1, periodId: p2 }),
        ownerA.post('/api/v1/school/results/validate').send({ classId: a1.class1, periodId: p2 }),
      ]);
      expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    });
  });
});
