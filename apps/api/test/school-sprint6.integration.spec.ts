import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request, { type Response } from 'supertest';
import { SchoolNotificationsService } from '../src/modules/school/school-notifications.service';
import { SchoolPrismaService } from '../src/modules/school/school-prisma.service';
import { creditSmsWallet, purgeSmsWallets } from './school-sms-support';
import {
  SCHOOL_SMS_PROVIDER,
  type SimulatedSmsProvider,
} from '../src/modules/school/school-sms.provider';
import { SchoolSmsService } from '../src/modules/school/school-sms.service';
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
 * Ocall School, Sprint 6 : portail parents, présences, annonces, notifications, SMS (simulés). Données
 * entièrement fictives. Exige TEST_DATABASE_URL et une base School de test distincte, jamais la production.
 */
const suite =
  (process.env.SCHOOL_TEST_DATABASE_URL ?? process.env.TEST_SCHOOL_DATABASE_URL)
    ? describe
    : describe.skip;

const TERMS = { startsOn: '2026-01-01', endsOn: '2099-12-31' };
const PARENT_PASSWORD = 'Famille2026Secure';

interface Structure {
  schoolId: string;
  yearId: string;
  level1: string;
  level2: string;
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

suite('Ocall School — Sprint 6, portail parents et communication (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: SchoolPrismaService;
  let sms: SchoolSmsService;
  let provider: SimulatedSmsProvider;
  let platform: InternalAccount;
  let ownerA: Agent;
  let ownerB: Agent;
  let a1: Structure;
  let a2: Structure;
  let b1: Structure;
  let secretary: Member;
  let teacher: Member;
  let directorA2: Member;
  let s1: string;
  let s2: string;
  let s3: string;
  let sB: string;
  let mother: string;
  let father: string;
  let uncle: string;
  let guardianB: string;
  let motherAgent: Agent;
  let fatherAgent: Agent;
  let motherLoginId: string;
  let today: string;
  let yesterday: string;
  let maths: string;
  let p1: string;
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
        ownerEmail: email(`owner6-${label}`),
        reference: `OCS6-${RUN}-${++counter}`,
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
    const level = async (n: string) =>
      (
        await owner
          .post('/api/v1/school/levels')
          .send({ cycleId: cycle.body.id, name: n })
          .expect(201)
      ).body.id as string;
    const level1 = await level('CM1');
    const level2 = await level('CM2');
    const cls = async (n: string, levelId: string) =>
      (
        await owner
          .post('/api/v1/school/classes')
          .send({ schoolYearId: year.body.id, levelId, name: n, capacity: 30 })
          .expect(201)
      ).body.id as string;
    return {
      schoolId,
      yearId: year.body.id,
      level1,
      level2,
      class1: await cls('CM1 A', level1),
      class2: await cls('CM2 A', level2),
    };
  }

  async function enrolled(
    owner: Agent,
    s: Structure,
    classId: string,
    levelId: string,
    lastName: string,
    firstName = 'Awa',
  ) {
    const created = await owner
      .post('/api/v1/school/students')
      .send({ schoolId: s.schoolId, lastName, firstName, birthDate: '2016-02-14' })
      .expect(201);
    const parent = await owner
      .post('/api/v1/school/guardians')
      .send({ schoolId: s.schoolId, lastName, firstName: 'Tuteur', phone: '+221 77 000 00 01' })
      .expect(201);
    await owner
      .post(`/api/v1/school/students/${created.body.id}/guardians`)
      .send({ guardianId: parent.body.id, relation: 'OTHER' })
      .expect(201);
    const enrollment = await owner
      .post('/api/v1/school/enrollments')
      .send({ studentId: created.body.id, schoolYearId: s.yearId, levelId, classId, submit: true })
      .expect(201);
    await owner
      .post(`/api/v1/school/enrollments/${enrollment.body.id}/status`)
      .send({ status: 'VALIDATED' })
      .expect(200);
    return created.body.id as string;
  }

  async function guardian(owner: Agent, s: Structure, firstName: string, phone: string) {
    return (
      await owner
        .post('/api/v1/school/guardians')
        .send({ schoolId: s.schoolId, lastName: 'Famille', firstName, phone })
        .expect(201)
    ).body.id as string;
  }

  const link = (
    owner: Agent,
    studentId: string,
    guardianId: string,
    rights: Record<string, boolean>,
  ) =>
    owner
      .post(`/api/v1/school/students/${studentId}/guardians`)
      .send({ guardianId, relation: 'MOTHER', ...rights })
      .expect(201);

  const invite = (agent: Agent, guardianId: string, sendSms = false) =>
    agent.post(`/api/v1/school/guardians/${guardianId}/portal/invitations`).send({ sendSms });

  const tokenOf = (path: string) => new URL(path, 'http://x').searchParams.get('token')!;

  const anonymous = () => request(app.getHttpServer());

  async function activate(path: string): Promise<{ loginId: string; agent: Agent }> {
    const res = await anonymous()
      .post('/api/v1/school/portal/activation')
      .send({ token: tokenOf(path), password: PARENT_PASSWORD })
      .expect(200);
    const session = await login(app, res.body.loginId, PARENT_PASSWORD);
    expect(session.status).toBe(200);
    return { loginId: res.body.loginId, agent: session.agent };
  }

  const childIds = async (agent: Agent) =>
    (await agent.get('/api/v1/school/portal/children').expect(200)).body.map(
      (c: { id: string }) => c.id,
    );

  const sheet = (agent: Agent, body: Record<string, unknown>) =>
    agent.put('/api/v1/school/attendance/sheet').send({ classId: a1.class1, date: today, ...body });

  const pdf = (agent: Agent, url: string) => agent.get(url).buffer(true).parse(binary);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(SchoolPrismaService);
    sms = app.get(SchoolSmsService);
    provider = app.get(SCHOOL_SMS_PROVIDER);
    platform = await internalAccount(app, prisma, `sc6-owner-${RUN}`, 'PLATFORM_OWNER');
    ownerA = await client('a');
    ownerB = await client('b');
    a1 = await structure(ownerA, 'Ecole Portail');
    a2 = await structure(ownerA, 'Ecole Voisine Portail');
    b1 = await structure(ownerB, 'Ecole Autre Client Portail');
    secretary = await member(ownerA, 'SECRETARY', [a1.schoolId]);
    teacher = await member(ownerA, 'TEACHER', [a1.schoolId]);
    directorA2 = await member(ownerA, 'SCHOOL_DIRECTOR', [a2.schoolId]);
    s1 = await enrolled(ownerA, a1, a1.class1, a1.level1, 'Ba');
    s2 = await enrolled(ownerA, a1, a1.class1, a1.level1, 'Ba', 'Fatou');
    s3 = await enrolled(ownerA, a1, a1.class2, a1.level2, 'Diop');
    sB = await enrolled(ownerB, b1, b1.class1, b1.level1, 'Gueye');
    // Famille : la mère suit les deux enfants, le père le premier (et accepte les SMS), l'oncle n'est
    // autorisé à rien.
    mother = await guardian(ownerA, a1, 'Aminata', '+221 77 111 11 11');
    father = await guardian(ownerA, a1, 'Moussa', '+221 77 222 22 22');
    uncle = await guardian(ownerA, a1, 'Cheikh', '+221 77 333 33 33');
    await link(ownerA, s1, mother, { canViewSchoolInfo: true });
    await link(ownerA, s2, mother, { canViewSchoolInfo: true });
    await link(ownerA, s1, father, { canViewSchoolInfo: true, canReceiveSms: true });
    await link(ownerA, s3, uncle, {});
    guardianB = await guardian(ownerB, b1, 'Fatou', '+221 77 444 44 44');
    await link(ownerB, sB, guardianB, { canViewSchoolInfo: true });

    const activateSubject = async (key: string) =>
      (
        await ownerA
          .post(`/api/v1/school/subjects/catalog/${key}/activate`)
          .send({ schoolId: a1.schoolId })
          .expect(201)
      ).body.id as string;
    maths = await activateSubject('mathematiques');
    await ownerA
      .put(`/api/v1/school/subjects/${maths}/levels`)
      .send({ levels: [{ levelId: a1.level1, coefficient: 2 }] })
      .expect(200);
    // L'enseignant reçoit la classe 1 seulement.
    await ownerA
      .post('/api/v1/school/teaching-assignments')
      .send({ classId: a1.class1, subjectId: maths, memberId: teacher.id })
      .expect(201);
    p1 = (
      await ownerA
        .post('/api/v1/school/periods')
        .send({
          schoolYearId: a1.yearId,
          kind: 'TRIMESTER',
          label: 'Trimestre 1',
          startsOn: '2026-10-01',
          endsOn: '2026-12-20',
        })
        .expect(201)
    ).body.id;
    const school = await db.school.findUniqueOrThrow({ where: { id: a1.schoolId } });
    today = new Intl.DateTimeFormat('en-CA', { timeZone: school.timezone }).format(new Date());
    // Veille : hors du justificatif accepté pour aujourd'hui (essais des SMS).
    yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  }, 600_000);

  afterAll(async () => {
    const where = { organizationId: { in: organizations } };
    // Comptes du portail parents : comptes Suite sans adhésion ni e-mail de test, donc absents du
    // nettoyage commun ; laissés, leur identifiant entrerait en collision avec une autre suite.
    const portalUsers = (
      await db.schoolPortalAccount.findMany({ where, select: { userId: true } })
    ).map((a) => a.userId);
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: portalUsers } } });
    await prisma.session.deleteMany({ where: { userId: { in: portalUsers } } });
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: portalUsers } } });
    await prisma.user.deleteMany({ where: { id: { in: portalUsers } } });
    await db.schoolNotification.deleteMany({ where });
    await db.schoolSmsMessage.deleteMany({ where });
    await purgeSmsWallets(db, where);
    await db.schoolSmsSettings.deleteMany({ where });
    await db.schoolAnnouncementEvent.deleteMany({ where });
    await db.schoolAnnouncementTarget.deleteMany({ where });
    await db.schoolAnnouncement.deleteMany({ where });
    await db.schoolResultPublication.deleteMany({ where });
    await db.schoolAttendanceEvent.deleteMany({ where });
    await db.schoolAttendanceRecord.deleteMany({ where });
    await db.schoolAttendanceSession.deleteMany({ where });
    await db.schoolAbsenceJustification.deleteMany({ where });
    await db.schoolGuardianInvitation.deleteMany({ where });
    await db.schoolPortalAccount.deleteMany({ where });
    await db.schoolQuranEvaluation.deleteMany({ where });
    await db.schoolQuranProgress.deleteMany({ where });
    await db.schoolQuranSettings.deleteMany({ where });
    await db.schoolResultValidation.deleteMany({ where });
    await db.schoolReportComment.deleteMany({ where });
    await db.schoolAppreciation.deleteMany({ where });
    await db.schoolGradeEvent.deleteMany({ where });
    await db.schoolGrade.deleteMany({ where });
    await db.schoolEvaluation.deleteMany({ where });
    await db.academicPeriod.deleteMany({ where });
    await db.schoolPaymentAllocation.deleteMany({ where });
    await db.schoolPayment.deleteMany({ where: { ...where, kind: 'REVERSAL' } });
    await db.schoolPayment.deleteMany({ where });
    await db.schoolChargeAdjustment.deleteMany({ where });
    await db.schoolCharge.deleteMany({ where });
    await db.schoolBenefit.deleteMany({ where });
    await db.schoolFeeEvent.deleteMany({ where });
    await db.schoolFeeInstallment.deleteMany({ where });
    await db.schoolFee.deleteMany({ where });
    await db.schoolFinanceSettings.deleteMany({ where });
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

  describe('comptes parents', () => {
    it('invitation, activation, connexion ; jeton à usage unique ; droits et isolation', async () => {
      await invite(teacher.agent, mother).expect(403);
      await invite(ownerB, mother).expect(404);
      await invite(directorA2.agent, mother).expect(404);
      expect((await invite(ownerA, uncle).expect(409)).body.code).toBe('NO_AUTHORIZED_CHILD');
      const sent = await invite(secretary.agent, mother).expect(201);
      expect(sent.body.path).toMatch(/^\/parents\/activation\?token=/);
      const check = await anonymous()
        .post('/api/v1/school/portal/activation/check')
        .send({ token: tokenOf(sent.body.path) })
        .expect(200);
      expect(check.body).toMatchObject({ status: 'PENDING', firstName: 'Aminata' });
      expect(JSON.stringify(check.body)).not.toContain('+221');
      const weak = await anonymous()
        .post('/api/v1/school/portal/activation')
        .send({ token: tokenOf(sent.body.path), password: 'court' })
        .expect(400);
      expect(weak.body.code).toBeDefined();
      const { loginId, agent } = await activate(sent.body.path);
      motherAgent = agent;
      motherLoginId = loginId;
      expect(loginId).toMatch(/-\d{4}$/);
      const me = await motherAgent.get('/api/v1/auth/me').expect(200);
      expect(me.body).toMatchObject({
        accountKind: 'guardian',
        organization: null,
        permissions: [],
      });
      const reused = await anonymous()
        .post('/api/v1/school/portal/activation')
        .send({ token: tokenOf(sent.body.path), password: PARENT_PASSWORD })
        .expect(403);
      expect(reused.body.code).toBe('INVALID_INVITATION');
      const status = await secretary.agent
        .get(`/api/v1/school/guardians/${mother}/portal`)
        .expect(200);
      expect(status.body.account).toMatchObject({ status: 'ACTIVE', loginId });
      expect(status.body.invitations[0].status).toBe('USED');
      // Un compte parent n'ouvre aucune route du personnel, et l'inverse.
      await motherAgent.get(`/api/v1/school/students?schoolId=${a1.schoolId}`).expect(403);
      await ownerA.get('/api/v1/school/portal/children').expect(403);
      await secretary.agent.get('/api/v1/school/portal/dashboard').expect(403);
    });

    it('invitation expirée ou remplacée : refusée', async () => {
      const first = await invite(ownerA, father).expect(201);
      const second = await invite(ownerA, father).expect(201);
      const replaced = await anonymous()
        .post('/api/v1/school/portal/activation/check')
        .send({ token: tokenOf(first.body.path) })
        .expect(200);
      expect(replaced.body.status).toBe('REVOKED');
      await db.schoolGuardianInvitation.updateMany({
        where: { guardianId: father, usedAt: null, revokedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const expired = await anonymous()
        .post('/api/v1/school/portal/activation/check')
        .send({ token: tokenOf(second.body.path) })
        .expect(200);
      expect(expired.body.status).toBe('EXPIRED');
      await anonymous()
        .post('/api/v1/school/portal/activation')
        .send({ token: tokenOf(second.body.path), password: PARENT_PASSWORD })
        .expect(403);
      expect(
        (
          await anonymous()
            .post('/api/v1/school/portal/activation/check')
            .send({ token: 'x'.repeat(43) })
            .expect(200)
        ).body.status,
      ).toBe('INVALID');
      const fresh = await invite(ownerA, father).expect(201);
      fatherAgent = (await activate(fresh.body.path)).agent;
    });

    it('un parent, plusieurs enfants ; un enfant, plusieurs responsables', async () => {
      expect((await childIds(motherAgent)).sort()).toEqual([s1, s2].sort());
      expect(await childIds(fatherAgent)).toEqual([s1]);
      const children = (await motherAgent.get('/api/v1/school/portal/children').expect(200)).body;
      expect(children[0]).toMatchObject({
        school: { id: a1.schoolId, defaultLocale: 'FR' },
        class: { id: a1.class1 },
        access: 'full',
      });
      expect(children[0]).not.toHaveProperty('guardianIds');
    });

    it('accès refusé à un enfant non autorisé, d’une autre école ou d’un autre client', async () => {
      for (const id of [s3, sB]) {
        await motherAgent.get(`/api/v1/school/portal/children/${id}/attendance`).expect(404);
        await motherAgent.get(`/api/v1/school/portal/children/${id}/results`).expect(404);
        await motherAgent.get(`/api/v1/school/portal/children/${id}/finance`).expect(404);
      }
      await fatherAgent.get(`/api/v1/school/portal/children/${s2}/attendance`).expect(404);
    });
  });

  describe('présences', () => {
    it('appel de sa classe par l’enseignant ; autre classe refusée ; doublon de séance impossible', async () => {
      await teacher.agent
        .put('/api/v1/school/attendance/sheet')
        .send({ classId: a1.class2, date: today, records: [{ studentId: s3, status: 'PRESENT' }] })
        .expect(404);
      await sheet(teacher.agent, { records: [{ studentId: s3, status: 'PRESENT' }] }).expect(400);
      const both = await Promise.all([
        sheet(teacher.agent, { records: [{ studentId: s1, status: 'ABSENT' }] }),
        sheet(secretary.agent, { records: [{ studentId: s2, status: 'PRESENT' }] }),
      ]);
      expect(both.map((r) => r.status)).toEqual([200, 200]);
      expect(
        await db.schoolAttendanceSession.count({ where: { classId: a1.class1, slot: 'JOURNEE' } }),
      ).toBe(1);
      const read = await teacher.agent
        .get(`/api/v1/school/attendance/sheet?classId=${a1.class1}&date=${today}`)
        .expect(200);
      const statuses = Object.fromEntries(
        read.body.students.map((s: { id: string; record: { status: string } | null }) => [
          s.id,
          s.record?.status ?? null,
        ]),
      );
      expect(statuses).toMatchObject({ [s1]: 'ABSENT', [s2]: 'PRESENT' });
      const future = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10);
      expect(
        (
          await sheet(teacher.agent, {
            date: future,
            records: [{ studentId: s1, status: 'PRESENT' }],
          }).expect(400)
        ).body.code,
      ).toBe('DATE_IN_FUTURE');
      await ownerB
        .get(`/api/v1/school/attendance/sheet?classId=${a1.class1}&date=${today}`)
        .expect(404);
    });

    it('correction motivée, historique conservé ; absence notifiée une seule fois', async () => {
      const noReason = await sheet(teacher.agent, {
        records: [{ studentId: s1, status: 'LATE', minutesLate: 10 }],
      }).expect(400);
      expect(noReason.body.code).toBe('CORRECTION_REASON_REQUIRED');
      await sheet(teacher.agent, {
        records: [{ studentId: s1, status: 'LATE', minutesLate: 10 }],
        reason: 'Arrivé après l’appel',
      }).expect(200);
      const record = await db.schoolAttendanceRecord.findFirstOrThrow({ where: { studentId: s1 } });
      const history = await secretary.agent
        .get(`/api/v1/school/attendance/records/${record.id}/history`)
        .expect(200);
      expect(history.body.map((e: { toStatus: string }) => e.toStatus)).toEqual(['ABSENT', 'LATE']);
      expect(history.body[1]).toMatchObject({
        fromStatus: 'ABSENT',
        reason: 'Arrivé après l’appel',
      });
      // Même saisie renvoyée : rien ne change, aucune notification de plus.
      await sheet(teacher.agent, {
        records: [{ studentId: s1, status: 'LATE', minutesLate: 10 }],
      }).expect(200);
      const notes = await db.schoolNotification.findMany({
        where: { studentId: s1, kind: { in: ['ABSENCE', 'LATE'] } },
      });
      // Mère et père : une absence puis un retard chacun.
      expect(notes.filter((n) => n.kind === 'ABSENCE')).toHaveLength(2);
      expect(notes.filter((n) => n.kind === 'LATE')).toHaveLength(2);
    });

    it('justificatif transmis par le parent, examiné par l’établissement : absence justifiée', async () => {
      await sheet(secretary.agent, {
        records: [{ studentId: s1, status: 'ABSENT' }],
        reason: 'Retard requalifié en absence',
      }).expect(200);
      const submitted = await motherAgent
        .post(`/api/v1/school/portal/children/${s1}/justifications`)
        .send({ fromDate: today, toDate: today, reason: 'Rendez-vous médical' })
        .expect(201);
      expect(submitted.body.status).toBe('PENDING');
      await motherAgent
        .post(`/api/v1/school/portal/children/${s3}/justifications`)
        .send({ fromDate: today, toDate: today, reason: 'Essai' })
        .expect(404);
      await motherAgent
        .post(`/api/v1/school/portal/children/${s1}/justifications`)
        .send({ fromDate: today, toDate: '2027-06-30', reason: 'Trop long' })
        .expect(400);
      const pending = await secretary.agent
        .get(`/api/v1/school/attendance/justifications?schoolId=${a1.schoolId}&status=PENDING`)
        .expect(200);
      expect(pending.body.map((j: { id: string }) => j.id)).toContain(submitted.body.id);
      await teacher.agent
        .post(`/api/v1/school/attendance/justifications/${submitted.body.id}/review`)
        .send({ decision: 'ACCEPTED' })
        .expect(403);
      await secretary.agent
        .post(`/api/v1/school/attendance/justifications/${submitted.body.id}/review`)
        .send({ decision: 'ACCEPTED', note: 'Certificat fourni' })
        .expect(200);
      expect(
        (
          await secretary.agent
            .post(`/api/v1/school/attendance/justifications/${submitted.body.id}/review`)
            .send({ decision: 'REJECTED' })
            .expect(409)
        ).body.code,
      ).toBe('JUSTIFICATION_REVIEWED');
      const view = await motherAgent
        .get(`/api/v1/school/portal/children/${s1}/attendance`)
        .expect(200);
      expect(view.body.records[0]).toMatchObject({ status: 'EXCUSED', date: today });
      expect(view.body.justifications[0]).toMatchObject({ status: 'ACCEPTED' });
      const stats = await secretary.agent
        .get(`/api/v1/school/attendance/stats?classId=${a1.class1}&from=${today}&to=${today}`)
        .expect(200);
      expect(stats.body.total).toMatchObject({ sessions: 2, present: 1, excused: 1 });
    });
  });

  describe('résultats et bulletins', () => {
    it('rien avant publication ; publication réservée aux résultats validés ; rouverts : retirés', async () => {
      const evaluation = await teacher.agent
        .post('/api/v1/school/evaluations')
        .send({
          classId: a1.class1,
          periodId: p1,
          subjectId: maths,
          kind: 'HOMEWORK',
          title: 'Devoir 1',
          heldOn: '2026-10-20',
          maxScore: 20,
        })
        .expect(201);
      await teacher.agent
        .put(`/api/v1/school/evaluations/${evaluation.body.id}/grades`)
        .send({
          grades: [
            { studentId: s1, status: 'SCORED', score: 15 },
            { studentId: s2, status: 'SCORED', score: 12 },
          ],
        })
        .expect(200);
      // Notes saisies mais non validées : invisibles des familles.
      expect(
        (await motherAgent.get(`/api/v1/school/portal/children/${s1}/results`).expect(200)).body
          .periods,
      ).toEqual([]);
      const body = { classId: a1.class1, periodId: p1 };
      expect(
        (await ownerA.post('/api/v1/school/results/publications').send(body).expect(409)).body.code,
      ).toBe('RESULTS_NOT_VALIDATED');
      await ownerA.post('/api/v1/school/results/validate').send(body).expect(200);
      await secretary.agent.post('/api/v1/school/results/publications').send(body).expect(403);
      const published = await ownerA
        .post('/api/v1/school/results/publications')
        .send(body)
        .expect(201);
      expect(
        (await ownerA.post('/api/v1/school/results/publications').send(body).expect(409)).body.code,
      ).toBe('ALREADY_PUBLISHED');
      const results = (
        await motherAgent.get(`/api/v1/school/portal/children/${s1}/results`).expect(200)
      ).body.periods;
      expect(results).toHaveLength(1);
      expect(results[0].subjects[0]).toMatchObject({ average: 15 });
      expect(results[0].subjects[0].evaluations[0]).toMatchObject({
        title: 'Devoir 1',
        score: 15,
        maxScore: 20,
      });
      // Bulletin de l'enfant seulement ; jamais celui d'un autre enfant de la classe.
      const card = await pdf(
        motherAgent,
        `/api/v1/school/portal/children/${s1}/report-cards/${published.body.id}`,
      ).expect(200);
      expect((card.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      expect(card.headers['cache-control']).toBe('private, no-store');
      await pdf(
        fatherAgent,
        `/api/v1/school/portal/children/${s2}/report-cards/${published.body.id}`,
      ).expect(404);
      const notified = await db.schoolNotification.count({
        where: { kind: 'REPORT_CARD', resourceId: published.body.id },
      });
      // Mère (deux enfants) et père (un enfant) : trois notifications.
      expect(notified).toBe(3);
      await ownerA
        .post('/api/v1/school/results/unlock')
        .send({ ...body, reason: 'Erreur de saisie' })
        .expect(200);
      expect(
        (await motherAgent.get(`/api/v1/school/portal/children/${s1}/results`).expect(200)).body
          .periods,
      ).toEqual([]);
      await pdf(
        motherAgent,
        `/api/v1/school/portal/children/${s1}/report-cards/${published.body.id}`,
      ).expect(404);
      // Revalidés puis republiés : nouvelle publication, l'ancienne est remplacée.
      await ownerA.post('/api/v1/school/results/validate').send(body).expect(200);
      await ownerA.post('/api/v1/school/results/publications').send(body).expect(201);
      expect(
        (await motherAgent.get(`/api/v1/school/portal/children/${s1}/results`).expect(200)).body
          .periods,
      ).toHaveLength(1);
    });
  });

  describe('finances en lecture seule', () => {
    it('échéances, encaissements et reçu ; aucune écriture ; nouvelle échéance notifiée', async () => {
      const fee = await ownerA
        .post('/api/v1/school/finance/fees')
        .send({
          schoolYearId: a1.yearId,
          category: 'TUITION',
          name: 'Scolarité',
          amount: 30_000,
          effectiveFrom: '2026-10-01',
          plan: { kind: 'ANNUAL', dueOn: '2026-10-05' },
        })
        .expect(201);
      await ownerA.post(`/api/v1/school/finance/fees/${fee.body.id}/generate`).send({}).expect(200);
      const paid = await ownerA
        .post('/api/v1/school/finance/payments')
        .send({
          schoolYearId: a1.yearId,
          studentId: s1,
          amount: 10_000,
          method: 'CASH',
          idempotencyKey: '7a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
        })
        .expect(201);
      const finance = await motherAgent
        .get(`/api/v1/school/portal/children/${s1}/finance`)
        .expect(200);
      expect(finance.body.totals).toMatchObject({ due: 30_000, paid: 10_000, balance: 20_000 });
      expect(finance.body.charges[0]).not.toHaveProperty('adjustment');
      expect(finance.body.payments[0]).toMatchObject({ amount: 10_000 });
      const receipt = await pdf(
        motherAgent,
        `/api/v1/school/portal/children/${s1}/payments/${paid.body.id}/receipt`,
      ).expect(200);
      expect((receipt.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      await pdf(
        motherAgent,
        `/api/v1/school/portal/children/${s2}/payments/${paid.body.id}/receipt`,
      ).expect(404);
      await motherAgent
        .post('/api/v1/school/finance/payments')
        .send({ schoolYearId: a1.yearId, studentId: s1, amount: 1, method: 'CASH' })
        .expect(403);
      expect(
        await db.schoolNotification.count({ where: { kind: 'CHARGE_DUE', studentId: s1 } }),
      ).toBe(2);
      // Contrôle des impayés : une seule notification par échéance, même s'il repasse.
      const notifications = app.get(SchoolNotificationsService);
      await notifications.scanOverdue(organizations[0]);
      await notifications.scanOverdue(organizations[0]);
      expect(
        await db.schoolNotification.count({ where: { kind: 'CHARGE_OVERDUE', studentId: s1 } }),
      ).toBe(2);
    });
  });

  describe('annonces', () => {
    const create = (agent: Agent, body: Record<string, unknown>) =>
      agent.post('/api/v1/school/announcements').send({
        schoolId: a1.schoolId,
        title: 'Réunion des parents',
        body: 'Jeudi à 17 h.',
        audience: 'SCHOOL',
        ...body,
      });
    const visible = async (agent: Agent) =>
      (await agent.get('/api/v1/school/portal/announcements').expect(200)).body.map(
        (a: { title: string }) => a.title,
      );

    it('brouillon invisible, publication visible, archivage retiré ; historique', async () => {
      const draft = await create(secretary.agent, { title: 'Sortie scolaire' }).expect(201);
      expect(await visible(motherAgent)).not.toContain('Sortie scolaire');
      await secretary.agent
        .post(`/api/v1/school/announcements/${draft.body.id}/publish`)
        .expect(200);
      expect(await visible(motherAgent)).toContain('Sortie scolaire');
      await secretary.agent
        .put(`/api/v1/school/announcements/${draft.body.id}`)
        .send({ schoolId: a1.schoolId, title: 'Modifiée', body: 'x', audience: 'SCHOOL' })
        .expect(409);
      await secretary.agent
        .post(`/api/v1/school/announcements/${draft.body.id}/archive`)
        .expect(200);
      expect(await visible(motherAgent)).not.toContain('Sortie scolaire');
      const detail = await secretary.agent
        .get(`/api/v1/school/announcements/${draft.body.id}`)
        .expect(200);
      expect(detail.body.events.map((e: { action: string }) => e.action)).toEqual([
        'created',
        'published',
        'archived',
      ]);
      const past = await create(secretary.agent, {
        title: 'Passée',
        expiresOn: '2026-01-01',
      }).expect(201);
      expect(
        (
          await secretary.agent
            .post(`/api/v1/school/announcements/${past.body.id}/publish`)
            .expect(400)
        ).body.code,
      ).toBe('ANNOUNCEMENT_EXPIRED');
    });

    it('destinataires filtrés : classe, élèves, responsables ; enseignant limité à ses classes', async () => {
      await create(teacher.agent, { title: 'Tous' }).expect(403);
      await create(teacher.agent, {
        title: 'Classe 2',
        audience: 'CLASS',
        targetIds: [a1.class2],
      }).expect(404);
      const mine = await create(teacher.agent, {
        title: 'Classe 1',
        audience: 'CLASS',
        targetIds: [a1.class1],
      }).expect(201);
      await teacher.agent.post(`/api/v1/school/announcements/${mine.body.id}/publish`).expect(200);
      const other = await create(ownerA, {
        title: 'Pour la classe 2',
        audience: 'CLASS',
        targetIds: [a1.class2],
      }).expect(201);
      await ownerA.post(`/api/v1/school/announcements/${other.body.id}/publish`).expect(200);
      const forS2 = await create(ownerA, {
        title: 'Pour le second enfant',
        audience: 'STUDENTS',
        targetIds: [s2],
      }).expect(201);
      await ownerA.post(`/api/v1/school/announcements/${forS2.body.id}/publish`).expect(200);
      const forFather = await create(ownerA, {
        title: 'Pour le père',
        audience: 'GUARDIANS',
        targetIds: [father],
      }).expect(201);
      await ownerA.post(`/api/v1/school/announcements/${forFather.body.id}/publish`).expect(200);
      await create(ownerA, { title: 'Étranger', audience: 'STUDENTS', targetIds: [sB] }).expect(
        400,
      );
      const motherSees = await visible(motherAgent);
      expect(motherSees).toEqual(expect.arrayContaining(['Classe 1', 'Pour le second enfant']));
      expect(motherSees).not.toContain('Pour la classe 2');
      expect(motherSees).not.toContain('Pour le père');
      const fatherSees = await visible(fatherAgent);
      expect(fatherSees).toEqual(expect.arrayContaining(['Classe 1', 'Pour le père']));
      expect(fatherSees).not.toContain('Pour le second enfant');
      await ownerB.get(`/api/v1/school/announcements?schoolId=${a1.schoolId}`).expect(404);
    });
  });

  describe('notifications', () => {
    it('centre de notifications : non lues, lecture, tout marquer lu, lien vers la ressource', async () => {
      const list = await motherAgent.get('/api/v1/school/portal/notifications').expect(200);
      const kinds = new Set(list.body.items.map((n: { kind: string }) => n.kind));
      for (const kind of ['ABSENCE', 'LATE', 'REPORT_CARD', 'CHARGE_DUE', 'ANNOUNCEMENT']) {
        expect(kinds).toContain(kind);
      }
      expect(list.body.unread).toBeGreaterThan(0);
      const absence = list.body.items.find((n: { kind: string }) => n.kind === 'ABSENCE');
      expect(absence.href).toBe(`/parents/enfants/${absence.studentId}/presences`);
      await motherAgent.post(`/api/v1/school/portal/notifications/${absence.id}/read`).expect(204);
      await fatherAgent.post(`/api/v1/school/portal/notifications/${absence.id}/read`).expect(404);
      const unread = await motherAgent
        .get('/api/v1/school/portal/notifications?unread=true')
        .expect(200);
      expect(unread.body.items.map((n: { id: string }) => n.id)).not.toContain(absence.id);
      await motherAgent.post('/api/v1/school/portal/notifications/read-all').expect(204);
      expect(
        (await motherAgent.get('/api/v1/school/portal/dashboard').expect(200)).body
          .unreadNotifications,
      ).toBe(0);
    });
  });

  describe('SMS simulés', () => {
    // Sprint S2 : aucun SMS sans crédits prépayés ; les établissements des essais sont crédités.
    beforeAll(async () => {
      for (const s of [a1, a2, b1]) {
        const school = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
        await creditSmsWallet(db, school.organizationId, s.schoolId, 10_000);
      }
    });

    it('désactivés par défaut ; activés : file, envoi simulé, historique masqué, texte sans donnée sensible', async () => {
      expect(await db.schoolSmsMessage.count({ where: { schoolId: a1.schoolId } })).toBe(0);
      await secretary.agent
        .put('/api/v1/school/sms/settings')
        .send({ schoolId: a1.schoolId, enabled: true })
        .expect(403);
      await ownerA
        .put('/api/v1/school/sms/settings')
        .send({ schoolId: a1.schoolId, enabled: true })
        .expect(200);
      await sheet(teacher.agent, {
        date: yesterday,
        slot: 'S2',
        records: [
          { studentId: s1, status: 'ABSENT' },
          { studentId: s2, status: 'PRESENT' },
        ],
      }).expect(200);
      const queued = await db.schoolSmsMessage.findMany({ where: { schoolId: a1.schoolId } });
      // Seul le père accepte les SMS.
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({
        status: 'PENDING',
        phone: '+221 77 222 22 22',
        kind: 'ABSENCE',
      });
      expect(queued[0]!.body).not.toMatch(/\d+\s*\/\s*20|XOF|médical/);
      const before = provider.sent.length;
      const done = await sms.processDue();
      expect(done.sent).toBeGreaterThanOrEqual(1);
      expect(provider.sent.length).toBeGreaterThan(before);
      const history = await ownerA
        .get(`/api/v1/school/sms/messages?schoolId=${a1.schoolId}`)
        .expect(200);
      expect(history.body.items[0].phone).not.toContain('22 22');
      expect(history.body.items[0]).toMatchObject({ status: 'SENT', attempts: 1 });
      expect(history.body.items[0]).not.toHaveProperty('body');
    });

    it('échec passager : nouvelles tentatives puis envoi ; échec définitif : abandon', async () => {
      await db.schoolGuardian.update({
        where: { id: father },
        data: { phone: '+221 77 000 99 99' },
      });
      await sheet(teacher.agent, {
        date: yesterday,
        slot: 'S3',
        records: [{ studentId: s1, status: 'ABSENT' }],
      }).expect(200);
      const now = Date.now();
      let result = await sms.processDue(new Date(now));
      expect(result.retried).toBe(1);
      const retry = await db.schoolSmsMessage.findFirstOrThrow({
        where: { schoolId: a1.schoolId, phone: '+221 77 000 99 99' },
      });
      expect(retry).toMatchObject({
        status: 'PENDING',
        attempts: 1,
        lastError: 'PROVIDER_UNAVAILABLE',
      });
      // Pas encore l'heure : rien n'est repris.
      expect((await sms.processDue(new Date(now + 1000))).retried).toBe(0);
      result = await sms.processDue(new Date(now + 6 * 60_000));
      expect(result.retried).toBe(1);
      result = await sms.processDue(new Date(now + 20 * 60_000));
      expect(result.sent).toBe(1);
      expect(
        await db.schoolSmsMessage.findUniqueOrThrow({ where: { id: retry.id } }),
      ).toMatchObject({ status: 'SENT', attempts: 3 });
      await db.schoolGuardian.update({
        where: { id: father },
        data: { phone: '+221 77 000 00 00' },
      });
      await sheet(teacher.agent, {
        date: yesterday,
        slot: 'S4',
        records: [{ studentId: s1, status: 'LATE' }],
      }).expect(200);
      result = await sms.processDue(new Date(now + 30 * 60_000));
      expect(result.failed).toBe(1);
      expect(
        await db.schoolSmsMessage.findFirstOrThrow({
          where: { schoolId: a1.schoolId, phone: '+221 77 000 00 00' },
        }),
      ).toMatchObject({ status: 'FAILED', lastError: 'INVALID_NUMBER' });
    });

    it('établissement en Arabe : SMS en arabe', async () => {
      await ownerA
        .patch(`/api/v1/school/schools/${a1.schoolId}`)
        .send({ defaultLocale: 'AR' })
        .expect(200);
      try {
        await db.schoolGuardian.update({
          where: { id: father },
          data: { phone: '+221 77 222 22 22' },
        });
        await sheet(teacher.agent, {
          date: yesterday,
          slot: 'S5',
          records: [{ studentId: s1, status: 'LATE' }],
        }).expect(200);
        const message = await db.schoolSmsMessage.findFirstOrThrow({
          where: {
            schoolId: a1.schoolId,
            dedupeKey: { contains: ':LATE:' },
            phone: '+221 77 222 22 22',
          },
          orderBy: { createdAt: 'desc' },
        });
        expect(message.body).toMatch(/[؀-ۿ]/);
        const children = (await motherAgent.get('/api/v1/school/portal/children').expect(200)).body;
        expect(children[0].school.defaultLocale).toBe('AR');
      } finally {
        await ownerA
          .patch(`/api/v1/school/schools/${a1.schoolId}`)
          .send({ defaultLocale: 'FR' })
          .expect(200);
      }
    });
  });

  describe('mémorisation du Coran', () => {
    it('masquée pour une école non éligible ; visible si le module est actif ; observations autorisées seules', async () => {
      await motherAgent.get(`/api/v1/school/portal/children/${s1}/quran`).expect(404);
      await ownerA
        .patch(`/api/v1/school/schools/${a1.schoolId}`)
        .send({ defaultLocale: 'BILINGUAL' })
        .expect(200);
      try {
        const coran = (
          await ownerA
            .post('/api/v1/school/subjects/catalog/coran/activate')
            .send({ schoolId: a1.schoolId })
            .expect(201)
        ).body.id as string;
        await ownerA
          .put(`/api/v1/school/subjects/${coran}/levels`)
          .send({ levels: [{ levelId: a1.level1, coefficient: 1 }] })
          .expect(200);
        await ownerA
          .post('/api/v1/school/teaching-assignments')
          .send({ classId: a1.class1, subjectId: coran, memberId: teacher.id })
          .expect(201);
        await ownerA
          .put('/api/v1/school/quran/settings')
          .send({ schoolId: a1.schoolId, enabled: true, subjectId: coran })
          .expect(200);
        const evaluate = (body: Record<string, unknown>) =>
          teacher.agent
            .post(`/api/v1/school/quran/students/${s1}/evaluations`)
            .send({ surah: 112, status: 'MEMORIZED', evaluatedOn: '2026-10-15', ...body })
            .expect(201);
        await evaluate({ remark: 'Très bonne récitation', remarkShared: true });
        await evaluate({
          surah: 113,
          status: 'IN_PROGRESS',
          remark: 'Note interne',
          remarkShared: false,
        });
        const quran = await motherAgent
          .get(`/api/v1/school/portal/children/${s1}/quran`)
          .expect(200);
        expect(quran.body.surahs).toHaveLength(114);
        expect(quran.body.summary.counts.MEMORIZED).toBe(1);
        const remarks = quran.body.evaluations.map((e: { remark: string | null }) => e.remark);
        expect(remarks).toContain('Très bonne récitation');
        expect(remarks).not.toContain('Note interne');
        expect(JSON.stringify(quran.body)).not.toContain('evaluatorUserId');
        await motherAgent.get(`/api/v1/school/portal/children/${s3}/quran`).expect(404);
      } finally {
        await ownerA
          .patch(`/api/v1/school/schools/${a1.schoolId}`)
          .send({ defaultLocale: 'FR' })
          .expect(200);
      }
    });
  });

  describe('correctifs de l’audit (passe 1)', () => {
    const portalOk = (agent: Agent) => agent.get('/api/v1/school/portal/children');
    // Concurrence et volume : plusieurs connexions réelles exigées ; ignorés sur PGlite, qui exécute tout
    // en séquence et ne supporte pas l'insertion de centaines de relevés d'un coup.
    const realDatabase = ![
      process.env.TEST_DATABASE_URL,
      process.env.SCHOOL_TEST_DATABASE_URL ?? process.env.TEST_SCHOOL_DATABASE_URL,
    ].some((url) => url?.includes('connection_limit=1'));
    const itReal = realDatabase ? it : it.skip;

    itReal(
      'invitations simultanées : une seule reste utilisable ; activation et révocation simultanées sans interblocage ; activation journalisée',
      async () => {
        const aunt = await guardian(ownerA, a1, 'Khady', '+221 77 555 55 55');
        await link(ownerA, s1, aunt, { canViewSchoolInfo: true });
        const both = await Promise.all([invite(ownerA, aunt), invite(secretary.agent, aunt)]);
        expect(both.map((r) => r.status)).toEqual([201, 201]);
        expect(
          await db.schoolGuardianInvitation.count({
            where: { guardianId: aunt, usedAt: null, revokedAt: null },
          }),
        ).toBe(1);
        // L'une des deux a révoqué l'autre.
        const states = await Promise.all(
          both.map(async (r) => ({
            token: tokenOf(r.body.path),
            status: (
              await anonymous()
                .post('/api/v1/school/portal/activation/check')
                .send({ token: tokenOf(r.body.path) })
                .expect(200)
            ).body.status as string,
          })),
        );
        expect(states.map((s) => s.status).sort()).toEqual(['PENDING', 'REVOKED']);
        const token = states.find((s) => s.status === 'PENDING')!.token;
        const first = await anonymous()
          .post('/api/v1/school/portal/activation')
          .send({ token, password: PARENT_PASSWORD })
          .expect(200);
        const user = await prisma.user.findFirstOrThrow({ where: { loginId: first.body.loginId } });
        expect(
          await db.schoolAccessDecision.count({
            where: { action: 'school.portal_activated', actorUserId: user.id },
          }),
        ).toBe(1);
        // Compte existant : nouvelle activation et révocation de l'accès en même temps.
        for (let round = 0; round < 3; round += 1) {
          const again = await invite(ownerA, aunt).expect(201);
          const [activation, revocation] = await Promise.all([
            anonymous()
              .post('/api/v1/school/portal/activation')
              .send({ token: tokenOf(again.body.path), password: PARENT_PASSWORD }),
            secretary.agent
              .post(`/api/v1/school/guardians/${aunt}/portal/revoke`)
              .send({ reason: 'Essai de concurrence' }),
          ]);
          expect([200, 403]).toContain(activation.status);
          expect([200, 404]).toContain(revocation.status);
          // Remise en état : le compte est relié avant le tour suivant.
          const relink = await invite(ownerA, aunt).expect(201);
          const done = await anonymous()
            .post('/api/v1/school/portal/activation')
            .send({ token: tokenOf(relink.body.path), password: PARENT_PASSWORD });
          expect(done.status).toBe(200);
        }
      },
    );

    it('organisation suspendue ou établissement hors contrat : portail fermé, rouvert ensuite', async () => {
      const org = organizations[0]!;
      await portalOk(motherAgent).expect(200);
      await prisma.organization.update({ where: { id: org }, data: { status: 'SUSPENDED' } });
      try {
        await portalOk(motherAgent).expect(401);
        const refused = await login(app, motherLoginId, PARENT_PASSWORD);
        expect(refused.status).not.toBe(200);
      } finally {
        await prisma.organization.update({ where: { id: org }, data: { status: 'ACTIVE' } });
      }
      await portalOk(motherAgent).expect(200);
      await prisma.suiteContract.updateMany({
        where: { organizationId: org },
        data: { coveredSchoolIds: [a2.schoolId] },
      });
      try {
        expect(await childIds(motherAgent)).toEqual([]);
        await motherAgent.get(`/api/v1/school/portal/children/${s1}/attendance`).expect(404);
        await motherAgent
          .post(`/api/v1/school/portal/children/${s1}/justifications`)
          .send({ fromDate: today, toDate: today, reason: 'Hors contrat' })
          .expect(404);
      } finally {
        await prisma.suiteContract.updateMany({
          where: { organizationId: org },
          data: { coveredSchoolIds: [] },
        });
      }
      expect(await childIds(motherAgent)).toContain(s1);
    });

    itReal(
      'appel et acceptation d’un justificatif simultanés : l’absence est toujours justifiée',
      async () => {
        for (let k = 2; k <= 5; k += 1) {
          const date = new Date(Date.parse(`${today}T00:00:00Z`) - k * 86_400_000)
            .toISOString()
            .slice(0, 10);
          const submitted = await motherAgent
            .post(`/api/v1/school/portal/children/${s1}/justifications`)
            .send({ fromDate: date, toDate: date, reason: 'Fièvre' })
            .expect(201);
          const [saved, reviewed] = await Promise.all([
            sheet(secretary.agent, {
              date,
              slot: `C${k}`,
              records: [{ studentId: s1, status: 'ABSENT' }],
            }),
            secretary.agent
              .post(`/api/v1/school/attendance/justifications/${submitted.body.id}/review`)
              .send({ decision: 'ACCEPTED' }),
          ]);
          expect([saved.status, reviewed.status]).toEqual([200, 200]);
          const record = await db.schoolAttendanceRecord.findFirstOrThrow({
            where: { studentId: s1, session: { classId: a1.class1, slot: `C${k}` } },
          });
          expect(record.status).toBe('EXCUSED');
        }
      },
    );

    itReal(
      'statistiques individuelles calculées sur toute la période, liste affichée limitée',
      async () => {
        const sessions = Array.from({ length: 600 }, (_, i) => ({
          id: randomUUID(),
          organizationId: organizations[0]!,
          schoolId: a1.schoolId,
          schoolYearId: a1.yearId,
          classId: a1.class2,
          date: new Date(Date.parse('2026-10-01T00:00:00Z') + Math.floor(i / 5) * 86_400_000),
          slot: `P${i % 5}`,
          takenByUserId: randomUUID(),
        }));
        await db.schoolAttendanceSession.createMany({ data: sessions });
        await db.schoolAttendanceRecord.createMany({
          data: sessions.map((s, i) => ({
            organizationId: s.organizationId,
            sessionId: s.id,
            studentId: s3,
            // Les 100 plus anciens relevés sont des absences, au-delà de la liste affichée.
            status: i < 100 ? ('ABSENT' as const) : ('PRESENT' as const),
            updatedByUserId: s.takenByUserId,
          })),
        });
        const view = await ownerA.get(`/api/v1/school/attendance/students/${s3}`).expect(200);
        expect(view.body.stats).toMatchObject({ sessions: 600, absent: 100, present: 500 });
        expect(view.body.stats.presenceRate).toBe(8333);
        expect(view.body.records).toHaveLength(500);
        expect(view.body.truncated).toBe(true);
      },
    );

    it('SMS : bail expiré après la dernière tentative : échec, jamais une sixième tentative', async () => {
      const base = {
        organizationId: organizations[0]!,
        schoolId: a1.schoolId,
        kind: 'ABSENCE' as const,
        body: 'Essai',
        status: 'PENDING' as const,
        nextAttemptAt: new Date(Date.now() - 60_000),
      };
      const exhausted = await db.schoolSmsMessage.create({
        data: {
          ...base,
          phone: '+221 77 000 12 34',
          attempts: 5,
          dedupeKey: `test-exhausted:${RUN}`,
        },
      });
      const last = await db.schoolSmsMessage.create({
        data: { ...base, phone: '+221 77 000 56 78', attempts: 4, dedupeKey: `test-last:${RUN}` },
      });
      const sentBefore = provider.sent.length;
      const result = await sms.processDue(new Date(), 500);
      expect(result.failed).toBeGreaterThanOrEqual(1);
      expect(
        await db.schoolSmsMessage.findUniqueOrThrow({ where: { id: exhausted.id } }),
      ).toMatchObject({ status: 'FAILED', attempts: 5, lastError: 'ATTEMPTS_EXHAUSTED' });
      expect(await db.schoolSmsMessage.findUniqueOrThrow({ where: { id: last.id } })).toMatchObject(
        { status: 'SENT', attempts: 5 },
      );
      expect(provider.sent.slice(sentBefore).map((m) => m.to)).not.toContain('+221 77 000 12 34');
    });

    it('justificatif d’un autre établissement (élève transféré) : jamais appliqué ici', async () => {
      const date = new Date(Date.parse(`${today}T00:00:00Z`) - 8 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      // État laissé par un transfert : justificatifs de l'élève rattachés à l'ancien établissement.
      const base = {
        organizationId: organizations[0]!,
        schoolId: a2.schoolId,
        studentId: s1,
        fromDate: new Date(`${date}T00:00:00Z`),
        toDate: new Date(`${date}T00:00:00Z`),
        reason: 'Ancien établissement',
        byGuardian: false,
        submittedByUserId: randomUUID(),
      };
      await db.schoolAbsenceJustification.create({
        data: { ...base, status: 'ACCEPTED', reviewedAt: new Date() },
      });
      await sheet(secretary.agent, {
        date,
        slot: 'T1',
        records: [{ studentId: s1, status: 'ABSENT' }],
      }).expect(200);
      const pending = await db.schoolAbsenceJustification.create({ data: base });
      await ownerA
        .post(`/api/v1/school/attendance/justifications/${pending.id}/review`)
        .send({ decision: 'ACCEPTED' })
        .expect(200);
      const record = await db.schoolAttendanceRecord.findFirstOrThrow({
        where: { studentId: s1, session: { classId: a1.class1, slot: 'T1' } },
      });
      expect(record.status).toBe('ABSENT');
    });

    it('personnel limité à un établissement : relevés et justificatifs d’un autre établissement exclus', async () => {
      // Relevé de l'élève dans l'établissement voisin (état laissé par un transfert).
      const session = await db.schoolAttendanceSession.create({
        data: {
          organizationId: organizations[0]!,
          schoolId: a2.schoolId,
          schoolYearId: a2.yearId,
          classId: a2.class1,
          date: new Date('2026-10-03T00:00:00Z'),
          slot: 'V1',
          takenByUserId: randomUUID(),
        },
      });
      await db.schoolAttendanceRecord.create({
        data: {
          organizationId: organizations[0]!,
          sessionId: session.id,
          studentId: s1,
          status: 'ABSENT',
          updatedByUserId: session.takenByUserId,
        },
      });
      const all = await ownerA.get(`/api/v1/school/attendance/students/${s1}`).expect(200);
      const limited = await secretary.agent
        .get(`/api/v1/school/attendance/students/${s1}`)
        .expect(200);
      expect(all.body.records.map((r: { class: { id: string } }) => r.class.id)).toContain(
        a2.class1,
      );
      expect(limited.body.records.map((r: { class: { id: string } }) => r.class.id)).not.toContain(
        a2.class1,
      );
      expect(limited.body.stats.sessions).toBe(all.body.stats.sessions - 1);
      const reasons = (body: { justifications: { reason: string }[] }) =>
        body.justifications.map((j) => j.reason);
      expect(reasons(all.body)).toContain('Ancien établissement');
      expect(reasons(limited.body)).not.toContain('Ancien établissement');
    });

    it('fait d’un autre établissement : aucun responsable de l’établissement actuel notifié', async () => {
      const resourceId = randomUUID();
      await app.get(SchoolNotificationsService).notifyStudents(db, {
        organizationId: organizations[0]!,
        schoolId: a2.schoolId,
        kind: 'CHARGE_OVERDUE',
        resourceId,
        studentIds: [s1],
        dedupe: () => `test-other-school:${resourceId}`,
        sms: { kind: 'CHARGE_OVERDUE' },
      });
      expect(await db.schoolNotification.count({ where: { resourceId } })).toBe(0);
      expect(
        await db.schoolSmsMessage.count({
          where: { dedupeKey: { startsWith: `test-other-school:${resourceId}` } },
        }),
      ).toBe(0);
    });

    it('élève sorti de la classe : son relevé reste affiché et corrigeable, aucune nouvelle saisie', async () => {
      const date = new Date(Date.parse(`${today}T00:00:00Z`) - 10 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      await sheet(secretary.agent, {
        date,
        slot: 'F1',
        records: [{ studentId: s1, status: 'PRESENT' }],
      }).expect(200);
      // Relevé de s3 (classe 2) dans cette séance de la classe 1, comme avant un changement de classe.
      const session = await db.schoolAttendanceSession.findFirstOrThrow({
        where: { classId: a1.class1, slot: 'F1' },
      });
      await db.schoolAttendanceRecord.create({
        data: {
          organizationId: organizations[0]!,
          sessionId: session.id,
          studentId: s3,
          status: 'PRESENT',
          updatedByUserId: session.takenByUserId,
        },
      });
      const view = await secretary.agent
        .get(`/api/v1/school/attendance/sheet?classId=${a1.class1}&date=${date}&slot=F1`)
        .expect(200);
      expect(view.body.students.find((s: { id: string }) => s.id === s3)).toMatchObject({
        former: true,
        record: { status: 'PRESENT' },
      });
      await sheet(secretary.agent, {
        date,
        slot: 'F1',
        records: [{ studentId: s3, status: 'ABSENT' }],
        reason: 'Erreur avant le changement de classe',
      }).expect(200);
      expect(
        (
          await sheet(secretary.agent, {
            date,
            slot: 'F2',
            records: [{ studentId: s3, status: 'ABSENT' }],
          }).expect(400)
        ).body.code,
      ).toBe('STUDENT_NOT_IN_CLASS');
      // Statistiques de classe : l'ancien élève figure dans le détail, qui explique tout le total.
      const stats = await secretary.agent
        .get(`/api/v1/school/attendance/stats?classId=${a1.class1}&from=${date}&to=${date}`)
        .expect(200);
      expect(stats.body.students.find((s: { id: string }) => s.id === s3)).toMatchObject({
        former: true,
        absent: 1,
      });
      const detailed = stats.body.students.reduce(
        (sum: number, s: { sessions: number }) => sum + s.sessions,
        0,
      );
      expect(detailed).toBe(stats.body.total.sessions);
    });

    it('annonces paginées : portail parents et liste du personnel', async () => {
      const first = await motherAgent.get('/api/v1/school/portal/announcements').expect(200);
      const page0 = await motherAgent.get('/api/v1/school/portal/announcements?page=0').expect(200);
      expect(page0.body).toEqual(first.body);
      expect(first.body.length).toBeGreaterThan(0);
      const page1 = await motherAgent.get('/api/v1/school/portal/announcements?page=1').expect(200);
      expect(page1.body).toEqual([]);
      await motherAgent.get('/api/v1/school/portal/announcements?page=-1').expect(400);
      const staff = (page: number) =>
        secretary.agent.get(`/api/v1/school/announcements?schoolId=${a1.schoolId}&page=${page}`);
      expect((await staff(0).expect(200)).body.length).toBeGreaterThan(0);
      expect((await staff(1).expect(200)).body).toEqual([]);
    });

    it('SMS en file pour un responsable qui ne les accepte plus : annulé, jamais envoyé', async () => {
      const date = new Date(Date.parse(`${today}T00:00:00Z`) - 11 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      await sheet(secretary.agent, {
        date,
        slot: 'Q1',
        records: [{ studentId: s1, status: 'ABSENT' }],
      }).expect(200);
      const queued = await db.schoolSmsMessage.findFirstOrThrow({
        where: { schoolId: a1.schoolId, status: 'PENDING', guardianId: father, studentId: s1 },
      });
      await secretary.agent
        .patch(`/api/v1/school/students/${s1}/guardians/${father}`)
        .send({ canReceiveSms: false })
        .expect(200);
      try {
        const before = provider.sent.length;
        const result = await sms.processDue(new Date(Date.now() + 60_000), 500);
        expect(result.cancelled).toBeGreaterThanOrEqual(1);
        expect(
          await db.schoolSmsMessage.findUniqueOrThrow({ where: { id: queued.id } }),
        ).toMatchObject({ status: 'CANCELLED', attempts: 0, lastError: 'RECIPIENT_INELIGIBLE' });
        expect(provider.sent.length).toBe(before);
      } finally {
        await secretary.agent
          .patch(`/api/v1/school/students/${s1}/guardians/${father}`)
          .send({ canReceiveSms: true })
          .expect(200);
      }
    });

    it('historique : minutes de retard et note conservées avant et après chaque correction', async () => {
      const date = new Date(Date.parse(`${today}T00:00:00Z`) - 9 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      await sheet(secretary.agent, {
        date,
        slot: 'H1',
        records: [{ studentId: s2, status: 'LATE', minutesLate: 45, note: 'Bus en panne' }],
      }).expect(200);
      await sheet(secretary.agent, {
        date,
        slot: 'H1',
        records: [{ studentId: s2, status: 'LATE', minutesLate: 5, note: 'Bus' }],
        reason: 'Erreur de saisie',
      }).expect(200);
      const record = await db.schoolAttendanceRecord.findFirstOrThrow({
        where: { studentId: s2, session: { classId: a1.class1, slot: 'H1' } },
      });
      const history = await secretary.agent
        .get(`/api/v1/school/attendance/records/${record.id}/history`)
        .expect(200);
      expect(history.body[0]).toMatchObject({
        fromStatus: null,
        toStatus: 'LATE',
        toMinutesLate: 45,
        toNote: 'Bus en panne',
      });
      expect(history.body[1]).toMatchObject({
        fromStatus: 'LATE',
        toStatus: 'LATE',
        fromMinutesLate: 45,
        toMinutesLate: 5,
        fromNote: 'Bus en panne',
        toNote: 'Bus',
        reason: 'Erreur de saisie',
      });
    });

    it('enseignant : historique d’un élève limité à ses classes, sans les justificatifs', async () => {
      // Relevé de l'élève dans une classe qui n'est pas confiée à l'enseignant.
      const session = await db.schoolAttendanceSession.create({
        data: {
          organizationId: organizations[0]!,
          schoolId: a1.schoolId,
          schoolYearId: a1.yearId,
          classId: a1.class2,
          date: new Date('2026-10-02T00:00:00Z'),
          slot: 'X1',
          takenByUserId: randomUUID(),
        },
      });
      await db.schoolAttendanceRecord.create({
        data: {
          organizationId: organizations[0]!,
          sessionId: session.id,
          studentId: s1,
          status: 'ABSENT',
          updatedByUserId: session.takenByUserId,
        },
      });
      const classesOf = (body: { records: { class: { id: string } }[] }) =>
        new Set(body.records.map((r) => r.class.id));
      // Secrétariat du même établissement : toutes les classes, comparaison à périmètre égal.
      const staff = await secretary.agent
        .get(`/api/v1/school/attendance/students/${s1}`)
        .expect(200);
      expect(classesOf(staff.body).has(a1.class2)).toBe(true);
      expect(staff.body.justifications.length).toBeGreaterThan(0);
      const mine = await teacher.agent.get(`/api/v1/school/attendance/students/${s1}`).expect(200);
      expect([...classesOf(mine.body)]).toEqual([a1.class1]);
      expect(mine.body.stats.sessions).toBe(staff.body.stats.sessions - 1);
      expect(mine.body.justifications).toEqual([]);
    });

    it('enseignant : publication refusée pour une classe qui ne lui est plus confiée', async () => {
      const draft = await teacher.agent
        .post('/api/v1/school/announcements')
        .send({
          schoolId: a1.schoolId,
          title: 'Brouillon de classe',
          body: 'Sortie',
          audience: 'CLASS',
          targetIds: [a1.class1],
        })
        .expect(201);
      const assignments = await db.schoolTeachingAssignment.findMany({
        where: { memberId: teacher.id, classId: a1.class1, endedAt: null },
      });
      for (const a of assignments) {
        await ownerA
          .post(`/api/v1/school/teaching-assignments/${a.id}/end`)
          .send({ reason: 'Fin d’affectation' })
          .expect(200);
      }
      expect(
        (
          await teacher.agent
            .post(`/api/v1/school/announcements/${draft.body.id}/publish`)
            .expect(403)
        ).body.code,
      ).toBe('FORBIDDEN');
      expect(await db.schoolNotification.count({ where: { resourceId: draft.body.id } })).toBe(0);
    });
  });

  describe('révocation et isolation', () => {
    it('rattachement révoqué : l’enfant disparaît ; accès retiré : session et connexion refusées', async () => {
      const titles = async () =>
        (await motherAgent.get('/api/v1/school/portal/notifications').expect(200)).body.items
          .filter((n: { kind: string }) => n.kind === 'ANNOUNCEMENT')
          .map((n: { params: { title: string } }) => n.params.title);
      expect(await titles()).toContain('Pour le second enfant');
      await secretary.agent
        .patch(`/api/v1/school/students/${s2}/guardians/${mother}`)
        .send({ canViewSchoolInfo: false })
        .expect(200);
      expect(await childIds(motherAgent)).toEqual([s1]);
      // L'annonce qui ne visait que l'enfant retiré disparaît avec ses notifications.
      expect(await titles()).not.toContain('Pour le second enfant');
      expect(await titles()).toContain('Classe 1');
      await motherAgent.get(`/api/v1/school/portal/children/${s2}/attendance`).expect(404);
      const status = await secretary.agent
        .get(`/api/v1/school/guardians/${father}/portal`)
        .expect(200);
      const loginId = status.body.account.loginId as string;
      await secretary.agent
        .post(`/api/v1/school/guardians/${father}/portal/revoke`)
        .send({ reason: 'Fin de la garde' })
        .expect(200);
      // Révocation effective dès la requête suivante.
      await fatherAgent.get('/api/v1/school/portal/children').expect(401);
      const again = await login(app, loginId, PARENT_PASSWORD);
      expect(again.status).toBe(403);
      expect(again.body.code).toBe('ACCOUNT_DISABLED');
    });

    it('isolation entre clients : un parent d’un autre client ne voit rien de l’école A', async () => {
      const sent = await invite(ownerB, guardianB).expect(201);
      const other = (await activate(sent.body.path)).agent;
      expect(await childIds(other)).toEqual([sB]);
      for (const id of [s1, s2, s3]) {
        await other.get(`/api/v1/school/portal/children/${id}/results`).expect(404);
      }
      const titles = (await other.get('/api/v1/school/portal/announcements').expect(200)).body;
      expect(titles).toEqual([]);
      const notes = (await other.get('/api/v1/school/portal/notifications').expect(200)).body;
      expect(notes.items).toEqual([]);
    });
  });
});
