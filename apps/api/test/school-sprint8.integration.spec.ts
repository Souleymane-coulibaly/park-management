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
 * Ocall School, Sprint 8 : reporting consolidé (direction, pédagogie, assiduité, finances), exports PDF,
 * XLSX et CSV, vues enregistrées, historique des opérations sensibles. Données entièrement fictives.
 * Exige des bases de test locales jetables (garde bloquante de `createTestApp`).
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

function binary(res: Response, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

suite('Ocall School — Sprint 8, reporting et exports (intégration)', () => {
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
  let s1: string;
  let s2: string;
  let p1: string;
  let p2: string;
  let today: string;
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

  const report = (agent: Agent, kind: string, query = '') =>
    agent.get(`/api/v1/school/reports/${kind}?schoolYearId=${a1.yearId}${query}`);

  const exported = (agent: Agent, kind: string, format: string, query = '') =>
    agent
      .get(
        `/api/v1/school/reports/export?schoolYearId=${a1.yearId}&kind=${kind}&format=${format}${query}`,
      )
      .buffer(true)
      .parse(binary);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(SchoolPrismaService);
    platform = await internalAccount(app, prisma, `sc8-owner-${RUN}`, 'PLATFORM_OWNER');
    ownerA = await client('a');
    ownerB = await client('b');
    a1 = await structure(ownerA, 'Ecole Reporting');
    b1 = await structure(ownerB, 'Ecole Autre Reporting');
    director = await member(ownerA, 'SCHOOL_DIRECTOR', [a1.schoolId]);
    secretary = await member(ownerA, 'SECRETARY', [a1.schoolId]);
    teacher = await member(ownerA, 'TEACHER', [a1.schoolId]);
    accountant = await member(ownerA, 'ACCOUNTANT', [a1.schoolId]);
    maths = (
      await ownerA
        .post('/api/v1/school/subjects/catalog/mathematiques/activate')
        .send({ schoolId: a1.schoolId })
        .expect(201)
    ).body.id;
    await ownerA
      .put(`/api/v1/school/subjects/${maths}/levels`)
      .send({ levels: [{ levelId: a1.level1, coefficient: 1, weeklyHours: 4 }] })
      .expect(200);
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
    // Moyennes : T1 12 et 8 (classe 10, un admis sur deux) ; T2 15 et 11 (classe 13, deux admis).
    await graded(p1, '2026-10-20', [
      [s1, 12],
      [s2, 8],
    ]);
    await graded(p2, '2027-01-20', [
      [s1, 15],
      [s2, 11],
    ]);
    const school = await db.school.findUniqueOrThrow({
      where: { id: a1.schoolId },
      select: { timezone: true },
    });
    today = new Intl.DateTimeFormat('en-CA', { timeZone: school.timezone }).format(new Date());
    await ownerA
      .put('/api/v1/school/attendance/sheet')
      .send({
        classId: a1.class1,
        date: today,
        records: [
          { studentId: s1, status: 'ABSENT' },
          { studentId: s2, status: 'PRESENT' },
        ],
      })
      .expect(200);
    const fee = await ownerA
      .post('/api/v1/school/finance/fees')
      .send({
        schoolYearId: a1.yearId,
        category: 'TUITION',
        name: 'Scolarité',
        amount: 90_000,
        effectiveFrom: '2026-10-01',
        plan: { kind: 'MONTHLY', firstMonth: '2026-10', lastMonth: '2027-06', dueDay: 5 },
      })
      .expect(201);
    await ownerA.post(`/api/v1/school/finance/fees/${fee.body.id}/generate`).send({}).expect(200);
  }, 300_000);

  afterAll(async () => {
    const where = { organizationId: { in: organizations } };
    await db.schoolReportView.deleteMany({ where });
    await db.schoolNotification.deleteMany({ where });
    await db.schoolAttendanceEvent.deleteMany({ where });
    await db.schoolAttendanceRecord.deleteMany({ where });
    await db.schoolAttendanceSession.deleteMany({ where });
    await db.schoolPaymentAllocation.deleteMany({ where });
    await db.schoolPayment.deleteMany({ where });
    await db.schoolChargeAdjustment.deleteMany({ where });
    await db.schoolCharge.deleteMany({ where });
    await db.schoolBenefit.deleteMany({ where });
    await db.schoolFeeEvent.deleteMany({ where });
    await db.schoolFeeInstallment.deleteMany({ where });
    await db.schoolFee.deleteMany({ where });
    await db.schoolFinanceSettings.deleteMany({ where });
    await db.schoolResultValidation.deleteMany({ where });
    await db.schoolReportComment.deleteMany({ where });
    await db.schoolAppreciation.deleteMany({ where });
    await db.schoolGradeEvent.deleteMany({ where });
    await db.schoolGrade.deleteMany({ where });
    await db.schoolEvaluation.deleteMany({ where });
    await db.academicPeriod.deleteMany({ where });
    await db.schoolTeachingAssignment.deleteMany({ where });
    await db.schoolTeacherSubject.deleteMany({ where });
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

  describe('tableau de bord de direction', () => {
    it('effectifs, classes, enseignants, répartition, assiduité, résultats et finances', async () => {
      const res = await report(ownerA, 'overview').expect(200);
      expect(res.body.school).toMatchObject({ id: a1.schoolId });
      expect(res.body.year).toMatchObject({ id: a1.yearId, label: '2026-2027' });
      expect(res.body.students).toEqual({ active: 2, unplaced: 0 });
      expect(res.body.classCount).toBe(2);
      expect(res.body.teachers).toBe(1);
      expect(
        res.body.byClass.map((c: { name: string; students: number }) => [c.name, c.students]),
      ).toEqual([
        ['CM1 A', 2],
        ['CM1 B', 0],
      ]);
      expect(res.body.attendance).toMatchObject({ sessions: 2, absent: 1, absenceRate: 5000 });
      // Dernière période commencée : T1 (T2 commence en 2027).
      expect(res.body.results.period.id).toBe(p1);
      expect(res.body.results.average).toBe(10);
      expect(res.body.results.passRate).toBe(5000);
      const dashboard = await ownerA
        .get(`/api/v1/school/finance/dashboard?schoolYearId=${a1.yearId}`)
        .expect(200);
      expect(res.body.finance).toMatchObject({
        expected: dashboard.body.expected,
        collected: dashboard.body.collected,
        balance: dashboard.body.balance,
      });
      expect(res.body.finance.expected).toBeGreaterThan(0);
    });

    it('droits : direction oui ; secrétariat, enseignant, comptable non', async () => {
      await report(director.agent, 'overview').expect(200);
      for (const agent of [secretary.agent, teacher.agent, accountant.agent]) {
        await report(agent, 'overview').expect(403);
        await report(agent, 'pedagogy').expect(403);
      }
      // Le comptable a les rapports financiers (Sprint 5), pas le reste.
      await report(accountant.agent, 'finance').expect(200);
      await report(secretary.agent, 'finance').expect(403);
    });

    it('année pas encore commencée : rapports servis avec mention, sans erreur de plage', async () => {
      const next = (
        await ownerA
          .post('/api/v1/school/years')
          .send({
            schoolId: a1.schoolId,
            label: '2028-2029',
            startsOn: '2028-09-01',
            endsOn: '2029-06-30',
          })
          .expect(201)
      ).body.id;
      const res = await ownerA
        .get(`/api/v1/school/reports/overview?schoolYearId=${next}`)
        .expect(200);
      expect(res.body.yearNotStarted).toBe(true);
      expect(res.body.from).toBe('2028-09-01');
      expect(res.body.to).toBe('2028-09-01');
      await ownerA.get(`/api/v1/school/reports/attendance?schoolYearId=${next}`).expect(200);
      // Bornes incohérentes saisies : toujours refusées.
      await ownerA
        .get(`/api/v1/school/reports/attendance?schoolYearId=${next}&from=2029-01-10&to=2028-12-01`)
        .expect(422);
    });

    it('isolation : l’année d’un autre client est introuvable ; classe hors année refusée', async () => {
      await report(ownerB, 'overview').expect(404);
      await ownerA.get(`/api/v1/school/reports/overview?schoolYearId=${b1.yearId}`).expect(404);
      await report(ownerA, 'pedagogy', `&classId=${b1.class1}`).expect(404);
      const range = await report(ownerA, 'attendance', '&from=2027-02-01&to=2027-01-01').expect(
        422,
      );
      expect(range.body.code).toBe('REPORT_INVALID_RANGE');
    });
  });

  describe('reporting pédagogique', () => {
    it('moyennes par classe et période, réussite, répartition, tendance, matières', async () => {
      const res = await report(ownerA, 'pedagogy').expect(200);
      expect(res.body.periods.map((p: { id: string }) => p.id)).toEqual([p1, p2]);
      const class1 = res.body.classes.find((c: { id: string }) => c.id === a1.class1);
      expect(
        class1.periods.map((p: { classAverage: number; passRate: number }) => [
          p.classAverage,
          p.passRate,
        ]),
      ).toEqual([
        [10, 5000],
        [13, 10000],
      ]);
      expect(class1.trend).toMatchObject({ direction: 'UP', delta: 3, from: p1, to: p2 });
      // Deux élèves notés (8 et 12 sur 20 : tranches 8–12 et 12–16) : statistique insuffisante.
      expect(class1.periods[0].insufficient).toBe(true);
      expect(class1.periods[0].distribution.bins.map((b: { count: number }) => b.count)).toEqual([
        0, 0, 1, 1, 0,
      ]);
      const subject = res.body.subjects.find((s: { subjectId: string }) => s.subjectId === maths);
      expect(subject.byPeriod.map((p: { average: number }) => p.average)).toEqual([10, 13]);
      expect(subject.trend.direction).toBe('UP');
      // La classe vide n'a aucun résultat : rien n'est inventé.
      const class2 = res.body.classes.find((c: { id: string }) => c.id === a1.class2);
      expect(class2.periods[0]).toMatchObject({ classAverage: null, graded: 0, passRate: null });
      expect(class2.trend.direction).toBe('INSUFFICIENT');
      expect(res.body.schoolByPeriod.map((p: { average: number }) => p.average)).toEqual([10, 13]);
    });

    it('filtres : une période et une classe', async () => {
      const res = await report(ownerA, 'pedagogy', `&periodId=${p2}&classId=${a1.class1}`).expect(
        200,
      );
      expect(res.body.filters).toEqual({ classId: a1.class1, periodId: p2 });
      expect(res.body.classes).toHaveLength(1);
      expect(res.body.classes[0].periods).toHaveLength(1);
      expect(res.body.classes[0].periods[0].classAverage).toBe(13);
    });
  });

  describe('assiduité', () => {
    it('par classe et par mois, sans nom d’élève ; classe la plus touchée', async () => {
      const res = await report(ownerA, 'attendance').expect(200);
      const class1 = res.body.byClass.find((c: { id: string }) => c.id === a1.class1);
      expect(class1).toMatchObject({ sessions: 1, records: 2, absent: 1, absenceRate: 5000 });
      expect(res.body.mostAbsent).toMatchObject({ id: a1.class1, absenceRate: 5000 });
      expect(res.body.byMonth).toEqual([
        expect.objectContaining({ month: today.slice(0, 7), absent: 1, present: 1 }),
      ]);
      expect(JSON.stringify(res.body)).not.toContain('Diop');
    });

    it('période sans relevé : données insuffisantes signalées', async () => {
      const res = await report(ownerA, 'attendance', '&from=2026-10-01&to=2026-10-02').expect(200);
      expect(res.body.insufficient).toBe(true);
      expect(res.body.total.absenceRate).toBeNull();
    });
  });

  describe('exports', () => {
    it('PDF, XLSX et CSV : identité du rapport, filtres, journalisation', async () => {
      const pdf = await exported(ownerA, 'pedagogy', 'pdf').expect(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      const xlsx = await exported(ownerA, 'attendance', 'xlsx').expect(200);
      expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
      const csv = await exported(ownerA, 'overview', 'csv').expect(200);
      const text = (csv.body as Buffer).toString('utf8');
      expect(text).toContain(`Ecole Reporting ${RUN}`);
      expect(text).toContain('Tableau de bord de direction');
      expect(text).toContain('2026-2027');
      expect(text).toContain('CM1 A');
      const logged = await prisma.auditLog.findMany({
        where: { action: 'school.report_exported', targetId: a1.yearId },
        select: { metadata: true },
      });
      expect(logged.map((l) => (l.metadata as { format: string }).format).sort()).toEqual([
        'csv',
        'pdf',
        'xlsx',
      ]);
    });

    it('filtres : appliqués ou refusés, jamais affichés sans effet ; effectif insuffisant exporté', async () => {
      // Le tableau de bord couvre l'établissement entier : un filtre de classe est refusé.
      const overview = await exported(ownerA, 'overview', 'csv', `&classId=${a1.class1}`).expect(
        422,
      );
      expect(overview.body.toString()).toContain('REPORT_FILTER_UNSUPPORTED');
      await report(ownerA, 'attendance', `&periodId=${p1}`).expect(422);
      // Période d'une autre année : refusée, son libellé n'apparaît nulle part.
      const other = (
        await ownerA
          .post('/api/v1/school/years')
          .send({
            schoolId: a1.schoolId,
            label: '2027-2028',
            startsOn: '2027-09-01',
            endsOn: '2028-06-30',
          })
          .expect(201)
      ).body.id;
      const foreign = (
        await ownerA
          .post('/api/v1/school/periods')
          .send({
            schoolYearId: other,
            kind: 'TRIMESTER',
            label: 'Période étrangère',
            startsOn: '2027-09-01',
            endsOn: '2027-12-20',
          })
          .expect(201)
      ).body.id;
      const refused = await exported(ownerA, 'pedagogy', 'csv', `&periodId=${foreign}`).expect(422);
      expect(refused.body.toString()).toContain('REPORT_PERIOD_OUTSIDE_YEAR');
      expect(refused.body.toString()).not.toContain('Période étrangère');
      // Filtre de classe appliqué à l'assiduité et restitué dans l'export.
      const att = await exported(ownerA, 'attendance', 'csv', `&classId=${a1.class1}`).expect(200);
      expect((att.body as Buffer).toString('utf8')).toMatch(/Filtres;CM1 A/);
      const ped = (await exported(ownerA, 'pedagogy', 'csv').expect(200)).body.toString('utf8');
      expect(ped).toContain('Effectif insuffisant');
      expect(ped).toMatch(/CM1 A;Trimestre 1;10;20;50;2;Oui/);
    });

    it('finances filtrées par dates : encaissé de la période distinct du cumul annuel', async () => {
      const range = '&from=2026-11-01&to=2026-11-30';
      const res = await report(ownerA, 'finance', range).expect(200);
      expect(res.body.periodCollected).toBe(0);
      expect(res.body.byClass[0]).toHaveProperty('periodCollected', 0);
      const csv = (await exported(ownerA, 'finance', 'csv', range).expect(200)).body.toString(
        'utf8',
      );
      expect(csv).toContain('Encaissé (cumul de l’année)');
      expect(csv).toContain('Encaissé sur la période');
      const plain = (await exported(ownerA, 'finance', 'csv').expect(200)).body.toString('utf8');
      expect(plain).not.toContain('Encaissé sur la période');
    });

    it('export financier en PDF ; droits et isolation des exports', async () => {
      const pdf = await exported(ownerA, 'finance', 'pdf').expect(200);
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      await exported(accountant.agent, 'finance', 'csv').expect(403);
      await exported(teacher.agent, 'pedagogy', 'csv').expect(403);
      await exported(ownerB, 'overview', 'pdf').expect(404);
    });
  });

  describe('vues enregistrées', () => {
    it('création, liste propre à l’utilisateur, suppression ; filtres inconnus écartés', async () => {
      const created = await ownerA
        .post('/api/v1/school/reports/views')
        .send({
          name: 'T2 en CM1 A',
          kind: 'pedagogy',
          schoolId: a1.schoolId,
          filters: { classId: a1.class1, periodId: p2, sql: 'DROP TABLE', from: 'hier' },
        })
        .expect(201);
      expect(created.body.filters).toEqual({ classId: a1.class1, periodId: p2 });
      const mine = await ownerA
        .get(`/api/v1/school/reports/views?schoolId=${a1.schoolId}`)
        .expect(200);
      expect(mine.body.map((v: { id: string }) => v.id)).toContain(created.body.id);
      const theirs = await director.agent
        .get(`/api/v1/school/reports/views?schoolId=${a1.schoolId}`)
        .expect(200);
      expect(theirs.body).toEqual([]);
      await director.agent.delete(`/api/v1/school/reports/views/${created.body.id}`).expect(404);
      await ownerB.get(`/api/v1/school/reports/views?schoolId=${a1.schoolId}`).expect(404);
      await ownerA.delete(`/api/v1/school/reports/views/${created.body.id}`).expect(200);
    });
  });

  describe('historique des opérations sensibles', () => {
    it('direction du groupe seulement ; limité au client ; paginé', async () => {
      const res = await ownerA.get('/api/v1/school/reports/audit?action=school.report').expect(200);
      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
      expect(
        res.body.items.every((i: { action: string }) => i.action.startsWith('school.report')),
      ).toBe(true);
      expect(res.body.items[0].actor).toBe('Mariama Sow');
      await director.agent.get('/api/v1/school/reports/audit').expect(403);
      const other = await ownerB
        .get('/api/v1/school/reports/audit?action=school.report')
        .expect(200);
      expect(other.body.items).toEqual([]);
      await ownerA.get('/api/v1/school/reports/audit?action=DROP').expect(400);
    });
  });
});
