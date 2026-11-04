import type { ConflictException, INestApplication } from '@nestjs/common';
import { Prisma } from '@ocall/school-database';
import { SchoolPrismaService } from '../src/modules/school/school-prisma.service';
import { SchoolTeachingService } from '../src/modules/school/school-teaching.service';
import { SchoolService } from '../src/modules/school/school.service';
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
 * Ocall School, Sprint 3B : catalogue et niveaux des matières, classes et groupes, enseignants,
 * affectations d'enseignement. Données entièrement fictives. Exige TEST_DATABASE_URL et
 * TEST_SCHOOL_DATABASE_URL.
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
  level2: string;
  class1: string;
  class2: string;
  class3: string;
}

interface Member {
  id: string;
  agent: Agent;
}

suite('Ocall School — Sprint 3B, équipe pédagogique (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: SchoolPrismaService;
  let platform: InternalAccount;
  let ownerA: Agent;
  let ownerB: Agent;
  let a1: Structure;
  let a2: Structure;
  let b1: Structure;
  let t1: Member;
  let t2: Member;
  let t3: Member;
  let other: Member;
  let secretary: Member;
  let supervisor: Member;
  let accountant: Member;
  let francais: string;
  let maths: string;
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
        countryCode: 'ML',
        ownerFirstName: 'Aminata',
        ownerLastName: 'Keita',
        ownerEmail: email(`owner3b-${label}`),
        reference: `OCS3B-${RUN}-${++counter}`,
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
      .send({ firstName: 'Fanta', lastName: `${role}${++counter}`, role, schoolIds })
      .expect(201);
    return {
      id: res.body.member.id,
      agent: await connect(res.body.member.loginId, res.body.temporaryPassword),
    };
  }

  async function structure(owner: Agent, name: string): Promise<Structure> {
    const school = await owner
      .post('/api/v1/school/schools')
      .send({ name: `${name} ${RUN}`, type: 'FRANCO_ARABIC', countryCode: 'ML' })
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
    const level1 = await level('CP1');
    const level2 = await level('CP2');
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
      class1: await cls('CP1 A', level1),
      class2: await cls('CP1 B', level1),
      class3: await cls('CP2 A', level2),
    };
  }

  /** Élève avec un responsable et une inscription validée dans la classe donnée. */
  async function enrolled(owner: Agent, s: Structure, classId: string, levelId = s.level1) {
    const created = await owner
      .post('/api/v1/school/students')
      .send({
        schoolId: s.schoolId,
        lastName: `Diarra${++counter}`,
        firstName: 'Awa',
        birthDate: `2017-01-${String((counter % 27) + 1).padStart(2, '0')}`,
      })
      .expect(201);
    const parent = await owner
      .post('/api/v1/school/guardians')
      .send({
        schoolId: s.schoolId,
        lastName: `Diarra${counter}`,
        firstName: 'Moussa',
        phone: '+223 70 00 00 01',
      })
      .expect(201);
    await owner
      .post(`/api/v1/school/students/${created.body.id}/guardians`)
      .send({ guardianId: parent.body.id, relation: 'FATHER' })
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

  const activate = (owner: Agent, key: string, schoolId: string) =>
    owner.post(`/api/v1/school/subjects/catalog/${key}/activate`).send({ schoolId });

  const assign = (agent: Agent, body: Record<string, unknown>) =>
    agent.post('/api/v1/school/teaching-assignments').send(body);

  const roster = (agent: Agent, classId: string) =>
    agent.get(`/api/v1/school/classes/${classId}/students`);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(SchoolPrismaService);
    platform = await internalAccount(app, prisma, `sc3b-owner-${RUN}`, 'PLATFORM_OWNER');
    ownerA = await client('a');
    ownerB = await client('b');
    a1 = await structure(ownerA, 'Medersa Equipe');
    a2 = await structure(ownerA, 'Ecole Voisine Equipe');
    b1 = await structure(ownerB, 'Complexe Autre Client Equipe');
    t1 = await member(ownerA, 'TEACHER', [a1.schoolId]);
    t2 = await member(ownerA, 'TEACHER', [a1.schoolId]);
    t3 = await member(ownerA, 'TEACHER', [a1.schoolId, a2.schoolId]);
    other = await member(ownerA, 'TEACHER', [a2.schoolId]);
    secretary = await member(ownerA, 'SECRETARY', [a1.schoolId]);
    supervisor = await member(ownerA, 'SUPERVISOR', [a1.schoolId]);
    accountant = await member(ownerA, 'ACCOUNTANT', [a1.schoolId]);
    await enrolled(ownerA, a1, a1.class1);
    await enrolled(ownerA, a1, a1.class2);
  }, 600_000);

  afterAll(async () => {
    const where = { organizationId: { in: organizations } };
    await db.schoolTeachingAssignment.deleteMany({ where });
    await db.schoolTeacherSubject.deleteMany({ where });
    await db.schoolClassGroupStudent.deleteMany({ where });
    await db.schoolClassGroup.deleteMany({ where });
    await db.subjectLevel.deleteMany({ where });
    await db.subject.deleteMany({ where });
    await db.schoolImportJob.deleteMany({ where });
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

  describe('catalogue et matières', () => {
    it("chaque établissement active sa copie d'une matière commune et l'adapte sans toucher aux autres", async () => {
      const catalog = await ownerA
        .get(`/api/v1/school/subjects/catalog?schoolId=${a1.schoolId}`)
        .expect(200);
      expect(catalog.body.length).toBeGreaterThanOrEqual(10);
      // Rien n'est activé d'office, matières religieuses comprises.
      expect(catalog.body.every((s: { isActive: boolean }) => !s.isActive)).toBe(true);

      const created = await activate(ownerA, 'francais', a1.schoolId).expect(201);
      francais = created.body.id;
      expect(created.body).toMatchObject({
        catalogKey: 'francais',
        name: 'Français',
        isActive: true,
      });
      // Activer deux fois ne crée pas de doublon.
      expect((await activate(ownerA, 'francais', a1.schoolId).expect(201)).body.id).toBe(francais);
      maths = (await activate(ownerA, 'mathematiques', a1.schoolId).expect(201)).body.id;

      await ownerA
        .patch(`/api/v1/school/subjects/${francais}`)
        .send({ name: 'Français langue seconde', defaultCoefficient: 3 })
        .expect(200);
      const elsewhere = await activate(ownerA, 'francais', a2.schoolId).expect(201);
      expect(elsewhere.body.id).not.toBe(francais);
      expect(elsewhere.body.name).toBe('Français');
    });

    it('activation réservée à la direction ; matière inconnue introuvable', async () => {
      await activate(secretary.agent, 'anglais', a1.schoolId).expect(403);
      await activate(ownerA, 'inconnue', a1.schoolId).expect(404);
      await activate(ownerB, 'anglais', a1.schoolId).expect(404);
    });

    it("niveaux d'une matière : seulement ceux de son établissement", async () => {
      await ownerA
        .put(`/api/v1/school/subjects/${francais}/levels`)
        .send({ levels: [{ levelId: a1.level1, coefficient: 2, weeklyHours: 6 }] })
        .expect(200);
      await ownerA
        .put(`/api/v1/school/subjects/${maths}/levels`)
        .send({ levels: [{ levelId: a1.level1 }, { levelId: a1.level2 }] })
        .expect(200);
      const foreign = await ownerA
        .put(`/api/v1/school/subjects/${francais}/levels`)
        .send({ levels: [{ levelId: a2.level1 }] })
        .expect(400);
      expect(foreign.body.code).toBe('OTHER_SCHOOL');
      await ownerA
        .put(`/api/v1/school/subjects/${francais}/levels`)
        .send({ levels: [{ levelId: a1.level1 }, { levelId: a1.level1 }] })
        .expect(400);
      const list = await ownerA.get(`/api/v1/school/subjects?schoolId=${a1.schoolId}`).expect(200);
      const fr = list.body.find((s: { id: string }) => s.id === francais);
      expect(fr.levels).toHaveLength(1);
    });
  });

  describe('classes et groupes', () => {
    it('capacité jamais sous l’effectif, renommage, archivage ; autre client introuvable', async () => {
      const below = await ownerA.patch(`/api/v1/school/classes/${a1.class2}`).send({ capacity: 0 });
      expect(below.status).toBe(400);
      await ownerA
        .patch(`/api/v1/school/classes/${a1.class2}`)
        .send({ capacity: 5, name: 'CP1 Bleue' })
        .expect(200);
      await enrolled(ownerA, a1, a1.class3, a1.level2);
      const full = await ownerA
        .patch(`/api/v1/school/classes/${a1.class3}`)
        .send({ capacity: 1 })
        .expect(200);
      expect(full.body.capacity).toBe(1);
      await ownerB.patch(`/api/v1/school/classes/${a1.class1}`).send({ name: 'Volée' }).expect(404);
      await ownerB.get(`/api/v1/school/classes/${a1.class1}`).expect(404);
      const detail = await ownerA.get(`/api/v1/school/classes/${a1.class1}`).expect(200);
      expect(detail.body).toMatchObject({ enrolled: 1, isActive: true });
    });

    it('la capacité refuse de descendre sous l’effectif inscrit', async () => {
      await enrolled(ownerA, a1, a1.class1);
      const res = await ownerA
        .patch(`/api/v1/school/classes/${a1.class1}`)
        .send({ capacity: 1 })
        .expect(409);
      expect(res.body.code).toBe('CAPACITY_BELOW_ENROLLED');
    });

    it('groupes : nom unique dans la classe, élèves inscrits dans la classe seulement', async () => {
      const group = await ownerA
        .post(`/api/v1/school/classes/${a1.class1}/groups`)
        .send({ name: 'Groupe arabe 1', nameAr: 'المجموعة 1' })
        .expect(201);
      const dup = await ownerA
        .post(`/api/v1/school/classes/${a1.class1}/groups`)
        .send({ name: 'Groupe arabe 1' })
        .expect(409);
      expect(dup.body.code).toBe('GROUP_NAME_USED');
      const inClass = await enrolled(ownerA, a1, a1.class1);
      const outside = await enrolled(ownerA, a1, a1.class2);
      await ownerA
        .put(`/api/v1/school/groups/${group.body.id}/students`)
        .send({ studentIds: [inClass] })
        .expect(200);
      const refused = await ownerA
        .put(`/api/v1/school/groups/${group.body.id}/students`)
        .send({ studentIds: [inClass, outside] })
        .expect(400);
      expect(refused.body.code).toBe('STUDENT_NOT_IN_CLASS');
      // Élève d'un autre établissement, ou identifiant inconnu : refusé sans toucher à son dossier.
      const foreign = await enrolled(ownerA, a2, a2.class1);
      for (const studentId of [foreign, '00000000-0000-4000-8000-000000000000']) {
        const res = await ownerA
          .put(`/api/v1/school/groups/${group.body.id}/students`)
          .send({ studentIds: [inClass, studentId] })
          .expect(400);
        expect(res.body.code).toBe('STUDENT_NOT_IN_CLASS');
      }
      const groups = await ownerA.get(`/api/v1/school/classes/${a1.class1}/groups`).expect(200);
      expect(groups.body[0].students).toHaveLength(1);
      await secretary.agent
        .post(`/api/v1/school/classes/${a1.class1}/groups`)
        .send({ name: 'Interdit' })
        .expect(403);
    });
  });

  describe('affectations', () => {
    it("affecter ouvre l'accès de l'enseignant à la classe, et seulement à elle", async () => {
      await roster(t1.agent, a1.class1).expect(404);
      const res = await assign(ownerA, {
        classId: a1.class1,
        subjectId: francais,
        memberId: t1.id,
      }).expect(201);
      expect(res.body).toMatchObject({ endedAt: null, outsideQualifications: false });
      expect((await roster(t1.agent, a1.class1).expect(200)).body.students.length).toBeGreaterThan(
        0,
      );
      await roster(t1.agent, a1.class2).expect(404);
      const mine = await t1.agent.get('/api/v1/school/teaching/mine').expect(200);
      expect(mine.body).toHaveLength(1);
      expect(mine.body[0].subject.id).toBe(francais);
      const decision = await db.schoolAccessDecision.findFirst({
        where: { action: 'school.teaching_assigned', targetId: a1.class1 },
      });
      expect(decision?.metadata).toMatchObject({ memberId: t1.id, subjectId: francais });
    });

    it('un seul enseignant actif par classe, groupe et matière', async () => {
      const dup = await assign(ownerA, {
        classId: a1.class1,
        subjectId: francais,
        memberId: t2.id,
      }).expect(409);
      expect(dup.body.code).toBe('TEACHING_SLOT_TAKEN');
      const [group] = (await ownerA.get(`/api/v1/school/classes/${a1.class1}/groups`).expect(200))
        .body;
      // Un groupe est une autre place : le même cours peut y avoir son propre enseignant.
      await assign(ownerA, {
        classId: a1.class1,
        groupId: group.id,
        subjectId: francais,
        memberId: t2.id,
      }).expect(201);
    });

    it('matière hors niveau, enseignant hors établissement, rôle ou compte inadaptés : refusés', async () => {
      const level = await assign(ownerA, {
        classId: a1.class3,
        subjectId: francais,
        memberId: t1.id,
      }).expect(400);
      expect(level.body.code).toBe('SUBJECT_NOT_IN_LEVEL');
      for (const memberId of [other.id, secretary.id]) {
        const res = await assign(ownerA, {
          classId: a1.class2,
          subjectId: maths,
          memberId,
        }).expect(400);
        expect(res.body.code).toBe('TEACHER_NOT_IN_SCHOOL');
      }
      // Matière d'un autre établissement, même client : identifiant forgé refusé.
      const foreignSubject = (await activate(ownerA, 'sciences', a2.schoolId).expect(201)).body.id;
      const forged = await assign(ownerA, {
        classId: a1.class2,
        subjectId: foreignSubject,
        memberId: t1.id,
      }).expect(400);
      expect(forged.body.code).toBe('SUBJECT_UNAVAILABLE');
    });

    it('un seul professeur principal actif par classe', async () => {
      await assign(ownerA, {
        classId: a1.class1,
        subjectId: maths,
        memberId: t1.id,
        isHomeroom: true,
      }).expect(201);
      const art = (await activate(ownerA, 'arts', a1.schoolId).expect(201)).body.id;
      await ownerA
        .put(`/api/v1/school/subjects/${art}/levels`)
        .send({ levels: [{ levelId: a1.level1 }] })
        .expect(200);
      const res = await assign(ownerA, {
        classId: a1.class1,
        subjectId: art,
        memberId: t2.id,
        isHomeroom: true,
      }).expect(409);
      expect(res.body.code).toBe('HOMEROOM_TAKEN');
    });

    it("remplacement : l'ancien enseignant perd l'accès aussitôt, l'historique est conservé", async () => {
      const first = await assign(ownerA, {
        classId: a1.class2,
        subjectId: maths,
        memberId: t3.id,
      }).expect(201);
      await roster(t3.agent, a1.class2).expect(200);
      const replaced = await ownerA
        .post(`/api/v1/school/teaching-assignments/${first.body.id}/replace`)
        .send({ memberId: t2.id, reason: 'Congé' })
        .expect(201);
      expect(replaced.body.member.id).toBe(t2.id);
      await roster(t3.agent, a1.class2).expect(404);
      await roster(t2.agent, a1.class2).expect(200);
      const history = await ownerA
        .get(`/api/v1/school/teaching-assignments?classId=${a1.class2}&history=true`)
        .expect(200);
      const ended = history.body.find((a: { id: string }) => a.id === first.body.id);
      expect(ended).toMatchObject({ endReason: 'Congé' });
      expect(ended.endedAt).not.toBeNull();
      const same = await ownerA
        .post(`/api/v1/school/teaching-assignments/${replaced.body.id}/replace`)
        .send({ memberId: t2.id })
        .expect(400);
      expect(same.body.code).toBe('SAME_TEACHER');
    });

    it('fin de la dernière affectation : accès retiré, fin tracée ; une fin répétée est refusée', async () => {
      const current = await ownerA
        .get(`/api/v1/school/teaching-assignments?classId=${a1.class2}`)
        .expect(200);
      const id = current.body[0].id as string;
      await ownerA
        .post(`/api/v1/school/teaching-assignments/${id}/end`)
        .send({ reason: 'Fin de mission' })
        .expect(200);
      await roster(t2.agent, a1.class2).expect(404);
      const again = await ownerA
        .post(`/api/v1/school/teaching-assignments/${id}/end`)
        .send({})
        .expect(409);
      expect(again.body.code).toBe('ASSIGNMENT_ENDED');
      const decision = await db.schoolAccessDecision.findFirst({
        where: { action: 'school.teaching_ended', targetId: a1.class2 },
        orderBy: { createdAt: 'desc' },
      });
      expect(decision?.metadata).toMatchObject({ assignmentId: id, accessRemoved: true });
    });

    it('désactiver un enseignant lui ferme ses classes à la requête suivante', async () => {
      await roster(t1.agent, a1.class1).expect(200);
      await ownerA.patch(`/api/v1/school/members/${t1.id}`).send({ isActive: false }).expect(200);
      const res = await roster(t1.agent, a1.class1);
      expect([401, 403]).toContain(res.status);
      // Inactif : il ne peut plus recevoir d'affectation.
      const refused = await assign(ownerA, {
        classId: a1.class2,
        subjectId: maths,
        memberId: t1.id,
      }).expect(400);
      expect(refused.body.code).toBe('TEACHER_NOT_IN_SCHOOL');
      // Ses affectations se terminent et ses accès sont retirés, dans la même transaction.
      expect(
        await db.schoolTeachingAssignment.count({ where: { memberId: t1.id, endedAt: null } }),
      ).toBe(0);
      expect(await db.schoolClassTeacher.count({ where: { memberId: t1.id } })).toBe(0);
      await ownerA.patch(`/api/v1/school/members/${t1.id}`).send({ isActive: true }).expect(200);
      // Réactivé (sa session, elle, a été fermée par la désactivation), il ne retrouve aucun accès d'office.
      expect(await db.schoolClassTeacher.count({ where: { memberId: t1.id } })).toBe(0);
    });

    it('classe archivée : plus aucune nouvelle affectation', async () => {
      await ownerA
        .patch(`/api/v1/school/classes/${a1.class2}`)
        .send({ isActive: false })
        .expect(200);
      const res = await assign(ownerA, {
        classId: a1.class2,
        subjectId: maths,
        memberId: t3.id,
      }).expect(409);
      expect(res.body.code).toBe('CLASS_ARCHIVED');
      await ownerA
        .patch(`/api/v1/school/classes/${a1.class2}`)
        .send({ isActive: true })
        .expect(200);
    });

    it('deux affectations simultanées sur la même place : une seule réussit', async () => {
      const results = await Promise.all(
        [t2, t3].map((t) =>
          assign(ownerA, { classId: a1.class2, subjectId: maths, memberId: t.id }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(
        await db.schoolTeachingAssignment.count({
          where: { classId: a1.class2, subjectId: maths, endedAt: null },
        }),
      ).toBe(1);
    });

    it('permissions : lecture pour secrétariat et surveillance, gestion pour la direction seule', async () => {
      for (const reader of [secretary, supervisor]) {
        await reader.agent
          .get(`/api/v1/school/teaching-assignments?classId=${a1.class1}`)
          .expect(200);
        await assign(reader.agent, {
          classId: a1.class1,
          subjectId: maths,
          memberId: t2.id,
        }).expect(403);
      }
      await accountant.agent
        .get(`/api/v1/school/teaching-assignments?classId=${a1.class1}`)
        .expect(403);
      await t2.agent.get(`/api/v1/school/teaching-assignments?classId=${a1.class1}`).expect(403);
      await t2.agent.get(`/api/v1/school/teachers?schoolId=${a1.schoolId}`).expect(403);
    });

    it('isolation : un autre client ne voit ni ne modifie les affectations', async () => {
      const [current] = (
        await ownerA.get(`/api/v1/school/teaching-assignments?classId=${a1.class1}`).expect(200)
      ).body;
      await ownerB.get(`/api/v1/school/teaching-assignments?classId=${a1.class1}`).expect(404);
      await ownerB
        .post(`/api/v1/school/teaching-assignments/${current.id}/end`)
        .send({})
        .expect(404);
      await ownerB.get(`/api/v1/school/teachers/${t1.id}`).expect(404);
      await assign(ownerB, { classId: a1.class1, subjectId: maths, memberId: t1.id }).expect(404);
      // Et la direction de l'un n'affecte pas un enseignant de l'autre.
      const b1Subject = (await activate(ownerB, 'francais', b1.schoolId).expect(201)).body.id;
      await assign(ownerB, { classId: b1.class1, subjectId: b1Subject, memberId: t1.id }).expect(
        400,
      );
    });

    it("l'ancienne route de retrait termine aussi les affectations de l'enseignant dans la classe", async () => {
      const [active] = (
        await ownerA.get(`/api/v1/school/teaching-assignments?classId=${a1.class2}`).expect(200)
      ).body;
      await ownerA
        .delete(`/api/v1/school/classes/${a1.class2}/teachers/${active.member.id}`)
        .expect((res) => expect([200, 204]).toContain(res.status));
      expect(
        await db.schoolTeachingAssignment.count({ where: { classId: a1.class2, endedAt: null } }),
      ).toBe(0);
    });

    it("la clôture de l'année termine ses affectations d'enseignement", async () => {
      const sciences = (
        await ownerA.get(`/api/v1/school/subjects?schoolId=${a2.schoolId}`).expect(200)
      ).body.find((s: { catalogKey: string }) => s.catalogKey === 'sciences').id;
      await ownerA
        .put(`/api/v1/school/subjects/${sciences}/levels`)
        .send({ levels: [{ levelId: a2.level1 }] })
        .expect(200);
      await assign(ownerA, { classId: a2.class1, subjectId: sciences, memberId: other.id }).expect(
        201,
      );
      await ownerA
        .post(`/api/v1/school/years/${a2.yearId}/status`)
        .send({ status: 'CLOSED' })
        .expect(200);
      const left = await db.schoolTeachingAssignment.findFirstOrThrow({
        where: { classId: a2.class1 },
      });
      expect(left.endedAt).not.toBeNull();
      expect(left.endReason).toBe('Clôture de l’année');
      const closed = await assign(ownerA, {
        classId: a2.class1,
        subjectId: sciences,
        memberId: other.id,
      }).expect(409);
      expect(closed.body.code).toBe('SCHOOL_YEAR_CLOSED');
    });
  });

  describe('enseignants', () => {
    it('matières enseignables, filtres de liste, noms arabes, alerte hors qualification', async () => {
      await ownerA
        .put(`/api/v1/school/teachers/${t2.id}/subjects`)
        .send({ subjectIds: [maths] })
        .expect(200);
      const foreign = (
        await ownerA.get(`/api/v1/school/subjects?schoolId=${a2.schoolId}`).expect(200)
      ).body[0].id;
      const refused = await ownerA
        .put(`/api/v1/school/teachers/${t2.id}/subjects`)
        .send({ subjectIds: [foreign] })
        .expect(400);
      expect(refused.body.code).toBe('OTHER_SCHOOL');
      await ownerA
        .patch(`/api/v1/school/members/${t2.id}`)
        .send({ firstNameAr: 'فانتا', lastNameAr: 'كيتا' })
        .expect(200);

      const bySubject = await ownerA
        .get(`/api/v1/school/teachers?schoolId=${a1.schoolId}&subjectId=${maths}`)
        .expect(200);
      expect(bySubject.body.map((t: { id: string }) => t.id)).toEqual([t2.id]);
      expect(bySubject.body[0]).toMatchObject({ firstNameAr: 'فانتا', lastNameAr: 'كيتا' });
      const search = await ownerA
        .get(`/api/v1/school/teachers?schoolId=${a1.schoolId}&q=${encodeURIComponent('كيتا')}`)
        .expect(200);
      expect(search.body.map((t: { id: string }) => t.id)).toContain(t2.id);

      // Hors de ses matières enseignables : accepté, avec une alerte.
      const flagged = await assign(ownerA, {
        classId: a1.class3,
        subjectId: maths,
        memberId: t1.id,
      }).expect(201);
      expect(flagged.body.outsideQualifications).toBe(false);
      await ownerA
        .put(`/api/v1/school/teachers/${t1.id}/subjects`)
        .send({ subjectIds: [francais] })
        .expect(200);
      await ownerA
        .post(`/api/v1/school/teaching-assignments/${flagged.body.id}/end`)
        .send({})
        .expect(200);
      const again = await assign(ownerA, {
        classId: a1.class3,
        subjectId: maths,
        memberId: t1.id,
      }).expect(201);
      expect(again.body.outsideQualifications).toBe(true);

      const detail = await ownerA.get(`/api/v1/school/teachers/${t1.id}`).expect(200);
      expect(detail.body.subjects.map((s: { id: string }) => s.id)).toEqual([francais]);
      expect(detail.body.teaching.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('cycle de vie des accès et des groupes', () => {
    it("l'ancienne route ne crée plus d'accès ; un accès hérité est visible et se retire", async () => {
      const res = await ownerA
        .post(`/api/v1/school/classes/${a1.class3}/teachers`)
        .send({ memberId: t3.id })
        .expect(409);
      expect(res.body.code).toBe('TEACHING_ASSIGNMENT_REQUIRED');
      await roster(t3.agent, a1.class3).expect(404);
      // Accès accordé avant le Sprint 3B, sans affectation : reproduit directement en base.
      const { organizationId } = await db.schoolClass.findUniqueOrThrow({
        where: { id: a1.class3 },
      });
      await db.schoolClassTeacher.create({
        data: { organizationId, classId: a1.class3, memberId: t3.id },
      });
      const detail = await ownerA.get(`/api/v1/school/classes/${a1.class3}`).expect(200);
      expect(detail.body.legacyAccess.map((m: { id: string }) => m.id)).toEqual([t3.id]);
      await roster(t3.agent, a1.class3).expect(200);
      await ownerA.delete(`/api/v1/school/classes/${a1.class3}/teachers/${t3.id}`).expect(204);
      await roster(t3.agent, a1.class3).expect(404);
    });

    it("changement de classe ou transfert : l'élève quitte aussitôt les groupes de son ancienne classe", async () => {
      const s = await structure(ownerA, 'Groupes Mobiles');
      const target = await structure(ownerA, 'Accueil Transfert');
      const moving = await enrolled(ownerA, s, s.class1);
      const leaving = await enrolled(ownerA, s, s.class1);
      const group = await ownerA
        .post(`/api/v1/school/classes/${s.class1}/groups`)
        .send({ name: 'Groupe mobile' })
        .expect(201);
      await ownerA
        .put(`/api/v1/school/groups/${group.body.id}/students`)
        .send({ studentIds: [moving, leaving] })
        .expect(200);
      const enrollment = await db.schoolEnrollment.findFirstOrThrow({
        where: { studentId: moving, status: 'VALIDATED' },
      });
      await ownerA
        .post(`/api/v1/school/enrollments/${enrollment.id}/class`)
        .send({ classId: s.class2 })
        .expect(200);
      await ownerA
        .post(`/api/v1/school/students/${leaving}/transfer`)
        .send({
          targetSchoolId: target.schoolId,
          targetSchoolYearId: target.yearId,
          targetLevelId: target.level1,
          effectiveOn: '2026-11-15',
          reason: 'Déménagement',
        })
        .expect(200);
      expect(await db.schoolClassGroupStudent.count({ where: { groupId: group.body.id } })).toBe(0);
      const groups = await ownerA.get(`/api/v1/school/classes/${s.class1}/groups`).expect(200);
      expect(groups.body[0].students).toEqual([]);
    });

    it("retrait d'établissement et changement de rôle : affectations terminées, accès retirés", async () => {
      const s = await structure(ownerA, 'Mouvements');
      const subject = (await activate(ownerA, 'francais', s.schoolId).expect(201)).body.id;
      await ownerA
        .put(`/api/v1/school/subjects/${subject}/levels`)
        .send({ levels: [{ levelId: s.level1 }] })
        .expect(200);
      await enrolled(ownerA, s, s.class1);
      const mover = await member(ownerA, 'TEACHER', [s.schoolId, a1.schoolId]);
      const successor = await member(ownerA, 'TEACHER', [s.schoolId]);
      await assign(ownerA, {
        classId: s.class1,
        subjectId: subject,
        memberId: mover.id,
        isHomeroom: true,
      }).expect(201);
      await roster(mover.agent, s.class1).expect(200);
      await ownerA
        .patch(`/api/v1/school/members/${mover.id}`)
        .send({ schoolIds: [a1.schoolId] })
        .expect(200);
      expect(
        await db.schoolTeachingAssignment.count({ where: { memberId: mover.id, endedAt: null } }),
      ).toBe(0);
      expect(await db.schoolClassTeacher.count({ where: { memberId: mover.id } })).toBe(0);
      // La place et le rôle de professeur principal sont libérés.
      await assign(ownerA, {
        classId: s.class1,
        subjectId: subject,
        memberId: successor.id,
        isHomeroom: true,
      }).expect(201);
      // Revenu dans l'établissement, l'ancien enseignant ne retrouve rien d'office.
      await ownerA
        .patch(`/api/v1/school/members/${mover.id}`)
        .send({ schoolIds: [s.schoolId, a1.schoolId] })
        .expect(200);
      await roster(mover.agent, s.class1).expect(404);
      // Un enseignant qui change de rôle n'enseigne plus.
      await ownerA
        .patch(`/api/v1/school/members/${successor.id}`)
        .send({ role: 'SUPERVISOR' })
        .expect(200);
      expect(
        await db.schoolTeachingAssignment.count({
          where: { memberId: successor.id, endedAt: null },
        }),
      ).toBe(0);
      expect(await db.schoolClassTeacher.count({ where: { memberId: successor.id } })).toBe(0);
    });

    it('la clôture de l’année a retiré les accès à ses classes', async () => {
      expect(await db.schoolClassTeacher.count({ where: { classId: a2.class1 } })).toBe(0);
      const decision = await db.schoolAccessDecision.findFirst({
        where: { action: 'school.year_status_changed', targetId: a2.yearId },
        orderBy: { createdAt: 'desc' },
      });
      expect(decision?.metadata).toMatchObject({ to: 'CLOSED', revokedAccess: 1 });
    });

    it("le comptable ne lit pas l'équipe par la fiche classe ; l'enseignant lit celle de sa classe", async () => {
      const seen = await accountant.agent.get(`/api/v1/school/classes/${a1.class1}`).expect(200);
      expect(seen.body.teaching).toBeNull();
      expect(seen.body.legacyAccess).toEqual([]);
      const own = await t2.agent.get(`/api/v1/school/classes/${a1.class1}`).expect(200);
      expect(Array.isArray(own.body.teaching)).toBe(true);
      expect(own.body.legacyAccess).toEqual([]);
    });

    it("les filtres de la liste des enseignants ne révèlent rien d'une autre école", async () => {
      const other = await structure(ownerA, 'Filtre Etranger');
      const subject = (await activate(ownerA, 'mathematiques', other.schoolId).expect(201)).body.id;
      await ownerA
        .put(`/api/v1/school/subjects/${subject}/levels`)
        .send({ levels: [{ levelId: other.level1 }] })
        .expect(200);
      const shared = await member(ownerA, 'TEACHER', [a1.schoolId, other.schoolId]);
      await assign(ownerA, {
        classId: other.class1,
        subjectId: subject,
        memberId: shared.id,
      }).expect(201);
      await ownerA
        .put(`/api/v1/school/teachers/${shared.id}/subjects`)
        .send({ subjectIds: [subject] })
        .expect(200);
      // Ses matières enseignables d'une autre école ne déclenchent ni ne révèlent d'alerte ici.
      const here = await assign(ownerA, {
        classId: a1.class2,
        subjectId: francais,
        memberId: shared.id,
      }).expect(201);
      expect(here.body.outsideQualifications).toBe(false);
      for (const filter of [`classId=${other.class1}`, `subjectId=${subject}`]) {
        const here = await ownerA
          .get(`/api/v1/school/teachers?schoolId=${a1.schoolId}&${filter}`)
          .expect(200);
        expect(here.body).toEqual([]);
        const there = await ownerA
          .get(`/api/v1/school/teachers?schoolId=${other.schoolId}&${filter}`)
          .expect(200);
        expect(there.body.map((t: { id: string }) => t.id)).toEqual([shared.id]);
      }
    });

    it("l'ancienne liste des classes est limitée aux classes de l'enseignant", async () => {
      const res = await t2.agent
        .get(`/api/v1/school/classes?schoolYearId=${a1.yearId}`)
        .expect(200);
      const ids = res.body.map((c: { id: string }) => c.id);
      expect(ids).toContain(a1.class1);
      expect(ids).not.toContain(a1.class3);
    });

    it('vider la capacité la supprime', async () => {
      const res = await ownerA
        .patch(`/api/v1/school/classes/${a1.class3}`)
        .send({ capacity: null })
        .expect(200);
      expect(res.body.capacity).toBeNull();
    });

    it('les index partiels refusent eux-mêmes un doublon, et le conflit est reconnu', async () => {
      const slot = await db.schoolTeachingAssignment.findFirstOrThrow({
        where: { classId: a1.class1, endedAt: null, groupId: { not: null } },
      });
      const base = {
        organizationId: slot.organizationId,
        classId: slot.classId,
        createdByUserId: slot.createdByUserId,
      };
      const duplicate = await db.schoolTeachingAssignment
        .create({
          data: { ...base, groupId: slot.groupId, subjectId: slot.subjectId, memberId: t3.id },
        })
        .catch((e: { code?: string; meta?: { target?: unknown } }) => e);
      expect(duplicate).toMatchObject({ code: 'P2002' });
      const art = (await activate(ownerA, 'arts', a1.schoolId).expect(201)).body.id;
      await assign(ownerA, {
        classId: a1.class1,
        subjectId: art,
        memberId: t3.id,
        isHomeroom: true,
      }).expect(201);
      const homeroom = await db.schoolTeachingAssignment
        .create({ data: { ...base, subjectId: maths, memberId: t2.id, isHomeroom: true } })
        .catch((e: { code?: string; meta?: { target?: unknown } }) => e);
      expect(homeroom).toMatchObject({ code: 'P2002' });
    });

    it('un conflit d’index simultané est restitué avec le bon code', async () => {
      const service = app.get(SchoolTeachingService) as unknown as {
        conflicts: (
          classId: string,
          isHomeroom: boolean,
          work: () => Promise<unknown>,
        ) => Promise<unknown>;
      };
      // Forme réelle observée : Prisma désigne « classId » pour les deux index partiels.
      const raced = () =>
        Promise.reject(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
            meta: { target: ['classId'] },
          }),
        );
      const codeOf = (e: unknown) =>
        ((e as ConflictException).getResponse() as { code: string }).code;
      // La classe 1 a un professeur principal actif (test précédent).
      expect(codeOf(await service.conflicts(a1.class1, true, raced).catch((e) => e))).toBe(
        'HOMEROOM_TAKEN',
      );
      expect(codeOf(await service.conflicts(a1.class1, false, raced).catch((e) => e))).toBe(
        'TEACHING_SLOT_TAKEN',
      );
      expect(codeOf(await service.conflicts(a1.class2, true, raced).catch((e) => e))).toBe(
        'TEACHING_SLOT_TAKEN',
      );
    });
  });

  // Exige plusieurs connexions réelles : ignoré sur PGlite, qui exécute tout en séquence.
  const realDatabase = ![
    process.env.TEST_DATABASE_URL,
    process.env.SCHOOL_TEST_DATABASE_URL ?? process.env.TEST_SCHOOL_DATABASE_URL,
  ].some((url) => url?.includes('connection_limit=1'));
  (realDatabase ? describe : describe.skip)('verrous bornés au périmètre', () => {
    /**
     * Une autre connexion tient un verrou exclusif sur une ligne étrangère pendant `work`. Une requête
     * qui verrouillerait cette ligne resterait bloquée : la réponse doit arriver bien avant sa libération.
     */
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

    it("un élève d'un autre client n'est jamais verrouillé par la composition d'un groupe", async () => {
      const foreign = (
        await ownerB
          .post('/api/v1/school/students')
          .send({
            schoolId: b1.schoolId,
            lastName: 'Sangare',
            firstName: 'Oumou',
            birthDate: '2017-02-03',
          })
          .expect(201)
      ).body.id as string;
      const [group] = (await ownerA.get(`/api/v1/school/classes/${a1.class1}/groups`).expect(200))
        .body;
      await whileLocked('SchoolStudent', foreign, async () => {
        const res = await promptly(
          ownerA.put(`/api/v1/school/groups/${group.id}/students`).send({ studentIds: [foreign] }),
        );
        expect(res.status).toBe(400);
      });
    });

    it("un enseignant d'un autre client n'est jamais verrouillé par une affectation ou un remplacement", async () => {
      const foreign = await member(ownerB, 'TEACHER', [b1.schoolId]);
      const [current] = (
        await ownerA.get(`/api/v1/school/teaching-assignments?classId=${a1.class1}`).expect(200)
      ).body;
      await whileLocked('SchoolMember', foreign.id, async () => {
        const created = await promptly(
          assign(ownerA, { classId: a1.class3, subjectId: maths, memberId: foreign.id }),
        );
        expect(created.status).toBe(400);
        const replaced = await promptly(
          ownerA
            .post(`/api/v1/school/teaching-assignments/${current.id}/replace`)
            .send({ memberId: foreign.id }),
        );
        expect(replaced.status).toBe(400);
        const subjects = await promptly(
          ownerA.put(`/api/v1/school/teachers/${foreign.id}/subjects`).send({ subjectIds: [] }),
        );
        expect(subjects.status).toBe(404);
      });
      // Rien n'a changé : l'affectation remplacée en vain est toujours active.
      const still = await db.schoolTeachingAssignment.findUniqueOrThrow({
        where: { id: current.id },
      });
      expect(still.endedAt).toBeNull();
    });

    it("un élève ou un enseignant d'un autre établissement du même client n'est jamais verrouillé", async () => {
      const neighbour = (
        await ownerA
          .post('/api/v1/school/students')
          .send({
            schoolId: a2.schoolId,
            lastName: 'Diarra',
            firstName: 'Awa',
            birthDate: '2017-04-05',
          })
          .expect(201)
      ).body.id as string;
      const [group] = (await ownerA.get(`/api/v1/school/classes/${a1.class1}/groups`).expect(200))
        .body;
      await whileLocked('SchoolStudent', neighbour, async () => {
        const res = await promptly(
          ownerA
            .put(`/api/v1/school/groups/${group.id}/students`)
            .send({ studentIds: [neighbour] }),
        );
        expect(res.status).toBe(400);
      });
      const [current] = (
        await ownerA.get(`/api/v1/school/teaching-assignments?classId=${a1.class1}`).expect(200)
      ).body;
      // Directeur limité au premier établissement : `other` n'enseigne que dans le second.
      const director = await member(ownerA, 'SCHOOL_DIRECTOR', [a1.schoolId]);
      await whileLocked('SchoolMember', other.id, async () => {
        const created = await promptly(
          assign(ownerA, { classId: a1.class3, subjectId: maths, memberId: other.id }),
        );
        expect(created.status).toBe(400);
        const replaced = await promptly(
          ownerA
            .post(`/api/v1/school/teaching-assignments/${current.id}/replace`)
            .send({ memberId: other.id }),
        );
        expect(replaced.status).toBe(400);
        const subjects = await promptly(
          director.agent
            .put(`/api/v1/school/teachers/${other.id}/subjects`)
            .send({ subjectIds: [] }),
        );
        expect(subjects.status).toBe(404);
        const updated = await promptly(
          director.agent.patch(`/api/v1/school/members/${other.id}`).send({ lastNameAr: 'كيتا' }),
        );
        expect(updated.status).toBe(404);
      });
      expect(
        (await db.schoolMember.findUniqueOrThrow({ where: { id: other.id } })).lastNameAr,
      ).toBeNull();
    });

    it("matières enseignables : un membre sorti du périmètre après le contrôle n'est ni verrouillé ni attendu", async () => {
      const director = await member(ownerA, 'SCHOOL_DIRECTOR', [a1.schoolId]);
      const moving = await member(ownerA, 'TEACHER', [a1.schoolId]);
      const teaching = app.get(SchoolTeachingService) as unknown as {
        teacherSchools: (...args: unknown[]) => Promise<string[]>;
      };
      const original = teaching.teacherSchools.bind(teaching);
      let reached!: () => void;
      let resume!: () => void;
      const at = new Promise<void>((resolve) => (reached = resolve));
      const gate = new Promise<void>((resolve) => (resume = resolve));
      // Pause après la prévalidation, faite hors transaction (troisième argument absent).
      const spy = jest
        .spyOn(teaching, 'teacherSchools')
        .mockImplementation(async (...args: unknown[]) => {
          const result = await original(...args);
          if (args[2] === undefined && args[1] === moving.id) {
            reached();
            await gate;
          }
          return result;
        });
      try {
        const request = director.agent
          .put(`/api/v1/school/teachers/${moving.id}/subjects`)
          .send({ subjectIds: [] })
          .then((r) => r);
        await at;
        await ownerA
          .patch(`/api/v1/school/members/${moving.id}`)
          .send({ schoolIds: [a2.schoolId] })
          .expect(200);
        await whileLocked('SchoolMember', moving.id, async () => {
          resume();
          expect((await promptly(request)).status).toBe(404);
        });
      } finally {
        resume();
        spy.mockRestore();
      }
    });

    it("un élève ou un responsable hors périmètre n'est jamais verrouillé par sa modification", async () => {
      const foreignStudent = (
        await ownerB
          .post('/api/v1/school/students')
          .send({
            schoolId: b1.schoolId,
            lastName: 'Traore',
            firstName: 'Mariam',
            birthDate: '2017-05-06',
          })
          .expect(201)
      ).body.id as string;
      const foreignGuardian = (
        await ownerB
          .post('/api/v1/school/guardians')
          .send({
            schoolId: b1.schoolId,
            lastName: 'Traore',
            firstName: 'Bakary',
            phone: '+223 70 00 00 41',
          })
          .expect(201)
      ).body.id as string;
      const neighbourStudent = (
        await ownerA
          .post('/api/v1/school/students')
          .send({
            schoolId: a2.schoolId,
            lastName: 'Kone',
            firstName: 'Salif',
            birthDate: '2017-06-07',
          })
          .expect(201)
      ).body.id as string;
      const neighbourGuardian = (
        await ownerA
          .post('/api/v1/school/guardians')
          .send({
            schoolId: a2.schoolId,
            lastName: 'Kone',
            firstName: 'Adama',
            phone: '+223 70 00 00 42',
          })
          .expect(201)
      ).body.id as string;
      // Directeur limité au premier établissement : le second lui est étranger.
      const director = await member(ownerA, 'SCHOOL_DIRECTOR', [a1.schoolId]);
      const cases: [string, string, Agent, string][] = [
        ['SchoolStudent', foreignStudent, ownerA, 'students'],
        ['SchoolStudent', neighbourStudent, director.agent, 'students'],
        ['SchoolGuardian', foreignGuardian, ownerA, 'guardians'],
        ['SchoolGuardian', neighbourGuardian, director.agent, 'guardians'],
      ];
      for (const [table, id, agent, path] of cases) {
        await whileLocked(table, id, async () => {
          const res = await promptly(
            agent.patch(`/api/v1/school/${path}/${id}`).send({ firstName: 'Modifie' }),
          );
          expect(res.status).toBe(404);
        });
      }
      const untouched = await db.schoolStudent.findUniqueOrThrow({
        where: { id: neighbourStudent },
      });
      expect(untouched.firstName).toBe('Salif');
    });

    it('fiche enseignant : périmètre et restitution lus dans un même instantané', async () => {
      const director = await member(ownerA, 'SCHOOL_DIRECTOR', [a1.schoolId]);
      const moving = await member(ownerA, 'TEACHER', [a1.schoolId]);
      const teaching = app.get(SchoolTeachingService) as unknown as {
        teacherSchools: (...args: unknown[]) => Promise<string[]>;
      };
      const original = teaching.teacherSchools.bind(teaching);
      let reached!: () => void;
      let resume!: () => void;
      const at = new Promise<void>((resolve) => (reached = resolve));
      const gate = new Promise<void>((resolve) => (resume = resolve));
      let armed = true;
      // Pause juste après le contrôle de périmètre, quelle que soit la connexion qui le porte.
      const spy = jest
        .spyOn(teaching, 'teacherSchools')
        .mockImplementation(async (...args: unknown[]) => {
          const result = await original(...args);
          if (armed && args[1] === moving.id) {
            armed = false;
            reached();
            await gate;
          }
          return result;
        });
      try {
        const request = director.agent.get(`/api/v1/school/teachers/${moving.id}`).then((r) => r);
        await at;
        // Le propriétaire déplace l'enseignant et change ses noms arabes dans la même opération.
        await ownerA
          .patch(`/api/v1/school/members/${moving.id}`)
          .send({ schoolIds: [a2.schoolId], lastNameAr: 'جديد' })
          .expect(200);
        resume();
        const res = await request;
        // La fiche reflète l'état contrôlé : jamais les valeurs écrites après la sortie du périmètre.
        expect(res.status).toBe(200);
        expect(res.body.lastNameAr).toBeNull();
        expect(res.body.schoolIds).toEqual([a1.schoolId]);
      } finally {
        resume();
        spy.mockRestore();
      }
    });

    it("un import n'attend jamais un responsable devenu invisible pour l'utilisateur", async () => {
      const origin = await structure(ownerA, `Import origine ${++counter}`);
      const elsewhere = await structure(ownerA, `Import ailleurs ${++counter}`);
      const staff = await member(ownerA, 'SECRETARY', [origin.schoolId]);
      const phone = '+223 70 00 00 51';
      const child = (
        await ownerA
          .post('/api/v1/school/students')
          .send({
            schoolId: origin.schoolId,
            lastName: 'Sylla',
            firstName: 'Awa',
            birthDate: '2017-03-14',
          })
          .expect(201)
      ).body.id as string;
      const parent = (
        await ownerA
          .post('/api/v1/school/guardians')
          .send({ schoolId: origin.schoolId, lastName: 'Sylla', firstName: 'Oumar', phone })
          .expect(201)
      ).body.id as string;
      await ownerA
        .post(`/api/v1/school/students/${child}/guardians`)
        .send({ guardianId: parent, relation: 'FATHER' })
        .expect(201);
      // Son seul enfant part ailleurs : le responsable sort du périmètre du secrétariat d'origine.
      await ownerA
        .post(`/api/v1/school/students/${child}/transfer`)
        .send({
          targetSchoolId: elsewhere.schoolId,
          targetSchoolYearId: elsewhere.yearId,
          targetLevelId: elsewhere.level1,
          effectiveOn: '2026-11-15',
          reason: 'Déménagement',
        })
        .expect(200);
      const csv = Buffer.from(
        `Nom;Prénom;Date de naissance;Nom du responsable;Prénom du responsable;Téléphone du responsable\r\nImport${counter};Awa;14/03/2017;Sylla;Oumar;${phone}\r\n`,
      );
      await whileLocked('SchoolGuardian', parent, async () => {
        const res = await promptly(
          staff.agent
            .post('/api/v1/school/imports')
            .field('schoolId', origin.schoolId)
            .attach('file', csv, 'e.csv'),
        );
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ createdRows: 1, errorRows: 0 });
      });
      expect(await db.schoolStudentGuardian.count({ where: { guardianId: parent } })).toBe(1);
    });

    it("liste des classes d'un enseignant : droits et restitution lus dans un même instantané", async () => {
      const own = await structure(ownerA, `Instantane ${++counter}`);
      const teacher = await member(ownerA, 'TEACHER', [own.schoolId]);
      const subject = (await activate(ownerA, 'francais', own.schoolId).expect(201)).body
        .id as string;
      await ownerA
        .put(`/api/v1/school/subjects/${subject}/levels`)
        .send({ levels: [{ levelId: own.level1 }] })
        .expect(200);
      const assignment = (
        await assign(ownerA, {
          classId: own.class1,
          subjectId: subject,
          memberId: teacher.id,
        }).expect(201)
      ).body.id as string;
      const school = app.get(SchoolService) as unknown as {
        ownClasses: (...args: unknown[]) => Promise<string[] | null>;
      };
      const original = school.ownClasses.bind(school);
      let reached!: () => void;
      let resume!: () => void;
      const at = new Promise<void>((resolve) => (reached = resolve));
      const gate = new Promise<void>((resolve) => (resume = resolve));
      let armed = true;
      // Pause juste après le calcul des classes confiées : seule la requête de l'enseignant le demande.
      const spy = jest
        .spyOn(school, 'ownClasses')
        .mockImplementation(async (...args: unknown[]) => {
          const result = await original(...args);
          if (armed && (args[0] as { role?: string }).role === 'TEACHER') {
            armed = false;
            reached();
            await gate;
          }
          return result;
        });
      try {
        const request = teacher.agent
          .get(`/api/v1/school/classes?schoolYearId=${own.yearId}`)
          .then((r) => r);
        await at;
        // Fin de la dernière affectation, puis renommage de la classe.
        await ownerA
          .post(`/api/v1/school/teaching-assignments/${assignment}/end`)
          .send({ reason: 'Fin de mission' })
          .expect(200);
        await ownerA
          .patch(`/api/v1/school/classes/${own.class1}`)
          .send({ name: 'Renommee apres retrait' })
          .expect(200);
        resume();
        const res = await request;
        expect(res.status).toBe(200);
        // Jamais un nom écrit après le retrait de l'accès.
        expect(res.body.map((c: { name: string }) => c.name)).not.toContain(
          'Renommee apres retrait',
        );
      } finally {
        resume();
        spy.mockRestore();
      }
    });

    it("affectations d'un enseignant : périmètre et noms lus dans un même instantané", async () => {
      const own = await structure(ownerA, `Historique ${++counter}`);
      const elsewhere = await structure(ownerA, `Historique ailleurs ${++counter}`);
      const staff = await member(ownerA, 'SECRETARY', [own.schoolId]);
      const moving = await member(ownerA, 'TEACHER', [own.schoolId]);
      const subject = (await activate(ownerA, 'francais', own.schoolId).expect(201)).body
        .id as string;
      await ownerA
        .put(`/api/v1/school/subjects/${subject}/levels`)
        .send({ levels: [{ levelId: own.level1 }] })
        .expect(200);
      await assign(ownerA, { classId: own.class1, subjectId: subject, memberId: moving.id }).expect(
        201,
      );
      const teaching = app.get(SchoolTeachingService) as unknown as {
        teacherSchools: (...args: unknown[]) => Promise<string[]>;
      };
      const original = teaching.teacherSchools.bind(teaching);
      let reached!: () => void;
      let resume!: () => void;
      const at = new Promise<void>((resolve) => (reached = resolve));
      const gate = new Promise<void>((resolve) => (resume = resolve));
      let armed = true;
      // Pause juste après le contrôle du périmètre de l'enseignant.
      const spy = jest
        .spyOn(teaching, 'teacherSchools')
        .mockImplementation(async (...args: unknown[]) => {
          const result = await original(...args);
          if (armed && args[1] === moving.id) {
            armed = false;
            reached();
            await gate;
          }
          return result;
        });
      try {
        const request = staff.agent
          .get(`/api/v1/school/teaching-assignments?memberId=${moving.id}&history=true`)
          .then((r) => r);
        await at;
        // L'enseignant part dans un autre établissement et change de nom arabe dans la même opération.
        await ownerA
          .patch(`/api/v1/school/members/${moving.id}`)
          .send({ schoolIds: [elsewhere.schoolId], lastNameAr: 'جديد' })
          .expect(200);
        resume();
        const res = await request;
        expect(res.status).toBe(200);
        // L'état contrôlé est restitué (l'affectation y figure), jamais un nom écrit après la sortie.
        expect(res.body).toHaveLength(1);
        for (const row of res.body as { member: { lastNameAr: string | null } }[]) {
          expect(row.member.lastNameAr).toBeNull();
        }
      } finally {
        resume();
        spy.mockRestore();
      }
    });

    it("un membre d'un autre client n'est jamais verrouillé par sa modification", async () => {
      const foreign = await member(ownerB, 'TEACHER', [b1.schoolId]);
      await whileLocked('SchoolMember', foreign.id, async () => {
        const res = await promptly(
          ownerA.patch(`/api/v1/school/members/${foreign.id}`).send({ lastNameAr: 'كيتا' }),
        );
        expect(res.status).toBe(404);
      });
    });

    it('deux remplacements simultanés des niveaux donnent une liste complète, jamais leur cumul', async () => {
      const subject = (await activate(ownerA, 'musique', a1.schoolId).expect(201)).body
        .id as string;
      const levels = (body: object) =>
        ownerA.put(`/api/v1/school/subjects/${subject}/levels`).send(body);
      await levels({ levels: [{ levelId: a1.level1 }] }).expect(200);
      // Une autre connexion retient la ligne existante : les deux remplacements partent ensemble et
      // attendent tous deux de pouvoir la supprimer.
      let release!: () => void;
      let ready!: (pid: number) => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const locked = new Promise<number>((resolve) => (ready = resolve));
      const holder = db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "SubjectLevel" WHERE "subjectId" = ${subject}::uuid FOR UPDATE`;
          const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          ready(row!.pid);
          await held;
        },
        { timeout: 60_000 },
      );
      const holderPid = await locked;
      const first = levels({ levels: [{ levelId: a1.level2 }] }).then((r) => r);
      const second = levels({ levels: [{ levelId: a1.level1, coefficient: 3 }] }).then((r) => r);
      // Les deux requêtes doivent être en attente de verrou avant la libération : l'une derrière la
      // connexion qui retient la ligne, l'autre derrière elle ou derrière la première requête.
      let observed = false;
      for (let i = 0; i < 200 && !observed; i++) {
        // w1 attend la connexion qui retient la ligne ; w2, distincte, attend celle-ci ou w1. Seules les
        // opérations sur cette matière peuvent attendre ce verrou : ce sont les deux requêtes du test.
        const [row] = await db.$queryRaw<{ observed: boolean }[]>`
          WITH w AS (
            SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND (query LIKE '%"SubjectLevel"%' OR query LIKE '%FROM "Subject"%')
          )
          SELECT EXISTS (
            SELECT 1 FROM w w1 JOIN w w2 ON w2.pid <> w1.pid
            WHERE ${holderPid}::int = ANY(w1.blockers)
              AND (${holderPid}::int = ANY(w2.blockers) OR w1.pid = ANY(w2.blockers))
          ) AS observed`;
        observed = row?.observed ?? false;
        if (!observed) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      release();
      await holder;
      expect(observed).toBe(true);
      const results = await Promise.all([first, second]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const final = await db.subjectLevel.findMany({ where: { subjectId: subject } });
      expect(final).toHaveLength(1);
    });
  });
});
