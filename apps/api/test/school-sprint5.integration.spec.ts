import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Workbook } from 'exceljs';
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
 * Ocall School, Sprint 5 : frais, échéanciers, avantages, encaissements, annulations, reçus, tableau de
 * bord. Données entièrement fictives. Exige TEST_DATABASE_URL et SCHOOL_TEST_DATABASE_URL (ou
 * TEST_SCHOOL_DATABASE_URL) : base School de test (Neon `test` ou PostgreSQL jetable), jamais la production.
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

suite('Ocall School — Sprint 5, gestion financière (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: SchoolPrismaService;
  let platform: InternalAccount;
  let ownerA: Agent;
  let ownerB: Agent;
  let a1: Structure;
  let a2: Structure;
  let b1: Structure;
  let accountant: Member;
  let secretary: Member;
  let teacher: Member;
  let directorA2: Member;
  let s1: string;
  let s2: string;
  let s3: string;
  let sB: string;
  let tuition: string;
  let canteen: string;
  let firstPayment: string;
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
        ownerEmail: email(`owner5-${label}`),
        reference: `OCS5-${RUN}-${++counter}`,
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
  ) {
    const created = await owner
      .post('/api/v1/school/students')
      .send({ schoolId: s.schoolId, lastName, firstName: 'Awa', birthDate: '2016-02-14' })
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
      .send({ studentId: created.body.id, schoolYearId: s.yearId, levelId, classId, submit: true })
      .expect(201);
    await owner
      .post(`/api/v1/school/enrollments/${enrollment.body.id}/status`)
      .send({ status: 'VALIDATED' })
      .expect(200);
    return created.body.id as string;
  }

  const fee = (agent: Agent, body: Record<string, unknown>) =>
    agent.post('/api/v1/school/finance/fees').send({
      schoolYearId: a1.yearId,
      category: 'TUITION',
      name: 'Scolarité',
      amount: 90_000,
      effectiveFrom: '2026-10-01',
      plan: { kind: 'MONTHLY', firstMonth: '2026-10', lastMonth: '2027-06', dueDay: 5 },
      ...body,
    });

  const situation = (agent: Agent, studentId: string) =>
    agent.get(`/api/v1/school/finance/students/${studentId}?schoolYearId=${a1.yearId}`);

  const pay = (agent: Agent, body: Record<string, unknown>) =>
    agent.post('/api/v1/school/finance/payments').send({
      schoolYearId: a1.yearId,
      method: 'CASH',
      idempotencyKey: randomUUID(),
      ...body,
    });

  const pdf = (agent: Agent, url: string) => agent.get(url).buffer(true).parse(binary);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(SchoolPrismaService);
    platform = await internalAccount(app, prisma, `sc5-owner-${RUN}`, 'PLATFORM_OWNER');
    ownerA = await client('a');
    ownerB = await client('b');
    a1 = await structure(ownerA, 'Ecole Finances');
    a2 = await structure(ownerA, 'Ecole Voisine Finances');
    b1 = await structure(ownerB, 'Ecole Autre Client Finances');
    accountant = await member(ownerA, 'ACCOUNTANT', [a1.schoolId]);
    secretary = await member(ownerA, 'SECRETARY', [a1.schoolId]);
    teacher = await member(ownerA, 'TEACHER', [a1.schoolId]);
    directorA2 = await member(ownerA, 'SCHOOL_DIRECTOR', [a2.schoolId]);
    s1 = await enrolled(ownerA, a1, a1.class1, a1.level1, 'Ba');
    s2 = await enrolled(ownerA, a1, a1.class1, a1.level1, 'Cisse');
    s3 = await enrolled(ownerA, a1, a1.class2, a1.level2, 'Diop');
    sB = await enrolled(ownerB, b1, b1.class1, b1.level1, 'Gueye');
  }, 600_000);

  afterAll(async () => {
    const where = { organizationId: { in: organizations } };
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

  describe('réglages et catalogue des frais', () => {
    it('réglages : XOF par défaut, réservés à la direction', async () => {
      const res = await ownerA
        .get(`/api/v1/school/finance/settings?schoolId=${a1.schoolId}`)
        .expect(200);
      expect(res.body).toEqual({
        currency: 'XOF',
        receiptPrefix: 'REC',
        secretaryCanCollect: false,
      });
      await secretary.agent
        .put('/api/v1/school/finance/settings')
        .send({ schoolId: a1.schoolId, receiptPrefix: 'XX' })
        .expect(403);
      await teacher.agent
        .get(`/api/v1/school/finance/settings?schoolId=${a1.schoolId}`)
        .expect(403);
      await ownerB.get(`/api/v1/school/finance/settings?schoolId=${a1.schoolId}`).expect(404);
      await ownerA
        .put('/api/v1/school/finance/settings')
        .send({ schoolId: a1.schoolId, receiptPrefix: 'ECF' })
        .expect(200);
      for (const field of ['currency', 'receiptPrefix', 'secretaryCanCollect']) {
        await ownerA
          .put('/api/v1/school/finance/settings')
          .send({ schoolId: a1.schoolId, [field]: null })
          .expect(400);
      }
    });

    it('création : échéancier mensuel exact ; contrôles de portée et de somme', async () => {
      const created = await fee(ownerA, {}).expect(201);
      tuition = created.body.id;
      const list = await accountant.agent
        .get(`/api/v1/school/finance/fees?schoolYearId=${a1.yearId}`)
        .expect(200);
      const row = list.body.find((f: { id: string }) => f.id === tuition);
      expect(row.installments).toHaveLength(9);
      expect(row.installments.reduce((s: number, i: { amount: number }) => s + i.amount, 0)).toBe(
        90_000,
      );
      expect(row.currency).toBe('XOF');
      await fee(accountant.agent, {}).expect(403);
      await fee(ownerA, { levelId: a2.level1 }).expect(404);
      await fee(ownerA, { classId: a1.class2, levelId: a1.level1 }).expect(400);
      const custom = await fee(ownerA, {
        plan: { kind: 'CUSTOM', installments: [{ dueOn: '2026-10-10', amount: 1 }] },
      }).expect(400);
      expect(custom.body.code).toBe('INVALID_PLAN');
      await fee(ownerA, { plan: undefined }).expect(400);
      await fee(ownerA, { plan: 'MONTHLY' }).expect(400);
      await fee(ownerB, {}).expect(404);
      await ownerA
        .put('/api/v1/school/finance/settings')
        .send({ schoolId: a1.schoolId, currency: 'EUR' })
        .expect(409);
      canteen = (
        await fee(ownerA, {
          category: 'CANTEEN',
          name: 'Cantine',
          nameAr: 'المطعم',
          amount: 18_000,
          mandatory: false,
          classId: a1.class1,
          plan: { kind: 'QUARTERLY', firstMonth: '2026-10', lastMonth: '2027-06', dueDay: 10 },
        }).expect(201)
      ).body.id;
    });
  });

  describe('échéances', () => {
    it('génération par élève, jamais deux fois ; frais facultatif pour les élèves désignés', async () => {
      const first = await ownerA
        .post(`/api/v1/school/finance/fees/${tuition}/generate`)
        .send({})
        .expect(200);
      expect(first.body).toEqual({ created: 27, students: 3 });
      const again = await ownerA
        .post(`/api/v1/school/finance/fees/${tuition}/generate`)
        .send({})
        .expect(200);
      expect(again.body.created).toBe(0);
      expect(
        (await ownerA.post(`/api/v1/school/finance/fees/${canteen}/generate`).send({}).expect(400))
          .body.code,
      ).toBe('STUDENTS_REQUIRED');
      await ownerA
        .post(`/api/v1/school/finance/fees/${canteen}/generate`)
        .send({ studentIds: [s3] })
        .expect(400);
      const optional = await ownerA
        .post(`/api/v1/school/finance/fees/${canteen}/generate`)
        .send({ studentIds: [s1] })
        .expect(200);
      expect(optional.body.created).toBe(3);
      await accountant.agent
        .post(`/api/v1/school/finance/fees/${tuition}/generate`)
        .send({})
        .expect(403);
      expect(await db.schoolCharge.count({ where: { studentId: s1 } })).toBe(12);
    });

    it('nouveau montant : futures échéances seulement ; échéancier d’un frais facturé verrouillé', async () => {
      await ownerA
        .patch(`/api/v1/school/finance/fees/${tuition}`)
        .send({ amount: 99_000 })
        .expect(200);
      const charge = await db.schoolCharge.findFirstOrThrow({
        where: { studentId: s1, feeId: tuition, position: 1 },
      });
      expect(charge.amount).toBe(10_000);
      for (const field of ['amount', 'effectiveFrom', 'name', 'mandatory', 'isActive', 'plan']) {
        await ownerA
          .patch(`/api/v1/school/finance/fees/${canteen}`)
          .send({ [field]: null })
          .expect(400);
      }
      await ownerA
        .patch(`/api/v1/school/finance/fees/${canteen}`)
        .send({ nameAr: null })
        .expect(200);
      await ownerA
        .patch(`/api/v1/school/finance/fees/${canteen}`)
        .send({ nameAr: 'المطعم' })
        .expect(200);
      const locked = await ownerA
        .patch(`/api/v1/school/finance/fees/${tuition}`)
        .send({ plan: { kind: 'ANNUAL', dueOn: '2026-10-05' } })
        .expect(409);
      expect(locked.body.code).toBe('FEE_PLAN_LOCKED');
      const history = await ownerA
        .get(`/api/v1/school/finance/fees/${tuition}/history`)
        .expect(200);
      expect(history.body.map((e: { action: string }) => e.action)).toEqual(['updated', 'created']);
      expect(history.body[0].before.amount).toBe(90_000);
      expect(history.body[0].after.amount).toBe(99_000);
      // Échéancier saisi et échéances calculées historisés, avant comme après.
      expect(history.body[0].after.plan).toMatchObject({ kind: 'MONTHLY', dueDay: 5 });
      expect(history.body[0].before.installments).toHaveLength(9);
      expect(history.body[0].after.installments[0]).toEqual({
        position: 1,
        dueOn: '2026-10-05',
        amount: 11_000,
      });
    });

    it('date d’application respectée ; cumuls bornés à la limite des montants', async () => {
      const later = await fee(ownerA, {
        schoolYearId: a2.yearId,
        effectiveFrom: '2099-01-01',
      }).expect(201);
      const early = await ownerA
        .post(`/api/v1/school/finance/fees/${later.body.id}/generate`)
        .send({})
        .expect(409);
      expect(early.body.code).toBe('FEE_NOT_YET_EFFECTIVE');
      // Établissement voisin, élève dédié : aucun effet sur les totaux de l'école principale.
      const big = await enrolled(ownerA, a2, a2.class1, a2.level1, 'Kane');
      const max = await fee(ownerA, {
        schoolYearId: a2.yearId,
        amount: 1_000_000_000,
        plan: { kind: 'ANNUAL', dueOn: '2026-10-05' },
      }).expect(201);
      await ownerA.post(`/api/v1/school/finance/fees/${max.body.id}/generate`).send({}).expect(200);
      const charge = await db.schoolCharge.findFirstOrThrow({ where: { studentId: big } });
      const adjust = await ownerA
        .post(`/api/v1/school/finance/charges/${charge.id}/adjust`)
        .send({ amount: 1, reason: 'Fournitures' })
        .expect(400);
      expect(adjust.body.code).toBe('AMOUNT_TOO_LARGE');
      const extra = await fee(ownerA, {
        schoolYearId: a2.yearId,
        category: 'OTHER',
        name: 'Tenue',
        amount: 100,
        plan: { kind: 'ANNUAL', dueOn: '2026-10-05' },
      }).expect(201);
      const total = await ownerA
        .post(`/api/v1/school/finance/fees/${extra.body.id}/generate`)
        .send({})
        .expect(409);
      expect(total.body.code).toBe('TOTAL_TOO_LARGE');
      expect(await db.schoolCharge.count({ where: { studentId: big } })).toBe(1);
    });

    it('situation : statuts et soldes ; enseignant refusé, autre client introuvable', async () => {
      const res = await secretary.agent
        .get(`/api/v1/school/finance/students/${s1}?schoolYearId=${a1.yearId}`)
        .expect(200);
      expect(res.body.charges).toHaveLength(12);
      const october = res.body.charges.find(
        (c: { label: string }) => c.label === 'Scolarité (1/9)',
      );
      expect(october).toMatchObject({ status: 'OVERDUE', balance: 10_000, dueOn: '2026-10-05' });
      expect(res.body.totals.due).toBe(90_000 + 18_000);
      await situation(teacher.agent, s1).expect(403);
      await situation(ownerB, s1).expect(404);
      await situation(directorA2.agent, s1).expect(404);
      await situation(ownerA, sB).expect(404);
    });
  });

  describe('réductions, bourses et exonérations', () => {
    it('bourse de 50 % sur la scolarité, réduction fixe, exonération ; retrait recalculé', async () => {
      const grant = (agent: Agent, body: Record<string, unknown>) =>
        agent
          .post('/api/v1/school/finance/benefits')
          .send({ schoolYearId: a1.yearId, reason: 'Dossier social', ...body });
      await grant(ownerA, {
        studentId: s2,
        kind: 'SCHOLARSHIP',
        value: 5000,
        category: 'TUITION',
      }).expect(201);
      let s2Charges = (await situation(ownerA, s2).expect(200)).body.charges;
      expect(s2Charges.every((c: { discount: number }) => c.discount === 5000)).toBe(true);
      const fixed = await grant(ownerA, {
        studentId: s2,
        kind: 'FIXED',
        value: 1000,
        feeId: tuition,
      }).expect(201);
      s2Charges = (await situation(ownerA, s2).expect(200)).body.charges;
      expect(s2Charges[0].discount).toBe(6000);
      await ownerA
        .post(`/api/v1/school/finance/benefits/${fixed.body.id}/revoke`)
        .send({ reason: 'Erreur de saisie' })
        .expect(200);
      expect((await situation(ownerA, s2).expect(200)).body.charges[0].discount).toBe(5000);
      await grant(ownerA, { studentId: s3, kind: 'EXEMPTION', value: 0 }).expect(201);
      expect((await situation(ownerA, s3).expect(200)).body.totals.due).toBe(0);
      await grant(secretary.agent, { studentId: s1, kind: 'PERCENT', value: 1000 }).expect(403);
      await grant(ownerA, { studentId: s1, kind: 'PERCENT', value: 10_001 }).expect(400);
      await grant(ownerA, { studentId: sB, kind: 'PERCENT', value: 1000 }).expect(404);
      const list = await accountant.agent
        .get(`/api/v1/school/finance/benefits?schoolYearId=${a1.yearId}`)
        .expect(200);
      expect(list.body.find((b: { id: string }) => b.id === fixed.body.id).status).toBe('REVOKED');
    });
  });

  describe('devise', () => {
    it('réduction fixe accordée avant tout frais : la devise ne peut plus changer, même après retrait', async () => {
      const lone = await structure(ownerA, 'Ecole Devise');
      const pupil = await enrolled(ownerA, lone, lone.class1, lone.level1, 'Mbaye');
      const currency = (value: string) =>
        ownerA
          .put('/api/v1/school/finance/settings')
          .send({ schoolId: lone.schoolId, currency: value });
      await currency('EUR').expect(200);
      await currency('XOF').expect(200);
      const benefit = await ownerA
        .post('/api/v1/school/finance/benefits')
        .send({
          schoolYearId: lone.yearId,
          studentId: pupil,
          kind: 'FIXED',
          value: 10_000,
          reason: 'Dossier social',
        })
        .expect(201);
      expect((await currency('EUR').expect(409)).body.code).toBe('CURRENCY_LOCKED');
      await ownerA
        .post(`/api/v1/school/finance/benefits/${benefit.body.id}/revoke`)
        .send({ reason: 'Erreur de saisie' })
        .expect(200);
      expect((await currency('EUR').expect(409)).body.code).toBe('CURRENCY_LOCKED');
    });
  });

  describe('encaissements', () => {
    it('paiement partiel couvrant plusieurs échéances, de la plus ancienne à la plus récente', async () => {
      const res = await pay(accountant.agent, { studentId: s1, amount: 25_000 }).expect(201);
      firstPayment = res.body.id;
      expect(res.body.receiptNumber).toMatch(/^ECF-2026-\d{6}$/);
      expect(res.body.verification).toBe('NOT_APPLICABLE');
      expect(res.body.balanceAfter).toBe(108_000 - 25_000);
      const amounts = res.body.allocations
        .map((a: { amount: number; charge: { dueOn: string } }) => [
          a.charge.dueOn.slice(0, 10),
          a.amount,
        ])
        .sort();
      expect(amounts).toEqual([
        ['2026-10-05', 10_000],
        ['2026-10-10', 6000],
        ['2026-11-05', 9000],
      ]);
      // Trace durable écrite avec l'encaissement, puis publiée au journal.
      const decisions = await db.schoolAccessDecision.findMany({
        where: { organizationId: organizations[0], targetId: firstPayment },
      });
      expect(decisions.map((d) => d.action)).toEqual(['school.payment_recorded']);
      expect(decisions[0]!.publishedAt).not.toBeNull();
    });

    it('soumission répétée : un seul encaissement ; doublon apparent à confirmer', async () => {
      const key = randomUUID();
      const first = await pay(accountant.agent, {
        studentId: s1,
        amount: 1000,
        idempotencyKey: key,
      }).expect(201);
      const repeat = await pay(accountant.agent, {
        studentId: s1,
        amount: 1000,
        idempotencyKey: key,
      }).expect(201);
      expect(repeat.body.id).toBe(first.body.id);
      expect(repeat.body.replayed).toBe(true);
      await pay(accountant.agent, { studentId: s1, amount: 2000, idempotencyKey: key }).expect(409);
      // Même élève, montant et moyen, mais une autre demande : jamais l'ancien encaissement renvoyé.
      for (const other of [{ note: 'Autre remarque' }, { paidAt: '2026-11-01T08:00:00.000Z' }]) {
        const mismatch = await pay(accountant.agent, {
          studentId: s1,
          amount: 1000,
          idempotencyKey: key,
          ...other,
        }).expect(409);
        expect(mismatch.body.code).toBe('IDEMPOTENCY_MISMATCH');
      }
      const lookalike = await pay(accountant.agent, { studentId: s1, amount: 1000 }).expect(409);
      expect(lookalike.body.code).toBe('POSSIBLE_DUPLICATE');
      await pay(accountant.agent, { studentId: s1, amount: 1000, confirmDuplicate: true }).expect(
        201,
      );
    });

    it('mobile money : référence exigée, déclaré non vérifié, jamais encaissé deux fois', async () => {
      expect(
        (
          await pay(accountant.agent, {
            studentId: s1,
            amount: 3000,
            method: 'MOBILE_MONEY',
          }).expect(400)
        ).body.code,
      ).toBe('REFERENCE_REQUIRED');
      const mm = await pay(accountant.agent, {
        studentId: s1,
        amount: 3000,
        method: 'MOBILE_MONEY',
        reference: 'WAVE-0001',
      }).expect(201);
      expect(mm.body.verification).toBe('DECLARED_UNVERIFIED');
      const twice = await pay(accountant.agent, {
        studentId: s2,
        amount: 3000,
        method: 'MOBILE_MONEY',
        reference: 'wave-0001',
      }).expect(409);
      expect(twice.body.code).toBe('DUPLICATE_REFERENCE');
    });

    it('affectation explicite, dépassement refusé, droits de caisse', async () => {
      const charges = (await situation(ownerA, s2).expect(200)).body.charges as {
        id: string;
        balance: number;
      }[];
      const explicit = await pay(accountant.agent, {
        studentId: s2,
        amount: charges[0]!.balance + 1000,
        allocations: [
          { chargeId: charges[0]!.id, amount: charges[0]!.balance },
          { chargeId: charges[1]!.id, amount: 1000 },
        ],
      }).expect(201);
      expect(explicit.body.allocations).toHaveLength(2);
      expect(
        (await pay(accountant.agent, { studentId: s2, amount: 999_999 }).expect(400)).body.code,
      ).toBe('AMOUNT_EXCEEDS_BALANCE');
      await pay(accountant.agent, {
        studentId: s2,
        amount: 500,
        allocations: [{ chargeId: charges[2]!.id, amount: 400 }],
      }).expect(400);
      await pay(secretary.agent, { studentId: s2, amount: 500 }).expect(403);
      await pay(teacher.agent, { studentId: s2, amount: 500 }).expect(403);
      await pay(ownerB, { studentId: s2, amount: 500 }).expect(404);
      await pay(accountant.agent, { studentId: sB, amount: 500 }).expect(404);
      await ownerA
        .put('/api/v1/school/finance/settings')
        .send({ schoolId: a1.schoolId, secretaryCanCollect: true })
        .expect(200);
      await pay(secretary.agent, { studentId: s2, amount: 500 }).expect(201);
      await ownerA
        .put('/api/v1/school/finance/settings')
        .send({ schoolId: a1.schoolId, secretaryCanCollect: false })
        .expect(200);
      await pay(secretary.agent, { studentId: s2, amount: 501 }).expect(403);
    });
  });

  describe('annulations et ajustements', () => {
    it('contrepassation motivée par la direction, reçu conservé au statut annulé', async () => {
      const before = (await situation(ownerA, s1).expect(200)).body.totals.paid;
      await accountant.agent
        .post(`/api/v1/school/finance/payments/${firstPayment}/cancel`)
        .send({ reason: 'Erreur' })
        .expect(403);
      await ownerA
        .post(`/api/v1/school/finance/payments/${firstPayment}/cancel`)
        .send({ reason: 'X' })
        .expect(400);
      const cancelled = await ownerA
        .post(`/api/v1/school/finance/payments/${firstPayment}/cancel`)
        .send({ reason: 'Erreur de caisse' })
        .expect(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(cancelled.body.reversal).not.toBeNull();
      const after = (await situation(ownerA, s1).expect(200)).body.totals.paid;
      expect(after).toBe(before - 25_000);
      expect(
        (
          await ownerA
            .post(`/api/v1/school/finance/payments/${firstPayment}/cancel`)
            .send({ reason: 'Encore' })
            .expect(409)
        ).body.code,
      ).toBe('PAYMENT_CANCELLED');
      const receipt = await pdf(
        accountant.agent,
        `/api/v1/school/finance/payments/${firstPayment}/receipt`,
      ).expect(200);
      expect((receipt.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      const reversal = await db.schoolPayment.findFirstOrThrow({
        where: { reversalOfId: firstPayment },
      });
      expect(reversal).toMatchObject({ kind: 'REVERSAL', amount: 25_000 });
      const decisions = await db.schoolAccessDecision.findMany({
        where: { organizationId: organizations[0], targetId: firstPayment },
      });
      expect(decisions.map((d) => d.action)).toContain('school.payment_cancelled');
      expect(JSON.stringify(decisions)).not.toContain('Erreur de caisse');
    });

    it('après annulation, la même référence peut servir à la correction', async () => {
      const mm = await db.schoolPayment.findFirstOrThrow({ where: { reference: 'WAVE-0001' } });
      await ownerA
        .post(`/api/v1/school/finance/payments/${mm.id}/cancel`)
        .send({ reason: 'Montant erroné' })
        .expect(200);
      await pay(accountant.agent, {
        studentId: s1,
        amount: 3500,
        method: 'MOBILE_MONEY',
        reference: 'WAVE-0001',
      }).expect(201);
    });

    it('ajustement justifié ; jamais sous le montant payé ; avantage refusé s’il crée un trop-perçu', async () => {
      const charges = (await situation(ownerA, s1).expect(200)).body.charges as {
        id: string;
        paid: number;
        due: number;
        label: string;
      }[];
      const target = charges.find((c) => c.paid > 0)!;
      await ownerA
        .post(`/api/v1/school/finance/charges/${target.id}/adjust`)
        .send({ amount: 2000, reason: 'Fournitures' })
        .expect(200);
      const below = await ownerA
        .post(`/api/v1/school/finance/charges/${target.id}/adjust`)
        .send({ amount: -(target.due + 2000), reason: 'Remise' })
        .expect(409);
      expect(below.body.code).toBe('ADJUSTMENT_BELOW_PAID');
      await accountant.agent
        .post(`/api/v1/school/finance/charges/${target.id}/adjust`)
        .send({ amount: 100, reason: 'Essai' })
        .expect(403);
      const exceed = await ownerA
        .post('/api/v1/school/finance/benefits')
        .send({
          schoolYearId: a1.yearId,
          studentId: s1,
          kind: 'EXEMPTION',
          value: 0,
          reason: 'Exonération tardive',
        })
        .expect(409);
      expect(exceed.body.code).toBe('BENEFIT_EXCEEDS_PAID');
    });
  });

  describe('reçus, tableau de bord, impayés et exports', () => {
    it('reçu : comptabilité et secrétariat ; enseignant refusé ; autre client introuvable ; trois langues', async () => {
      const payment = await db.schoolPayment.findFirstOrThrow({
        where: { studentId: s2, kind: 'PAYMENT', status: 'CONFIRMED' },
      });
      const url = `/api/v1/school/finance/payments/${payment.id}/receipt`;
      const res = await pdf(secretary.agent, url).expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['cache-control']).toBe('private, no-store');
      await pdf(teacher.agent, url).expect(403);
      await pdf(ownerB, url).expect(404);
      await pdf(directorA2.agent, url).expect(404);
      expect([401, 403]).toContain((await request(app.getHttpServer()).get(url)).status);
      // Langue de l'établissement au moment de l'encaissement, figée avec le reçu.
      try {
        for (const [locale, arabic, amount] of [
          ['FR', false, 310],
          ['AR', true, 320],
          ['BILINGUAL', true, 330],
        ] as const) {
          await ownerA
            .patch(`/api/v1/school/schools/${a1.schoolId}`)
            .send({ defaultLocale: locale })
            .expect(200);
          const paid = await pay(accountant.agent, { studentId: s2, amount }).expect(201);
          const raw = (
            (
              await pdf(ownerA, `/api/v1/school/finance/payments/${paid.body.id}/receipt`).expect(
                200,
              )
            ).body as Buffer
          ).toString('latin1');
          expect(/NotoNaskhArabic/.test(raw)).toBe(arabic);
        }
      } finally {
        await ownerA
          .patch(`/api/v1/school/schools/${a1.schoolId}`)
          .send({ defaultLocale: 'FR' })
          .expect(200);
      }
    });

    it('reçu réédité identique au reçu remis, malgré les changements de l’élève et de l’établissement', async () => {
      const paid = await pay(accountant.agent, { studentId: s2, amount: 810 }).expect(201);
      const url = `/api/v1/school/finance/payments/${paid.body.id}/receipt`;
      // Seuls la date de production et l'identifiant du fichier varient d'une édition à l'autre.
      const body = async () =>
        ((await pdf(ownerA, url).expect(200)).body as Buffer)
          .toString('latin1')
          .replace(/\(D:\d{14}Z\)/g, '')
          .replace(/\/ID \[<[0-9a-f]+> <[0-9a-f]+>\]/g, '');
      const issued = await body();
      expect(await body()).toBe(issued);
      const stored = await db.schoolPayment.findUniqueOrThrow({ where: { id: paid.body.id } });
      expect(stored.receiptSnapshot).toMatchObject({ locale: 'FR', yearLabel: '2026-2027' });
      const student = await db.schoolStudent.findUniqueOrThrow({ where: { id: s2 } });
      const school = await db.school.findUniqueOrThrow({ where: { id: a1.schoolId } });
      await db.schoolStudent.update({ where: { id: s2 }, data: { lastName: 'Renommé' } });
      await db.school.update({
        where: { id: a1.schoolId },
        data: { address: 'Nouvelle adresse', defaultLocale: 'AR' },
      });
      try {
        expect(await body()).toBe(issued);
      } finally {
        await db.schoolStudent.update({ where: { id: s2 }, data: { lastName: student.lastName } });
        await db.school.update({
          where: { id: a1.schoolId },
          data: { address: school.address, defaultLocale: school.defaultLocale },
        });
      }
    });

    it('tableau de bord cohérent : attendu = encaissé + solde ; réservé à la direction et à la comptabilité', async () => {
      const res = await accountant.agent
        .get(`/api/v1/school/finance/dashboard?schoolYearId=${a1.yearId}`)
        .expect(200);
      const d = res.body;
      expect(d.expected).toBe(d.collected + d.balance);
      const net = (d.collectionsByMethod as { amount: number }[]).reduce((s, m) => s + m.amount, 0);
      expect(net).toBe(d.collected);
      expect((d.collectionsByMonth as { amount: number }[]).reduce((s, m) => s + m.amount, 0)).toBe(
        d.collected,
      );
      expect(d.studentsInArrears).toBeGreaterThanOrEqual(1);
      expect(d.byClass.reduce((s: number, c: { expected: number }) => s + c.expected, 0)).toBe(
        d.expected,
      );
      const byClass = await ownerA
        .get(`/api/v1/school/finance/dashboard?schoolYearId=${a1.yearId}&classId=${a1.class2}`)
        .expect(200);
      expect(byClass.body.expected).toBe(0);
      // Sans période : situation annuelle seule. Période passée : rien encaissé, situation inchangée.
      expect(d.periodCollected).toBeNull();
      const dashboard = (from: string, to: string) =>
        ownerA
          .get(`/api/v1/school/finance/dashboard?schoolYearId=${a1.yearId}&from=${from}&to=${to}`)
          .expect(200);
      const before = (await dashboard('2026-01-01', '2026-01-31')).body;
      expect(before).toMatchObject({ periodCollected: 0, collected: d.collected });
      expect(
        before.byClass.every((c: { periodCollected: number }) => c.periodCollected === 0),
      ).toBe(true);
      // Toute l'année : l'encaissé sur la période (contrepassations comprises) égale l'encaissé.
      const whole = (await dashboard('2026-01-01', '2099-12-31')).body;
      expect(whole.periodCollected).toBe(d.collected);
      expect(
        whole.byClass.reduce(
          (s: number, c: { periodCollected: number }) => s + c.periodCollected,
          0,
        ),
      ).toBe(d.collected);
      const tuitionOnly = await ownerA
        .get(`/api/v1/school/finance/dashboard?schoolYearId=${a1.yearId}&category=CANTEEN`)
        .expect(200);
      expect(tuitionOnly.body.expected).toBe(18_000);
      await secretary.agent
        .get(`/api/v1/school/finance/dashboard?schoolYearId=${a1.yearId}`)
        .expect(403);
      await ownerB.get(`/api/v1/school/finance/dashboard?schoolYearId=${a1.yearId}`).expect(404);
    });

    it('impayés et exports CSV / XLSX journalisés', async () => {
      const unpaid = await ownerA
        .get(`/api/v1/school/finance/unpaid?schoolYearId=${a1.yearId}`)
        .expect(200);
      expect(unpaid.body.map((u: { student: { id: string } }) => u.student.id)).toContain(s1);
      expect(unpaid.body.every((u: { overdue: number }) => u.overdue > 0)).toBe(true);
      const own = (await situation(ownerA, s1).expect(200)).body.totals;
      const row = unpaid.body.find((u: { student: { id: string } }) => u.student.id === s1);
      expect(row).toMatchObject({ overdue: own.overdue, balance: own.balance, className: 'CM1 A' });
      const filtered = (query: string) =>
        ownerA.get(`/api/v1/school/finance/unpaid?schoolYearId=${a1.yearId}${query}`).expect(200);
      expect((await filtered(`&classId=${a1.class2}`)).body).toEqual([]);
      const canteenUnpaid = (await filtered('&category=CANTEEN')).body;
      expect(canteenUnpaid.map((u: { student: { id: string } }) => u.student.id)).toEqual([s1]);
      expect(canteenUnpaid[0].balance).toBeLessThan(row.balance);
      const csv = await ownerA
        .get(`/api/v1/school/finance/export?schoolYearId=${a1.yearId}&kind=unpaid&format=csv`)
        .expect(200);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      expect(csv.text).toContain('Matricule');
      const xlsx = await pdf(
        ownerA,
        `/api/v1/school/finance/export?schoolYearId=${a1.yearId}&kind=payments&format=xlsx`,
      ).expect(200);
      expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
      // Montants : nombres signés, jamais neutralisés en texte (CSV) ni écrits en texte (XLSX).
      const paymentsCsv = (
        await ownerA
          .get(`/api/v1/school/finance/export?schoolYearId=${a1.yearId}&kind=payments&format=csv`)
          .expect(200)
      ).text;
      expect(paymentsCsv).toMatch(/;-25000;/);
      expect(paymentsCsv).not.toContain("'-");
      const book = new Workbook();
      await book.xlsx.load(xlsx.body as Buffer);
      const sheet = book.worksheets[0]!;
      const amountColumn = (sheet.getRow(1).values as unknown[]).indexOf('Montant');
      const amounts = sheet
        .getColumn(amountColumn)
        .values.slice(2)
        .filter((v) => v !== undefined && v !== null);
      expect(amounts.length).toBeGreaterThan(3);
      expect(amounts.every((v) => typeof v === 'number')).toBe(true);
      expect(amounts.some((v) => (v as number) < 0)).toBe(true);
      // Filtres du tableau de bord appliqués à l'export des encaissements.
      const rows = async (filter: string) =>
        (
          await ownerA
            .get(
              `/api/v1/school/finance/export?schoolYearId=${a1.yearId}&kind=payments&format=csv${filter}`,
            )
            .expect(200)
        ).text
          .split(/\r?\n/)
          .filter((l) => l.trim()).length - 1;
      const all = await rows('');
      expect(all).toBeGreaterThan(3);
      expect(await rows(`&classId=${a1.class2}`)).toBe(0);
      const canteenOnly = await rows('&category=CANTEEN');
      expect(canteenOnly).toBeGreaterThan(0);
      expect(canteenOnly).toBeLessThan(all);
      await secretary.agent
        .get(`/api/v1/school/finance/export?schoolYearId=${a1.yearId}&kind=unpaid`)
        .expect(403);
      const audit = await prisma.auditLog.findMany({
        where: { organizationId: organizations[0], action: 'school.finance_exported' },
      });
      expect(audit.length).toBeGreaterThanOrEqual(2);
    });

    it('historique des paiements : périmètre de l’établissement, jamais la clé de formulaire', async () => {
      const list = await accountant.agent
        .get(`/api/v1/school/finance/payments?schoolId=${a1.schoolId}`)
        .expect(200);
      expect(list.body.items.length).toBeGreaterThan(3);
      expect(list.body.nextCursor).toBeNull();
      expect(list.body.items.every((p: Record<string, unknown>) => !('idempotencyKey' in p))).toBe(
        true,
      );
      await directorA2.agent
        .get(`/api/v1/school/finance/payments?schoolId=${a1.schoolId}`)
        .expect(404);
    });

    it('historique paginé dans un ordre total ; reçus filtrés avant la pagination', async () => {
      // Établissement voisin, élève au frais maximal : 101 encaissements, puis une annulation.
      const big = await db.schoolStudent.findFirstOrThrow({
        where: { organizationId: organizations[0], lastName: 'Kane' },
      });
      const ids: string[] = [];
      for (let i = 1; i <= 101; i++) {
        const res = await ownerA
          .post('/api/v1/school/finance/payments')
          .send({
            schoolYearId: a2.yearId,
            studentId: big.id,
            amount: i,
            method: 'CASH',
            idempotencyKey: randomUUID(),
            paidAt: '2026-11-03T08:00:00.000Z',
          })
          .expect(201);
        ids.push(res.body.id);
      }
      await ownerA
        .post(`/api/v1/school/finance/payments/${ids[0]}/cancel`)
        .send({ reason: 'Erreur de caisse' })
        .expect(200);
      const page = (query: string) =>
        ownerA.get(`/api/v1/school/finance/payments?schoolId=${a2.schoolId}${query}`).expect(200);
      const collect = async (receipts: boolean) => {
        const seen: { id: string; kind: string }[] = [];
        let cursor: string | null = null;
        let pages = 0;
        do {
          const res = await page(
            `${receipts ? '&receipts=true' : ''}${cursor ? `&cursor=${cursor}` : ''}`,
          );
          expect(res.body.items.length).toBeLessThanOrEqual(100);
          seen.push(...res.body.items);
          cursor = res.body.nextCursor;
          pages += 1;
        } while (cursor);
        return { seen, pages };
      };
      // Même date pour tous : l'ordre total (création, identifiant) évite trous et doublons.
      const all = await collect(false);
      expect(all.pages).toBe(2);
      expect(new Set(all.seen.map((p) => p.id)).size).toBe(all.seen.length);
      expect(all.seen.length).toBe(102);
      const receipts = await collect(true);
      expect(receipts.seen.length).toBe(101);
      expect(receipts.seen.every((p) => p.kind === 'PAYMENT')).toBe(true);
      await ownerA
        .get(`/api/v1/school/finance/payments?schoolId=${a2.schoolId}&cursor=not-a-uuid`)
        .expect(400);
    });

    it('jours et mois dans le fuseau de l’établissement : 23 h 30 UTC appartient au lendemain local', async () => {
      const big = await db.schoolStudent.findFirstOrThrow({
        where: { organizationId: organizations[0], lastName: 'Kane' },
      });
      const late = await ownerA
        .post('/api/v1/school/finance/payments')
        .send({
          schoolYearId: a2.yearId,
          studentId: big.id,
          amount: 777,
          method: 'CASH',
          idempotencyKey: randomUUID(),
          paidAt: '2026-10-31T23:30:00.000Z',
        })
        .expect(201);
      const school = await db.school.findUniqueOrThrow({ where: { id: a2.schoolId } });
      const ids = async () =>
        (
          await ownerA
            .get(
              `/api/v1/school/finance/payments?schoolId=${a2.schoolId}&from=2026-11-01&to=2026-11-01`,
            )
            .expect(200)
        ).body.items.map((p: { id: string }) => p.id);
      const dashboard = async () =>
        (
          await ownerA
            .get(
              `/api/v1/school/finance/dashboard?schoolYearId=${a2.yearId}&from=2026-11-01&to=2026-11-01`,
            )
            .expect(200)
        ).body;
      await db.school.update({ where: { id: a2.schoolId }, data: { timezone: 'Africa/Lagos' } });
      try {
        // UTC+1 : le 1er novembre local commence le 31 octobre à 23 h UTC.
        expect(await ids()).toEqual([late.body.id]);
        const d = await dashboard();
        expect(d.periodCollected).toBe(777);
        expect(d.collectionsByMonth).toEqual([{ month: '2026-11', amount: 777 }]);
        const csv = (
          await ownerA
            .get(
              `/api/v1/school/finance/export?schoolYearId=${a2.yearId}&kind=payments&format=csv&from=2026-11-01&to=2026-11-01`,
            )
            .expect(200)
        ).text;
        expect(csv.trim().split(/\r?\n/)).toHaveLength(2);
      } finally {
        await db.school.update({ where: { id: a2.schoolId }, data: { timezone: school.timezone } });
      }
      // UTC (fuseau d'origine) : ce paiement appartient au 31 octobre.
      expect(school.timezone).toBe('Africa/Dakar');
      expect(await ids()).toEqual([]);
      expect((await dashboard()).periodCollected).toBe(0);
    });

    it('encaissement de l’ancien établissement annulable après un transfert, par qui le couvre', async () => {
      const moving = await enrolled(ownerA, a1, a1.class1, a1.level1, 'Fall');
      await ownerA
        .post(`/api/v1/school/finance/fees/${tuition}/generate`)
        .send({ studentIds: [moving] })
        .expect(200);
      const paid = await pay(accountant.agent, { studentId: moving, amount: 4000 }).expect(201);
      const benefit = await ownerA
        .post('/api/v1/school/finance/benefits')
        .send({
          schoolYearId: a1.yearId,
          studentId: moving,
          kind: 'FIXED',
          value: 100,
          reason: 'Réduction erronée',
        })
        .expect(201);
      await ownerA
        .post(`/api/v1/school/students/${moving}/transfer`)
        .send({
          targetSchoolId: a2.schoolId,
          targetSchoolYearId: a2.yearId,
          targetLevelId: a2.level1,
          effectiveOn: '2026-11-15',
          reason: 'Déménagement',
        })
        .expect(200);
      // La direction du nouvel établissement ne voit pas l'encaissement de l'ancien.
      await directorA2.agent
        .post(`/api/v1/school/finance/payments/${paid.body.id}/cancel`)
        .send({ reason: 'Erreur de caisse' })
        .expect(404);
      const cancelled = await ownerA
        .post(`/api/v1/school/finance/payments/${paid.body.id}/cancel`)
        .send({ reason: 'Erreur de caisse' })
        .expect(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      const charges = await db.schoolCharge.findMany({ where: { studentId: moving } });
      expect(charges.every((c) => c.paid === 0)).toBe(true);
      // Corrections historiques de l'ancien établissement : avantage retiré, échéance ajustée.
      await directorA2.agent
        .post(`/api/v1/school/finance/benefits/${benefit.body.id}/revoke`)
        .send({ reason: 'Réduction erronée' })
        .expect(404);
      await ownerA
        .post(`/api/v1/school/finance/benefits/${benefit.body.id}/revoke`)
        .send({ reason: 'Réduction erronée' })
        .expect(200);
      const after = await db.schoolCharge.findMany({ where: { studentId: moving } });
      expect(after.every((c) => c.discount === 0)).toBe(true);
      await ownerA
        .post(`/api/v1/school/finance/charges/${charges[0]!.id}/adjust`)
        .send({ amount: 500, reason: 'Fournitures oubliées' })
        .expect(200);
    });

    it('élève sorti avec un solde : proposé à la caisse, situation et encaissement possibles', async () => {
      const leaver = await enrolled(ownerA, a1, a1.class1, a1.level1, 'Sy');
      await ownerA
        .post(`/api/v1/school/finance/fees/${tuition}/generate`)
        .send({ studentIds: [leaver] })
        .expect(200);
      const list = (agent: Agent, q = '') =>
        agent.get(
          `/api/v1/school/finance/leavers?schoolYearId=${a1.yearId}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
        );
      expect((await list(accountant.agent).expect(200)).body).toEqual({
        items: [],
        truncated: false,
      });
      const enrollment = await db.schoolEnrollment.findFirstOrThrow({
        where: { studentId: leaver, schoolYearId: a1.yearId, status: 'VALIDATED' },
      });
      await ownerA
        .post(`/api/v1/school/enrollments/${enrollment.id}/exit`)
        .send({ reason: 'DROPPED_OUT', exitedOn: '2026-11-04' })
        .expect(200);
      const leavers = (await list(accountant.agent).expect(200)).body;
      expect(leavers.truncated).toBe(false);
      expect(leavers.items.map((l: { id: string }) => l.id)).toEqual([leaver]);
      expect(Object.keys(leavers.items[0]).sort()).toEqual(
        ['firstName', 'firstNameAr', 'id', 'lastName', 'lastNameAr', 'matricule'].sort(),
      );
      // Recherche par nom ou matricule ; les caractères spéciaux de LIKE ne sont pas des jokers.
      const matricule = leavers.items[0].matricule as string;
      const ids = async (q: string) =>
        (await list(accountant.agent, q).expect(200)).body.items.map((l: { id: string }) => l.id);
      expect(await ids('sy')).toEqual([leaver]);
      expect(await ids(matricule.slice(-4))).toEqual([leaver]);
      expect(await ids('Introuvable')).toEqual([]);
      expect(await ids('%')).toEqual([]);
      const balance = (await situation(accountant.agent, leaver).expect(200)).body.totals
        .balance as number;
      expect(balance).toBeGreaterThan(1500);
      await pay(accountant.agent, { studentId: leaver, amount: 1500 }).expect(201);
      // Entièrement réglé : il n'est plus proposé.
      await pay(accountant.agent, {
        studentId: leaver,
        amount: balance - 1500,
        method: 'BANK_TRANSFER',
        reference: `SOLDE-${RUN}`,
      }).expect(201);
      expect((await list(accountant.agent).expect(200)).body.items).toEqual([]);
      await list(teacher.agent).expect(403);
      await list(ownerB).expect(404);
      await directorA2.agent
        .get(`/api/v1/school/finance/leavers?schoolYearId=${a1.yearId}`)
        .expect(404);
    });
  });

  // Exige plusieurs connexions réelles : ignoré sur PGlite, qui exécute tout en séquence.
  const realDatabase = ![
    process.env.TEST_DATABASE_URL,
    process.env.SCHOOL_TEST_DATABASE_URL ?? process.env.TEST_SCHOOL_DATABASE_URL,
  ].some((url) => url?.includes('connection_limit=1'));
  (realDatabase ? describe : describe.skip)('concurrence', () => {
    it('deux caisses simultanées pour le même reste : un seul encaissement passe', async () => {
      const balance = (await situation(ownerA, s2).expect(200)).body.totals.balance as number;
      const both = await Promise.all([
        pay(accountant.agent, { studentId: s2, amount: balance }),
        pay(ownerA, {
          studentId: s2,
          amount: balance,
          method: 'BANK_TRANSFER',
          reference: `VIR-${RUN}`,
        }),
      ]);
      expect(both.map((r) => r.status).sort()).toEqual([201, 400]);
      expect((await situation(ownerA, s2).expect(200)).body.totals.balance).toBe(0);
    });

    it('droit de caisse du secrétariat retiré pendant l’attente du verrou : encaissement refusé', async () => {
      await ownerA
        .put('/api/v1/school/finance/settings')
        .send({ schoolId: a1.schoolId, secretaryCanCollect: true })
        .expect(200);
      let inflight: Promise<Response> | undefined;
      await db.$transaction(
        async (tx) => {
          // Même verrou exclusif que le changement de réglages.
          await tx.$queryRaw`SELECT id FROM "School" WHERE id = ${a1.schoolId}::uuid FOR UPDATE`;
          inflight = pay(secretary.agent, { studentId: s1, amount: 600 }).then((r) => r);
          await new Promise((r) => setTimeout(r, 1500));
          await tx.schoolFinanceSettings.updateMany({
            where: { schoolId: a1.schoolId },
            data: { secretaryCanCollect: false },
          });
        },
        { timeout: 20_000 },
      );
      expect((await inflight!).status).toBe(403);
      expect(await db.schoolPayment.count({ where: { studentId: s1, amount: 600 } })).toBe(0);
    });

    /**
     * Requêtes lancées pendant que le test tient l'établissement voisin en exclusif : toutes attendent
     * au même point (verrou partagé de l'établissement), puis repartent ensemble à la libération.
     */
    async function released(requests: (() => PromiseLike<Response>)[]): Promise<Response[]> {
      let inflight: Promise<Response[]> | undefined;
      await db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "School" WHERE id = ${a2.schoolId}::uuid FOR UPDATE`;
          inflight = Promise.all(requests.map((r) => Promise.resolve(r())));
          await new Promise((r) => setTimeout(r, 1500));
        },
        { timeout: 20_000 },
      );
      return inflight!;
    }

    it('deux générations simultanées : cumul jamais dépassé, aucune attente croisée', async () => {
      // Établissement voisin, classe dédiée : aucun effet sur les autres tests.
      const solo = await enrolled(ownerA, a2, a2.class2, a2.level2, 'Sarr');
      const heavy = async () =>
        (
          await fee(ownerA, {
            schoolYearId: a2.yearId,
            classId: a2.class2,
            levelId: a2.level2,
            amount: 600_000_000,
            plan: { kind: 'ANNUAL', dueOn: '2026-10-05' },
          }).expect(201)
        ).body.id as string;
      const [f1, f2] = [await heavy(), await heavy()];
      const both = await released(
        [f1, f2].map(
          (id) => () =>
            ownerA.post(`/api/v1/school/finance/fees/${id}/generate`).send({ studentIds: [solo] }),
        ),
      );
      expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(both.find((r) => r.status === 409)!.body.code).toBe('TOTAL_TOO_LARGE');
      expect(await db.schoolCharge.count({ where: { studentId: solo } })).toBe(1);
      // La génération prend l'élève en exclusif : elle attend même un simple lecteur partagé.
      const third = (
        await fee(ownerA, {
          schoolYearId: a2.yearId,
          classId: a2.class2,
          levelId: a2.level2,
          category: 'EXAM',
          name: 'Examen',
          amount: 1_000,
          plan: { kind: 'ANNUAL', dueOn: '2026-10-05' },
        }).expect(201)
      ).body.id as string;
      let settled = false;
      let waiting: Promise<Response> | undefined;
      await db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "SchoolStudent" WHERE id = ${solo}::uuid FOR SHARE`;
          waiting = Promise.resolve(
            ownerA
              .post(`/api/v1/school/finance/fees/${third}/generate`)
              .send({ studentIds: [solo] }),
          ).then((r) => {
            settled = true;
            return r;
          });
          await new Promise((r) => setTimeout(r, 1500));
          expect(settled).toBe(false);
        },
        { timeout: 20_000 },
      );
      expect((await waiting!).status).toBe(200);
      // Même frais, élèves désignés en ordre inverse : les deux passent, sans interblocage.
      const pair = [
        await enrolled(ownerA, a2, a2.class1, a2.level1, 'Ndiaye'),
        await enrolled(ownerA, a2, a2.class1, a2.level1, 'Faye'),
      ];
      for (let round = 0; round < 3; round++) {
        const optional = await fee(ownerA, {
          schoolYearId: a2.yearId,
          category: 'TRANSPORT',
          name: `Transport ${round}`,
          amount: 9_000,
          mandatory: false,
        }).expect(201);
        const runs = await released(
          [pair, [...pair].reverse()].map(
            (studentIds) => () =>
              ownerA
                .post(`/api/v1/school/finance/fees/${optional.body.id}/generate`)
                .send({ studentIds }),
          ),
        );
        expect(runs.map((r) => r.status)).toEqual([200, 200]);
        expect(runs.reduce((n, r) => n + (r.body.created as number), 0)).toBe(18);
      }
    });

    it('même formulaire soumis deux fois en même temps : un seul encaissement', async () => {
      const key = randomUUID();
      const both = await Promise.all([
        pay(accountant.agent, { studentId: s1, amount: 700, idempotencyKey: key }),
        pay(accountant.agent, { studentId: s1, amount: 700, idempotencyKey: key }),
      ]);
      expect(both.map((r) => r.status)).toEqual([201, 201]);
      expect(both[0]!.body.id).toBe(both[1]!.body.id);
      expect(await db.schoolPayment.count({ where: { idempotencyKey: key } })).toBe(1);
    });
  });
});
