import { Workbook } from 'exceljs';
import type { INestApplication } from '@nestjs/common';
import { SchoolGuardiansService } from '../src/modules/school/school-guardians.service';
import { SchoolPrismaService } from '../src/modules/school/school-prisma.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  type Agent,
  type InternalAccount,
  PASSWORD,
  RUN,
  type SignedUpOwner,
  cleanup,
  createTestApp,
  email,
  internalAccount,
  login,
  signup,
} from './helpers';

/**
 * Ocall School, Sprint 2 : dossiers élèves, matricules, inscriptions, responsables, documents, imports.
 * Données entièrement fictives. Exige TEST_DATABASE_URL et TEST_SCHOOL_DATABASE_URL.
 */
const suite = process.env.TEST_SCHOOL_DATABASE_URL ? describe : describe.skip;

const TERMS = { startsOn: '2026-01-01', endsOn: '2099-12-31' };
const AR_LAST = 'الفقيرة';
const AR_FIRST = 'فاطمة';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Page >> endobj\n%%EOF');

interface Structure {
  schoolId: string;
  yearId: string;
  nextYearId: string;
  levelId: string;
  classId: string;
  otherClassId: string;
}

suite('Ocall School — Sprint 2 (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: SchoolPrismaService;
  let platform: InternalAccount;
  let park: SignedUpOwner;
  let ownerA: Agent;
  let ownerB: Agent;
  let contractA: string;
  let secretary: Agent;
  let teacher: Agent;
  let teacherId: string;
  let accountant: Agent;
  let a1: Structure;
  let a2: Structure;
  let b1: Structure;
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

  async function client(label: string) {
    const res = await platform.agent
      .post('/api/v1/platform/contracts/clients')
      .send({
        organizationName: `Test ${label} ${RUN}`,
        countryCode: 'ML',
        ownerFirstName: 'Aminata',
        ownerLastName: 'Keita',
        ownerEmail: email(`owner2-${label}`),
        reference: `OCS2-${RUN}-${++counter}`,
        ...TERMS,
      })
      .expect(201);
    organizations.push(res.body.contract.organizationId);
    await platform.agent
      .post(`/api/v1/platform/contracts/${res.body.contract.id}/status`)
      .send({ status: 'ACTIVE', reason: 'Décision de test' })
      .expect(200);
    return {
      agent: await connect(res.body.loginId, res.body.temporaryPassword),
      contractId: res.body.contract.id as string,
    };
  }

  async function member(owner: Agent, role: string, schoolIds: string[]) {
    const res = await owner
      .post('/api/v1/school/members')
      .send({ firstName: 'Fanta', lastName: role, role, schoolIds })
      .expect(201);
    return {
      id: res.body.member.id as string,
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
    const nextYear = await owner
      .post('/api/v1/school/years')
      .send({ schoolId, label: '2027-2028', startsOn: '2027-10-01', endsOn: '2028-06-30' })
      .expect(201);
    const cycle = await owner
      .post('/api/v1/school/cycles')
      .send({ schoolId, name: 'Primaire' })
      .expect(201);
    const level = await owner
      .post('/api/v1/school/levels')
      .send({ cycleId: cycle.body.id, name: 'CP1', nameAr: 'السنة الأولى' })
      .expect(201);
    const cls = await owner
      .post('/api/v1/school/classes')
      .send({ schoolYearId: year.body.id, levelId: level.body.id, name: 'CP1 A' })
      .expect(201);
    const other = await owner
      .post('/api/v1/school/classes')
      .send({ schoolYearId: year.body.id, levelId: level.body.id, name: 'CP1 B' })
      .expect(201);
    await owner
      .post('/api/v1/school/classes')
      .send({ schoolYearId: nextYear.body.id, levelId: level.body.id, name: 'CP1 A' })
      .expect(201);
    return {
      schoolId,
      yearId: year.body.id,
      nextYearId: nextYear.body.id,
      levelId: level.body.id,
      classId: cls.body.id,
      otherClassId: other.body.id,
    };
  }

  const student = (agent: Agent, schoolId: string, body: Record<string, unknown> = {}) =>
    agent.post('/api/v1/school/students').send({
      schoolId,
      lastName: `Diarra${++counter}`,
      firstName: 'Awa',
      birthDate: '2018-03-14',
      ...body,
    });

  const guardian = (agent: Agent, schoolId: string, lastName = 'Diarra') =>
    agent
      .post('/api/v1/school/guardians')
      .send({ schoolId, lastName, firstName: 'Moussa', phone: '+223 70 00 00 01' });

  /** Dossier avec un responsable et une inscription validée dans la classe de référence. */
  async function enrolled(owner: Agent, s: Structure, classId = s.classId) {
    const created = await student(owner, s.schoolId).expect(201);
    const parent = await guardian(owner, s.schoolId).expect(201);
    await owner
      .post(`/api/v1/school/students/${created.body.id}/guardians`)
      .send({ guardianId: parent.body.id, relation: 'FATHER' })
      .expect(201);
    const enrollment = await owner
      .post('/api/v1/school/enrollments')
      .send({
        studentId: created.body.id,
        schoolYearId: s.yearId,
        levelId: s.levelId,
        classId,
        submit: true,
      })
      .expect(201);
    await owner
      .post(`/api/v1/school/enrollments/${enrollment.body.id}/status`)
      .send({ status: 'VALIDATED' })
      .expect(200);
    return { id: created.body.id as string, enrollmentId: enrollment.body.id as string };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(SchoolPrismaService);
    platform = await internalAccount(app, prisma, `sc2-owner-${RUN}`, 'PLATFORM_OWNER');
    park = await signup(app, 'sc2park', 'PARK');
    const a = await client('a');
    const b = await client('b');
    ownerA = a.agent;
    contractA = a.contractId;
    ownerB = b.agent;
    a1 = await structure(ownerA, 'Medersa Annour');
    a2 = await structure(ownerA, 'École Espoir');
    b1 = await structure(ownerB, 'Complexe Bakary');
    secretary = (await member(ownerA, 'SECRETARY', [a1.schoolId])).agent;
    const t = await member(ownerA, 'TEACHER', [a1.schoolId]);
    teacher = t.agent;
    teacherId = t.id;
    accountant = (await member(ownerA, 'ACCOUNTANT', [a1.schoolId])).agent;
  }, 300_000);

  afterAll(async () => {
    const where = { organizationId: { in: organizations } };
    await db.schoolImportJob.deleteMany({ where });
    await db.schoolStudentEvent.deleteMany({ where });
    await db.schoolStudentDocument.deleteMany({ where });
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
    await db.schoolYear.deleteMany({ where });
    await db.schoolMember.deleteMany({ where });
    await db.school.deleteMany({ where });
    await db.schoolGroup.deleteMany({ where });
    await cleanup(prisma);
    await app.close();
  });

  describe('dossier et matricule', () => {
    it('crée un dossier, sans jamais renvoyer le champ chiffré', async () => {
      const res = await student(ownerA, a1.schoolId, { address: 'Bamako' }).expect(201);
      expect(res.body.matricule).toMatch(/^2026-\d{6}$/);
      expect(res.body.status).toBe('REGISTERED');
      expect(res.body).not.toHaveProperty('specialNeedsEnc');
    });

    it('applique le format de l’établissement', async () => {
      await ownerA
        .put(`/api/v1/school/student-settings?schoolId=${a2.schoolId}`)
        .send({
          matriculeScope: 'SCHOOL',
          matriculePrefix: 'ECO',
          matriculeYear: true,
          matriculePadding: 4,
          requiredDocuments: [],
          customFields: [],
        })
        .expect(200);
      const res = await student(ownerA, a2.schoolId).expect(201);
      expect(res.body.matricule).toMatch(/^ECO-2026-\d{4}$/);
    });

    it('génère des matricules uniques sous inscriptions simultanées', async () => {
      const results = await Promise.all(
        Array.from({ length: 12 }, () => student(ownerA, a1.schoolId)),
      );
      expect(results.map((r) => r.status)).toEqual(Array(12).fill(201));
      const numbers = results.map((r) => r.body.matricule as string);
      expect(new Set(numbers).size).toBe(12);
    });

    it('accepte un matricule existant, le refuse en double, et le saute ensuite', async () => {
      const taken = `2026-${String(900000 + (counter % 1000)).padStart(6, '0')}`;
      await student(ownerA, a1.schoolId, { matricule: taken }).expect(201);
      const twice = await student(ownerA, a1.schoolId, { matricule: taken }).expect(409);
      expect(twice.body.code).toBe('MATRICULE_USED');
      await db.schoolNumberCounter.update({
        where: {
          organizationId_counterKey: {
            organizationId: organizations[0]!,
            counterKey: `${a1.schoolId}:2026`,
          },
        },
        data: { value: Number(taken.slice(5)) - 1 },
      });
      const next = await student(ownerA, a1.schoolId).expect(201);
      expect(next.body.matricule).not.toBe(taken);
      expect(Number(next.body.matricule.slice(5))).toBe(Number(taken.slice(5)) + 1);
    });

    it('refuse un doublon de personne, sauf homonyme confirmé', async () => {
      const body = { lastName: 'Sidibé', firstName: 'Kadia', birthDate: '2017-05-05' };
      await student(ownerA, a1.schoolId, body).expect(201);
      const dup = await student(ownerA, a1.schoolId, {
        ...body,
        lastName: 'SIDIBE',
      }).expect(409);
      expect(dup.body.code).toBe('STUDENT_DUPLICATE');
      await student(ownerA, a1.schoolId, { ...body, confirmHomonym: true }).expect(201);
    });

    describe('doublon entre établissements du groupe', () => {
      const NEUTRAL = 'Ce dossier nécessite une vérification par l’administrateur du groupe.';
      const expectNeutral = (body: Record<string, unknown>, ...secrets: string[]) => {
        expect(body.code).toBe('STUDENT_REVIEW_REQUIRED');
        expect(body.message).toBe(NEUTRAL);
        const text = JSON.stringify(body);
        for (const secret of secrets) expect(text).not.toContain(secret);
      };

      it('le personnel hors périmètre reçoit un message neutre et ne peut pas passer outre', async () => {
        const body = { lastName: 'Traoré', firstName: 'Salimata', birthDate: '2015-01-15' };
        const twin = await student(ownerA, a2.schoolId, body).expect(201);
        const before = await db.schoolStudent.count({ where: { schoolId: a1.schoolId } });

        for (const payload of [body, { ...body, confirmHomonym: true }]) {
          const res = await student(secretary, a1.schoolId, payload).expect(409);
          expectNeutral(res.body, twin.body.id, twin.body.matricule, a2.schoolId);
        }
        const director = await member(ownerA, 'SCHOOL_DIRECTOR', [a1.schoolId]);
        const refused = await student(director.agent, a1.schoolId, {
          ...body,
          confirmHomonym: true,
        }).expect(409);
        expectNeutral(refused.body, twin.body.id);
        expect(await db.schoolStudent.count({ where: { schoolId: a1.schoolId } })).toBe(before);
      });

      it('une modification vers une identité présente ailleurs reste neutre', async () => {
        const body = { lastName: 'Sanogo', firstName: 'Bintou', birthDate: '2015-02-15' };
        const twin = await student(ownerA, a2.schoolId, body).expect(201);
        const own = await student(secretary, a1.schoolId, { birthDate: body.birthDate }).expect(
          201,
        );
        const res = await secretary
          .patch(`/api/v1/school/students/${own.body.id}`)
          .send({ lastName: body.lastName, firstName: body.firstName })
          .expect(409);
        expectNeutral(res.body, twin.body.id, twin.body.matricule);
      });

      it('un secrétariat couvrant les deux écoles ne confirme pas : il faut le droit de transfert', async () => {
        const body = { lastName: 'Cissé', firstName: 'Nana', birthDate: '2015-03-15' };
        await student(ownerA, a2.schoolId, body).expect(201);
        const both = await member(ownerA, 'SECRETARY', [a1.schoolId, a2.schoolId]);
        const res = await student(both.agent, a1.schoolId, {
          ...body,
          confirmHomonym: true,
        }).expect(409);
        expect(res.body.code).toBe('STUDENT_REVIEW_REQUIRED');
      });

      it('la direction du groupe constate le doublon et confirme un homonyme', async () => {
        const body = { lastName: 'Bagayoko', firstName: 'Mariam', birthDate: '2015-04-15' };
        const twin = await student(ownerA, a2.schoolId, body).expect(201);
        const seen = await student(ownerA, a1.schoolId, body).expect(409);
        expect(seen.body.code).toBe('STUDENT_DUPLICATE');
        expect(seen.body.details).toEqual([twin.body.id]);
        const other = await student(ownerA, a1.schoolId, {
          ...body,
          confirmHomonym: true,
        }).expect(201);
        expect(other.body.id).not.toBe(twin.body.id);
      });

      it('l’import signale la ligne en vérification, sans la compter comme doublon', async () => {
        const body = { lastName: 'Fofana', firstName: 'Djeneba', birthDate: '2015-05-15' };
        const twin = await student(ownerA, a2.schoolId, body).expect(201);
        const csv = Buffer.from('Nom;Prénom;Date de naissance\r\nFofana;Djeneba;15/05/2015\r\n');
        const res = await secretary
          .post('/api/v1/school/imports/preview')
          .field('schoolId', a1.schoolId)
          .attach('file', csv, 'e.csv')
          .expect(200);
        expect(res.body.duplicates).toEqual([]);
        expect(res.body.valid).toBe(0);
        expect(res.body.errors).toHaveLength(1);
        expect(res.body.errors[0]).toMatchObject({
          code: 'STUDENT_REVIEW_REQUIRED',
          message: NEUTRAL,
        });
        expect(JSON.stringify(res.body)).not.toContain(twin.body.id);
      });
    });

    it('le matricule ne change pas par une modification, seulement par une correction motivée', async () => {
      const created = await student(ownerA, a1.schoolId).expect(201);
      const id = created.body.id as string;
      await ownerA
        .patch(`/api/v1/school/students/${id}`)
        .send({ matricule: 'PIRATE-1' })
        .expect(400);
      await secretary
        .post(`/api/v1/school/students/${id}/matricule`)
        .send({ matricule: 'FIX-1', reason: 'Erreur de saisie' })
        .expect(403);
      const fixed = `FIX-${RUN}`;
      await ownerA
        .post(`/api/v1/school/students/${id}/matricule`)
        .send({ matricule: fixed, reason: 'Erreur de saisie' })
        .expect(200);
      const history = await ownerA.get(`/api/v1/school/students/${id}/history`).expect(200);
      const event = history.body.events.find(
        (e: { type: string }) => e.type === 'MATRICULE_CORRECTED',
      );
      expect(event.details).toMatchObject({ to: fixed, reason: 'Erreur de saisie' });
      const audit = await prisma.auditLog.count({
        where: { action: 'school.matricule_corrected', targetId: id },
      });
      expect(audit).toBe(1);
    });

    it('refuse un champ libre sensible, et une valeur hors des champs définis', async () => {
      const res = await ownerA
        .put(`/api/v1/school/student-settings?schoolId=${a1.schoolId}`)
        .send({
          matriculeScope: 'SCHOOL',
          matriculePrefix: '',
          matriculeYear: true,
          matriculePadding: 6,
          requiredDocuments: [],
          customFields: [{ key: 'culte', label: 'Religion' }],
        })
        .expect(400);
      expect(res.body.code).toBe('INVALID_CUSTOM_FIELDS');
      const unknown = await student(ownerA, a1.schoolId, {
        customFields: { inconnu: 'x' },
      }).expect(400);
      expect(unknown.body.code).toBe('CUSTOM_FIELD_UNKNOWN');
    });

    it('chiffre les besoins particuliers : illisibles en base, consultation journalisée', async () => {
      const created = await student(ownerA, a1.schoolId).expect(201);
      const id = created.body.id as string;
      const secret = 'Besoin fictif de test';
      await ownerA
        .put(`/api/v1/school/students/${id}/sensitive`)
        .send({ specialNeeds: secret })
        .expect(200);
      const row = await db.schoolStudent.findUniqueOrThrow({ where: { id } });
      expect(row.specialNeedsEnc).not.toContain(secret);
      const read = await ownerA.get(`/api/v1/school/students/${id}/sensitive`).expect(200);
      expect(read.body.specialNeeds).toBe(secret);
      expect(
        await prisma.auditLog.count({
          where: { action: 'school.student_sensitive_viewed', targetId: id },
        }),
      ).toBe(1);
      await secretary.get(`/api/v1/school/students/${id}/sensitive`).expect(403);
      const full = await secretary.get(`/api/v1/school/students/${id}`).expect(200);
      expect(JSON.stringify(full.body)).not.toContain(row.specialNeedsEnc);
    });
  });

  describe('inscriptions', () => {
    it('suit brouillon, attente, validation, et exige classe et responsable', async () => {
      const created = await student(secretary, a1.schoolId).expect(201);
      const id = created.body.id as string;
      const draft = await secretary
        .post('/api/v1/school/enrollments')
        .send({ studentId: id, schoolYearId: a1.yearId, levelId: a1.levelId })
        .expect(201);
      expect(draft.body).toMatchObject({ status: 'DRAFT', kind: 'NEW' });
      const url = `/api/v1/school/enrollments/${draft.body.id}/status`;
      const skip = await ownerA.post(url).send({ status: 'VALIDATED' }).expect(409);
      expect(skip.body.code).toBe('ENROLLMENT_TRANSITION_REFUSED');
      await secretary.post(url).send({ status: 'PENDING' }).expect(200);
      await secretary.post(url).send({ status: 'VALIDATED' }).expect(403);
      const noClass = await ownerA.post(url).send({ status: 'VALIDATED' }).expect(409);
      expect(noClass.body.code).toBe('ENROLLMENT_CLASS_REQUIRED');
      await secretary
        .post(`/api/v1/school/enrollments/${draft.body.id}/class`)
        .send({ classId: a1.classId })
        .expect(200);
      const noGuardian = await ownerA.post(url).send({ status: 'VALIDATED' }).expect(409);
      expect(noGuardian.body.code).toBe('ENROLLMENT_GUARDIAN_REQUIRED');
      const parent = await guardian(secretary, a1.schoolId).expect(201);
      await secretary
        .post(`/api/v1/school/students/${id}/guardians`)
        .send({ guardianId: parent.body.id, relation: 'MOTHER' })
        .expect(201);
      const ok = await ownerA.post(url).send({ status: 'VALIDATED' }).expect(200);
      expect(ok.body.status).toBe('VALIDATED');
      const after = await ownerA.get(`/api/v1/school/students/${id}`).expect(200);
      expect(after.body.status).toBe('ENROLLED');
    });

    it('refuse une seconde inscription active la même année', async () => {
      const { id } = await enrolled(ownerA, a1);
      const res = await ownerA
        .post('/api/v1/school/enrollments')
        .send({ studentId: id, schoolYearId: a1.yearId, levelId: a1.levelId })
        .expect(409);
      expect(res.body.code).toBe('ENROLLMENT_DUPLICATE');
    });

    it('PostgreSQL refuse lui-même deux affectations ouvertes la même année', async () => {
      const { id, enrollmentId } = await enrolled(ownerA, a1);
      const open = await db.schoolClassAssignment.findFirstOrThrow({
        where: { studentId: id, endedAt: null },
      });
      await expect(
        db.schoolClassAssignment.create({
          data: {
            organizationId: open.organizationId,
            enrollmentId,
            studentId: id,
            schoolYearId: a1.yearId,
            classId: a1.otherClassId,
            createdByUserId: open.createdByUserId,
          },
        }),
      ).rejects.toThrow();
    });

    it('réinscrit le même dossier une autre année, sans nouveau matricule', async () => {
      const { id } = await enrolled(ownerA, a1);
      const before = await ownerA.get(`/api/v1/school/students/${id}`).expect(200);
      const next = await ownerA
        .post('/api/v1/school/enrollments')
        .send({ studentId: id, schoolYearId: a1.nextYearId, levelId: a1.levelId })
        .expect(201);
      expect(next.body.kind).toBe('RENEWAL');
      const after = await ownerA.get(`/api/v1/school/students/${id}`).expect(200);
      expect(after.body.matricule).toBe(before.body.matricule);
      const all = await ownerA.get(`/api/v1/school/students/${id}/enrollments`).expect(200);
      expect(all.body).toHaveLength(2);
    });

    it('refuse une classe d’un autre niveau ou d’une autre année', async () => {
      const created = await student(ownerA, a1.schoolId).expect(201);
      const res = await ownerA
        .post('/api/v1/school/enrollments')
        .send({
          studentId: created.body.id,
          schoolYearId: a1.nextYearId,
          levelId: a1.levelId,
          classId: a1.classId,
        })
        .expect(400);
      expect(res.body.code).toBe('OTHER_SCHOOL');
    });

    it('exige les pièces obligatoires de l’établissement', async () => {
      const s = await structure(ownerA, `Pieces ${++counter}`);
      await ownerA
        .put(`/api/v1/school/student-settings?schoolId=${s.schoolId}`)
        .send({
          matriculeScope: 'SCHOOL',
          matriculePrefix: '',
          matriculeYear: true,
          matriculePadding: 6,
          requiredDocuments: ['BIRTH_CERTIFICATE'],
          customFields: [],
        })
        .expect(200);
      const created = await student(ownerA, s.schoolId).expect(201);
      const id = created.body.id as string;
      const parent = await guardian(ownerA, s.schoolId).expect(201);
      await ownerA
        .post(`/api/v1/school/students/${id}/guardians`)
        .send({ guardianId: parent.body.id, relation: 'FATHER' })
        .expect(201);
      const enrollment = await ownerA
        .post('/api/v1/school/enrollments')
        .send({
          studentId: id,
          schoolYearId: s.yearId,
          levelId: s.levelId,
          classId: s.classId,
          submit: true,
        })
        .expect(201);
      const url = `/api/v1/school/enrollments/${enrollment.body.id}/status`;
      const missing = await ownerA.post(url).send({ status: 'VALIDATED' }).expect(409);
      expect(missing.body.code).toBe('ENROLLMENT_DOCUMENTS_MISSING');
      await ownerA
        .post(`/api/v1/school/students/${id}/documents`)
        .field('category', 'BIRTH_CERTIFICATE')
        .attach('file', PDF, 'acte.pdf')
        .expect(201);
      await ownerA.post(url).send({ status: 'VALIDATED' }).expect(200);
    });
  });

  describe('classes et affectations', () => {
    it('change de classe en gardant l’historique, et met à jour les effectifs', async () => {
      const s = await structure(ownerA, `Mobilite ${++counter}`);
      const { id, enrollmentId } = await enrolled(ownerA, s);
      await ownerA
        .post(`/api/v1/school/enrollments/${enrollmentId}/class`)
        .send({ classId: s.classId })
        .expect(409);
      await ownerA
        .post(`/api/v1/school/enrollments/${enrollmentId}/class`)
        .send({ classId: s.otherClassId, reason: 'Décision pédagogique' })
        .expect(200);
      const history = await ownerA.get(`/api/v1/school/students/${id}/history`).expect(200);
      expect(history.body.assignments).toHaveLength(2);
      expect(history.body.assignments.filter((a: { endedAt: unknown }) => !a.endedAt)).toHaveLength(
        1,
      );
      const rosters = await ownerA
        .get(`/api/v1/school/rosters?schoolYearId=${s.yearId}`)
        .expect(200);
      const count = (classId: string) =>
        rosters.body.find((c: { id: string }) => c.id === classId).enrolled;
      expect(count(s.classId)).toBe(0);
      expect(count(s.otherClassId)).toBe(1);
      const list = await ownerA
        .get(`/api/v1/school/classes/${s.otherClassId}/students`)
        .expect(200);
      expect(list.body.students.map((e: { id: string }) => e.id)).toEqual([id]);
    });

    it('ne dépasse pas la capacité d’une classe, même sous validations simultanées', async () => {
      const s = await structure(ownerA, `Capacite ${++counter}`);
      const small = await ownerA
        .post('/api/v1/school/classes')
        .send({ schoolYearId: s.yearId, levelId: s.levelId, name: 'Petite', capacity: 1 })
        .expect(201);
      const pending: string[] = [];
      for (let i = 0; i < 3; i++) {
        const created = await student(ownerA, s.schoolId).expect(201);
        const parent = await guardian(ownerA, s.schoolId).expect(201);
        await ownerA
          .post(`/api/v1/school/students/${created.body.id}/guardians`)
          .send({ guardianId: parent.body.id, relation: 'OTHER' })
          .expect(201);
        const e = await ownerA
          .post('/api/v1/school/enrollments')
          .send({
            studentId: created.body.id,
            schoolYearId: s.yearId,
            levelId: s.levelId,
            classId: small.body.id,
            submit: true,
          })
          .expect(201);
        pending.push(e.body.id);
      }
      const results = await Promise.all(
        pending.map((id) =>
          ownerA.post(`/api/v1/school/enrollments/${id}/status`).send({ status: 'VALIDATED' }),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.body.code === 'CLASS_FULL')).toHaveLength(2);
    });

    it('gère départ et abandon : l’inscription se termine, le dossier reste', async () => {
      const { id, enrollmentId } = await enrolled(ownerA, a1);
      const res = await ownerA
        .post(`/api/v1/school/enrollments/${enrollmentId}/exit`)
        .send({ reason: 'DROPPED_OUT', exitedOn: '2026-12-01' })
        .expect(200);
      expect(res.body).toMatchObject({ status: 'ENDED', exitReason: 'DROPPED_OUT' });
      const after = await ownerA.get(`/api/v1/school/students/${id}`).expect(200);
      expect(after.body.status).toBe('DROPPED_OUT');
      const open = await db.schoolClassAssignment.count({
        where: { studentId: id, endedAt: null },
      });
      expect(open).toBe(0);
    });

    it('une sortie sur une année ne retire pas l’inscription validée de l’année suivante', async () => {
      const { id, enrollmentId } = await enrolled(ownerA, a1);
      const next = await ownerA
        .post('/api/v1/school/enrollments')
        .send({ studentId: id, schoolYearId: a1.nextYearId, levelId: a1.levelId, submit: true })
        .expect(201);
      const cls = await db.schoolClass.findFirstOrThrow({ where: { schoolYearId: a1.nextYearId } });
      await ownerA
        .post(`/api/v1/school/enrollments/${next.body.id}/class`)
        .send({ classId: cls.id })
        .expect(200);
      await ownerA
        .post(`/api/v1/school/enrollments/${next.body.id}/status`)
        .send({ status: 'VALIDATED' })
        .expect(200);
      await ownerA
        .post(`/api/v1/school/enrollments/${enrollmentId}/exit`)
        .send({ reason: 'LEFT', exitedOn: '2027-06-30' })
        .expect(200);
      const after = await ownerA.get(`/api/v1/school/students/${id}`).expect(200);
      expect(after.body.status).toBe('ENROLLED');
    });

    it('une année clôturée est figée, et l’enseignant perd l’accès à ses anciens élèves', async () => {
      const s = await structure(ownerA, `Cloture ${++counter}`);
      const prof = await member(ownerA, 'TEACHER', [s.schoolId]);
      const { id, enrollmentId } = await enrolled(ownerA, s);
      const created = await student(ownerA, s.schoolId).expect(201);
      const parent = await guardian(ownerA, s.schoolId).expect(201);
      await ownerA
        .post(`/api/v1/school/students/${created.body.id}/guardians`)
        .send({ guardianId: parent.body.id, relation: 'OTHER' })
        .expect(201);
      const pending = await ownerA
        .post('/api/v1/school/enrollments')
        .send({
          studentId: created.body.id,
          schoolYearId: s.yearId,
          levelId: s.levelId,
          classId: s.classId,
          submit: true,
        })
        .expect(201);
      await ownerA
        .post(`/api/v1/school/classes/${s.classId}/teachers`)
        .send({ memberId: prof.id })
        .expect(201);
      await prof.agent.get(`/api/v1/school/students/${id}`).expect(200);
      await ownerA
        .post(`/api/v1/school/years/${s.yearId}/status`)
        .send({ status: 'CLOSED' })
        .expect(200);
      const refused = await ownerA
        .post(`/api/v1/school/enrollments/${pending.body.id}/status`)
        .send({ status: 'VALIDATED' })
        .expect(409);
      expect(refused.body.code).toBe('SCHOOL_YEAR_CLOSED');
      await ownerA
        .post(`/api/v1/school/enrollments/${enrollmentId}/exit`)
        .send({ reason: 'LEFT', exitedOn: '2027-06-30' })
        .expect(409);
      const after = await ownerA.get(`/api/v1/school/students/${id}`).expect(200);
      expect(after.body.status).toBe('REGISTERED');
      expect(after.body.enrollment).toBeNull();
      expect(
        await db.schoolClassAssignment.count({ where: { studentId: id, endedAt: null } }),
      ).toBe(0);
      await prof.agent.get(`/api/v1/school/students/${id}`).expect(404);
    });

    it('après transfert : recherche à jour et responsable retiré de l’ancienne école', async () => {
      const s = await structure(ownerA, `Depart ${++counter}`);
      const secretaryOfS = await member(ownerA, 'SECRETARY', [s.schoolId]);
      const created = await student(ownerA, s.schoolId, { matricule: `DUP-${RUN}` }).expect(201);
      await student(ownerA, a2.schoolId, { matricule: `DUP-${RUN}` }).expect(201);
      const parent = await guardian(ownerA, s.schoolId, 'Parti').expect(201);
      await ownerA
        .post(`/api/v1/school/students/${created.body.id}/guardians`)
        .send({ guardianId: parent.body.id, relation: 'OTHER' })
        .expect(201);
      await secretaryOfS.agent.get('/api/v1/school/guardians?q=parti').expect(200);
      const res = await ownerA
        .post(`/api/v1/school/students/${created.body.id}/transfer`)
        .send({
          targetSchoolId: a2.schoolId,
          targetSchoolYearId: a2.yearId,
          targetLevelId: a2.levelId,
          effectiveOn: '2026-11-15',
          reason: 'Déménagement',
        })
        .expect(200);
      expect(res.body.matricule).not.toBe(`DUP-${RUN}`);
      const found = await ownerA
        .get(`/api/v1/school/students?schoolId=${a2.schoolId}&q=${res.body.matricule}`)
        .expect(200);
      expect(found.body.items.map((i: { id: string }) => i.id)).toEqual([created.body.id]);
      const seen = await secretaryOfS.agent.get('/api/v1/school/guardians?q=parti').expect(200);
      expect(seen.body).toEqual([]);
      await secretaryOfS.agent
        .patch(`/api/v1/school/guardians/${parent.body.id}`)
        .send({ phone: '+22370000009' })
        .expect(404);
    });

    it('le périmètre du matricule ne change plus une fois des dossiers créés', async () => {
      const s = await structure(ownerA, `Portee ${++counter}`);
      await student(ownerA, s.schoolId).expect(201);
      const res = await ownerA
        .put(`/api/v1/school/student-settings?schoolId=${s.schoolId}`)
        .send({
          matriculeScope: 'GROUP',
          matriculePrefix: '',
          matriculeYear: true,
          matriculePadding: 6,
          requiredDocuments: [],
          customFields: [],
        })
        .expect(409);
      expect(res.body.code).toBe('MATRICULE_SCOPE_LOCKED');
    });

    it('une modification ne crée ni doublon de personne, ni erreur serveur sur une valeur nulle', async () => {
      const body = { lastName: 'Dembélé', firstName: 'Oumou', birthDate: '2016-02-02' };
      await student(ownerA, a1.schoolId, body).expect(201);
      const other = await student(ownerA, a1.schoolId, { birthDate: '2016-02-02' }).expect(201);
      const dup = await ownerA
        .patch(`/api/v1/school/students/${other.body.id}`)
        .send({ lastName: 'Dembele', firstName: 'Oumou' })
        .expect(409);
      expect(dup.body.code).toBe('STUDENT_DUPLICATE');
      await ownerA
        .patch(`/api/v1/school/students/${other.body.id}`)
        .send({ lastName: null })
        .expect(400);
    });

    it('transfère dans le groupe : réservé à la direction et historisé', async () => {
      const { id } = await enrolled(ownerA, a1);
      const body = {
        targetSchoolId: a2.schoolId,
        targetSchoolYearId: a2.yearId,
        targetLevelId: a2.levelId,
        targetClassId: a2.classId,
        effectiveOn: '2026-11-15',
        reason: 'Déménagement',
      };
      await secretary.post(`/api/v1/school/students/${id}/transfer`).send(body).expect(403);
      const res = await ownerA
        .post(`/api/v1/school/students/${id}/transfer`)
        .send(body)
        .expect(200);
      expect(res.body.enrollment).toMatchObject({ status: 'PENDING', kind: 'TRANSFER_IN' });
      const all = await ownerA.get(`/api/v1/school/students/${id}/enrollments`).expect(200);
      expect(all.body.map((e: { status: string }) => e.status).sort()).toEqual([
        'ENDED',
        'PENDING',
      ]);
      await secretary.get(`/api/v1/school/students/${id}`).expect(404);
      const history = await ownerA.get(`/api/v1/school/students/${id}/history`).expect(200);
      expect(history.body.events.some((e: { type: string }) => e.type === 'TRANSFERRED')).toBe(
        true,
      );
    });

    it('refuse un transfert vers un autre client', async () => {
      const { id } = await enrolled(ownerA, a1);
      await ownerA
        .post(`/api/v1/school/students/${id}/transfer`)
        .send({
          targetSchoolId: b1.schoolId,
          targetSchoolYearId: b1.yearId,
          targetLevelId: b1.levelId,
          effectiveOn: '2026-11-15',
          reason: 'Tentative',
        })
        .expect(404);
    });
  });

  describe('responsables', () => {
    it('rattache plusieurs responsables à un élève, un seul principal', async () => {
      const created = await student(ownerA, a1.schoolId).expect(201);
      const id = created.body.id as string;
      const mother = await guardian(ownerA, a1.schoolId, 'Mère').expect(201);
      const father = await guardian(ownerA, a1.schoolId, 'Père').expect(201);
      await ownerA
        .post(`/api/v1/school/students/${id}/guardians`)
        .send({ guardianId: mother.body.id, relation: 'MOTHER' })
        .expect(201);
      const both = await ownerA
        .post(`/api/v1/school/students/${id}/guardians`)
        .send({ guardianId: father.body.id, relation: 'FATHER', isPrimary: true, canPickUp: true })
        .expect(201);
      expect(both.body).toHaveLength(2);
      expect(both.body.filter((l: { isPrimary: boolean }) => l.isPrimary)).toHaveLength(1);
      expect(both.body[0].guardian.id).toBe(father.body.id);
      expect(both.body[0].canReceiveSms).toBe(false);
    });

    it('accepte un responsable sans e-mail', async () => {
      const res = await guardian(ownerA, a1.schoolId).expect(201);
      expect(res.body.email).toBeNull();
    });

    it('lie un responsable à plusieurs enfants, droits vérifiés enfant par enfant', async () => {
      const parent = await guardian(ownerA, a1.schoolId, 'Fratrie').expect(201);
      const child1 = await student(ownerA, a1.schoolId).expect(201);
      const child2 = await student(ownerA, a1.schoolId).expect(201);
      const other = await student(ownerA, a1.schoolId).expect(201);
      await ownerA
        .post(`/api/v1/school/students/${child1.body.id}/guardians`)
        .send({ guardianId: parent.body.id, relation: 'FATHER', canViewSchoolInfo: true })
        .expect(201);
      await ownerA
        .post(`/api/v1/school/students/${child2.body.id}/guardians`)
        .send({ guardianId: parent.body.id, relation: 'FATHER' })
        .expect(201);
      const found = await ownerA.get('/api/v1/school/guardians?q=fratrie').expect(200);
      expect(found.body[0].links).toHaveLength(2);
      const allowed = await app
        .get(SchoolGuardiansService)
        .authorizedStudentIds(organizations[0]!, parent.body.id);
      expect(allowed).toEqual([child1.body.id]);
      expect(allowed).not.toContain(child2.body.id);
      expect(allowed).not.toContain(other.body.id);
      await ownerA
        .patch(`/api/v1/school/students/${child2.body.id}/guardians/${parent.body.id}`)
        .send({ canViewSchoolInfo: true })
        .expect(200);
      expect(
        (
          await app
            .get(SchoolGuardiansService)
            .authorizedStudentIds(organizations[0]!, parent.body.id)
        ).sort(),
      ).toEqual([child1.body.id, child2.body.id].sort());
    });

    it('un élève inscrit garde au moins un responsable', async () => {
      const { id } = await enrolled(ownerA, a1);
      const links = await ownerA.get(`/api/v1/school/students/${id}/guardians`).expect(200);
      const res = await ownerA
        .delete(`/api/v1/school/students/${id}/guardians/${links.body[0].guardian.id}`)
        .expect(409);
      expect(res.body.code).toBe('LAST_GUARDIAN');
    });
  });

  describe('isolation et droits', () => {
    it('isole deux écoles du même client', async () => {
      const inA2 = await student(ownerA, a2.schoolId).expect(201);
      await secretary.get(`/api/v1/school/students/${inA2.body.id}`).expect(404);
      await student(secretary, a2.schoolId).expect(404);
      const list = await secretary.get('/api/v1/school/students?pageSize=100').expect(200);
      expect(list.body.items.every((s: { schoolId: string }) => s.schoolId === a1.schoolId)).toBe(
        true,
      );
      await secretary.get(`/api/v1/school/students?schoolId=${a2.schoolId}`).expect(404);
      const parent = await guardian(ownerA, a2.schoolId, 'Cloisonne').expect(201);
      const found = await secretary.get('/api/v1/school/guardians?q=cloisonne').expect(200);
      expect(found.body).toEqual([]);
      await secretary
        .patch(`/api/v1/school/guardians/${parent.body.id}`)
        .send({ phone: '+22370000009' })
        .expect(404);
    });

    it('isole deux clients sur chaque type de ressource', async () => {
      const { id, enrollmentId } = await enrolled(ownerA, a1);
      const doc = await ownerA
        .post(`/api/v1/school/students/${id}/documents`)
        .field('category', 'OTHER')
        .attach('file', PDF, 'piece.pdf')
        .expect(201);
      const parent = await guardian(ownerA, a1.schoolId).expect(201);
      await ownerB.get(`/api/v1/school/students/${id}`).expect(404);
      await ownerB.patch(`/api/v1/school/students/${id}`).send({ address: 'x' }).expect(404);
      await ownerB.get(`/api/v1/school/students/${id}/guardians`).expect(404);
      await ownerB.get(`/api/v1/school/students/${id}/documents`).expect(404);
      await ownerB.get(`/api/v1/school/students/${id}/documents/${doc.body.id}/link`).expect(404);
      await ownerB.delete(`/api/v1/school/students/${id}/documents/${doc.body.id}`).expect(404);
      await ownerB
        .post(`/api/v1/school/enrollments/${enrollmentId}/status`)
        .send({ status: 'CANCELLED', note: 'x' })
        .expect(404);
      await ownerB.get(`/api/v1/school/classes/${a1.classId}/students`).expect(404);
      await ownerB
        .patch(`/api/v1/school/guardians/${parent.body.id}`)
        .send({ phone: '+22370000009' })
        .expect(404);
      const mine = await student(ownerB, b1.schoolId).expect(201);
      await ownerB
        .post(`/api/v1/school/students/${mine.body.id}/guardians`)
        .send({ guardianId: parent.body.id, relation: 'OTHER' })
        .expect(404);
      await ownerB
        .post('/api/v1/school/enrollments')
        .send({ studentId: mine.body.id, schoolYearId: a1.yearId, levelId: a1.levelId })
        .expect(400);
      const list = await ownerB.get('/api/v1/school/students?pageSize=100').expect(200);
      expect(list.body.items.map((s: { id: string }) => s.id)).not.toContain(id);
    });

    it('PostgreSQL refuse un lien direct entre deux clients', async () => {
      const student1 = await student(ownerA, a1.schoolId).expect(201);
      const foreign = await guardian(ownerB, b1.schoolId).expect(201);
      await expect(
        db.schoolStudentGuardian.create({
          data: {
            organizationId: organizations[0]!,
            studentId: student1.body.id,
            guardianId: foreign.body.id,
            relation: 'OTHER',
          },
        }),
      ).rejects.toThrow();
    });

    it('enseignant : seulement ses classes, et la liste restreinte', async () => {
      const inClass = await enrolled(ownerA, a1);
      const notInClass = await enrolled(ownerA, a1, a1.otherClassId);
      await ownerA
        .post(`/api/v1/school/classes/${a1.classId}/teachers`)
        .send({ memberId: teacherId })
        .expect(201);
      const seen = await teacher.get(`/api/v1/school/students/${inClass.id}`).expect(200);
      expect(seen.body).not.toHaveProperty('birthDate');
      expect(seen.body).not.toHaveProperty('address');
      await teacher.get(`/api/v1/school/students/${notInClass.id}`).expect(404);
      await teacher.get(`/api/v1/school/classes/${a1.otherClassId}/students`).expect(404);
      await teacher.get(`/api/v1/school/classes/${a1.classId}/students`).expect(200);
      const list = await teacher.get('/api/v1/school/students?pageSize=100').expect(200);
      const ids = list.body.items.map((s: { id: string }) => s.id);
      expect(ids).toContain(inClass.id);
      expect(ids).not.toContain(notInClass.id);
      await teacher.get(`/api/v1/school/students/${inClass.id}/guardians`).expect(403);
      await teacher.get(`/api/v1/school/students/${inClass.id}/documents`).expect(403);
      await teacher.get(`/api/v1/school/students/${inClass.id}/sensitive`).expect(403);
      await teacher
        .patch(`/api/v1/school/students/${inClass.id}`)
        .send({ address: 'x' })
        .expect(403);
      await teacher.get(`/api/v1/school/exports/students?schoolId=${a1.schoolId}`).expect(403);
      await teacher.get('/api/v1/school/students/dashboard').expect(403);
    });

    it('comptable : ni dossier complet, ni responsables, ni documents', async () => {
      const { id } = await enrolled(ownerA, a1);
      const seen = await accountant.get(`/api/v1/school/students/${id}`).expect(200);
      expect(seen.body).not.toHaveProperty('birthDate');
      await accountant.get(`/api/v1/school/students/${id}/guardians`).expect(403);
      await accountant.get(`/api/v1/school/students/${id}/documents`).expect(403);
      await accountant.get(`/api/v1/school/students/${id}/history`).expect(403);
    });

    it('Super Admin Ocall : aucune consultation libre des dossiers', async () => {
      const { id } = await enrolled(ownerA, a1);
      const denied = await platform.agent.get(`/api/v1/school/students/${id}`);
      expect([401, 403, 404]).toContain(denied.status);
      expect(denied.body).not.toHaveProperty('matricule');
      const names = await platform.agent
        .get(`/api/v1/platform/school-organizations/${organizations[0]}/schools`)
        .expect(200);
      expect(JSON.stringify(names.body)).not.toContain('matricule');
    });

    it('client Ocall Park : aucun accès aux élèves', async () => {
      const res = await park.agent.get('/api/v1/school/students').expect(403);
      expect(res.body.code).toBe('PRODUCT_NOT_ENABLED');
    });
  });

  describe('documents', () => {
    it('télécharge par lien temporaire, journalisé, en pièce jointe', async () => {
      const created = await student(ownerA, a1.schoolId).expect(201);
      const id = created.body.id as string;
      const doc = await ownerA
        .post(`/api/v1/school/students/${id}/documents`)
        .field('category', 'BIRTH_CERTIFICATE')
        .attach('file', PDF, '../../acte de naissance.pdf')
        .expect(201);
      expect(doc.body.displayName).toBe('acte de naissance.pdf');
      const arabicName = await ownerA
        .post(`/api/v1/school/students/${id}/documents`)
        .field('category', 'OTHER')
        .attach('file', PDF, 'شهادة.pdf')
        .expect(201);
      expect(arabicName.body.displayName).toBe('شهادة.pdf');
      expect(doc.body).not.toHaveProperty('storageKey');
      const link = await ownerA
        .get(`/api/v1/school/students/${id}/documents/${doc.body.id}/link`)
        .expect(200);
      const anonymous = await login(app, 'absent@test.ocallpark.local', 'x');
      const file = await anonymous.agent.get(link.body.url).expect(200);
      expect(file.headers['content-disposition']).toContain('attachment');
      expect(file.headers['cache-control']).toContain('no-store');
      expect(file.headers['x-content-type-options']).toBe('nosniff');
      expect(
        await prisma.auditLog.count({
          where: { action: 'school.document_downloaded', targetId: doc.body.id },
        }),
      ).toBe(1);
      await anonymous.agent.get(`${link.body.url}x`).expect(404);
      await anonymous.agent.get(`/api/v1/files/${link.body.url.split('/').pop()}`).expect(404);
    });

    it('refuse un faux PDF, un exécutable, un PDF actif et une photo PDF', async () => {
      const created = await student(ownerA, a1.schoolId).expect(201);
      const url = `/api/v1/school/students/${created.body.id}/documents`;
      const fake = await ownerA
        .post(url)
        .field('category', 'OTHER')
        .attach('file', Buffer.from('MZ exécutable'), 'facture.pdf')
        .expect(400);
      expect(fake.body.code).toBe('FILE_TYPE_REFUSED');
      const active = await ownerA
        .post(url)
        .field('category', 'OTHER')
        .attach('file', Buffer.from('%PDF-1.7 /JavaScript (app.alert())'), 'a.pdf')
        .expect(400);
      expect(active.body.code).toBe('FILE_ACTIVE_CONTENT');
      await ownerA
        .post(url)
        .field('category', 'PHOTO')
        .attach('file', PDF, 'photo.pdf')
        .expect(400);
      await ownerA
        .post(url)
        .field('category', 'PHOTO')
        .attach('file', PNG, 'photo.png')
        .expect(201);
      await ownerA
        .post(url)
        .field('category', 'INVENTE')
        .attach('file', PNG, 'photo.png')
        .expect(400);
    });

    it('un document supprimé n’est plus accessible ; seule la direction supprime', async () => {
      const created = await student(ownerA, a1.schoolId).expect(201);
      const id = created.body.id as string;
      const doc = await secretary
        .post(`/api/v1/school/students/${id}/documents`)
        .field('category', 'OTHER')
        .attach('file', PDF, 'piece.pdf')
        .expect(201);
      const url = `/api/v1/school/students/${id}/documents/${doc.body.id}`;
      const link = await ownerA.get(`${url}/link`).expect(200);
      await secretary.delete(url).expect(403);
      await ownerA.delete(url).expect(204);
      await ownerA.get(link.body.url).expect(404);
      const list = await ownerA.get(`/api/v1/school/students/${id}/documents`).expect(200);
      expect(list.body).toEqual([]);
      const row = await db.schoolStudentDocument.findUniqueOrThrow({ where: { id: doc.body.id } });
      expect(row.deletedAt).not.toBeNull();
    });
  });

  describe('import et export', () => {
    const csvLine = (i: number) =>
      `Koné${i};Ibrahim;الكوني;إبراهيم;14/03/2017;Ségou;M;CP1;CP1 A;Koné;Seydou;+223 70 11 22 3${i}`;
    const HEADER =
      'Nom;Prénom;Nom en arabe;Prénom en arabe;Date de naissance;Lieu de naissance;Sexe;Niveau;Classe;Nom du responsable;Prénom du responsable;Téléphone du responsable';

    const upload = (
      agent: Agent,
      url: string,
      content: Buffer,
      name: string,
      fields: Record<string, string>,
    ) => {
      let req = agent.post(url);
      for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
      return req.attach('file', content, name);
    };

    it('importe un CSV en deux temps, arabe compris, sans doublon au second envoi', async () => {
      const s = await structure(ownerA, `Import ${++counter}`);
      const fields = { schoolId: s.schoolId, schoolYearId: s.yearId };
      const csv = Buffer.from(
        `\uFEFF${HEADER}\r\n${csvLine(1)}\r\n${csvLine(2)}\r\n;Sans nom;;;01/01/2017;;;;;;;\r\nX;Y;;;31/02/2017;;;;;;;\r\n`,
      );
      const preview = await upload(
        ownerA,
        '/api/v1/school/imports/preview',
        csv,
        'e.csv',
        fields,
      ).expect(200);
      expect(preview.body).toMatchObject({ format: 'CSV', total: 4, valid: 2 });
      expect(preview.body.errors.map((e: { line: number }) => e.line)).toEqual([4, 5]);
      expect(preview.body.sample[0].firstNameAr).toBe('إبراهيم');
      expect(await db.schoolStudent.count({ where: { schoolId: s.schoolId } })).toBe(0);

      const refused = await upload(ownerA, '/api/v1/school/imports', csv, 'e.csv', fields).expect(
        409,
      );
      expect(refused.body.code).toBe('IMPORT_HAS_ERRORS');
      expect(await db.schoolStudent.count({ where: { schoolId: s.schoolId } })).toBe(0);

      const done = await upload(ownerA, '/api/v1/school/imports', csv, 'e.csv', {
        ...fields,
        skipInvalid: 'true',
      }).expect(201);
      expect(done.body).toMatchObject({ createdRows: 2, errorRows: 2, duplicateRows: 0 });
      expect(JSON.stringify(done.body.report)).not.toContain('Koné');

      const rows = await db.schoolStudent.findMany({ where: { schoolId: s.schoolId } });
      expect(rows.map((r) => r.firstNameAr)).toEqual(['إبراهيم', 'إبراهيم']);
      const enrollments = await db.schoolEnrollment.findMany({ where: { schoolId: s.schoolId } });
      expect(enrollments.every((e) => e.status === 'PENDING' && e.classId === s.classId)).toBe(
        true,
      );
      expect(await db.schoolStudentGuardian.count({ where: { studentId: rows[0]!.id } })).toBe(1);

      const again = await upload(ownerA, '/api/v1/school/imports', csv, 'e.csv', {
        ...fields,
        skipInvalid: 'true',
      }).expect(201);
      expect(again.body).toMatchObject({ createdRows: 0, duplicateRows: 2 });
      const history = await ownerA.get(`/api/v1/school/imports?schoolId=${s.schoolId}`).expect(200);
      expect(history.body).toHaveLength(2);
    });

    it('importe un XLSX avec correspondance de colonnes personnalisée et matricule existant', async () => {
      const s = await structure(ownerA, `Xlsx ${++counter}`);
      const book = new Workbook();
      const sheet = book.addWorksheet('Élèves');
      sheet.addRow(['Famille', 'Prenom usuel', 'Ne(e)', 'N°', 'عربي']);
      sheet.addRow([
        'Coulibaly',
        'Rokia',
        new Date('2016-09-01T00:00:00.000Z'),
        `OLD-${RUN}`,
        'روكيا',
      ]);
      const buffer = Buffer.from(await book.xlsx.writeBuffer());
      const mapping = JSON.stringify({
        lastName: 'Famille',
        firstName: 'Prenom usuel',
        birthDate: 'Ne(e)',
        matricule: 'N°',
        firstNameAr: 'عربي',
      });
      const done = await upload(ownerA, '/api/v1/school/imports', buffer, 'e.xlsx', {
        schoolId: s.schoolId,
        mapping,
      }).expect(201);
      expect(done.body).toMatchObject({ format: 'XLSX', createdRows: 1 });
      const row = await db.schoolStudent.findFirstOrThrow({ where: { schoolId: s.schoolId } });
      expect(row.matricule).toBe(`OLD-${RUN}`);
      expect(row.firstNameAr).toBe('روكيا');
      expect(row.birthDate.toISOString().slice(0, 10)).toBe('2016-09-01');
    });

    it('refuse un fichier qui n’est pas un tableau', async () => {
      const res = await upload(
        ownerA,
        '/api/v1/school/imports/preview',
        Buffer.concat([Buffer.from([0x4d, 0x5a, 0, 0]), Buffer.alloc(20)]),
        'e.csv',
        { schoolId: a1.schoolId },
      ).expect(400);
      expect(res.body.code).toBe('IMPORT_FILE_INVALID');
    });

    it('n’importe pas pour une école hors périmètre ou un autre client', async () => {
      const csv = Buffer.from(`${HEADER}\n${csvLine(3)}\n`);
      await upload(secretary, '/api/v1/school/imports', csv, 'e.csv', {
        schoolId: a2.schoolId,
      }).expect(404);
      await upload(ownerB, '/api/v1/school/imports', csv, 'e.csv', {
        schoolId: a1.schoolId,
      }).expect(404);
      await upload(teacher, '/api/v1/school/imports', csv, 'e.csv', {
        schoolId: a1.schoolId,
      }).expect(403);
    });

    it('recherche sur les noms français et arabes, avec ou sans diacritiques', async () => {
      const s = await structure(ownerA, `Recherche ${++counter}`);
      const created = await student(ownerA, s.schoolId, {
        lastName: 'Traoré',
        firstName: 'Fatoumata',
        lastNameAr: AR_LAST,
        firstNameAr: AR_FIRST,
      }).expect(201);
      for (const q of ['traore', 'TRAORÉ fato', 'فاطمه', AR_FIRST, created.body.matricule]) {
        const res = await ownerA
          .get(`/api/v1/school/students?schoolId=${s.schoolId}&q=${encodeURIComponent(q)}`)
          .expect(200);
        expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([created.body.id]);
      }
      const none = await ownerA
        .get(`/api/v1/school/students?schoolId=${s.schoolId}&q=inexistant`)
        .expect(200);
      expect(none.body.total).toBe(0);
    });

    it('exporte en CSV et XLSX avec l’arabe intact et les colonnes limitées', async () => {
      const s = await structure(ownerA, `Export ${++counter}`);
      const created = await student(ownerA, s.schoolId, {
        lastNameAr: AR_LAST,
        firstNameAr: AR_FIRST,
        address: 'Adresse confidentielle',
        adminNotes: 'Note confidentielle',
      }).expect(201);
      await ownerA
        .put(`/api/v1/school/students/${created.body.id}/sensitive`)
        .send({ specialNeeds: 'Besoin confidentiel' })
        .expect(200);
      const csv = await ownerA
        .get(`/api/v1/school/exports/students?schoolId=${s.schoolId}`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      const text = (csv.body as Buffer).toString('utf8');
      expect(text.charCodeAt(0)).toBe(0xfeff);
      expect(text).toContain(AR_FIRST);
      expect(text).not.toContain('confidentiel');
      expect(csv.headers['content-disposition']).toContain('attachment');

      const xlsx = await ownerA
        .get(`/api/v1/school/exports/students?schoolId=${s.schoolId}&format=xlsx`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      const book = new Workbook();
      await book.xlsx.load(xlsx.body as unknown as ArrayBuffer);
      expect(book.worksheets[0]!.getRow(2).getCell(5).value).toBe(AR_FIRST);
      expect(
        await prisma.auditLog.count({
          where: { action: 'school.students_exported', targetId: s.schoolId },
        }),
      ).toBe(2);
    });

    it('la liste d’une classe ne contient que ses élèves', async () => {
      const s = await structure(ownerA, `Liste ${++counter}`);
      await enrolled(ownerA, s);
      await enrolled(ownerA, s, s.otherClassId);
      const res = await ownerA
        .get(`/api/v1/school/exports/students?schoolId=${s.schoolId}&classId=${s.classId}`)
        .expect(200);
      expect(res.text.trim().split('\r\n')).toHaveLength(2);
    });
  });

  describe('tableau de bord', () => {
    it('ne compte que le périmètre du rôle', async () => {
      const s = await structure(ownerA, `Tableau ${++counter}`);
      await enrolled(ownerA, s);
      const created = await student(ownerA, s.schoolId).expect(201);
      await ownerA
        .post('/api/v1/school/enrollments')
        .send({
          studentId: created.body.id,
          schoolYearId: s.yearId,
          levelId: s.levelId,
          submit: true,
        })
        .expect(201);
      const dash = await ownerA
        .get(`/api/v1/school/students/dashboard?schoolId=${s.schoolId}`)
        .expect(200);
      expect(dash.body).toMatchObject({ students: 2, enrolled: 1, pending: 1, recent: 1 });
      // Une réinscription validée sur une autre année ne double pas l'effectif.
      const renewed = await db.schoolEnrollment.findFirstOrThrow({
        where: { schoolId: s.schoolId, status: 'VALIDATED' },
      });
      const nextClass = await db.schoolClass.findFirstOrThrow({
        where: { schoolYearId: s.nextYearId },
      });
      const again = await ownerA
        .post('/api/v1/school/enrollments')
        .send({
          studentId: renewed.studentId,
          schoolYearId: s.nextYearId,
          levelId: s.levelId,
          classId: nextClass.id,
          submit: true,
        })
        .expect(201);
      await ownerA
        .post(`/api/v1/school/enrollments/${again.body.id}/status`)
        .send({ status: 'VALIDATED' })
        .expect(200);
      const after = await ownerA
        .get(`/api/v1/school/students/dashboard?schoolId=${s.schoolId}`)
        .expect(200);
      expect(after.body.enrolled).toBe(1);
      expect(dash.body.byLevel[0]).toMatchObject({ name: 'CP1', count: 1 });
      expect(dash.body.byClass[0]).toMatchObject({ name: 'CP1 A', count: 1 });
      await secretary.get(`/api/v1/school/students/dashboard?schoolId=${s.schoolId}`).expect(404);
    });
  });

  describe('contrat suspendu', () => {
    it('lecture et export restent possibles, aucune écriture, aucune suppression de données', async () => {
      const s = await structure(ownerA, `Lecture ${++counter}`);
      const { id, enrollmentId } = await enrolled(ownerA, s);
      const doc = await ownerA
        .post(`/api/v1/school/students/${id}/documents`)
        .field('category', 'OTHER')
        .attach('file', PDF, 'piece.pdf')
        .expect(201);
      await platform.agent
        .post(`/api/v1/platform/contracts/${contractA}/status`)
        .send({ status: 'SUSPENDED', reason: 'Décision de test' })
        .expect(200);
      try {
        await ownerA.get(`/api/v1/school/students/${id}`).expect(200);
        await ownerA.get(`/api/v1/school/students/${id}/guardians`).expect(200);
        const link = await ownerA
          .get(`/api/v1/school/students/${id}/documents/${doc.body.id}/link`)
          .expect(200);
        await ownerA.get(link.body.url).expect(200);
        await ownerA.get(`/api/v1/school/exports/students?schoolId=${s.schoolId}`).expect(200);
        const writes = await Promise.all([
          student(ownerA, s.schoolId),
          ownerA.patch(`/api/v1/school/students/${id}`).send({ address: 'x' }),
          ownerA
            .post(`/api/v1/school/enrollments/${enrollmentId}/exit`)
            .send({ reason: 'LEFT', exitedOn: '2026-12-01' }),
          ownerA.delete(`/api/v1/school/students/${id}/documents/${doc.body.id}`),
          guardian(ownerA, s.schoolId),
        ]);
        for (const res of writes) {
          expect(res.status).toBe(403);
          expect(res.body.code).toBe('CONTRACT_READ_ONLY');
        }
      } finally {
        await platform.agent
          .post(`/api/v1/platform/contracts/${contractA}/status`)
          .send({ status: 'ACTIVE', reason: 'Décision de test' })
          .expect(200);
      }
    });
  });
});
