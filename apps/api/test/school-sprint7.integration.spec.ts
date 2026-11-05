import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
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
 * Ocall School, Sprint 7 : salles, emplois du temps, conflits, calendrier scolaire, examens, portail
 * parents. Données entièrement fictives. Exige TEST_DATABASE_URL et une base School de test distincte.
 */
const suite =
  (process.env.SCHOOL_TEST_DATABASE_URL ?? process.env.TEST_SCHOOL_DATABASE_URL)
    ? describe
    : describe.skip;

const TERMS = { startsOn: '2026-01-01', endsOn: '2099-12-31' };
const PARENT_PASSWORD = 'Famille2026Secure';
/** Semaine de test : lundi 16 novembre 2026. */
const MONDAY = '2026-11-16';
const WEDNESDAY = '2026-11-18';

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

suite('Ocall School — Sprint 7, planning, calendrier et examens (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: SchoolPrismaService;
  let platform: InternalAccount;
  let ownerA: Agent;
  let ownerB: Agent;
  let a1: Structure;
  let b1: Structure;
  let secretary: Member;
  let teacher: Member;
  let teacher2: Member;
  let supervisor: Member;
  let maths: string;
  let french: string;
  let s1: string;
  let s2: string;
  let groupA: string;
  let mother: string;
  let motherAgent: Agent;
  let roomA: string;
  let roomB: string;
  let draft1: string;
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
        ownerEmail: email(`owner7-${label}`),
        reference: `OCS7-${RUN}-${++counter}`,
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

  async function enrolled(
    owner: Agent,
    s: Structure,
    classId: string,
    lastName: string,
    firstName: string,
  ) {
    const created = await owner
      .post('/api/v1/school/students')
      .send({ schoolId: s.schoolId, lastName, firstName, birthDate: '2016-02-14' })
      .expect(201);
    // Inscription validée : l'élève doit avoir au moins un responsable (règle du Sprint 2).
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

  const assign = (classId: string, subjectId: string, memberId: string, groupId?: string) =>
    ownerA
      .post('/api/v1/school/teaching-assignments')
      .send({ classId, subjectId, memberId, ...(groupId ? { groupId } : {}) })
      .expect(201);

  const draft = (agent: Agent, classId: string, extra: Record<string, unknown> = {}) =>
    agent
      .post('/api/v1/school/timetables')
      .send({ classId, validFrom: '2026-10-01', validTo: '2027-06-30', ...extra });

  const slot = (agent: Agent, timetableId: string, body: Record<string, unknown>) =>
    agent.post(`/api/v1/school/timetables/${timetableId}/slots`).send({
      kind: 'LESSON',
      weekday: 1,
      start: '08:00',
      end: '09:00',
      ...body,
    });

  const classWeek = (agent: Agent, classId: string, date = MONDAY) =>
    agent.get(`/api/v1/school/planning/class-week?classId=${classId}&date=${date}`);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(SchoolPrismaService);
    platform = await internalAccount(app, prisma, `sc7-owner-${RUN}`, 'PLATFORM_OWNER');
    ownerA = await client('a');
    ownerB = await client('b');
    a1 = await structure(ownerA, 'Ecole Planning');
    b1 = await structure(ownerB, 'Ecole Autre Planning');
    secretary = await member(ownerA, 'SECRETARY', [a1.schoolId]);
    teacher = await member(ownerA, 'TEACHER', [a1.schoolId]);
    teacher2 = await member(ownerA, 'TEACHER', [a1.schoolId]);
    supervisor = await member(ownerA, 'SUPERVISOR', [a1.schoolId]);
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
    s1 = await enrolled(ownerA, a1, a1.class1, 'Ba', 'Awa');
    s2 = await enrolled(ownerA, a1, a1.class1, 'Diop', 'Fatou');
    groupA = (
      await ownerA
        .post(`/api/v1/school/classes/${a1.class1}/groups`)
        .send({ name: 'Groupe A' })
        .expect(201)
    ).body.id;
    await ownerA
      .put(`/api/v1/school/groups/${groupA}/students`)
      .send({ studentIds: [s2] })
      .expect(200);
    // L'enseignant 1 : mathématiques dans les deux classes ; l'enseignant 2 : français en classe 1.
    await assign(a1.class1, maths, teacher.id);
    await assign(a1.class2, maths, teacher.id);
    await assign(a1.class1, french, teacher2.id);
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
    // Famille : la mère suit le premier enfant.
    mother = (
      await ownerA
        .post('/api/v1/school/guardians')
        .send({
          schoolId: a1.schoolId,
          lastName: 'Ba',
          firstName: 'Aminata',
          phone: '+221 77 111 11 11',
        })
        .expect(201)
    ).body.id;
    await ownerA
      .post(`/api/v1/school/students/${s1}/guardians`)
      .send({ guardianId: mother, relation: 'MOTHER', canViewSchoolInfo: true })
      .expect(201);
    const sent = await ownerA
      .post(`/api/v1/school/guardians/${mother}/portal/invitations`)
      .send({ sendSms: false })
      .expect(201);
    const token = new URL(sent.body.path, 'http://x').searchParams.get('token');
    const activated = await request(app.getHttpServer())
      .post('/api/v1/school/portal/activation')
      .send({ token, password: PARENT_PASSWORD })
      .expect(200);
    motherAgent = (await login(app, activated.body.loginId, PARENT_PASSWORD)).agent;
  }, 600_000);

  afterAll(async () => {
    const where = { organizationId: { in: organizations } };
    const portalUsers = (
      await db.schoolPortalAccount.findMany({ where, select: { userId: true } })
    ).map((a) => a.userId);
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: portalUsers } } });
    await prisma.session.deleteMany({ where: { userId: { in: portalUsers } } });
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: portalUsers } } });
    await prisma.user.deleteMany({ where: { id: { in: portalUsers } } });
    await db.schoolExamSchedule.deleteMany({ where });
    await db.schoolCalendarEventTarget.deleteMany({ where });
    await db.schoolCalendarEvent.deleteMany({ where });
    await db.schoolLessonException.deleteMany({ where });
    await db.schoolTimetableEvent.deleteMany({ where });
    await db.schoolTimetableSlot.deleteMany({ where });
    await db.schoolTimetable.deleteMany({ where });
    await db.schoolTeacherUnavailability.deleteMany({ where });
    await db.schoolRoom.deleteMany({ where });
    await db.schoolNotification.deleteMany({ where });
    await db.schoolSmsMessage.deleteMany({ where });
    await db.schoolGuardianInvitation.deleteMany({ where });
    await db.schoolPortalAccount.deleteMany({ where });
    await db.schoolGradeEvent.deleteMany({ where });
    await db.schoolGrade.deleteMany({ where });
    await db.schoolEvaluation.deleteMany({ where });
    await db.academicPeriod.deleteMany({ where });
    await db.schoolTeachingAssignment.deleteMany({ where });
    await db.schoolTeacherSubject.deleteMany({ where });
    await db.subjectLevel.deleteMany({ where });
    await db.subject.deleteMany({ where });
    await db.schoolStudentEvent.deleteMany({ where });
    await db.schoolClassGroupStudent.deleteMany({ where });
    await db.schoolClassGroup.deleteMany({ where });
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

  describe('salles', () => {
    it('création, nom unique, capacité, désactivation ; droits et isolation', async () => {
      roomA = (
        await secretary.agent
          .post('/api/v1/school/rooms')
          .send({ schoolId: a1.schoolId, name: 'Salle 1', capacity: 30 })
          .expect(201)
      ).body.id;
      roomB = (
        await ownerA
          .post('/api/v1/school/rooms')
          .send({ schoolId: a1.schoolId, name: 'Salle 2' })
          .expect(201)
      ).body.id;
      expect(
        (
          await ownerA
            .post('/api/v1/school/rooms')
            .send({ schoolId: a1.schoolId, name: 'Salle 1' })
            .expect(409)
        ).body.code,
      ).toBe('ROOM_NAME_TAKEN');
      await teacher.agent
        .post('/api/v1/school/rooms')
        .send({ schoolId: a1.schoolId, name: 'X' })
        .expect(403);
      await ownerA
        .post('/api/v1/school/rooms')
        .send({ schoolId: a1.schoolId, name: 'Y', capacity: 0 })
        .expect(400);
      const off = (
        await ownerA
          .post('/api/v1/school/rooms')
          .send({ schoolId: a1.schoolId, name: 'Ancienne' })
          .expect(201)
      ).body.id;
      await ownerA.patch(`/api/v1/school/rooms/${off}`).send({ isActive: false }).expect(200);
      const listed = await teacher.agent
        .get(`/api/v1/school/rooms?schoolId=${a1.schoolId}`)
        .expect(200);
      expect(listed.body.map((r: { name: string }) => r.name)).toEqual(['Salle 1', 'Salle 2']);
      await ownerB.get(`/api/v1/school/rooms?schoolId=${a1.schoolId}`).expect(404);
      await ownerB.patch(`/api/v1/school/rooms/${roomA}`).send({ name: 'Piratée' }).expect(404);
    });
  });

  describe('emplois du temps', () => {
    it('brouillon : créneaux, pause, contrôles d’heure, d’affectation et de chevauchement ; un seul brouillon', async () => {
      draft1 = (await draft(secretary.agent, a1.class1).expect(201)).body.id;
      expect((await draft(ownerA, a1.class1).expect(409)).body.code).toBe('TIMETABLE_DRAFT_EXISTS');
      await draft(teacher.agent, a1.class2).expect(403);
      await draft(ownerA, a1.class2, { validTo: '2027-08-31' }).expect(400);
      await slot(secretary.agent, draft1, {
        subjectId: maths,
        memberId: teacher.id,
        roomId: roomA,
      }).expect(201);
      await slot(secretary.agent, draft1, {
        start: '09:00',
        end: '10:00',
        subjectId: french,
        memberId: teacher2.id,
        groupId: groupA,
      }).expect(201);
      await slot(secretary.agent, draft1, {
        kind: 'BREAK',
        start: '10:00',
        end: '10:15',
        label: 'Récréation',
      }).expect(201);
      expect(
        (
          await slot(secretary.agent, draft1, {
            start: '11:00',
            end: '11:00',
            subjectId: maths,
            memberId: teacher.id,
          }).expect(400)
        ).body.code,
      ).toBe('SLOT_INVALID_TIME');
      expect(
        (
          await slot(secretary.agent, draft1, {
            start: '11:00',
            end: '12:00',
            subjectId: maths,
            memberId: teacher2.id,
          }).expect(409)
        ).body.code,
      ).toBe('SLOT_TEACHER_NOT_ASSIGNED');
      const overlap = await slot(secretary.agent, draft1, {
        start: '08:30',
        end: '09:30',
        subjectId: french,
        memberId: teacher2.id,
      }).expect(409);
      expect(overlap.body.code).toBe('SLOT_CLASS_OVERLAP');
      expect(overlap.body.details[0]).toMatchObject({ code: 'SLOT_CLASS_OVERLAP', weekday: 1 });
      await slot(secretary.agent, draft1, {
        kind: 'BREAK',
        start: '11:00',
        end: '11:15',
        subjectId: maths,
      }).expect(400);
      const view = await secretary.agent.get(`/api/v1/school/timetables/${draft1}`).expect(200);
      expect(view.body.slots).toHaveLength(3);
      expect(view.body.slots[0]).toMatchObject({
        start: '08:00',
        end: '09:00',
        room: { name: 'Salle 1' },
      });
      expect(view.body.events.map((e: { action: string }) => e.action)).toEqual([
        'created',
        'slot_added',
        'slot_added',
        'slot_added',
      ]);
      // Brouillon invisible de l'enseignant et des familles.
      await teacher.agent.get(`/api/v1/school/timetables/${draft1}`).expect(404);
    });

    it('publication contrôlée : direction seulement, familles notifiées, consultation enseignant et parent', async () => {
      await secretary.agent.post(`/api/v1/school/timetables/${draft1}/publish`).expect(403);
      const checked = await ownerA.post(`/api/v1/school/timetables/${draft1}/check`).expect(200);
      expect(checked.body.conflicts).toEqual([]);
      await ownerA.post(`/api/v1/school/timetables/${draft1}/publish`).expect(200);
      expect(
        await db.schoolNotification.count({ where: { kind: 'TIMETABLE', resourceId: draft1 } }),
      ).toBe(1);
      const week = await classWeek(teacher.agent, a1.class1).expect(200);
      const monday = week.body.days[0];
      expect(monday.date).toBe(MONDAY);
      expect(monday.lessons.map((l: { start: string }) => l.start)).toEqual([
        '08:00',
        '09:00',
        '10:00',
      ]);
      const mine = await teacher.agent
        .get(`/api/v1/school/planning/teacher-week?date=${MONDAY}`)
        .expect(200);
      expect(mine.body.days[0].lessons).toHaveLength(1);
      expect(mine.body.changes[0]).toMatchObject({ action: 'published' });
      await teacher.agent
        .get(`/api/v1/school/planning/teacher-week?date=${MONDAY}&memberId=${teacher2.id}`)
        .expect(403);
      await teacher2.agent.get(`/api/v1/school/timetables?classId=${a1.class2}`).expect(404);
      // Parent : cours de toute la classe, pas ceux d'un groupe dont l'enfant n'est pas membre.
      const child = await motherAgent
        .get(`/api/v1/school/portal/children/${s1}/planning?date=${MONDAY}`)
        .expect(200);
      expect(child.body.days[0].lessons.map((l: { start: string }) => l.start)).toEqual([
        '08:00',
        '10:00',
      ]);
      await motherAgent
        .get(`/api/v1/school/portal/children/${s2}/planning?date=${MONDAY}`)
        .expect(404);
      await ownerB.get(`/api/v1/school/timetables/${draft1}`).expect(404);
      await classWeek(ownerB, a1.class1).expect(404);
    });

    it('conflits enseignant et salle entre classes ; indisponibilité ; vérification à la publication', async () => {
      const d2 = (await draft(ownerA, a1.class2).expect(201)).body.id;
      const teacherConflict = await slot(ownerA, d2, {
        subjectId: maths,
        memberId: teacher.id,
      }).expect(409);
      expect(teacherConflict.body.code).toBe('SLOT_TEACHER_CONFLICT');
      expect(teacherConflict.body.details[0].class).toMatchObject({ id: a1.class1 });
      expect(
        (
          await slot(ownerA, d2, {
            start: '08:30',
            end: '09:30',
            subjectId: maths,
            memberId: teacher.id,
            roomId: roomA,
          }).expect(409)
        ).body.code,
      ).toBe('SLOT_TEACHER_CONFLICT');
      // Même salle, autre enseignant (affecté pour l'occasion) : salle refusée.
      await assign(a1.class2, french, teacher2.id);
      expect(
        (
          await slot(ownerA, d2, {
            start: '08:15',
            end: '08:45',
            subjectId: french,
            memberId: teacher2.id,
            roomId: roomA,
          }).expect(409)
        ).body.code,
      ).toBe('SLOT_ROOM_CONFLICT');
      await slot(ownerA, d2, {
        start: '08:15',
        end: '08:45',
        subjectId: french,
        memberId: teacher2.id,
        roomId: roomB,
      }).expect(201);
      // Indisponibilité du mercredi après-midi.
      await ownerA
        .post('/api/v1/school/teacher-unavailability')
        .send({
          schoolId: a1.schoolId,
          memberId: teacher.id,
          weekday: 3,
          start: '14:00',
          end: '18:00',
          reason: 'Formation',
        })
        .expect(201);
      expect(
        (
          await slot(ownerA, d2, {
            weekday: 3,
            start: '15:00',
            end: '16:00',
            subjectId: maths,
            memberId: teacher.id,
          }).expect(409)
        ).body.code,
      ).toBe('SLOT_TEACHER_UNAVAILABLE');
      // Indisponibilité sur un cours publié : refusée.
      expect(
        (
          await ownerA
            .post('/api/v1/school/teacher-unavailability')
            .send({
              schoolId: a1.schoolId,
              memberId: teacher.id,
              weekday: 1,
              start: '07:30',
              end: '08:30',
            })
            .expect(409)
        ).body.code,
      ).toBe('UNAVAILABILITY_CONFLICT');
      await slot(ownerA, d2, {
        weekday: 2,
        start: '08:00',
        end: '09:00',
        subjectId: maths,
        memberId: teacher.id,
      }).expect(201);
      // Le brouillon de la classe 1 devient conflictuel après coup (créneau valable, puis la classe 2
      // publie le même enseignant) : la publication revérifie tout.
      const d1b = (await draft(ownerA, a1.class1, { sourceId: draft1 }).expect(201)).body.id;
      await slot(ownerA, d1b, {
        weekday: 4,
        start: '08:00',
        end: '09:00',
        subjectId: maths,
        memberId: teacher.id,
      }).expect(201);
      await slot(ownerA, d2, {
        weekday: 4,
        start: '08:00',
        end: '09:00',
        subjectId: maths,
        memberId: teacher.id,
      }).expect(201);
      await ownerA.post(`/api/v1/school/timetables/${d2}/publish`).expect(200);
      const blocked = await ownerA.post(`/api/v1/school/timetables/${d1b}/publish`).expect(409);
      expect(blocked.body.code).toBe('SLOT_TEACHER_CONFLICT');
      const check = await ownerA.post(`/api/v1/school/timetables/${d1b}/check`).expect(200);
      expect(check.body.conflicts.map((c: { code: string }) => c.code)).toContain(
        'SLOT_TEACHER_CONFLICT',
      );
      await ownerA.delete(`/api/v1/school/timetables/${d1b}`).expect(200);
    });

    it('nouvelle version : remplace la fin de la précédente ; chevauchement par la fin refusé', async () => {
      const next = (
        await draft(ownerA, a1.class1, { sourceId: draft1, validFrom: '2027-01-04' }).expect(201)
      ).body.id;
      await ownerA.post(`/api/v1/school/timetables/${next}/publish`).expect(200);
      const versions = await ownerA
        .get(`/api/v1/school/timetables?classId=${a1.class1}`)
        .expect(200);
      const first = versions.body.find((v: { id: string }) => v.id === draft1);
      expect(first).toMatchObject({ status: 'PUBLISHED', validTo: '2027-01-03' });
      const early = (
        await draft(ownerA, a1.class1, { validFrom: '2026-10-01', validTo: '2026-12-31' }).expect(
          201,
        )
      ).body.id;
      await slot(ownerA, early, { subjectId: maths, memberId: teacher.id }).expect(201);
      expect(
        (await ownerA.post(`/api/v1/school/timetables/${early}/publish`).expect(409)).body.code,
      ).toBe('TIMETABLE_VALIDITY_OVERLAP');
      await ownerA.delete(`/api/v1/school/timetables/${early}`).expect(200);
      // Semaine de novembre : toujours la première version.
      expect((await classWeek(ownerA, a1.class1).expect(200)).body.days[0].lessons).toHaveLength(3);
    });

    it('annulation d’un cours à une date : familles notifiées, semaine marquée, rétablissement', async () => {
      const view = await ownerA.get(`/api/v1/school/timetables/${draft1}`).expect(200);
      const mathsSlot = view.body.slots.find(
        (x: { subject: { id: string } | null }) => x.subject?.id === maths,
      );
      await teacher.agent
        .post(`/api/v1/school/timetable-slots/${mathsSlot.id}/cancellations`)
        .send({ date: MONDAY, reason: 'Enseignant en formation' })
        .expect(403);
      await ownerA
        .post(`/api/v1/school/timetable-slots/${mathsSlot.id}/cancellations`)
        .send({ date: '2026-11-17', reason: 'Mauvais jour' })
        .expect(400);
      await secretary.agent
        .post(`/api/v1/school/timetable-slots/${mathsSlot.id}/cancellations`)
        .send({ date: MONDAY, reason: 'Enseignant en formation' })
        .expect(201);
      expect(
        (
          await secretary.agent
            .post(`/api/v1/school/timetable-slots/${mathsSlot.id}/cancellations`)
            .send({ date: MONDAY, reason: 'Encore' })
            .expect(409)
        ).body.code,
      ).toBe('LESSON_ALREADY_CANCELLED');
      expect(await db.schoolNotification.count({ where: { kind: 'LESSON_CANCELLED' } })).toBe(1);
      const lesson = (await classWeek(ownerA, a1.class1).expect(200)).body.days[0].lessons[0];
      expect(lesson.cancelled).toEqual({ reason: 'Enseignant en formation' });
      const child = await motherAgent
        .get(`/api/v1/school/portal/children/${s1}/planning?date=${MONDAY}`)
        .expect(200);
      expect(child.body.days[0].lessons[0].cancelled).not.toBeNull();
      await secretary.agent
        .delete(`/api/v1/school/timetable-slots/${mathsSlot.id}/cancellations/${MONDAY}`)
        .expect(200);
      expect(
        (await classWeek(ownerA, a1.class1).expect(200)).body.days[0].lessons[0].cancelled,
      ).toBeNull();
    });
  });

  describe('calendrier scolaire', () => {
    const event = (agent: Agent, body: Record<string, unknown>) =>
      agent.post('/api/v1/school/calendar/events').send({
        schoolId: a1.schoolId,
        category: 'SCHOOL_EVENT',
        title: 'Kermesse',
        startsOn: '2026-11-20',
        endsOn: '2026-11-20',
        audience: 'SCHOOL',
        visibility: 'FAMILIES',
        ...body,
      });

    it('fermeture : cours suspendus ce jour-là ; examen refusé ; événements ciblés et visibilité', async () => {
      const holiday = await event(secretary.agent, {
        category: 'PUBLIC_HOLIDAY',
        title: 'Jour férié',
        titleAr: 'عطلة رسمية',
        startsOn: MONDAY,
        endsOn: MONDAY,
        important: true,
      }).expect(201);
      await teacher.agent.post('/api/v1/school/calendar/events').send({}).expect(403);
      // Brouillon : invisible de l'enseignant et sans effet sur la semaine.
      await teacher.agent.get(`/api/v1/school/calendar/events/${holiday.body.id}`).expect(404);
      expect((await classWeek(ownerA, a1.class1).expect(200)).body.days[0].closures).toEqual([]);
      await secretary.agent
        .post(`/api/v1/school/calendar/events/${holiday.body.id}/publish`)
        .expect(200);
      expect(
        await db.schoolNotification.count({
          where: { kind: 'EVENT', resourceId: holiday.body.id },
        }),
      ).toBe(1);
      const monday = (await classWeek(teacher.agent, a1.class1).expect(200)).body.days[0];
      expect(monday.closures[0]).toMatchObject({ title: 'Jour férié', category: 'PUBLIC_HOLIDAY' });
      expect(monday.lessons.every((l: { closed: unknown }) => l.closed !== null)).toBe(true);
      // Événement réservé au personnel et événement d'une autre classe : jamais côté parent.
      const staffOnly = await event(ownerA, {
        title: 'Conseil des maîtres',
        visibility: 'STAFF',
      }).expect(201);
      await ownerA.post(`/api/v1/school/calendar/events/${staffOnly.body.id}/publish`).expect(200);
      const otherClass = await event(ownerA, {
        title: 'Sortie CM1 B',
        category: 'FIELD_TRIP',
        audience: 'CLASSES',
        targetIds: [a1.class2],
      }).expect(201);
      await ownerA.post(`/api/v1/school/calendar/events/${otherClass.body.id}/publish`).expect(200);
      const groupTrip = await event(ownerA, {
        title: 'Atelier du groupe A',
        audience: 'GROUPS',
        targetIds: [groupA],
      }).expect(201);
      await ownerA.post(`/api/v1/school/calendar/events/${groupTrip.body.id}/publish`).expect(200);
      await event(ownerA, { audience: 'CLASSES', targetIds: [b1.class1] }).expect(400);
      const family = await motherAgent
        .get('/api/v1/school/portal/calendar?from=2026-11-01&to=2026-11-30')
        .expect(200);
      const titles = family.body.map((e: { title: string }) => e.title);
      expect(titles).toContain('Jour férié');
      expect(titles).not.toContain('Conseil des maîtres');
      expect(titles).not.toContain('Sortie CM1 B');
      expect(titles).not.toContain('Atelier du groupe A');
      // Calendrier du personnel : années, périodes et événements ; l'enseignant ne voit pas la sortie
      // d'une classe qui ne lui est pas confiée… sauf qu'il enseigne en CM1 B : il la voit.
      const staff = await teacher2.agent
        .get(`/api/v1/school/calendar?schoolId=${a1.schoolId}&from=2026-11-01&to=2026-11-30`)
        .expect(200);
      expect(staff.body.years[0].periods[0]).toMatchObject({ label: 'Trimestre 1' });
      expect(staff.body.events.map((e: { title: string }) => e.title)).toContain('Sortie CM1 B');
      await ownerB
        .get(`/api/v1/school/calendar?schoolId=${a1.schoolId}&from=2026-11-01&to=2026-11-30`)
        .expect(404);
      await ownerA
        .get(`/api/v1/school/calendar?schoolId=${a1.schoolId}&from=2026-01-01&to=2027-12-31`)
        .expect(400);
    });
  });

  describe('examens', () => {
    let evaluation: string;
    let evaluation2: string;
    let exam: string;

    it('programmation d’une évaluation : fermeture, conflits de classe, salle et surveillant ; publication', async () => {
      const create = async (title: string) =>
        (
          await teacher.agent
            .post('/api/v1/school/evaluations')
            .send({
              classId: a1.class1,
              periodId: p1,
              subjectId: maths,
              kind: 'EXAM',
              title,
              heldOn: WEDNESDAY,
              maxScore: 20,
            })
            .expect(201)
        ).body.id as string;
      evaluation = await create('Composition 1');
      evaluation2 = await create('Composition 2');
      const body = {
        evaluationId: evaluation,
        date: WEDNESDAY,
        start: '08:00',
        durationMinutes: 120,
        roomId: roomA,
        supervisorMemberId: supervisor.id,
      };
      await teacher.agent.post('/api/v1/school/exams').send(body).expect(403);
      expect(
        (
          await secretary.agent
            .post('/api/v1/school/exams')
            .send({ ...body, date: MONDAY })
            .expect(409)
        ).body.code,
      ).toBe('EXAM_ON_CLOSURE');
      exam = (await secretary.agent.post('/api/v1/school/exams').send(body).expect(201)).body.id;
      expect(
        (await secretary.agent.post('/api/v1/school/exams').send(body).expect(409)).body.code,
      ).toBe('EXAM_ALREADY_SCHEDULED');
      const second = {
        ...body,
        evaluationId: evaluation2,
        start: '09:00',
        roomId: roomB,
        supervisorMemberId: null,
      };
      expect(
        (await secretary.agent.post('/api/v1/school/exams').send(second).expect(409)).body.code,
      ).toBe('EXAM_CLASS_CONFLICT');
      await secretary.agent
        .post('/api/v1/school/exams')
        .send({ ...second, start: '10:00', durationMinutes: 600 })
        .expect(400);
      // Brouillon : ni parent ni enseignant ; publication : visible et notifiée.
      expect(
        (
          await motherAgent
            .get(`/api/v1/school/portal/children/${s1}/planning?date=${WEDNESDAY}`)
            .expect(200)
        ).body.days[2].exams,
      ).toEqual([]);
      await secretary.agent.post(`/api/v1/school/exams/${exam}/publish`).expect(200);
      expect(await db.schoolNotification.count({ where: { kind: 'EXAM', resourceId: exam } })).toBe(
        1,
      );
      const child = await motherAgent
        .get(`/api/v1/school/portal/children/${s1}/planning?date=${WEDNESDAY}`)
        .expect(200);
      expect(child.body.days[2].exams[0]).toMatchObject({
        start: '08:00',
        end: '10:00',
        subject: { id: maths },
      });
      const supervised = await supervisor.agent
        .get(`/api/v1/school/planning/teacher-week?date=${WEDNESDAY}`)
        .expect(200);
      expect(supervised.body.days[2].exams).toHaveLength(1);
      // Changement d'horaire publié : nouvelle notification ; annulation : une de plus.
      await secretary.agent
        .put(`/api/v1/school/exams/${exam}`)
        .send({ ...body, start: '10:00' })
        .expect(200);
      expect(await db.schoolNotification.count({ where: { kind: 'EXAM', resourceId: exam } })).toBe(
        2,
      );
      const listed = await teacher.agent
        .get(`/api/v1/school/exams?schoolId=${a1.schoolId}&from=2026-11-01&to=2026-11-30`)
        .expect(200);
      expect(listed.body.map((e: { id: string }) => e.id)).toEqual([exam]);
      await secretary.agent.post(`/api/v1/school/exams/${exam}/cancel`).expect(200);
      expect(await db.schoolNotification.count({ where: { kind: 'EXAM', resourceId: exam } })).toBe(
        3,
      );
      await ownerB
        .get(`/api/v1/school/exams?schoolId=${a1.schoolId}&from=2026-11-01&to=2026-11-30`)
        .expect(404);
    });
  });

  describe('correctifs de l’audit (passe 1)', () => {
    const NEXT_MONDAY = '2026-11-23';
    const event = (agent: Agent, body: Record<string, unknown>) =>
      agent.post('/api/v1/school/calendar/events').send({
        schoolId: a1.schoolId,
        category: 'PEDAGOGICAL_DAY',
        title: 'Journée pédagogique',
        startsOn: NEXT_MONDAY,
        endsOn: NEXT_MONDAY,
        audience: 'SCHOOL',
        visibility: 'STAFF',
        ...body,
      });
    const lessonsOf = (week: { days: { lessons: { class: { id: string } }[] }[] }) =>
      week.days.flatMap((d) => d.lessons);
    let teacher3: Member;
    let english: string;

    it('enseignant : salle et planning limités aux classes qui lui sont encore confiées', async () => {
      teacher3 = await member(ownerA, 'TEACHER', [a1.schoolId]);
      english = (
        await ownerA
          .post('/api/v1/school/subjects/catalog/anglais/activate')
          .send({ schoolId: a1.schoolId })
          .expect(201)
      ).body.id;
      await ownerA
        .put(`/api/v1/school/subjects/${english}/levels`)
        .send({ levels: [{ levelId: a1.level1, coefficient: 1 }] })
        .expect(200);
      const assignment = (await assign(a1.class2, english, teacher3.id)).body.id as string;
      // Salle 1 : occupée par la classe 1, que l'enseignant 3 n'a pas.
      const staffRoom = await ownerA
        .get(`/api/v1/school/rooms/${roomA}/week?date=${NEXT_MONDAY}`)
        .expect(200);
      expect(lessonsOf(staffRoom.body).some((l) => l.class.id === a1.class1)).toBe(true);
      const teacherRoom = await teacher3.agent
        .get(`/api/v1/school/rooms/${roomA}/week?date=${NEXT_MONDAY}`)
        .expect(200);
      expect(lessonsOf(teacherRoom.body)).toEqual([]);
      // Cours publié de l'enseignant 3 en classe 2, puis fin de son affectation : plus rien.
      const published = (
        await ownerA.get(`/api/v1/school/timetables?classId=${a1.class2}`).expect(200)
      ).body.find((v: { status: string }) => v.status === 'PUBLISHED');
      await slot(ownerA, published.id, {
        weekday: 3,
        start: '10:00',
        end: '11:00',
        subjectId: english,
        memberId: teacher3.id,
      }).expect(201);
      const before = await teacher3.agent
        .get(`/api/v1/school/planning/teacher-week?date=${NEXT_MONDAY}`)
        .expect(200);
      expect(lessonsOf(before.body)).toHaveLength(1);
      await ownerA
        .post(`/api/v1/school/teaching-assignments/${assignment}/end`)
        .send({ reason: 'Fin de mission' })
        .expect(200);
      const after = await teacher3.agent
        .get(`/api/v1/school/planning/teacher-week?date=${NEXT_MONDAY}`)
        .expect(200);
      expect(lessonsOf(after.body)).toEqual([]);
      expect(after.body.changes).toEqual([]);
    });

    it('fermeture réservée au personnel : suspension sans son titre côté parent ; autre établissement ignoré', async () => {
      const staffOnly = (await event(secretary.agent, {}).expect(201)).body.id;
      await secretary.agent.post(`/api/v1/school/calendar/events/${staffOnly}/publish`).expect(200);
      const child = await motherAgent
        .get(`/api/v1/school/portal/children/${s1}/planning?date=${NEXT_MONDAY}`)
        .expect(200);
      expect(child.body.days[0].closures).toEqual([
        { id: null, title: null, titleAr: null, category: null },
      ]);
      expect(child.body.days[0].lessons[0].closed).toMatchObject({ title: null });
      expect(JSON.stringify(child.body)).not.toContain('Journée pédagogique');
      const staff = await classWeek(ownerA, a1.class1, NEXT_MONDAY).expect(200);
      expect(staff.body.days[0].closures[0]).toMatchObject({ title: 'Journée pédagogique' });
      // Fermeture d'un autre établissement du même client : sans effet sur la classe 1.
      const a2 = await structure(ownerA, 'Ecole Voisine Planning');
      const elsewhere = (
        await event(ownerA, {
          schoolId: a2.schoolId,
          startsOn: '2026-11-30',
          endsOn: '2026-11-30',
          title: 'Fermeture voisine',
        }).expect(201)
      ).body.id;
      await ownerA.post(`/api/v1/school/calendar/events/${elsewhere}/publish`).expect(200);
      const week = await classWeek(ownerA, a1.class1, '2026-11-30').expect(200);
      expect(week.body.days[0].closures).toEqual([]);
      expect(week.body.days[0].lessons.every((l: { closed: unknown }) => l.closed === null)).toBe(
        true,
      );
    });

    it('fermeture d’un groupe : seuls ses cours sont suspendus, les autres enfants ne la voient pas', async () => {
      const id = (
        await event(ownerA, {
          category: 'HOLIDAY',
          title: 'Sortie du groupe A',
          visibility: 'FAMILIES',
          audience: 'GROUPS',
          targetIds: [groupA],
          startsOn: '2026-12-07',
          endsOn: '2026-12-07',
        }).expect(201)
      ).body.id;
      await ownerA.post(`/api/v1/school/calendar/events/${id}/publish`).expect(200);
      const monday = (await classWeek(ownerA, a1.class1, '2026-12-07').expect(200)).body.days[0];
      const byStart = Object.fromEntries(
        monday.lessons.map((l: { start: string; closed: unknown }) => [l.start, l.closed]),
      );
      expect(byStart['08:00']).toBeNull();
      expect(byStart['09:00']).toMatchObject({ title: 'Sortie du groupe A' });
      expect(monday.closures.map((c: { title: string }) => c.title)).toContain(
        'Sortie du groupe A',
      );
      const child = await motherAgent
        .get(`/api/v1/school/portal/children/${s1}/planning?date=2026-12-07`)
        .expect(200);
      expect(child.body.days[0].closures).toEqual([]);
    });

    it('affectation de groupe : pas de cours de toute la classe ; ressource désactivée refusée à la publication', async () => {
      const arabic = (
        await ownerA
          .post('/api/v1/school/subjects/catalog/arabe/activate')
          .send({ schoolId: a1.schoolId })
          .expect(201)
      ).body.id;
      await ownerA
        .put(`/api/v1/school/subjects/${arabic}/levels`)
        .send({ levels: [{ levelId: a1.level1, coefficient: 1 }] })
        .expect(200);
      await assign(a1.class1, arabic, teacher3.id, groupA);
      const d = (await draft(ownerA, a1.class1, { validFrom: '2027-04-01' }).expect(201)).body.id;
      expect(
        (
          await slot(ownerA, d, {
            weekday: 5,
            start: '15:00',
            end: '16:00',
            subjectId: arabic,
            memberId: teacher3.id,
          }).expect(409)
        ).body.code,
      ).toBe('SLOT_TEACHER_NOT_ASSIGNED');
      await slot(ownerA, d, {
        weekday: 5,
        start: '15:00',
        end: '16:00',
        subjectId: arabic,
        memberId: teacher3.id,
        groupId: groupA,
        roomId: roomB,
      }).expect(201);
      await ownerA.patch(`/api/v1/school/rooms/${roomB}`).send({ isActive: false }).expect(200);
      try {
        expect(
          (await ownerA.post(`/api/v1/school/timetables/${d}/publish`).expect(409)).body.code,
        ).toBe('SLOT_ROOM_INACTIVE');
      } finally {
        await ownerA.patch(`/api/v1/school/rooms/${roomB}`).send({ isActive: true }).expect(200);
      }
      await ownerA.delete(`/api/v1/school/timetables/${d}`).expect(200);
    });

    it('examen : date dans la période, date de l’évaluation alignée, fermeture et suppression protégées', async () => {
      const create = async (title: string) =>
        (
          await teacher.agent
            .post('/api/v1/school/evaluations')
            .send({
              classId: a1.class1,
              periodId: p1,
              subjectId: maths,
              kind: 'EXAM',
              title,
              heldOn: '2026-12-01',
              maxScore: 20,
            })
            .expect(201)
        ).body.id as string;
      const evaluation = await create('Composition 3');
      const body = {
        evaluationId: evaluation,
        date: '2027-01-12',
        start: '08:00',
        durationMinutes: 60,
      };
      expect((await ownerA.post('/api/v1/school/exams').send(body).expect(400)).body.code).toBe(
        'EXAM_OUTSIDE_PERIOD',
      );
      const exam = (
        await ownerA
          .post('/api/v1/school/exams')
          .send({ ...body, date: '2026-12-02' })
          .expect(201)
      ).body.id;
      const stored = await db.schoolEvaluation.findUniqueOrThrow({ where: { id: evaluation } });
      expect(stored.heldOn.toISOString().slice(0, 10)).toBe('2026-12-02');
      expect(
        (
          await teacher.agent
            .patch(`/api/v1/school/evaluations/${evaluation}`)
            .send({ heldOn: '2026-12-10' })
            .expect(409)
        ).body.code,
      ).toBe('EVALUATION_SCHEDULED');
      await ownerA.post(`/api/v1/school/exams/${exam}/publish`).expect(200);
      expect(
        (await teacher.agent.delete(`/api/v1/school/evaluations/${evaluation}`).expect(409)).body
          .code,
      ).toBe('EVALUATION_EXAM_PUBLISHED');
      // Fermeture publiée par-dessus l'examen : refusée, avec l'examen en cause.
      const holiday = (
        await event(ownerA, {
          category: 'HOLIDAY',
          title: 'Pont',
          startsOn: '2026-12-01',
          endsOn: '2026-12-03',
        }).expect(201)
      ).body.id;
      const refused = await ownerA
        .post(`/api/v1/school/calendar/events/${holiday}/publish`)
        .expect(409);
      expect(refused.body.code).toBe('CLOSURE_EXAM_CONFLICT');
      expect(refused.body.details[0]).toMatchObject({
        date: '2026-12-02',
        class: { id: a1.class1 },
      });
      // Brouillon de programmation : supprimé avec l'évaluation.
      const other = await create('Composition 4');
      await ownerA
        .post('/api/v1/school/exams')
        .send({ ...body, evaluationId: other, date: '2026-12-04' })
        .expect(201);
      await teacher.agent.delete(`/api/v1/school/evaluations/${other}`).expect(200);
      expect(await db.schoolExamSchedule.count({ where: { evaluationId: other } })).toBe(0);
    });

    it('rétablissement d’un cours notifié ; description arabe conservée ; contrainte des horaires', async () => {
      expect(
        await db.schoolNotification.count({
          where: { kind: 'LESSON_CANCELLED', params: { path: ['change'], equals: 'restored' } },
        }),
      ).toBe(1);
      const created = (
        await event(ownerA, {
          category: 'SCHOOL_EVENT',
          title: 'Fête',
          descriptionAr: 'وصف بالعربية',
          visibility: 'FAMILIES',
          startsOn: '2026-12-15',
          endsOn: '2026-12-15',
        }).expect(201)
      ).body;
      await ownerA
        .put(`/api/v1/school/calendar/events/${created.id}`)
        .send({
          schoolId: a1.schoolId,
          category: 'SCHOOL_EVENT',
          title: 'Fête de fin d’année',
          startsOn: '2026-12-15',
          endsOn: '2026-12-15',
          audience: 'SCHOOL',
          visibility: 'FAMILIES',
        })
        .expect(200);
      const kept = await ownerA.get(`/api/v1/school/calendar/events/${created.id}`).expect(200);
      expect(kept.body).toMatchObject({
        title: 'Fête de fin d’année',
        descriptionAr: 'وصف بالعربية',
      });
      await expect(
        db.schoolCalendarEvent.update({ where: { id: created.id }, data: { endMinute: 600 } }),
      ).rejects.toThrow();
    });
  });

  describe('correctifs de l’audit (passe 2)', () => {
    it('fil enseignant : le retrait de son dernier cours d’une version y figure', async () => {
      const view = await ownerA.get(`/api/v1/school/timetables/${draft1}`).expect(200);
      const french = view.body.slots.find(
        (x: { teacher: { id: string } | null }) => x.teacher?.id === teacher2.id,
      );
      await ownerA.delete(`/api/v1/school/timetables/${draft1}/slots/${french.id}`).expect(200);
      const feed = await teacher2.agent
        .get(`/api/v1/school/planning/teacher-week?date=2026-11-23`)
        .expect(200);
      expect(feed.body.changes.map((c: { action: string }) => c.action)).toContain('slot_removed');
    });

    it('enseignant d’un autre établissement : identité introuvable pour un personnel limité', async () => {
      const elsewhere = (
        await ownerA
          .post('/api/v1/school/schools')
          .send({ name: `Annexe ${RUN}`, type: 'PRIMARY', countryCode: 'SN' })
          .expect(201)
      ).body.id as string;
      const outsider = await member(ownerA, 'TEACHER', [elsewhere]);
      const refused = await secretary.agent
        .get(`/api/v1/school/planning/teacher-week?date=2026-11-23&memberId=${outsider.id}`)
        .expect(404);
      expect(JSON.stringify(refused.body)).not.toContain('Ibrahima');
      await ownerA
        .get(`/api/v1/school/planning/teacher-week?date=2026-11-23&memberId=${outsider.id}`)
        .expect(200);
    });

    it('événement d’un groupe désactivé depuis le brouillon : publication refusée, aucune notification', async () => {
      const id = (
        await ownerA
          .post('/api/v1/school/calendar/events')
          .send({
            schoolId: a1.schoolId,
            category: 'FIELD_TRIP',
            title: 'Sortie du groupe',
            startsOn: '2026-12-16',
            endsOn: '2026-12-16',
            audience: 'GROUPS',
            targetIds: [groupA],
            visibility: 'FAMILIES',
            important: true,
          })
          .expect(201)
      ).body.id;
      await ownerA.patch(`/api/v1/school/groups/${groupA}`).send({ isActive: false }).expect(200);
      try {
        expect(
          (await ownerA.post(`/api/v1/school/calendar/events/${id}/publish`).expect(409)).body.code,
        ).toBe('EVENT_TARGET_INACTIVE');
        expect(await db.schoolNotification.count({ where: { resourceId: id } })).toBe(0);
      } finally {
        await ownerA.patch(`/api/v1/school/groups/${groupA}`).send({ isActive: true }).expect(200);
      }
    });

    it('rétablissement après archivage de la version : refusé, sans fausse annonce', async () => {
      const versions = (
        await ownerA.get(`/api/v1/school/timetables?classId=${a1.class2}`).expect(200)
      ).body;
      const published = versions.find((v: { status: string }) => v.status === 'PUBLISHED');
      const view = await ownerA.get(`/api/v1/school/timetables/${published.id}`).expect(200);
      const tuesday = view.body.slots.find((x: { weekday: number }) => x.weekday === 2);
      await ownerA
        .post(`/api/v1/school/timetable-slots/${tuesday.id}/cancellations`)
        .send({ date: '2026-12-08', reason: 'Conseil de classe' })
        .expect(201);
      await ownerA.post(`/api/v1/school/timetables/${published.id}/archive`).expect(200);
      const before = await db.schoolNotification.count({ where: { kind: 'LESSON_CANCELLED' } });
      await ownerA
        .delete(`/api/v1/school/timetable-slots/${tuesday.id}/cancellations/2026-12-08`)
        .expect(404);
      expect(await db.schoolNotification.count({ where: { kind: 'LESSON_CANCELLED' } })).toBe(
        before,
      );
    });
  });

  describe('correctifs de l’audit (passe 3)', () => {
    it('cours déplacé à un autre jour : l’ancienne annulation disparaît, rien à rétablir', async () => {
      const versions = (
        await ownerA.get(`/api/v1/school/timetables?classId=${a1.class1}`).expect(200)
      ).body;
      const current = versions.find(
        (v: { status: string; validFrom: string }) =>
          v.status === 'PUBLISHED' && v.validFrom === '2026-10-01',
      );
      const view = await ownerA.get(`/api/v1/school/timetables/${current.id}`).expect(200);
      const mathsSlot = view.body.slots.find(
        (x: { subject: { id: string } | null }) => x.subject?.id === maths,
      );
      await ownerA
        .post(`/api/v1/school/timetable-slots/${mathsSlot.id}/cancellations`)
        .send({ date: '2026-12-14', reason: 'Sortie' })
        .expect(201);
      await ownerA
        .put(`/api/v1/school/timetables/${current.id}/slots/${mathsSlot.id}`)
        .send({
          kind: 'LESSON',
          weekday: 2,
          start: '08:00',
          end: '09:00',
          subjectId: maths,
          memberId: teacher.id,
        })
        .expect(200);
      expect(await db.schoolLessonException.count({ where: { slotId: mathsSlot.id } })).toBe(0);
      const before = await db.schoolNotification.count({ where: { kind: 'LESSON_CANCELLED' } });
      expect(
        (
          await ownerA
            .delete(`/api/v1/school/timetable-slots/${mathsSlot.id}/cancellations/2026-12-14`)
            .expect(400)
        ).body.code,
      ).toBe('LESSON_NOT_ON_DATE');
      expect(await db.schoolNotification.count({ where: { kind: 'LESSON_CANCELLED' } })).toBe(
        before,
      );
    });

    it('événement publié modifié vers un groupe désactivé : refusé', async () => {
      const id = (
        await ownerA
          .post('/api/v1/school/calendar/events')
          .send({
            schoolId: a1.schoolId,
            category: 'SCHOOL_EVENT',
            title: 'Spectacle',
            startsOn: '2026-12-17',
            endsOn: '2026-12-17',
            audience: 'SCHOOL',
            visibility: 'FAMILIES',
          })
          .expect(201)
      ).body.id;
      await ownerA.post(`/api/v1/school/calendar/events/${id}/publish`).expect(200);
      await ownerA.patch(`/api/v1/school/groups/${groupA}`).send({ isActive: false }).expect(200);
      try {
        expect(
          (
            await ownerA
              .put(`/api/v1/school/calendar/events/${id}`)
              .send({
                schoolId: a1.schoolId,
                category: 'SCHOOL_EVENT',
                title: 'Spectacle',
                startsOn: '2026-12-17',
                endsOn: '2026-12-17',
                audience: 'GROUPS',
                targetIds: [groupA],
                visibility: 'FAMILIES',
              })
              .expect(409)
          ).body.code,
        ).toBe('EVENT_TARGET_INACTIVE');
      } finally {
        await ownerA.patch(`/api/v1/school/groups/${groupA}`).send({ isActive: true }).expect(200);
      }
    });

    it('examen d’un groupe désactivé : publication refusée, aucune notification', async () => {
      const evaluation = (
        await teacher2.agent
          .post('/api/v1/school/evaluations')
          .send({
            classId: a1.class1,
            periodId: p1,
            subjectId: french,
            groupId: groupA,
            kind: 'EXAM',
            title: 'Dictée du groupe',
            heldOn: '2026-12-09',
            maxScore: 20,
          })
          .expect(201)
      ).body.id;
      const exam = (
        await ownerA
          .post('/api/v1/school/exams')
          .send({
            evaluationId: evaluation,
            date: '2026-12-09',
            start: '14:00',
            durationMinutes: 60,
          })
          .expect(201)
      ).body.id;
      await ownerA.patch(`/api/v1/school/groups/${groupA}`).send({ isActive: false }).expect(200);
      try {
        expect(
          (await ownerA.post(`/api/v1/school/exams/${exam}/publish`).expect(409)).body.code,
        ).toBe('EXAM_TARGET_INACTIVE');
        expect(await db.schoolNotification.count({ where: { resourceId: exam } })).toBe(0);
      } finally {
        await ownerA.patch(`/api/v1/school/groups/${groupA}`).send({ isActive: true }).expect(200);
      }
    });

    it('fil enseignant : les étapes d’un brouillon ne sont pas des changements publiés', async () => {
      const d = (await draft(ownerA, a1.class2, { validFrom: '2027-05-03' }).expect(201)).body.id;
      const temp = (
        await slot(ownerA, d, {
          weekday: 4,
          start: '14:00',
          end: '15:00',
          subjectId: french,
          memberId: teacher2.id,
        }).expect(201)
      ).body.slots[0].id;
      await ownerA.delete(`/api/v1/school/timetables/${d}/slots/${temp}`).expect(200);
      await slot(ownerA, d, {
        weekday: 4,
        start: '15:00',
        end: '16:00',
        subjectId: french,
        memberId: teacher2.id,
      }).expect(201);
      await ownerA.post(`/api/v1/school/timetables/${d}/publish`).expect(200);
      const feed = await teacher2.agent
        .get(`/api/v1/school/planning/teacher-week?date=2027-05-06`)
        .expect(200);
      const ofClass2 = feed.body.changes.filter(
        (c: { class: { id: string } }) => c.class.id === a1.class2,
      );
      expect(ofClass2.map((c: { action: string }) => c.action)).toContain('published');
      expect(ofClass2.map((c: { action: string }) => c.action)).not.toContain('slot_removed');
    });
  });

  describe('correctifs de l’audit (passe 4)', () => {
    it('destinataires du planning : inscription de l’année en cours seulement (pas une inscription future)', async () => {
      const next = (
        await ownerA
          .post('/api/v1/school/years')
          .send({
            schoolId: a1.schoolId,
            label: '2027-2028',
            startsOn: '2027-09-01',
            endsOn: '2028-06-30',
          })
          .expect(201)
      ).body.id as string;
      const futureClass = (
        await ownerA
          .post('/api/v1/school/classes')
          .send({ schoolYearId: next, levelId: a1.level1, name: 'CM1 A 2027', capacity: 30 })
          .expect(201)
      ).body.id as string;
      const enrollment = await ownerA
        .post('/api/v1/school/enrollments')
        .send({
          studentId: s1,
          schoolYearId: next,
          levelId: a1.level1,
          classId: futureClass,
          submit: true,
        })
        .expect(201);
      await ownerA
        .post(`/api/v1/school/enrollments/${enrollment.body.id}/status`)
        .send({ status: 'VALIDATED' })
        .expect(200);
      await assign(futureClass, maths, teacher.id);
      const d = (
        await ownerA
          .post('/api/v1/school/timetables')
          .send({ classId: futureClass, validFrom: '2027-09-01', validTo: '2028-06-30' })
          .expect(201)
      ).body.id;
      await slot(ownerA, d, {
        weekday: 3,
        start: '08:00',
        end: '09:00',
        subjectId: maths,
        memberId: teacher.id,
      }).expect(201);
      await ownerA.post(`/api/v1/school/timetables/${d}/publish`).expect(200);
      // L'enfant n'est dans cette classe qu'à partir de l'an prochain : son portail ne la montre pas.
      expect(
        await db.schoolNotification.count({ where: { kind: 'TIMETABLE', resourceId: d } }),
      ).toBe(0);
    });

    it('rétablissement pendant une fermeture : exception retirée, aucune annonce de reprise', async () => {
      const versions = (
        await ownerA.get(`/api/v1/school/timetables?classId=${a1.class1}`).expect(200)
      ).body;
      const current = versions.find(
        (v: { status: string; validFrom: string }) =>
          v.status === 'PUBLISHED' && v.validFrom === '2026-10-01',
      );
      const view = await ownerA.get(`/api/v1/school/timetables/${current.id}`).expect(200);
      // Classe 1 (élèves inscrits, mère notifiable) : cours de mathématiques du mardi.
      const tuesday = view.body.slots.find((x: { weekday: number }) => x.weekday === 2);
      await ownerA
        .post(`/api/v1/school/timetable-slots/${tuesday.id}/cancellations`)
        .send({ date: '2026-12-22', reason: 'Absence' })
        .expect(201);
      const holiday = (
        await ownerA
          .post('/api/v1/school/calendar/events')
          .send({
            schoolId: a1.schoolId,
            category: 'PUBLIC_HOLIDAY',
            title: 'Jour férié de décembre',
            startsOn: '2026-12-22',
            endsOn: '2026-12-22',
            audience: 'SCHOOL',
            visibility: 'FAMILIES',
          })
          .expect(201)
      ).body.id;
      await ownerA.post(`/api/v1/school/calendar/events/${holiday}/publish`).expect(200);
      const restored = () =>
        db.schoolNotification.count({
          where: { kind: 'LESSON_CANCELLED', params: { path: ['change'], equals: 'restored' } },
        });
      const before = await restored();
      await ownerA
        .delete(`/api/v1/school/timetable-slots/${tuesday.id}/cancellations/2026-12-22`)
        .expect(200);
      expect(await db.schoolLessonException.count({ where: { slotId: tuesday.id } })).toBe(0);
      expect(await restored()).toBe(before);
      // Fil des enseignants : un retrait d'annulation, pas un « cours rétabli ».
      const facts = await db.schoolTimetableEvent.findMany({
        where: { details: { path: ['slotId'], equals: tuesday.id } },
        select: { action: true, details: true },
      });
      const onDay = facts.filter((x) => (x.details as { date?: string }).date === '2026-12-22');
      expect(onDay.map((x) => x.action)).toContain('lesson_exception_removed');
      expect(onDay.map((x) => x.action)).not.toContain('lesson_restored');
    });
  });

  describe('correctifs de l’audit (passe 5)', () => {
    it('vérification d’un emploi du temps : relit l’année sous la garde de l’établissement', async () => {
      const b = await structure(ownerA, 'Ecole Cloturee Planning');
      const d = (await draft(ownerA, b.class1).expect(201)).body.id;
      await ownerA.post(`/api/v1/school/timetables/${d}/check`).expect(200);
      await ownerA
        .post(`/api/v1/school/years/${b.yearId}/status`)
        .send({ status: 'CLOSED' })
        .expect(200);
      const checked = await ownerA.post(`/api/v1/school/timetables/${d}/check`).expect(409);
      expect(checked.body.code).toBe('SCHOOL_YEAR_CLOSED');
      // Passe 6 : une pause non plus ne se saisit pas dans une année clôturée.
      const pause = await slot(ownerA, d, { kind: 'BREAK', label: 'Récréation' }).expect(409);
      expect(pause.body.code).toBe('SCHOOL_YEAR_CLOSED');
    });
  });

  // Concurrence : plusieurs connexions réelles exigées ; ignorée sur PGlite, qui exécute en séquence.
  const realDatabase = ![
    process.env.TEST_DATABASE_URL,
    process.env.SCHOOL_TEST_DATABASE_URL ?? process.env.TEST_SCHOOL_DATABASE_URL,
  ].some((url) => url?.includes('connection_limit=1'));
  (realDatabase ? describe : describe.skip)('concurrence', () => {
    it('deux créneaux incompatibles créés en même temps : un seul est validé', async () => {
      // Deux brouillons (classes 1 et 2) ; le même enseignant le vendredi à 14 h dans chacun, en même temps.
      // Les deux sont des brouillons : le conflit inter-classes ne vaut qu'avec une version publiée. On
      // vérifie donc la classe : deux créneaux qui se chevauchent dans la même version.
      const d = (await draft(ownerA, a1.class2, { validFrom: '2027-02-01' }).expect(201)).body.id;
      const both = await Promise.all([
        slot(ownerA, d, {
          weekday: 5,
          start: '14:00',
          end: '15:00',
          subjectId: maths,
          memberId: teacher.id,
        }),
        slot(secretary.agent, d, {
          weekday: 5,
          start: '14:30',
          end: '15:30',
          subjectId: french,
          memberId: teacher2.id,
        }),
      ]);
      expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
      const view = await ownerA.get(`/api/v1/school/timetables/${d}`).expect(200);
      expect(view.body.slots.filter((x: { weekday: number }) => x.weekday === 5)).toHaveLength(1);
      // Publication concurrente de deux classes au même enseignant : une seule passe.
      const c1 = (
        await draft(ownerA, a1.class1, { sourceId: undefined, validFrom: '2027-03-01' }).expect(201)
      ).body.id;
      await slot(ownerA, c1, {
        weekday: 6,
        start: '08:00',
        end: '09:00',
        subjectId: maths,
        memberId: teacher.id,
      }).expect(201);
      await slot(ownerA, d, {
        weekday: 6,
        start: '08:00',
        end: '09:00',
        subjectId: maths,
        memberId: teacher.id,
      }).expect(201);
      const published = await Promise.all([
        ownerA.post(`/api/v1/school/timetables/${c1}/publish`),
        ownerA.post(`/api/v1/school/timetables/${d}/publish`),
      ]);
      expect(published.map((r) => r.status).sort()).toEqual([200, 409]);
    });
  });
});
