import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { APP_CONFIG, type AppConfig } from '../src/config/app-config';
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
 * Ocall School, Sprint 1 : contrats, isolation, rôles, lecture seule, et aucune incidence sur Ocall Park.
 * Exige deux bases de test distinctes : TEST_DATABASE_URL et TEST_SCHOOL_DATABASE_URL.
 */
const suite =
  (process.env.SCHOOL_TEST_DATABASE_URL ?? process.env.TEST_SCHOOL_DATABASE_URL)
    ? describe
    : describe.skip;

const TERMS = { startsOn: '2026-01-01', endsOn: '2099-12-31' };
const ARABIC = 'مدرسة النور';

suite('Ocall School — Sprint 1 (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: SchoolPrismaService;
  let platform: InternalAccount;
  let auditor: InternalAccount;
  let park: SignedUpOwner;
  let clientA: { agent: Agent; organizationId: string; contractId: string };
  let clientB: { agent: Agent; organizationId: string; contractId: string };
  let francoArabic: string;
  let classic: string;
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

  async function client(label: string, limits?: { maxSchools: number }) {
    const res = await platform.agent
      .post('/api/v1/platform/contracts/clients')
      .send({
        organizationName: `Test ${label} ${RUN}`,
        countryCode: 'ML',
        ownerFirstName: 'Aminata',
        ownerLastName: 'Keita',
        ownerEmail: email(`owner-${label}`),
        reference: `OCS-${RUN}-${++counter}`,
        ...TERMS,
        ...(limits ? { limits } : {}),
      })
      .expect(201);
    organizations.push(res.body.contract.organizationId);
    return {
      agent: await connect(res.body.loginId, res.body.temporaryPassword),
      organizationId: res.body.contract.organizationId as string,
      contractId: res.body.contract.id as string,
    };
  }

  const setStatus = (contractId: string, status: string) =>
    platform.agent
      .post(`/api/v1/platform/contracts/${contractId}/status`)
      .send({ status, reason: 'Décision de test' });

  const createSchool = (agent: Agent, body: Record<string, unknown>) =>
    agent.post('/api/v1/school/schools').send({ type: 'PRIMARY', countryCode: 'ML', ...body });

  async function member(owner: Agent, role: string, schoolIds: string[], label = role) {
    const res = await owner
      .post('/api/v1/school/members')
      .send({ firstName: 'Fanta', lastName: label, role, schoolIds })
      .expect(201);
    return {
      id: res.body.member.id as string,
      agent: await connect(res.body.member.loginId, res.body.temporaryPassword),
    };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(SchoolPrismaService);
    platform = await internalAccount(app, prisma, `sc-owner-${RUN}`, 'PLATFORM_OWNER');
    auditor = await internalAccount(app, prisma, `sc-audit-${RUN}`, 'READ_ONLY_AUDITOR');
    park = await signup(app, 'scpark', 'PARK');
  }, 240_000);

  afterAll(async () => {
    const where = { organizationId: { in: organizations } };
    await db.gradingPolicyVersion.deleteMany({ where });
    await db.subject.deleteMany({ where });
    await db.schoolClass.deleteMany({ where });
    await db.level.deleteMany({ where });
    await db.cycle.deleteMany({ where });
    await db.pedagogicalTrack.deleteMany({ where });
    await db.academicPeriod.deleteMany({ where });
    await db.schoolYear.deleteMany({ where });
    await db.schoolMember.deleteMany({ where });
    await db.school.deleteMany({ where });
    await db.schoolGroup.deleteMany({ where });
    await cleanup(prisma);
    await app.close();
  });

  describe('contrats et activation', () => {
    it('un client Park sans contrat garde Park et n’accède pas à School', async () => {
      const apps = await park.agent.get('/api/v1/suite/apps').expect(200);
      expect(apps.body.map((a: { code: string }) => a.code)).toEqual(['OCALL_PARK']);
      const res = await park.agent.get('/api/v1/school/context').expect(403);
      expect(res.body.code).toBe('PRODUCT_NOT_ENABLED');
    });

    it('l’inscription publique ne peut pas créer une organisation sans activité', async () => {
      await app.getHttpServer();
      await park.agent
        .post('/api/v1/auth/signup')
        .send({
          organizationName: `Test none ${RUN}`,
          businessType: 'NONE',
          countryCode: 'ML',
          establishmentName: 'Site',
          firstName: 'Awa',
          lastName: 'Traoré',
          email: email('none'),
          password: PASSWORD,
        })
        .expect(400);
    });

    it('seul un compte habilité gère les contrats ; un membre n’y accède pas', async () => {
      await auditor.agent.get('/api/v1/platform/contracts').expect(200);
      await auditor.agent
        .post('/api/v1/platform/contracts')
        .send({ organizationId: park.organizationId, reference: `X-${RUN}`, ...TERMS })
        .expect(403);
      await park.agent.get('/api/v1/platform/contracts').expect(403);
    });

    it('un contrat en brouillon n’ouvre pas le produit ; son activation, oui', async () => {
      clientA = await client('sca');
      const draft = await clientA.agent.get('/api/v1/school/context').expect(403);
      expect(draft.body.code).toBe('PRODUCT_NOT_ENABLED');
      await setStatus(clientA.contractId, 'ACTIVE').expect(200);
      const context = await clientA.agent.get('/api/v1/school/context').expect(200);
      expect(context.body).toMatchObject({ role: 'GROUP_DIRECTOR', access: 'full', schools: [] });
      const apps = await clientA.agent.get('/api/v1/suite/apps').expect(200);
      expect(apps.body.map((a: { code: string }) => a.code)).toEqual(['OCALL_SCHOOL']);
    });

    it('un client sur contrat n’a aucune activité Park ; School n’a que la grille S1, non souscriptible par le client', async () => {
      await clientA.agent.get('/api/v1/ticketing/establishments').expect(403);
      await clientA.agent.get('/api/v1/restaurant/tables').expect((res) => {
        expect([403, 404]).toContain(res.status);
      });
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: clientA.organizationId },
        select: { businessType: true, _count: { select: { subscriptions: true } } },
      });
      expect(org.businessType).toBe('NONE');
      expect(org._count.subscriptions).toBe(0);
      // Socle S1 : grille unifiée (50 000 / 65 000 + 200 000) ; School en préproduction (D1).
      const plans = await prisma.subscriptionPlan.findMany({
        where: { product: { code: 'OCALL_SCHOOL' } },
        select: { monthlyPrice: true, setupFee: true, product: { select: { status: true } } },
        orderBy: { monthlyPrice: 'asc' },
      });
      expect(plans.map((p) => [p.monthlyPrice, p.setupFee])).toEqual([
        [50000, 200000],
        [65000, 200000],
      ]);
      expect(plans[0]?.product?.status).toBe('PREPRODUCTION');
    });

    it('un client Park peut ajouter School, sans perdre Park', async () => {
      const res = await platform.agent
        .post('/api/v1/platform/contracts')
        .send({ organizationId: park.organizationId, reference: `P-${RUN}`, ...TERMS })
        .expect(201);
      await setStatus(res.body.id, 'ACTIVE').expect(200);
      const apps = await park.agent.get('/api/v1/suite/apps').expect(200);
      expect(apps.body.map((a: { code: string }) => a.code)).toEqual([
        'OCALL_PARK',
        'OCALL_SCHOOL',
      ]);
      await park.agent.get('/api/v1/ticketing/establishments').expect(200);
      await setStatus(res.body.id, 'TERMINATED').expect(200);
    });

    it('référence unique et dates cohérentes', async () => {
      const contract = await prisma.suiteContract.findUniqueOrThrow({
        where: { id: clientA.contractId },
      });
      const dup = await platform.agent
        .post('/api/v1/platform/contracts')
        .send({ organizationId: park.organizationId, reference: contract.reference, ...TERMS })
        .expect(409);
      expect(dup.body.code).toBe('CONTRACT_REFERENCE_USED');
      const dates = await platform.agent
        .post('/api/v1/platform/contracts')
        .send({
          organizationId: park.organizationId,
          reference: `D-${RUN}`,
          startsOn: '2027-01-01',
          endsOn: '2026-01-01',
        })
        .expect(400);
      expect(dates.body.code).toBe('INVALID_CONTRACT_DATES');
    });
  });

  describe('structure scolaire', () => {
    it('école franco-arabe : nom arabe conservé à l’identique ; école classique sans matière imposée', async () => {
      const fa = await createSchool(clientA.agent, {
        name: 'Medersa Annour',
        nameAr: ARABIC,
        type: 'FRANCO_ARABIC',
        defaultLocale: 'BILINGUAL',
      }).expect(201);
      francoArabic = fa.body.id;
      expect(fa.body.nameAr).toBe(ARABIC);
      const cl = await createSchool(clientA.agent, { name: 'École Bamako' }).expect(201);
      classic = cl.body.id;
      const subjects = await clientA.agent
        .get('/api/v1/school/subjects')
        .query({ schoolId: classic })
        .expect(200);
      expect(subjects.body).toEqual([]);
      const dup = await createSchool(clientA.agent, { name: 'École Bamako' }).expect(409);
      expect(dup.body.code).toBe('SCHOOL_NAME_USED');
    });

    it('matières bilingues et religieuses, par choix de l’établissement', async () => {
      const coran = await clientA.agent
        .post('/api/v1/school/subjects')
        .send({
          schoolId: francoArabic,
          name: 'Coran',
          nameAr: 'القرآن',
          isReligious: true,
          defaultCoefficient: 2.5,
        })
        .expect(201);
      expect(coran.body).toMatchObject({ nameAr: 'القرآن', isReligious: true });
      expect(Number(coran.body.defaultCoefficient)).toBe(2.5);
    });

    it('année : une seule en cours, périodes dans l’année et sans chevauchement, clôture définitive', async () => {
      const year = (label: string, startsOn: string, endsOn: string) =>
        clientA.agent
          .post('/api/v1/school/years')
          .send({ schoolId: classic, label, startsOn, endsOn });
      const y1 = (await year('2026-2027', '2026-10-01', '2027-06-30').expect(201)).body;
      const y2 = (await year('2027-2028', '2027-10-01', '2028-06-30').expect(201)).body;
      await year('2026-2027', '2026-10-01', '2027-06-30').expect(409);
      await year('Inversée', '2027-06-30', '2026-10-01').expect(400);
      const status = (id: string, value: string) =>
        clientA.agent.post(`/api/v1/school/years/${id}/status`).send({ status: value });
      await status(y1.id, 'ACTIVE').expect(200);
      const second = await status(y2.id, 'ACTIVE').expect(409);
      expect(second.body.code).toBe('SCHOOL_YEAR_ALREADY_ACTIVE');

      const period = (startsOn: string, endsOn: string) =>
        clientA.agent.post('/api/v1/school/periods').send({
          schoolYearId: y1.id,
          kind: 'TRIMESTER',
          label: 'Trimestre',
          startsOn,
          endsOn,
        });
      expect((await period('2026-10-01', '2026-12-20').expect(201)).body.position).toBe(1);
      const overlap = await period('2026-12-20', '2027-03-01').expect(409);
      expect(overlap.body.code).toBe('PERIOD_OVERLAP');
      const outside = await period('2027-05-01', '2027-08-01').expect(400);
      expect(outside.body.code).toBe('PERIOD_OUTSIDE_YEAR');
      expect((await period('2027-01-05', '2027-03-20').expect(201)).body.position).toBe(2);

      await status(y1.id, 'CLOSED').expect(200);
      await status(y1.id, 'ACTIVE').expect(409);
      const frozen = await period('2027-04-01', '2027-05-01').expect(409);
      expect(frozen.body.code).toBe('SCHOOL_YEAR_CLOSED');
      await status(y2.id, 'ACTIVE').expect(200);
    });

    it('classe : année, niveau et parcours du même établissement obligatoires', async () => {
      const a = clientA.agent;
      const cycle = (
        await a
          .post('/api/v1/school/cycles')
          .send({ schoolId: classic, name: 'Premier cycle' })
          .expect(201)
      ).body;
      const level = (
        await a.post('/api/v1/school/levels').send({ cycleId: cycle.id, name: 'CP' }).expect(201)
      ).body;
      const otherTrack = (
        await a
          .post('/api/v1/school/tracks')
          .send({ schoolId: francoArabic, name: 'Franco-arabe', locale: 'BILINGUAL' })
          .expect(201)
      ).body;
      const faYear = (
        await a
          .post('/api/v1/school/years')
          .send({
            schoolId: francoArabic,
            label: '2026-2027',
            startsOn: '2026-10-01',
            endsOn: '2027-06-30',
          })
          .expect(201)
      ).body;
      const years = await a.get('/api/v1/school/years').query({ schoolId: classic }).expect(200);
      const active = years.body.find((y: { status: string }) => y.status === 'ACTIVE');

      const created = await a
        .post('/api/v1/school/classes')
        .send({ schoolYearId: active.id, levelId: level.id, name: 'CP A' })
        .expect(201);
      expect(created.body.name).toBe('CP A');
      const wrongYear = await a
        .post('/api/v1/school/classes')
        .send({ schoolYearId: faYear.id, levelId: level.id, name: 'CP B' })
        .expect(400);
      expect(wrongYear.body.code).toBe('OTHER_SCHOOL');
      const wrongTrack = await a
        .post('/api/v1/school/classes')
        .send({ schoolYearId: active.id, levelId: level.id, trackId: otherTrack.id, name: 'CP C' })
        .expect(400);
      expect(wrongTrack.body.code).toBe('OTHER_SCHOOL');
    });

    it('règles de notation versionnées : aucune réécriture, règles invalides refusées', async () => {
      const policy = (rules: Record<string, unknown>) =>
        clientA.agent.post('/api/v1/school/grading-policies').send({
          schoolId: classic,
          effectiveFrom: '2026-10-01',
          rules,
        });
      const valid = {
        scale: 20,
        passMark: 10,
        decimals: 2,
        ranking: { enabled: true, ties: 'SHARED', excludedSubjectIds: [] },
      };
      expect((await policy(valid).expect(201)).body.version).toBe(1);
      expect((await policy({ ...valid, passMark: 12 }).expect(201)).body.version).toBe(2);
      const bad = await policy({ ...valid, passMark: 30 }).expect(400);
      expect(bad.body.code).toBe('INVALID_GRADING_RULES');
      const list = await clientA.agent
        .get('/api/v1/school/grading-policies')
        .query({ schoolId: classic })
        .expect(200);
      expect(list.body.map((p: { rules: { passMark: number } }) => p.rules.passMark)).toEqual([
        12, 10,
      ]);
    });
  });

  describe('isolation entre clients', () => {
    it('un autre client ne voit ni ne modifie rien', async () => {
      clientB = await client('scb');
      await setStatus(clientB.contractId, 'ACTIVE').expect(200);
      const b = clientB.agent;
      expect((await b.get('/api/v1/school/schools').expect(200)).body).toEqual([]);
      await b.get('/api/v1/school/years').query({ schoolId: classic }).expect(404);
      await b.get('/api/v1/school/subjects').query({ schoolId: francoArabic }).expect(404);
      await b.patch(`/api/v1/school/schools/${classic}`).send({ name: 'Volé' }).expect(404);
      await b
        .post('/api/v1/school/subjects')
        .send({ schoolId: classic, name: 'Intrusion' })
        .expect(404);
      await b
        .post('/api/v1/school/members')
        .send({ firstName: 'X', lastName: 'Y', role: 'TEACHER', schoolIds: [classic] })
        .expect(404);
      const exported = await b.get('/api/v1/school/export').expect(200);
      expect(exported.body.schools).toEqual([]);
    });

    it('PostgreSQL refuse lui-même un lien entre deux clients', async () => {
      await expect(
        db.subject.create({
          data: {
            organizationId: clientB.organizationId,
            schoolId: classic,
            name: 'Lien interdit',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('les données School ne sont pas dans la base Ocall Suite', async () => {
      const tables = await prisma.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('School', 'SchoolMember', 'Subject')`;
      expect(tables).toEqual([]);
    });
  });

  describe('rôles et périmètre', () => {
    let directorId: string;
    let director: Agent;
    let teacher: Agent;

    it('un compte School n’a aucun droit Ocall Park', async () => {
      const created = await member(clientA.agent, 'SCHOOL_DIRECTOR', [classic], 'Directeur');
      director = created.agent;
      directorId = created.id;
      const me = await director.get('/api/v1/auth/me').expect(200);
      expect(me.body.role).toBe('PRODUCT_USER');
      expect(me.body.permissions).toEqual([]);
      await director.get('/api/v1/employees').expect(403);
      await director.get('/api/v1/establishments').expect(403);
      await director.get('/api/v1/ticketing/establishments').expect(403);
      await director.get('/api/v1/platform/contracts').expect(403);
    });

    it('un employé Park sans rôle School n’accède pas à School', async () => {
      const res = await clientA.agent.get('/api/v1/suite/apps').expect(200);
      expect(res.body).toHaveLength(1);
      const est = (await park.agent.get('/api/v1/establishments').expect(200)).body[0].id;
      const parkContract = await platform.agent
        .post('/api/v1/platform/contracts')
        .send({ organizationId: park.organizationId, reference: `P2-${RUN}`, ...TERMS })
        .expect(201);
      await setStatus(parkContract.body.id, 'ACTIVE').expect(200);
      const created = await park.agent
        .post('/api/v1/employees')
        .send({ firstName: 'Fanta', lastName: 'Caisse', role: 'CASHIER', establishmentIds: [est] })
        .expect(201);
      const cashier = await connect(created.body.employee.loginId, created.body.temporaryPassword);
      const denied = await cashier.get('/api/v1/school/context').expect(403);
      expect(denied.body.code).toBe('FORBIDDEN');
      await setStatus(parkContract.body.id, 'TERMINATED').expect(200);
    });

    it('un directeur ne voit que son établissement et n’en crée pas', async () => {
      const list = await director.get('/api/v1/school/schools').expect(200);
      expect(list.body.map((s: { id: string }) => s.id)).toEqual([classic]);
      await director.get('/api/v1/school/subjects').query({ schoolId: francoArabic }).expect(404);
      await createSchool(director, { name: 'Refusée' }).expect(403);
      await director
        .post('/api/v1/school/subjects')
        .send({ schoolId: classic, name: 'Mathématiques' })
        .expect(201);
    });

    it('un directeur n’attribue pas de poste de direction ni un autre établissement', async () => {
      const role = await director
        .post('/api/v1/school/members')
        .send({ firstName: 'A', lastName: 'B', role: 'GROUP_DIRECTOR', schoolIds: [classic] })
        .expect(403);
      expect(role.body.code).toBe('SCHOOL_ROLE_NOT_ASSIGNABLE');
      await director
        .post('/api/v1/school/members')
        .send({ firstName: 'A', lastName: 'B', role: 'TEACHER', schoolIds: [francoArabic] })
        .expect(404);
    });

    it('un enseignant consulte sans modifier ni exporter', async () => {
      teacher = (await member(director, 'TEACHER', [classic], 'Prof')).agent;
      await teacher.get('/api/v1/school/subjects').query({ schoolId: classic }).expect(200);
      await teacher
        .post('/api/v1/school/subjects')
        .send({ schoolId: classic, name: 'Interdite' })
        .expect(403);
      await teacher.get('/api/v1/school/export').expect(403);
      await teacher.get('/api/v1/school/members').expect(403);
    });

    it('désactiver un membre ferme ses sessions', async () => {
      const temp = await member(clientA.agent, 'SECRETARY', [classic], 'Secretaire');
      await temp.agent.get('/api/v1/school/context').expect(200);
      await clientA.agent
        .patch(`/api/v1/school/members/${temp.id}`)
        .send({ isActive: false })
        .expect(200);
      await temp.agent.get('/api/v1/school/context').expect(401);
    });

    it('un membre ne modifie pas son propre accès', async () => {
      await director
        .patch(`/api/v1/school/members/${directorId}`)
        .send({ isActive: false })
        .expect(403);
    });
  });

  describe('contrat suspendu, expiré ou résilié', () => {
    const counts = async () => ({
      schools: await db.school.count({ where: { organizationId: clientA.organizationId } }),
      subjects: await db.subject.count({ where: { organizationId: clientA.organizationId } }),
    });

    it('suspendu : lecture et export, aucune écriture, aucune donnée supprimée', async () => {
      const before = await counts();
      await setStatus(clientA.contractId, 'SUSPENDED').expect(200);
      const context = await clientA.agent.get('/api/v1/school/context').expect(200);
      expect(context.body.access).toBe('read_only');
      await clientA.agent.get('/api/v1/school/schools').expect(200);
      const exported = await clientA.agent.get('/api/v1/school/export').expect(200);
      expect(exported.body.schools).toHaveLength(before.schools);
      const write = await createSchool(clientA.agent, { name: 'Pendant la suspension' }).expect(
        403,
      );
      expect(write.body.code).toBe('CONTRACT_READ_ONLY');
      expect(await counts()).toEqual(before);
      const apps = await clientA.agent.get('/api/v1/suite/apps').expect(200);
      expect(apps.body[0].access).toBe('read_only');
      await setStatus(clientA.contractId, 'ACTIVE').expect(200);
      await createSchool(clientA.agent, { name: 'Après réactivation' }).expect(201);
    });

    it('date de fin dépassée : lecture seule immédiate, le renouvellement rétablit l’accès', async () => {
      await prisma.suiteContract.update({
        where: { id: clientA.contractId },
        data: { endsOn: new Date('2026-01-02T00:00:00Z') },
      });
      const context = await clientA.agent.get('/api/v1/school/context').expect(200);
      expect(context.body.access).toBe('read_only');
      await createSchool(clientA.agent, { name: 'Après échéance' }).expect(403);
      await platform.agent
        .post(`/api/v1/platform/contracts/${clientA.contractId}/renew`)
        .send({ endsOn: '2099-12-31', reason: 'Renouvellement signé' })
        .expect(200);
      expect((await clientA.agent.get('/api/v1/school/context').expect(200)).body.access).toBe(
        'full',
      );
      const detail = await platform.agent
        .get(`/api/v1/platform/contracts/${clientA.contractId}`)
        .expect(200);
      expect(detail.body.events.map((e: { type: string }) => e.type)).toContain('RENEWED');
    });

    it('limite et couverture du contrat appliquées par le serveur', async () => {
      const limited = await client('sclim', { maxSchools: 1 });
      await setStatus(limited.contractId, 'ACTIVE').expect(200);
      const first = await createSchool(limited.agent, { name: 'Unique' }).expect(201);
      const refused = await createSchool(limited.agent, { name: 'Seconde' }).expect(409);
      expect(refused.body.code).toBe('CONTRACT_SCHOOL_LIMIT');

      await platform.agent
        .patch(`/api/v1/platform/contracts/${limited.contractId}`)
        .send({ limits: { maxSchools: 2 } })
        .expect(200);
      const second = await createSchool(limited.agent, { name: 'Seconde' }).expect(201);
      await platform.agent
        .patch(`/api/v1/platform/contracts/${limited.contractId}`)
        .send({ coveredSchoolIds: [first.body.id] })
        .expect(200);
      const list = await limited.agent.get('/api/v1/school/schools').expect(200);
      expect(list.body.map((s: { id: string }) => s.id)).toEqual([first.body.id]);
      await limited.agent
        .get('/api/v1/school/years')
        .query({ schoolId: second.body.id })
        .expect(404);
    });

    it('résilié : définitif, données conservées et exportables', async () => {
      await setStatus(clientB.contractId, 'TERMINATED').expect(200);
      const again = await setStatus(clientB.contractId, 'ACTIVE').expect(409);
      expect(again.body.code).toBe('CONTRACT_TRANSITION_REFUSED');
      await clientB.agent.get('/api/v1/school/export').expect(200);
    });

    it('les actions sensibles sont journalisées', async () => {
      const actions = (
        await prisma.auditLog.findMany({
          where: { organizationId: clientA.organizationId },
          select: { action: true },
        })
      ).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'platform.contract_created',
          'platform.contract_status_changed',
          'platform.contract_renewed',
          'school.created',
          'school.member_created',
          'school.exported',
        ]),
      );
    });
  });

  describe('protection d’Ocall Park', () => {
    it('School désactivé : routes introuvables, Park inchangé', async () => {
      const config = app.get<AppConfig>(APP_CONFIG);
      config.school.enabled = false;
      try {
        await clientA.agent.get('/api/v1/school/context').expect(404);
        const apps = await park.agent.get('/api/v1/suite/apps').expect(200);
        expect(apps.body.map((a: { code: string }) => a.code)).toEqual(['OCALL_PARK']);
        await park.agent.get('/api/v1/ticketing/establishments').expect(200);
      } finally {
        config.school.enabled = true;
      }
    });

    it('base School injoignable : l’API démarre et Park fonctionne', async () => {
      const previous = process.env.SCHOOL_DATABASE_URL;
      process.env.SCHOOL_ENABLED = 'true';
      process.env.SCHOOL_DATABASE_URL = 'postgresql://u:p@127.0.0.1:1/school?connect_timeout=1';
      // Même base Suite que l'application de test ; seule la base School est injoignable.
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(prisma)
        .compile();
      const broken = moduleRef.createNestApplication();
      setupApp(broken);
      await broken.init();
      try {
        await request(broken.getHttpServer()).get('/api/v1/health').expect(200);
        const session = await login(broken, park.email, PASSWORD);
        expect(session.status).toBe(200);
        await session.agent.get('/api/v1/ticketing/establishments').expect(200);
        await session.agent.get('/api/v1/school/schools').expect(500);
      } finally {
        await broken.close();
        process.env.SCHOOL_DATABASE_URL = previous ?? '';
      }
    }, 120_000);
  });
});
