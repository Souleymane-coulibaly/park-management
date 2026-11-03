import { Workbook } from 'exceljs';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { AuditService } from '../src/common/audit/audit.service';
import { SchoolEnrollmentsService } from '../src/modules/school/school-enrollments.service';
import { SchoolGuardiansService } from '../src/modules/school/school-guardians.service';
import { SchoolImportsService } from '../src/modules/school/school-imports.service';
import { SchoolStudentsController } from '../src/modules/school/school-students.controller';
import { SchoolPrismaService } from '../src/modules/school/school-prisma.service';
import { SchoolMembersService } from '../src/modules/school/school-members.service';
import { SchoolStudentsService } from '../src/modules/school/school-students.service';
import { SchoolService } from '../src/modules/school/school.service';
import { SuiteContractsService } from '../src/modules/suite-contracts/suite-contracts.service';
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
const suite =
  (process.env.SCHOOL_TEST_DATABASE_URL ?? process.env.TEST_SCHOOL_DATABASE_URL)
    ? describe
    : describe.skip;

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
      loginId: res.body.member.loginId as string,
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
    await db.academicPeriod.deleteMany({ where });
    await db.schoolAccessDecision.deleteMany({ where });
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
      await anonymous.agent.get(link.body.url).expect(401);
      const file = await ownerA.get(link.body.url).expect(200);
      expect(file.headers['content-disposition']).toContain('attachment');
      expect(file.headers['cache-control']).toContain('no-store');
      expect(file.headers['x-content-type-options']).toBe('nosniff');
      expect(
        await prisma.auditLog.count({
          where: { action: 'school.document_downloaded', targetId: doc.body.id },
        }),
      ).toBe(1);
      await ownerA.get(`${link.body.url}x`).expect(404);
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
      expect(enrollments).toHaveLength(2);
      expect(enrollments.map((e) => e.studentId).sort()).toEqual(rows.map((r) => r.id).sort());
      for (const e of enrollments) {
        expect(e).toMatchObject({ status: 'PENDING', classId: s.classId, schoolYearId: s.yearId });
      }
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

    it('S2-IMP-01 : des en-têtes inconnus restent configurables, sans rien enregistrer', async () => {
      const s = await structure(ownerA, `Entetes ${++counter}`);
      const csv = Buffer.from('Family;Given;DOB\nSangaré;Oumou;05/06/2017\n');
      const fields = { schoolId: s.schoolId };
      const preview = await upload(
        ownerA,
        '/api/v1/school/imports/preview',
        csv,
        'e.csv',
        fields,
      ).expect(200);
      expect(preview.body).toMatchObject({
        headers: ['Family', 'Given', 'DOB'],
        missing: ['lastName', 'firstName', 'birthDate'],
        total: 1,
        valid: 0,
      });
      // L'enregistrement, lui, exige toujours une correspondance complète.
      const refused = await upload(ownerA, '/api/v1/school/imports', csv, 'e.csv', fields).expect(
        400,
      );
      expect(refused.body.code).toBe('IMPORT_MAPPING_INCOMPLETE');
      const mapping = JSON.stringify({ lastName: 'Family', firstName: 'Given', birthDate: 'DOB' });
      const mapped = await upload(ownerA, '/api/v1/school/imports/preview', csv, 'e.csv', {
        ...fields,
        mapping,
      }).expect(200);
      expect(mapped.body).toMatchObject({ missing: [], valid: 1 });
      expect(await db.schoolStudent.count({ where: { schoolId: s.schoolId } })).toBe(0);
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

    it('S2-EXP-01 : exports soumis au limiteur dédié, au plafond de lignes et aux places', async () => {
      const proto = SchoolStudentsController.prototype;
      for (const route of [proto.exportStudents, proto.exportGuardians]) {
        expect(Reflect.getMetadata('exportRoute', route)).toBe(true);
      }
      const s = await structure(ownerA, `Plafond ${++counter}`);
      const imports = app.get(SchoolImportsService) as unknown as {
        exportMaxRows: number;
        exportsRunning: number;
      };
      const max = imports.exportMaxRows;
      imports.exportMaxRows = 0;
      try {
        // Un export vide ne dépasse aucun plafond.
        for (const kind of ['students', 'guardians']) {
          await ownerA.get(`/api/v1/school/exports/${kind}?schoolId=${s.schoolId}`).expect(200);
        }
      } finally {
        imports.exportMaxRows = max;
      }
      // Un élève avec son responsable dans chacune des deux classes.
      await enrolled(ownerA, s);
      await enrolled(ownerA, s, s.otherClassId);
      const before = await prisma.auditLog.count({ where: { targetId: s.schoolId } });
      imports.exportMaxRows = 1;
      try {
        for (const kind of ['students', 'guardians']) {
          const res = await ownerA
            .get(`/api/v1/school/exports/${kind}?schoolId=${s.schoolId}&format=xlsx`)
            .expect(422);
          expect(res.body.code).toBe('EXPORT_TOO_LARGE');
        }
        expect(await prisma.auditLog.count({ where: { targetId: s.schoolId } })).toBe(before);
        // S2-EXP-02 : le fractionnement conseillé par le refus fonctionne aussi pour les responsables.
        for (const kind of ['students', 'guardians']) {
          const res = await ownerA
            .get(`/api/v1/school/exports/${kind}?schoolId=${s.schoolId}&classId=${s.classId}`)
            .expect(200);
          expect(res.text.trim().split('\r\n')).toHaveLength(2);
        }
      } finally {
        imports.exportMaxRows = max;
      }
      const afterSplit = await prisma.auditLog.count({ where: { targetId: s.schoolId } });
      imports.exportsRunning = 2;
      try {
        const busy = await ownerA
          .get(`/api/v1/school/exports/students?schoolId=${s.schoolId}`)
          .expect(429);
        expect(busy.body.code).toBe('EXPORT_BUSY');
      } finally {
        imports.exportsRunning = 0;
      }
      // Refusé avant tout fichier : aucun export n'est journalisé.
      expect(await prisma.auditLog.count({ where: { targetId: s.schoolId } })).toBe(afterSplit);
      await ownerA.get(`/api/v1/school/exports/students?schoolId=${s.schoolId}`).expect(200);
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

  describe('révocation : les droits sont revérifiés à chaque accès au document', () => {
    /** Un membre, un document et un lien valide, téléchargeable une première fois. */
    async function issued(role = 'SECRETARY', extraSchools: string[] = []) {
      const s = await structure(ownerA, `Acces ${++counter}`);
      const staff = await member(ownerA, role, [s.schoolId, ...extraSchools]);
      const created = await student(ownerA, s.schoolId).expect(201);
      const url = `/api/v1/school/students/${created.body.id}/documents`;
      const doc = await ownerA
        .post(url)
        .field('category', 'OTHER')
        .attach('file', PDF, 'p.pdf')
        .expect(201);
      const link = await staff.agent.get(`${url}/${doc.body.id}/link`).expect(200);
      await staff.agent.get(link.body.url).expect(200);
      return {
        s,
        staff,
        studentId: created.body.id as string,
        documentId: doc.body.id as string,
        file: link.body.url as string,
      };
    }

    it('sans session, le lien ne donne rien', async () => {
      const { file } = await issued();
      await signup(app, `anon${++counter}`, 'PARK').then((p) => p.agent.get(file).expect(403));
      await request(app.getHttpServer()).get(file).expect(401);
    });

    it('un autre utilisateur, même habilité, ne peut pas se servir du lien', async () => {
      const { s, file } = await issued();
      const other = await member(ownerA, 'SECRETARY', [s.schoolId]);
      await other.agent.get(file).expect(404);
      await ownerA.get(file).expect(404);
    });

    it('un autre client ne peut pas se servir du lien', async () => {
      const { file } = await issued();
      await ownerB.get(file).expect(404);
    });

    it('un transfert de l’élève ferme aussitôt le lien déjà délivré', async () => {
      const { staff, studentId, file } = await issued();
      await ownerA
        .post(`/api/v1/school/students/${studentId}/transfer`)
        .send({
          targetSchoolId: a2.schoolId,
          targetSchoolYearId: a2.yearId,
          targetLevelId: a2.levelId,
          effectiveOn: '2026-11-15',
          reason: 'Déménagement',
        })
        .expect(200);
      await staff.agent.get(file).expect(404);
    });

    it('le retrait de l’établissement ferme aussitôt le lien', async () => {
      const { s, staff, file } = await issued('SECRETARY', [a2.schoolId]);
      await ownerA
        .patch(`/api/v1/school/members/${staff.id}`)
        .send({ schoolIds: [a2.schoolId] })
        .expect(200);
      expect(s.schoolId).not.toBe(a2.schoolId);
      await staff.agent.get(file).expect(404);
    });

    it('la perte du rôle ferme aussitôt le lien', async () => {
      const { staff, file } = await issued();
      await ownerA
        .patch(`/api/v1/school/members/${staff.id}`)
        .send({ role: 'ACCOUNTANT' })
        .expect(200);
      await staff.agent.get(file).expect(403);
    });

    it('la désactivation du compte ferme aussitôt le lien', async () => {
      const { staff, file } = await issued();
      await ownerA
        .patch(`/api/v1/school/members/${staff.id}`)
        .send({ isActive: false })
        .expect(200);
      const res = await staff.agent.get(file);
      expect([401, 403]).toContain(res.status);
    });

    it('un membre actif, sans autre changement, garde son accès, journalisé à chaque fois', async () => {
      const { staff, documentId, file } = await issued();
      await staff.agent.get(file).expect(200);
      expect(
        await app.get(PrismaService).auditLog.count({
          where: { action: 'school.document_downloaded', targetId: documentId },
        }),
      ).toBe(2);
    });
  });

  describe('S1-06 : les décisions d’accès restent tracées malgré une panne du journal', () => {
    const logged = (action: string, targetId: string) =>
      app.get(PrismaService).auditLog.findMany({ where: { action, targetId } });
    const failJournal = (action: string) => {
      const audit = app.get(AuditService);
      const original = audit.record.bind(audit);
      return jest.spyOn(audit, 'record').mockImplementation((entry, tx) => {
        if (entry.action === action) return Promise.reject(new Error('journal indisponible'));
        return original(entry, tx);
      });
    };

    it('membre : la décision survit à la panne, puis est publiée une seule fois avec son acteur', async () => {
      const m = await member(ownerA, 'SECRETARY', [a1.schoolId]);
      const spy = failJournal('school.member_updated');
      try {
        await ownerA
          .patch(`/api/v1/school/members/${m.id}`)
          .send({ isActive: false, role: 'TEACHER' })
          .expect(200);
      } finally {
        spy.mockRestore();
      }
      expect(await logged('school.member_updated', m.id)).toHaveLength(0);
      const [pending] = await db.schoolAccessDecision.findMany({
        where: { targetId: m.id, publishedAt: null },
      });
      expect(pending!.metadata).toMatchObject({ isActive: false, role: 'TEACHER' });

      await ownerA.get('/api/v1/school/members').expect(200);
      await ownerA.get('/api/v1/school/members').expect(200);
      const entries = await logged('school.member_updated', m.id);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.metadata).toMatchObject({ decisionId: pending!.id, isActive: false });
      expect(entries[0]!.actorUserId).toBe(pending!.actorUserId);
      expect(
        (await db.schoolAccessDecision.findUniqueOrThrow({ where: { id: pending!.id } }))
          .publishedAt,
      ).not.toBeNull();
    });

    it('une décision déjà publiée mais non marquée n’est pas journalisée deux fois', async () => {
      const m = await member(ownerA, 'SECRETARY', [a1.schoolId]);
      await ownerA.patch(`/api/v1/school/members/${m.id}`).send({ role: 'TEACHER' }).expect(200);
      const decision = await db.schoolAccessDecision.findFirstOrThrow({
        where: { targetId: m.id },
      });
      await db.schoolAccessDecision.update({
        where: { id: decision.id },
        data: { publishedAt: null },
      });
      await ownerA.get('/api/v1/school/members').expect(200);
      expect(await logged('school.member_updated', m.id)).toHaveLength(1);
    });

    it('un échec de la transaction School n’enregistre ni le changement ni la décision', async () => {
      const m = await member(ownerA, 'SECRETARY', [a1.schoolId]);
      const spy = jest
        .spyOn(app.get(SchoolService), 'recordDecision')
        .mockRejectedValueOnce(new Error('School indisponible'));
      try {
        await ownerA.patch(`/api/v1/school/members/${m.id}`).send({ role: 'TEACHER' }).expect(500);
      } finally {
        spy.mockRestore();
      }
      const row = await db.schoolMember.findUniqueOrThrow({ where: { id: m.id } });
      expect(row.role).toBe('SECRETARY');
      expect(await db.schoolAccessDecision.count({ where: { targetId: m.id } })).toBe(0);
    });

    it('affectation d’un enseignant : ajout et retrait restent tracés malgré la panne', async () => {
      const s = await structure(ownerA, `Trace ${++counter}`);
      const prof = await member(ownerA, 'TEACHER', [s.schoolId]);
      const url = `/api/v1/school/classes/${s.classId}/teachers`;
      const spy = failJournal('school.class_teacher_added');
      try {
        await ownerA.post(url).send({ memberId: prof.id }).expect(201);
      } finally {
        spy.mockRestore();
      }
      expect(
        await db.schoolAccessDecision.count({
          where: { targetId: s.classId, action: 'school.class_teacher_added', publishedAt: null },
        }),
      ).toBe(1);
      await ownerA.delete(`${url}/${prof.id}`).expect(204);
      expect(await logged('school.class_teacher_added', s.classId)).toHaveLength(1);
      expect(await logged('school.class_teacher_removed', s.classId)).toHaveLength(1);
    });

    it('une décision d’un client n’apparaît jamais dans le journal d’un autre', async () => {
      const m = await member(ownerA, 'SECRETARY', [a1.schoolId]);
      await ownerA.patch(`/api/v1/school/members/${m.id}`).send({ role: 'TEACHER' }).expect(200);
      const [entry] = await logged('school.member_updated', m.id);
      const [org] = await db.schoolAccessDecision.findMany({
        where: { targetId: m.id },
        select: { organizationId: true },
      });
      expect(entry!.organizationId).toBe(org!.organizationId);
    });
  });

  describe('traçabilité du périmètre', () => {
    it('une clôture d’année reste tracée malgré une panne du journal, avec son acteur', async () => {
      const s = await structure(ownerA, `CloTrace ${++counter}`);
      const audit = app.get(AuditService);
      const original = audit.record.bind(audit);
      const spy = jest.spyOn(audit, 'record').mockImplementation((entry, tx) => {
        if (entry.action === 'school.year_status_changed') {
          return Promise.reject(new Error('journal indisponible'));
        }
        return original(entry, tx);
      });
      try {
        await ownerA
          .post(`/api/v1/school/years/${s.yearId}/status`)
          .send({ status: 'CLOSED' })
          .expect(200);
      } finally {
        spy.mockRestore();
      }
      const pending = await db.schoolAccessDecision.findFirstOrThrow({
        where: { targetId: s.yearId, publishedAt: null },
      });
      expect(pending.metadata).toMatchObject({ to: 'CLOSED' });
      await ownerA.get('/api/v1/school/members').expect(200);
      const entries = await app.get(PrismaService).auditLog.findMany({
        where: { action: 'school.year_status_changed', targetId: s.yearId },
      });
      const closing = entries.filter((e) => (e.metadata as { to?: string }).to === 'CLOSED');
      expect(closing).toHaveLength(1);
      expect(closing[0]!.actorUserId).toBe(pending.actorUserId);
    });

    it('un changement de couverture conserve les établissements avant et après', async () => {
      const c = await client(`scope${++counter}`);
      const s = await structure(c.agent, `Couvert ${++counter}`);
      await platform.agent
        .patch(`/api/v1/platform/contracts/${c.contractId}`)
        .send({ coveredSchoolIds: [s.schoolId] })
        .expect(200);
      const event = await app.get(PrismaService).suiteContractEvent.findFirstOrThrow({
        where: { contractId: c.contractId, type: 'SCOPE_CHANGED' },
      });
      expect(JSON.parse(event.reason!)).toMatchObject({
        fromSchoolIds: [],
        toSchoolIds: [s.schoolId],
      });
    });
  });

  describe('S1-05 : une panne entre les deux bases laisse toujours le compte fermé', () => {
    const syncService = () =>
      app.get(SchoolMembersService) as unknown as {
        syncAccount: (...args: unknown[]) => Promise<void>;
      };
    /** School est validé, puis Suite échoue : la seule divergence possible depuis cet ordre d'écriture. */
    const failSuite = () =>
      jest
        .spyOn(syncService(), 'syncAccount')
        .mockImplementationOnce(() => Promise.reject(new Error('Suite indisponible')));
    const suiteActive = async (memberId: string) => {
      const row = await db.schoolMember.findUniqueOrThrow({ where: { id: memberId } });
      const [account] = await app.get(PrismaService).organizationMembership.findMany({
        where: { userId: row.userId, role: 'PRODUCT_USER' },
      });
      return { school: row.isActive, suite: account!.isActive };
    };

    it('désactivation interrompue : School est fermé aussitôt, la reprise termine', async () => {
      const m = await member(ownerA, 'SECRETARY', [a1.schoolId]);
      const url = `/api/v1/school/members/${m.id}`;
      await m.agent.get('/api/v1/school/context').expect(200);
      const spy = failSuite();
      try {
        await ownerA.patch(url).send({ isActive: false }).expect(500);
      } finally {
        spy.mockRestore();
      }
      expect(await suiteActive(m.id)).toEqual({ school: false, suite: true });
      expect(
        await app.get(PrismaService).auditLog.count({
          where: { action: 'school.member_updated', targetId: m.id },
        }),
      ).toBe(1);
      await m.agent.get('/api/v1/school/context').expect(403);
      await ownerA.patch(url).send({ isActive: false }).expect(200);
      expect(await suiteActive(m.id)).toEqual({ school: false, suite: false });
      expect((await m.agent.get('/api/v1/school/context')).status).toBe(401);
    });

    it('réactivation interrompue : la connexion reste refusée, la reprise ouvre', async () => {
      const m = await member(ownerA, 'SECRETARY', [a1.schoolId]);
      const url = `/api/v1/school/members/${m.id}`;
      await ownerA.patch(url).send({ isActive: false }).expect(200);
      const spy = failSuite();
      try {
        await ownerA.patch(url).send({ isActive: true }).expect(500);
      } finally {
        spy.mockRestore();
      }
      expect(await suiteActive(m.id)).toEqual({ school: true, suite: false });
      expect((await login(app, m.loginId, PASSWORD)).status).not.toBe(200);
      await ownerA.patch(url).send({ isActive: true }).expect(200);
      const session = await login(app, m.loginId, PASSWORD);
      expect(session.status).toBe(200);
      await session.agent.get('/api/v1/school/context').expect(200);
    });

    it('reprise avec restriction : les nouveaux droits valent avant toute réouverture', async () => {
      const local = await structure(ownerA, `Reprise ${++counter}`);
      const m = await member(ownerA, 'SECRETARY', [local.schoolId, a2.schoolId]);
      const url = `/api/v1/school/members/${m.id}`;
      await ownerA.patch(url).send({ isActive: false }).expect(200);
      const service = syncService();
      const original = service.syncAccount.bind(service);
      let seenBySuite: { role: string; schools: string[] } | null = null;
      const spy = jest.spyOn(service, 'syncAccount').mockImplementationOnce(async (...args) => {
        const row = await db.schoolMember.findUniqueOrThrow({
          where: { id: m.id },
          include: { assignments: true },
        });
        seenBySuite = { role: row.role, schools: row.assignments.map((a) => a.schoolId) };
        await original(...args);
      });
      try {
        await ownerA
          .patch(url)
          .send({ isActive: true, role: 'TEACHER', schoolIds: [local.schoolId] })
          .expect(200);
      } finally {
        spy.mockRestore();
      }
      expect(seenBySuite).toEqual({ role: 'TEACHER', schools: [local.schoolId] });
    });

    it('après une désactivation interrompue, un directeur limité ne rouvre pas le compte partagé', async () => {
      const director = await member(ownerA, 'SCHOOL_DIRECTOR', [a1.schoolId]);
      const m = await member(ownerA, 'SECRETARY', [a1.schoolId, a2.schoolId]);
      const url = `/api/v1/school/members/${m.id}`;
      const spy = failSuite();
      try {
        await ownerA.patch(url).send({ isActive: false }).expect(500);
      } finally {
        spy.mockRestore();
      }
      const refused = await director.agent.patch(url).send({ isActive: true }).expect(403);
      expect(refused.body.code).toBe('SCHOOL_MEMBER_SHARED');
      expect(await suiteActive(m.id)).toEqual({ school: false, suite: true });
    });

    it('une synchronisation tardive n’écrase pas une décision plus récente', async () => {
      const m = await member(ownerA, 'TEACHER', [a1.schoolId]);
      const url = `/api/v1/school/members/${m.id}`;
      const service = syncService();
      const original = service.syncAccount.bind(service);
      const spy = jest.spyOn(service, 'syncAccount').mockImplementationOnce(async (...args) => {
        // La désactivation est validée dans School ; une réactivation complète passe avant sa synchro.
        await ownerA.patch(url).send({ isActive: true }).expect(200);
        await original(...args);
      });
      try {
        await ownerA.patch(url).send({ isActive: false }).expect(200);
      } finally {
        spy.mockRestore();
      }
      expect(await suiteActive(m.id)).toEqual({ school: true, suite: true });
    });

    it('après une réactivation interrompue, un directeur limité ne rouvre pas le compte partagé', async () => {
      const director = await member(ownerA, 'SCHOOL_DIRECTOR', [a1.schoolId]);
      const m = await member(ownerA, 'SECRETARY', [a1.schoolId, a2.schoolId]);
      const url = `/api/v1/school/members/${m.id}`;
      await ownerA.patch(url).send({ isActive: false }).expect(200);
      const spy = failSuite();
      try {
        await ownerA.patch(url).send({ isActive: true }).expect(500);
      } finally {
        spy.mockRestore();
      }
      expect(await suiteActive(m.id)).toEqual({ school: true, suite: false });
      const refused = await director.agent.patch(url).send({ isActive: true }).expect(403);
      expect(refused.body.code).toBe('SCHOOL_MEMBER_SHARED');
      expect(await suiteActive(m.id)).toEqual({ school: true, suite: false });
    });

    it('reprise avec restriction puis panne de School : Suite reste fermé, rien n’est rouvert', async () => {
      const local = await structure(ownerA, `Panne ${++counter}`);
      const m = await member(ownerA, 'SECRETARY', [local.schoolId, a2.schoolId]);
      const url = `/api/v1/school/members/${m.id}`;
      const spySuite = failSuite();
      try {
        await ownerA.patch(url).send({ isActive: false }).expect(500);
        await ownerA.patch(url).send({ isActive: true }).expect(200);
      } finally {
        spySuite.mockRestore();
      }
      await app.get(PrismaService).organizationMembership.updateMany({
        where: {
          userId: (await db.schoolMember.findUniqueOrThrow({ where: { id: m.id } })).userId,
        },
        data: { isActive: false },
      });
      const spy = jest
        .spyOn(app.get(SchoolService), 'recordDecision')
        .mockRejectedValueOnce(new Error('School indisponible'));
      try {
        await ownerA
          .patch(url)
          .send({ isActive: true, role: 'TEACHER', schoolIds: [local.schoolId] })
          .expect(500);
      } finally {
        spy.mockRestore();
      }
      expect(await suiteActive(m.id)).toEqual({ school: true, suite: false });
      expect((await db.schoolMember.findUniqueOrThrow({ where: { id: m.id } })).role).toBe(
        'SECRETARY',
      );
      expect((await login(app, m.loginId, PASSWORD)).status).not.toBe(200);
    });

    it('une ligne School ne donne aucun accès à un compte qui n’est pas dédié à School', async () => {
      const m = await member(ownerA, 'SECRETARY', [a1.schoolId]);
      await m.agent.get('/api/v1/school/context').expect(200);
      const row = await db.schoolMember.findUniqueOrThrow({ where: { id: m.id } });
      await app.get(PrismaService).organizationMembership.updateMany({
        where: { userId: row.userId, role: 'PRODUCT_USER' },
        data: { role: 'CASHIER' },
      });
      await m.agent.get('/api/v1/school/context').expect(403);
    });
  });

  // Exige plusieurs connexions réelles : ignoré sur PGlite, qui exécute tout en séquence.
  const realDatabase = ![
    process.env.TEST_DATABASE_URL,
    process.env.SCHOOL_TEST_DATABASE_URL ?? process.env.TEST_SCHOOL_DATABASE_URL,
  ].some((url) => url?.includes('connection_limit=1'));
  (realDatabase ? describe : describe.skip)('S2-14 : entrelacements imposés', () => {
    // Une assertion en échec ne doit jamais laisser une opération en pause, verrous tenus.
    const cleanups: (() => void)[] = [];
    afterEach(async () => {
      for (const cleanup of cleanups.splice(0)) cleanup();
      claimed.clear();
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    const started = <T>(request: PromiseLike<T>) => Promise.resolve(request);
    /** Connexion de l'opération en pause : son identifiant réel, lu dans sa transaction. */
    let holder: number | null = null;
    const backendPid = async (tx: { $queryRaw: PrismaService['$queryRaw'] }) => {
      const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      return row!.pid;
    };
    /** Connexions bloquées déjà rattachées à une opération attendue de ce test. */
    const claimed = new Set<number>();
    /**
     * Preuve par PostgreSQL : `pending` est la seule opération lancée depuis la précédente preuve, et
     * exactement une nouvelle connexion, portant sur `table`, est bloquée par celle de l'opération en
     * pause. Cette connexion est donc celle de `pending` : elle lui est rattachée, puis exclue des
     * preuves suivantes. Lancer chaque opération attendue seulement après la preuve de la précédente.
     */
    const isBlocked = async (
      pending: Promise<unknown>,
      table: string,
      client: { $queryRaw: PrismaService['$queryRaw'] } = db as never,
    ) => {
      let done = false;
      void pending.then(() => (done = true));
      const pattern = `%"${table}"%`;
      for (let i = 0; i < 100 && !done; i++) {
        const rows = await client.$queryRaw<{ pid: number }[]>`
          SELECT w.pid FROM pg_stat_activity w
          WHERE w.datname = current_database() AND w.state = 'active' AND w.query LIKE ${pattern}
            AND ${holder}::int = ANY(pg_blocking_pids(w.pid))`;
        const fresh = rows.map((r) => r.pid).filter((pid) => !claimed.has(pid));
        if (fresh.length > 1) throw new Error('Plusieurs opérations attendues non rattachées.');
        if (fresh.length === 1) {
          claimed.add(fresh[0]!);
          return !done;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    };

    /** Arrête une opération juste après l'appel visé, verrous tenus, jusqu'à `release()`. */
    function pauseAfter<K extends string>(
      target: Record<K, (...args: never[]) => Promise<unknown>>,
      method: K,
      when: (...args: unknown[]) => boolean = () => true,
    ) {
      let release!: () => void;
      let reached!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const at = new Promise<void>((resolve) => (reached = resolve));
      const original = (target[method] as (...args: unknown[]) => Promise<unknown>).bind(target);
      let armed = true;
      const spy = jest
        .spyOn(target as Record<string, (...args: unknown[]) => Promise<unknown>>, method)
        .mockImplementation(async (...args: unknown[]) => {
          const result = await original(...args);
          if (armed && when(...args)) {
            armed = false;
            holder = await backendPid(
              args.find(
                (arg) => typeof arg === 'object' && arg !== null && '$queryRaw' in arg,
              ) as never,
            );
            reached();
            await gate;
          }
          return result;
        });
      const restore = () => spy.mockRestore();
      cleanups.push(release, restore);
      return { at, release, restore };
    }
    const service = <T>(token: new (...args: never[]) => T) =>
      app.get(token) as unknown as Record<string, (...args: never[]) => Promise<unknown>>;
    const students = () => service(SchoolStudentsService);
    const school = () => service(SchoolService);
    const enrollments = () => service(SchoolEnrollmentsService);
    const guardians = () => service(SchoolGuardiansService);
    const members = () => service(SchoolMembersService);
    const contracts = () => service(SuiteContractsService);
    const transfer = (agent: Agent, id: string) =>
      agent.post(`/api/v1/school/students/${id}/transfer`).send({
        targetSchoolId: a2.schoolId,
        targetSchoolYearId: a2.yearId,
        targetLevelId: a2.levelId,
        effectiveOn: '2026-11-15',
        reason: 'Déménagement',
      });
    const closeYear = (id: string) =>
      ownerA.post(`/api/v1/school/years/${id}/status`).send({ status: 'CLOSED' });
    /** Clôture simulée, tenue ouverte le temps de prouver qu'une opération concurrente l'attend. */
    function holdClosure(s: Structure) {
      let commit!: () => void;
      let locked!: () => void;
      const gate = new Promise<void>((resolve) => (commit = resolve));
      const ready = new Promise<void>((resolve) => (locked = resolve));
      cleanups.push(commit);
      const done = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "School" WHERE id = ${s.schoolId}::uuid FOR UPDATE`;
        await tx.schoolYear.update({ where: { id: s.yearId }, data: { status: 'CLOSED' } });
        holder = await backendPid(tx as never);
        locked();
        await gate;
      });
      return { ready, commit, done };
    }
    async function pendingEnrollment(s: Structure) {
      const created = await student(ownerA, s.schoolId).expect(201);
      const parent = await guardian(ownerA, s.schoolId).expect(201);
      await ownerA
        .post(`/api/v1/school/students/${created.body.id}/guardians`)
        .send({ guardianId: parent.body.id, relation: 'FATHER' })
        .expect(201);
      const enrollment = await ownerA
        .post('/api/v1/school/enrollments')
        .send({
          studentId: created.body.id,
          schoolYearId: s.yearId,
          levelId: s.levelId,
          classId: s.classId,
          submit: true,
        })
        .expect(201);
      return { id: created.body.id as string, enrollmentId: enrollment.body.id as string };
    }

    it('une création tient le réglage du matricule en attente, qui est ensuite refusé', async () => {
      const s = await structure(ownerA, `Regl1 ${++counter}`);
      const settings = (
        await ownerA.get(`/api/v1/school/student-settings?schoolId=${s.schoolId}`).expect(200)
      ).body;
      const pause = pauseAfter(school(), 'guardSchools');
      const create = started(student(ownerA, s.schoolId));
      await pause.at;
      const save = started(
        ownerA
          .put(`/api/v1/school/student-settings?schoolId=${s.schoolId}`)
          .send({ ...settings, matriculeScope: 'GROUP' }),
      );
      expect(await isBlocked(save, 'School')).toBe(true);
      pause.release();
      expect((await create).status).toBe(201);
      expect((await save).status).toBe(409);
      pause.restore();
    });

    it('un réglage du matricule fait attendre la création, qui suit le périmètre final', async () => {
      const s = await structure(ownerA, `Regl2 ${++counter}`);
      const settings = (
        await ownerA.get(`/api/v1/school/student-settings?schoolId=${s.schoolId}`).expect(200)
      ).body;
      const pause = pauseAfter(students(), 'readSettings');
      const save = started(
        ownerA
          .put(`/api/v1/school/student-settings?schoolId=${s.schoolId}`)
          .send({ ...settings, matriculeScope: 'GROUP' }),
      );
      await pause.at;
      const create = started(student(ownerA, s.schoolId));
      expect(await isBlocked(create, 'School')).toBe(true);
      pause.release();
      expect((await save).status).toBe(200);
      const created = await create;
      expect(created.status).toBe(201);
      const row = await db.schoolStudent.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(row.matriculeScope).toBe('GROUP');
      pause.restore();
    });

    it('deux déplacements vers une classe d’une place : l’un attend, puis est refusé', async () => {
      const s = await structure(ownerA, `Place ${++counter}`);
      const small = await ownerA
        .post('/api/v1/school/classes')
        .send({ schoolYearId: s.yearId, levelId: s.levelId, name: 'Petite', capacity: 1 })
        .expect(201);
      const [one, two] = [await enrolled(ownerA, s), await enrolled(ownerA, s)];
      const move = (id: string) =>
        started(
          ownerA
            .post(`/api/v1/school/enrollments/${id}/class`)
            .send({ classId: small.body.id, reason: 'Essai' }),
        );
      const pause = pauseAfter(enrollments(), 'lockClass');
      const first = move(one.enrollmentId);
      await pause.at;
      const second = move(two.enrollmentId);
      expect(await isBlocked(second, 'SchoolClass')).toBe(true);
      pause.release();
      expect((await first).status).toBe(200);
      const refused = await second;
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('CLASS_FULL');
      pause.restore();
    });

    it('S1-01 : une affectation attend le contrôle en cours sur le même membre', async () => {
      const local = await structure(ownerA, `Mem ${++counter}`);
      const director = await member(ownerA, 'SCHOOL_DIRECTOR', [local.schoolId]);
      const m = await member(ownerA, 'TEACHER', [local.schoolId]);
      const url = `/api/v1/school/members/${m.id}`;
      const pause = pauseAfter(members(), 'findManageable');
      const promote = started(director.agent.patch(url).send({ role: 'SECRETARY' }));
      await pause.at;
      const extend = started(ownerA.patch(url).send({ schoolIds: [local.schoolId, a2.schoolId] }));
      expect(await isBlocked(extend, 'SchoolMember')).toBe(true);
      pause.release();
      expect((await promote).status).toBe(200);
      expect((await extend).status).toBe(200);
      pause.restore();
    });

    it('la clôture attend une période en cours', async () => {
      const s = await structure(ownerA, `Per1 ${++counter}`);
      const pause = pauseAfter(school(), 'guardSchools');
      const period = started(
        ownerA.post('/api/v1/school/periods').send({
          schoolYearId: s.yearId,
          kind: 'TRIMESTER',
          label: 'Trimestre',
          startsOn: '2026-10-01',
          endsOn: '2026-12-20',
        }),
      );
      await pause.at;
      const closing = started(closeYear(s.yearId));
      expect(await isBlocked(closing, 'School')).toBe(true);
      pause.release();
      expect((await period).status).toBe(201);
      expect((await closing).status).toBe(200);
      pause.restore();
    });

    it('une période et une validation qui attendent la clôture sont ensuite refusées', async () => {
      const s = await structure(ownerA, `Per2 ${++counter}`);
      const { id, enrollmentId } = await pendingEnrollment(s);
      const closure = holdClosure(s);
      await closure.ready;
      const period = started(
        ownerA.post('/api/v1/school/periods').send({
          schoolYearId: s.yearId,
          kind: 'TRIMESTER',
          label: 'Trimestre',
          startsOn: '2026-10-01',
          endsOn: '2026-12-20',
        }),
      );
      // Chaque opération n'est lancée qu'une fois la précédente prouvée en attente.
      expect(await isBlocked(period, 'School')).toBe(true);
      const validation = started(
        ownerA
          .post(`/api/v1/school/enrollments/${enrollmentId}/status`)
          .send({ status: 'VALIDATED' }),
      );
      expect(await isBlocked(validation, 'School')).toBe(true);
      closure.commit();
      await closure.done;
      expect((await period).status).toBe(409);
      expect((await validation).status).toBe(409);
      expect(await db.schoolClassAssignment.count({ where: { studentId: id } })).toBe(0);
    });

    it('la clôture attend une validation en cours, et ferme son affectation', async () => {
      const s = await structure(ownerA, `Val ${++counter}`);
      const { id, enrollmentId } = await pendingEnrollment(s);
      const pause = pauseAfter(school(), 'guardSchools');
      const validation = started(
        ownerA
          .post(`/api/v1/school/enrollments/${enrollmentId}/status`)
          .send({ status: 'VALIDATED' }),
      );
      await pause.at;
      const closing = started(closeYear(s.yearId));
      expect(await isBlocked(closing, 'School')).toBe(true);
      pause.release();
      expect((await validation).status).toBe(200);
      expect((await closing).status).toBe(200);
      expect(
        await db.schoolClassAssignment.count({ where: { studentId: id, endedAt: null } }),
      ).toBe(0);
      expect((await db.schoolStudent.findUniqueOrThrow({ where: { id } })).status).toBe(
        'REGISTERED',
      );
      pause.restore();
    });

    it('un changement de classe attend la validation et s’applique sur l’état relu', async () => {
      const s = await structure(ownerA, `Val2 ${++counter}`);
      const { id, enrollmentId } = await pendingEnrollment(s);
      const pause = pauseAfter(students(), 'lockInScope');
      const validation = started(
        ownerA
          .post(`/api/v1/school/enrollments/${enrollmentId}/status`)
          .send({ status: 'VALIDATED' }),
      );
      await pause.at;
      const moved = started(
        ownerA
          .post(`/api/v1/school/enrollments/${enrollmentId}/class`)
          .send({ classId: s.otherClassId, reason: 'Essai' }),
      );
      expect(await isBlocked(moved, 'SchoolStudent')).toBe(true);
      pause.release();
      expect((await validation).status).toBe(200);
      expect((await moved).status).toBe(200);
      const open = await db.schoolClassAssignment.findMany({
        where: { studentId: id, endedAt: null },
      });
      expect(open.map((a) => a.classId)).toEqual([s.otherClassId]);
      pause.restore();
    });

    it('une écriture qui attend un transfert est refusée, sans toucher au dossier', async () => {
      const s = await structure(ownerA, `Tr ${++counter}`);
      const staff = await member(ownerA, 'SECRETARY', [s.schoolId]);
      const created = await student(ownerA, s.schoolId).expect(201);
      const id = created.body.id as string;
      const pause = pauseAfter(students(), 'readSettings');
      const move = started(transfer(ownerA, id));
      await pause.at;
      const write = started(
        staff.agent.patch(`/api/v1/school/students/${id}`).send({ birthPlace: 'Gao' }),
      );
      expect(await isBlocked(write, 'SchoolStudent')).toBe(true);
      pause.release();
      expect((await move).status).toBe(200);
      expect((await write).status).toBe(404);
      expect((await db.schoolStudent.findUniqueOrThrow({ where: { id } })).birthPlace).toBeNull();
      pause.restore();
    });

    it('une modification de responsable qui attend le transfert de l’enfant est refusée', async () => {
      const s = await structure(ownerA, `Resp ${++counter}`);
      const staff = await member(ownerA, 'SECRETARY', [s.schoolId]);
      const { id } = await enrolled(ownerA, s);
      const link = await db.schoolStudentGuardian.findFirstOrThrow({ where: { studentId: id } });
      const pause = pauseAfter(students(), 'readSettings');
      const move = started(transfer(ownerA, id));
      await pause.at;
      const write = started(
        staff.agent.patch(`/api/v1/school/guardians/${link.guardianId}`).send({ firstName: 'X' }),
      );
      expect(await isBlocked(write, 'SchoolGuardian')).toBe(true);
      pause.release();
      expect((await move).status).toBe(200);
      expect((await write).status).toBe(404);
      pause.restore();
    });

    it('un transfert attend la modification du responsable en cours', async () => {
      const s = await structure(ownerA, `Resp2 ${++counter}`);
      const staff = await member(ownerA, 'SECRETARY', [s.schoolId]);
      const { id } = await enrolled(ownerA, s);
      const link = await db.schoolStudentGuardian.findFirstOrThrow({ where: { studentId: id } });
      const pause = pauseAfter(guardians(), 'lockInScope');
      const write = started(
        staff.agent.patch(`/api/v1/school/guardians/${link.guardianId}`).send({ firstName: 'Y' }),
      );
      await pause.at;
      const move = started(transfer(ownerA, id));
      expect(await isBlocked(move, 'SchoolGuardian')).toBe(true);
      pause.release();
      expect((await write).status).toBe(200);
      expect((await move).status).toBe(200);
      pause.restore();
    });

    it('le trentième document se réserve sous verrou : l’envoi suivant attend, puis est refusé', async () => {
      const created = await student(ownerA, a1.schoolId).expect(201);
      const url = `/api/v1/school/students/${created.body.id}/documents`;
      const send = () =>
        started(ownerA.post(url).field('category', 'OTHER').attach('file', PDF, 'p.pdf'));
      for (let i = 0; i < 29; i++) expect((await send()).status).toBe(201);
      const pause = pauseAfter(students(), 'lockInScope');
      const first = send();
      await pause.at;
      const second = send();
      expect(await isBlocked(second, 'SchoolStudent')).toBe(true);
      pause.release();
      expect((await first).status).toBe(201);
      expect((await second).status).toBe(409);
      pause.restore();
    });

    it('deux modifications d’identité se suivent : la clé finale reflète les deux', async () => {
      const created = await student(ownerA, a1.schoolId, {
        lastName: `Ident${RUN}`,
        firstName: 'Prenom',
        birthDate: '2013-07-07',
      }).expect(201);
      const id = created.body.id as string;
      const url = `/api/v1/school/students/${id}`;
      const pause = pauseAfter(students(), 'lockInScope');
      const a = started(ownerA.patch(url).send({ lastName: `Finale${RUN}` }));
      await pause.at;
      const b = started(ownerA.patch(url).send({ firstName: 'Autre' }));
      expect(await isBlocked(b, 'SchoolStudent')).toBe(true);
      pause.release();
      expect((await a).status).toBe(200);
      expect((await b).status).toBe(200);
      const dup = await student(ownerA, a1.schoolId, {
        lastName: `Finale${RUN}`,
        firstName: 'Autre',
        birthDate: '2013-07-07',
      }).expect(409);
      expect(dup.body.details).toEqual([id]);
    });

    it('une résiliation attend le renouvellement en cours et l’emporte', async () => {
      const c = await client(`hold${++counter}`);
      const pause = pauseAfter(contracts(), 'find');
      const renew = started(
        platform.agent
          .post(`/api/v1/platform/contracts/${c.contractId}/renew`)
          .send({ endsOn: '2199-12-31', reason: 'Renouvellement' }),
      );
      await pause.at;
      const stop = started(
        platform.agent
          .post(`/api/v1/platform/contracts/${c.contractId}/status`)
          .send({ status: 'TERMINATED', reason: 'Résiliation' }),
      );
      expect(await isBlocked(stop, 'SuiteContract', app.get(PrismaService))).toBe(true);
      pause.release();
      expect((await renew).status).toBe(200);
      expect((await stop).status).toBe(200);
      const row = await app.get(PrismaService).suiteContract.findUniqueOrThrow({
        where: { id: c.contractId },
      });
      expect(row.status).toBe('TERMINATED');
      pause.restore();
    });

    describe('retrait de l’enseignant après le chargement de ses classes', () => {
      async function teacherOfClass() {
        const s = await structure(ownerA, `Prof2 ${++counter}`);
        const prof = await member(ownerA, 'TEACHER', [s.schoolId]);
        const teachers = `/api/v1/school/classes/${s.classId}/teachers`;
        await ownerA.post(teachers).send({ memberId: prof.id }).expect(201);
        const { id } = await enrolled(ownerA, s);
        return { s, prof, id, teachers };
      }
      const NEW_NAME = 'Identitemodifiee';
      /** La lecture a chargé ses classes ; le retrait et la modification valident avant qu'elle reprenne. */
      async function afterLoad(
        ctxOf: Awaited<ReturnType<typeof teacherOfClass>>,
        read: () => PromiseLike<{ status: number; text: string }>,
      ) {
        const pause = pauseAfter(students(), 'ownClasses', (...args) => args[1] !== undefined);
        const reading = started(read());
        await pause.at;
        await ownerA.delete(`${ctxOf.teachers}/${ctxOf.prof.id}`).expect(204);
        await ownerA
          .patch(`/api/v1/school/students/${ctxOf.id}`)
          .send({ firstName: NEW_NAME })
          .expect(200);
        pause.release();
        const res = await reading;
        pause.restore();
        expect(res.status).toBe(200);
        expect(res.text).not.toContain(NEW_NAME);
      }

      it('dossier', async () => {
        const c = await teacherOfClass();
        await afterLoad(c, () => c.prof.agent.get(`/api/v1/school/students/${c.id}`));
      });

      it('recherche', async () => {
        const c = await teacherOfClass();
        await afterLoad(c, () =>
          c.prof.agent.get(`/api/v1/school/students?schoolId=${c.s.schoolId}`),
        );
      });

      it('liste de classe', async () => {
        const c = await teacherOfClass();
        await afterLoad(c, () =>
          c.prof.agent.get(`/api/v1/school/classes/${c.s.classId}/students`),
        );
      });

      it('effectifs', async () => {
        const c = await teacherOfClass();
        const url = `/api/v1/school/rosters?schoolYearId=${c.s.yearId}`;
        const seen = await c.prof.agent.get(url).expect(200);
        expect(seen.body).toHaveLength(1);
        expect(seen.body[0]).toMatchObject({ id: c.s.classId, enrolled: 1 });
        const pause = pauseAfter(students(), 'ownClasses', (...args) => args[1] !== undefined);
        const reading = started(c.prof.agent.get(url));
        await pause.at;
        await ownerA.delete(`${c.teachers}/${c.prof.id}`).expect(204);
        await enrolled(ownerA, c.s);
        pause.release();
        const res = await reading;
        pause.restore();
        expect(res.status).toBe(200);
        expect(res.body[0]).toMatchObject({ id: c.s.classId, enrolled: 1 });
      });
    });
  });

  describe('corrections de l’audit', () => {
    const transferBody = (s: Structure) => ({
      targetSchoolId: s.schoolId,
      targetSchoolYearId: s.yearId,
      targetLevelId: s.levelId,
      effectiveOn: '2026-11-15',
      reason: 'Déménagement',
    });

    /** Dossier avec responsable et inscription en attente de validation. */
    async function pending(owner: Agent, s: Structure, classId = s.classId) {
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
      return { id: created.body.id as string, enrollmentId: enrollment.body.id as string };
    }

    it('S2-01 : un échec du journal après validation ne supprime pas le fichier', async () => {
      const created = await student(ownerA, a1.schoolId).expect(201);
      const url = `/api/v1/school/students/${created.body.id}/documents`;
      const audit = app.get(AuditService);
      const original = audit.record.bind(audit);
      const spy = jest.spyOn(audit, 'record').mockImplementation((entry, tx) => {
        if (entry.action === 'school.document_added') {
          return Promise.reject(new Error('journal indisponible'));
        }
        return original(entry, tx);
      });
      try {
        await ownerA.post(url).field('category', 'OTHER').attach('file', PDF, 'p.pdf').expect(500);
      } finally {
        spy.mockRestore();
      }
      const list = await ownerA.get(url).expect(200);
      expect(list.body).toHaveLength(1);
      const link = await ownerA.get(`${url}/${list.body[0].id}/link`).expect(200);
      await ownerA.get(link.body.url).expect(200);
    });

    it('S2-02 : après transfert, l’ancienne école ne lit plus le dossier par ses listes', async () => {
      const s = await structure(ownerA, `Ancienne ${++counter}`);
      const staff = await member(ownerA, 'SECRETARY', [s.schoolId]);
      const { id, enrollmentId } = await enrolled(ownerA, s);
      await staff.agent.get(`/api/v1/school/classes/${s.classId}/students`).expect(200);
      await ownerA
        .post(`/api/v1/school/students/${id}/transfer`)
        .send(transferBody(a2))
        .expect(200);
      await ownerA
        .patch(`/api/v1/school/students/${id}`)
        .send({ firstName: 'Nouveauprenom' })
        .expect(200);

      const list = await staff.agent
        .get(`/api/v1/school/enrollments?schoolId=${s.schoolId}`)
        .expect(200);
      expect(JSON.stringify(list.body)).not.toContain('Nouveauprenom');
      expect(list.body.items.map((e: { id: string }) => e.id)).not.toContain(enrollmentId);
      const roster = await staff.agent
        .get(`/api/v1/school/classes/${s.classId}/students`)
        .expect(200);
      expect(JSON.stringify(roster.body)).not.toContain('Nouveauprenom');
      await staff.agent
        .post(`/api/v1/school/enrollments/${enrollmentId}/status`)
        .send({ status: 'CANCELLED', note: 'Essai' })
        .expect(404);
      const all = await ownerA.get(`/api/v1/school/students/${id}/enrollments`).expect(200);
      expect(all.body.map((e: { id: string }) => e.id)).toContain(enrollmentId);
    });

    it('S2-03 : un import ne rattache ni un responsable inaccessible, ni un simple préfixe', async () => {
      const s = await structure(ownerA, `Parents ${++counter}`);
      const staff = await member(ownerA, 'SECRETARY', [s.schoolId]);
      const created = await student(ownerA, s.schoolId).expect(201);
      const phone = '+223 70 55 44 33';
      const parent = await ownerA
        .post('/api/v1/school/guardians')
        .send({ schoolId: s.schoolId, lastName: 'Sylla', firstName: 'Oumar', phone })
        .expect(201);
      await ownerA
        .post(`/api/v1/school/students/${created.body.id}/guardians`)
        .send({ guardianId: parent.body.id, relation: 'FATHER' })
        .expect(201);
      await ownerA
        .post(`/api/v1/school/students/${created.body.id}/transfer`)
        .send(transferBody(a2))
        .expect(200);

      const line = (last: string, guardianFirst: string) =>
        `${last};Awa;14/03/2017;Sylla;${guardianFirst};${phone}`;
      const csv = Buffer.from(
        `Nom;Prénom;Date de naissance;Nom du responsable;Prénom du responsable;Téléphone du responsable\r\n${line(`Import${RUN}a`, 'Oumar')}\r\n`,
      );
      const first = await staff.agent
        .post('/api/v1/school/imports')
        .field('schoolId', s.schoolId)
        .attach('file', csv, 'e.csv')
        .expect(201);
      expect(first.body).toMatchObject({ createdRows: 1, errorRows: 0 });
      const imported = await db.schoolStudent.findFirstOrThrow({
        where: { schoolId: s.schoolId, lastName: `Import${RUN}a` },
        select: { guardians: { select: { guardianId: true } } },
      });
      expect(imported.guardians).toHaveLength(1);
      expect(imported.guardians[0]!.guardianId).not.toBe(parent.body.id);
      const links = await db.schoolStudentGuardian.count({ where: { guardianId: parent.body.id } });
      expect(links).toBe(1);
      const homonym = await ownerA
        .post('/api/v1/school/guardians')
        .send({
          schoolId: s.schoolId,
          lastName: 'Sylla',
          firstName: 'Ali',
          phone: '+223 70 55 44 34',
        })
        .expect(201);
      const other = Buffer.from(
        `Nom;Prénom;Date de naissance;Nom du responsable;Prénom du responsable;Téléphone du responsable\r\n${`Import${RUN}b`};Awa;14/03/2017;Sylla;Aliou;+223 70 55 44 34\r\n`,
      );
      const second = await staff.agent
        .post('/api/v1/school/imports')
        .field('schoolId', s.schoolId)
        .attach('file', other, 'e.csv')
        .expect(201);
      expect(second.body).toMatchObject({ createdRows: 1, errorRows: 0 });
      expect(await db.schoolStudentGuardian.count({ where: { guardianId: homonym.body.id } })).toBe(
        0,
      );
    });

    it('S2-04 : une écriture reçue après le transfert ne touche pas le dossier déplacé', async () => {
      const s = await structure(ownerA, `Course ${++counter}`);
      const staff = await member(ownerA, 'SECRETARY', [s.schoolId]);
      const created = await student(ownerA, s.schoolId).expect(201);
      const id = created.body.id as string;
      const [write, move] = await Promise.all([
        staff.agent.patch(`/api/v1/school/students/${id}`).send({ birthPlace: 'Kayes' }),
        ownerA.post(`/api/v1/school/students/${id}/transfer`).send(transferBody(a2)),
      ]);
      expect(move.status).toBe(200);
      expect([200, 404]).toContain(write.status);
      await staff.agent
        .patch(`/api/v1/school/students/${id}`)
        .send({ birthPlace: 'Gao' })
        .expect(404);
      const row = await db.schoolStudent.findUniqueOrThrow({ where: { id } });
      expect(row.birthPlace).not.toBe('Gao');
      expect(row.schoolId).toBe(a2.schoolId);
    });

    it('S2-05 : validation et changement de classe simultanés restent cohérents', async () => {
      const s = await structure(ownerA, `Valid ${++counter}`);
      const { id, enrollmentId } = await pending(ownerA, s);
      const [validated, moved] = await Promise.all([
        ownerA
          .post(`/api/v1/school/enrollments/${enrollmentId}/status`)
          .send({ status: 'VALIDATED' }),
        ownerA
          .post(`/api/v1/school/enrollments/${enrollmentId}/class`)
          .send({ classId: s.otherClassId, reason: 'Essai' }),
      ]);
      expect(validated.status).toBe(200);
      expect(moved.status).toBe(200);
      const enrollment = await db.schoolEnrollment.findUniqueOrThrow({
        where: { id: enrollmentId },
      });
      const open = await db.schoolClassAssignment.findMany({
        where: { studentId: id, endedAt: null },
      });
      expect(open).toHaveLength(1);
      expect(open[0]!.classId).toBe(enrollment.classId);
    });

    it('S2-06 : une validation simultanée de la clôture ne laisse aucune affectation ouverte', async () => {
      const s = await structure(ownerA, `Cloture ${++counter}`);
      const { id, enrollmentId } = await pending(ownerA, s);
      const [validated, closed] = await Promise.all([
        ownerA
          .post(`/api/v1/school/enrollments/${enrollmentId}/status`)
          .send({ status: 'VALIDATED' }),
        ownerA.post(`/api/v1/school/years/${s.yearId}/status`).send({ status: 'CLOSED' }),
      ]);
      expect(closed.status).toBe(200);
      expect([200, 409]).toContain(validated.status);
      expect(
        await db.schoolClassAssignment.count({ where: { studentId: id, endedAt: null } }),
      ).toBe(0);
      const row = await db.schoolStudent.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe('REGISTERED');
    });

    it('S1-04 : aucune classe ni période ajoutée en même temps que la clôture ne reste ouverte', async () => {
      const s = await structure(ownerA, `Periode ${++counter}`);
      const period = {
        schoolYearId: s.yearId,
        kind: 'TRIMESTER',
        label: 'Trimestre',
        startsOn: '2026-10-01',
        endsOn: '2026-12-20',
      };
      const [closed, cls, concurrent] = await Promise.all([
        ownerA.post(`/api/v1/school/years/${s.yearId}/status`).send({ status: 'CLOSED' }),
        ownerA
          .post('/api/v1/school/classes')
          .send({ schoolYearId: s.yearId, levelId: s.levelId, name: 'CP1 Z' }),
        ownerA.post('/api/v1/school/periods').send(period),
      ]);
      expect(closed.status).toBe(200);
      expect([201, 409]).toContain(cls.status);
      expect([201, 409]).toContain(concurrent.status);
      await ownerA
        .post('/api/v1/school/classes')
        .send({ schoolYearId: s.yearId, levelId: s.levelId, name: 'CP1 Y' })
        .expect(409);
      await ownerA
        .post('/api/v1/school/periods')
        .send({
          schoolYearId: s.yearId,
          kind: 'TRIMESTER',
          label: 'Trimestre',
          startsOn: '2026-10-01',
          endsOn: '2026-12-20',
        })
        .expect(409);
    });

    /** Fait aboutir un transfert exactement entre le contrôle d'accès et la suite de la requête. */
    const transferAfterCheck = (id: string) => {
      const students = app.get(SchoolStudentsService);
      const original = students.findStudent.bind(students);
      return jest.spyOn(students, 'findStudent').mockImplementationOnce(async (ctx, target) => {
        const seen = await original(ctx, target);
        await ownerA
          .post(`/api/v1/school/students/${id}/transfer`)
          .send(transferBody(a2))
          .expect(200);
        return seen;
      });
    };

    it.each([
      ['enrollments', (id: string) => `/api/v1/school/students/${id}/enrollments`],
      ['guardians', (id: string) => `/api/v1/school/students/${id}/guardians`],
      ['documents', (id: string) => `/api/v1/school/students/${id}/documents`],
    ])('S2-11 : %s ne renvoie rien si le transfert suit le contrôle', async (_name, url) => {
      const s = await structure(ownerA, `Lecture ${++counter}`);
      const staff = await member(ownerA, 'SECRETARY', [s.schoolId]);
      const { id } = await enrolled(ownerA, s);
      await ownerA
        .post(`/api/v1/school/students/${id}/documents`)
        .field('category', 'OTHER')
        .attach('file', PDF, 'p.pdf')
        .expect(201);
      expect((await staff.agent.get(url(id)).expect(200)).body).toHaveLength(1);
      const spy = transferAfterCheck(id);
      try {
        const res = await staff.agent.get(url(id)).expect(200);
        expect(res.body).toEqual([]);
      } finally {
        spy.mockRestore();
      }
    });

    it('S2-11 : l’historique ne renvoie rien si le transfert suit le contrôle', async () => {
      const s = await structure(ownerA, `Histoire ${++counter}`);
      const staff = await member(ownerA, 'SECRETARY', [s.schoolId]);
      const { id } = await enrolled(ownerA, s);
      const spy = transferAfterCheck(id);
      try {
        const res = await staff.agent.get(`/api/v1/school/students/${id}/history`).expect(200);
        expect(res.body).toEqual({ events: [], assignments: [] });
      } finally {
        spy.mockRestore();
      }
    });

    it('S2-03 : l’ancienne école ne modifie ni ne rattache un responsable parti avec l’enfant', async () => {
      const s = await structure(ownerA, `Parti ${++counter}`);
      const staff = await member(ownerA, 'SECRETARY', [s.schoolId]);
      const { id } = await enrolled(ownerA, s);
      const links = await db.schoolStudentGuardian.findFirstOrThrow({ where: { studentId: id } });
      const other = await student(staff.agent, s.schoolId).expect(201);
      await ownerA
        .post(`/api/v1/school/students/${id}/transfer`)
        .send(transferBody(a2))
        .expect(200);
      await staff.agent
        .patch(`/api/v1/school/guardians/${links.guardianId}`)
        .send({ firstName: 'Modifie' })
        .expect(404);
      await staff.agent
        .post(`/api/v1/school/students/${other.body.id}/guardians`)
        .send({ guardianId: links.guardianId, relation: 'OTHER' })
        .expect(404);
    });

    it('S2-16 : un enseignant ne lit plus un élève sorti de sa classe après le contrôle', async () => {
      const s = await structure(ownerA, `Prof ${++counter}`);
      const prof = await member(ownerA, 'TEACHER', [s.schoolId]);
      await ownerA
        .post(`/api/v1/school/classes/${s.classId}/teachers`)
        .send({ memberId: prof.id })
        .expect(201);
      const { id, enrollmentId } = await enrolled(ownerA, s);
      await prof.agent.get(`/api/v1/school/students/${id}`).expect(200);
      const students = app.get(SchoolStudentsService);
      const original = students.findStudent.bind(students);
      const spy = jest
        .spyOn(students, 'findStudent')
        .mockImplementationOnce(async (ctx, target) => {
          const seen = await original(ctx, target);
          await ownerA
            .post(`/api/v1/school/enrollments/${enrollmentId}/class`)
            .send({ classId: s.otherClassId, reason: 'Essai' })
            .expect(200);
          return seen;
        });
      try {
        await prof.agent.get(`/api/v1/school/students/${id}`).expect(404);
      } finally {
        spy.mockRestore();
      }
    });

    it('S2-16 : un enseignant retiré de sa classe après le contrôle ne lit plus rien', async () => {
      const s = await structure(ownerA, `Retrait ${++counter}`);
      const prof = await member(ownerA, 'TEACHER', [s.schoolId]);
      const classTeachers = `/api/v1/school/classes/${s.classId}/teachers`;
      await ownerA.post(classTeachers).send({ memberId: prof.id }).expect(201);
      const { id } = await enrolled(ownerA, s);
      await prof.agent.get(`/api/v1/school/students/${id}`).expect(200);
      const students = app.get(SchoolStudentsService);
      const original = students.findStudent.bind(students);
      const spy = jest
        .spyOn(students, 'findStudent')
        .mockImplementationOnce(async (ctx, target) => {
          const seen = await original(ctx, target);
          await ownerA.delete(`${classTeachers}/${prof.id}`).expect(204);
          return seen;
        });
      try {
        await prof.agent.get(`/api/v1/school/students/${id}`).expect(404);
      } finally {
        spy.mockRestore();
      }
      const list = await prof.agent
        .get(`/api/v1/school/students?schoolId=${s.schoolId}`)
        .expect(200);
      expect(list.body.items).toEqual([]);
      await prof.agent.get(`/api/v1/school/classes/${s.classId}/students`).expect(404);
    });

    it('S2-17 : aucun lien de document après un transfert survenu après le contrôle', async () => {
      const s = await structure(ownerA, `Lien ${++counter}`);
      const staff = await member(ownerA, 'SECRETARY', [s.schoolId]);
      const created = await student(ownerA, s.schoolId).expect(201);
      const url = `/api/v1/school/students/${created.body.id}/documents`;
      const doc = await ownerA
        .post(url)
        .field('category', 'OTHER')
        .attach('file', PDF, 'p.pdf')
        .expect(201);
      await staff.agent.get(`${url}/${doc.body.id}/link`).expect(200);
      const spy = transferAfterCheck(created.body.id);
      try {
        await staff.agent.get(`${url}/${doc.body.id}/link`).expect(404);
      } finally {
        spy.mockRestore();
      }
    });

    it('S2-03 : un transfert survenu après le contrôle bloque le rattachement à ce dossier', async () => {
      const s = await structure(ownerA, `Rattache ${++counter}`);
      const staff = await member(ownerA, 'SECRETARY', [s.schoolId]);
      const created = await student(ownerA, s.schoolId).expect(201);
      const parent = await guardian(ownerA, s.schoolId, 'Rattache').expect(201);
      const spy = transferAfterCheck(created.body.id);
      try {
        await staff.agent
          .post(`/api/v1/school/students/${created.body.id}/guardians`)
          .send({ guardianId: parent.body.id, relation: 'OTHER' })
          .expect(404);
      } finally {
        spy.mockRestore();
      }
      expect(await db.schoolStudentGuardian.count({ where: { studentId: created.body.id } })).toBe(
        0,
      );
    });

    it('S1-05 : l’activation reste identique dans les deux bases', async () => {
      const m = await member(ownerA, 'TEACHER', [a1.schoolId]);
      const url = `/api/v1/school/members/${m.id}`;
      const results = await Promise.all([
        ownerA.patch(url).send({ isActive: false }),
        ownerA.patch(url).send({ isActive: true }),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const row = await db.schoolMember.findUniqueOrThrow({ where: { id: m.id } });
      const accounts = await app.get(PrismaService).organizationMembership.findMany({
        where: { userId: row.userId, role: 'PRODUCT_USER' },
      });
      expect(accounts.map((a) => a.isActive)).toEqual([row.isActive]);
    });

    it('S2-12 : un dossier créé pendant le changement de réglage suit le périmètre final', async () => {
      const s = await structure(ownerA, `Portee ${++counter}`);
      const settings = await ownerA
        .get(`/api/v1/school/student-settings?schoolId=${s.schoolId}`)
        .expect(200);
      const [saved, created] = await Promise.all([
        ownerA
          .put(`/api/v1/school/student-settings?schoolId=${s.schoolId}`)
          .send({ ...settings.body, matriculeScope: 'GROUP' }),
        student(ownerA, s.schoolId),
      ]);
      expect(created.status).toBe(201);
      const row = await db.schoolStudent.findUniqueOrThrow({ where: { id: created.body.id } });
      if (saved.status === 200) expect(row.matriculeScope).toBe('GROUP');
      else {
        expect(saved.status).toBe(409);
        expect(row.matriculeScope).toBe(s.schoolId);
      }
    });

    it('S2-13 : deux élèves déplacés en même temps vers la même classe aboutissent', async () => {
      const s = await structure(ownerA, `Places ${++counter}`);
      const [one, two] = [await enrolled(ownerA, s), await enrolled(ownerA, s)];
      const results = await Promise.all(
        [one, two].map((e) =>
          ownerA
            .post(`/api/v1/school/enrollments/${e.enrollmentId}/class`)
            .send({ classId: s.otherClassId, reason: 'Essai' }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200]);
    });

    it('S2-07 : deux modifications simultanées gardent une identité exacte', async () => {
      const created = await student(ownerA, a1.schoolId, {
        lastName: `Ancien${RUN}`,
        firstName: 'Prenom',
        birthDate: '2014-06-06',
      }).expect(201);
      const id = created.body.id as string;
      const url = `/api/v1/school/students/${id}`;
      const [a, b] = await Promise.all([
        ownerA.patch(url).send({ lastName: `Nouveau${RUN}` }),
        ownerA.patch(url).send({ firstName: 'Autre' }),
      ]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      const dup = await student(ownerA, a1.schoolId, {
        lastName: `Nouveau${RUN}`,
        firstName: 'Autre',
        birthDate: '2014-06-06',
      }).expect(409);
      expect(dup.body.code).toBe('STUDENT_DUPLICATE');
      expect(dup.body.details).toEqual([id]);
    });

    it('S2-08 : la limite de documents tient face aux envois simultanés', async () => {
      const created = await student(ownerA, a1.schoolId).expect(201);
      const id = created.body.id as string;
      const url = `/api/v1/school/students/${id}/documents`;
      const send = () => ownerA.post(url).field('category', 'OTHER').attach('file', PDF, 'p.pdf');
      for (let i = 0; i < 29; i++) await send().expect(201);
      const results = await Promise.all([send(), send()]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(
        await db.schoolStudentDocument.count({ where: { studentId: id, deletedAt: null } }),
      ).toBe(30);
    });

    it('S1-01 : un directeur ne modifie pas globalement un membre partagé', async () => {
      const director = await member(ownerA, 'SCHOOL_DIRECTOR', [a1.schoolId]);
      const shared = await member(ownerA, 'TEACHER', [a1.schoolId, a2.schoolId]);
      const url = `/api/v1/school/members/${shared.id}`;
      const role = await director.agent.patch(url).send({ role: 'SECRETARY' }).expect(403);
      expect(role.body.code).toBe('SCHOOL_MEMBER_SHARED');
      await director.agent.patch(url).send({ isActive: false }).expect(403);

      const local = await structure(ownerA, `Membre ${++counter}`);
      const both = await member(ownerA, 'SCHOOL_DIRECTOR', [a1.schoolId, local.schoolId]);
      await both.agent
        .patch(url)
        .send({ schoolIds: [local.schoolId] })
        .expect(200);
      const assignments = await db.schoolMemberAssignment.findMany({
        where: { memberId: shared.id },
      });
      expect(assignments.map((a) => a.schoolId).sort()).toEqual(
        [a2.schoolId, local.schoolId].sort(),
      );
      const seen = await director.agent.get('/api/v1/school/members').expect(200);
      expect(JSON.stringify(seen.body)).not.toContain(a2.schoolId);
    });

    it('S1-02 : un renouvellement simultané ne réactive pas un contrat résilié', async () => {
      const c = await client(`renew${++counter}`);
      const [renew, terminate] = await Promise.all([
        platform.agent
          .post(`/api/v1/platform/contracts/${c.contractId}/renew`)
          .send({ endsOn: '2199-12-31', reason: 'Renouvellement' }),
        platform.agent
          .post(`/api/v1/platform/contracts/${c.contractId}/status`)
          .send({ status: 'TERMINATED', reason: 'Résiliation' }),
      ]);
      expect(terminate.status).toBe(200);
      expect([200, 409]).toContain(renew.status);
      const row = await app.get(PrismaService).suiteContract.findUniqueOrThrow({
        where: { id: c.contractId },
      });
      expect(row.status).toBe('TERMINATED');
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
