import type { INestApplication } from '@nestjs/common';
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
 * Ocall School — contrôle d'accès avec PLUSIEURS contrats pour une même organisation (correctif du
 * Sprint 1) : accès par établissement selon les contrats qui le couvrent, jamais un seul contrat retenu
 * selon l'ordre de la base. Données fictives, bases de test locales jetables.
 */
const suite =
  (process.env.SCHOOL_TEST_DATABASE_URL ?? process.env.TEST_SCHOOL_DATABASE_URL)
    ? describe
    : describe.skip;

const TERMS = { startsOn: '2026-01-01', endsOn: '2099-12-31' };

suite('Ocall School — contrats multiples (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: SchoolPrismaService;
  let platform: InternalAccount;
  let owner: Agent;
  let other: Agent;
  let organizationId: string;
  let contract1: string;
  let contract2: string;
  let schoolA: string;
  let schoolB: string;
  let schoolC: string;
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

  const status = (id: string, s: string) =>
    platform.agent
      .post(`/api/v1/platform/contracts/${id}/status`)
      .send({ status: s, reason: 'Décision de test' })
      .expect(200);

  async function client(label: string) {
    const res = await platform.agent
      .post('/api/v1/platform/contracts/clients')
      .send({
        organizationName: `Test ${label} ${RUN}`,
        countryCode: 'SN',
        ownerFirstName: 'Mariama',
        ownerLastName: 'Sow',
        ownerEmail: email(`owner-ctr-${label}`),
        reference: `OCSC-${RUN}-${++counter}`,
        ...TERMS,
      })
      .expect(201);
    organizations.push(res.body.contract.organizationId);
    await status(res.body.contract.id, 'ACTIVE');
    return {
      agent: await connect(res.body.loginId, res.body.temporaryPassword),
      organizationId: res.body.contract.organizationId as string,
      contractId: res.body.contract.id as string,
    };
  }

  const school = async (who: Agent, name: string) =>
    (
      await who
        .post('/api/v1/school/schools')
        .send({ name: `${name} ${RUN}`, type: 'PRIMARY', countryCode: 'SN' })
        .expect(201)
    ).body.id as string;

  const createYear = (who: Agent, schoolId: string, label: string) =>
    who
      .post('/api/v1/school/years')
      .send({ schoolId, label, startsOn: '2026-10-01', endsOn: '2027-06-30' });

  const scope = (id: string, body: object) =>
    platform.agent.patch(`/api/v1/platform/contracts/${id}`).send(body).expect(200);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(SchoolPrismaService);
    platform = await internalAccount(app, prisma, `ctr-owner-${RUN}`, 'PLATFORM_OWNER');
    const first = await client('multi');
    owner = first.agent;
    organizationId = first.organizationId;
    contract1 = first.contractId;
    other = (await client('autre')).agent;
    schoolA = await school(owner, 'Ecole A');
    schoolB = await school(owner, 'Ecole B');
    schoolC = await school(owner, 'Ecole C');
    // Second contrat du même client, activé ; chaque contrat couvre un seul établissement.
    const second = await platform.agent
      .post('/api/v1/platform/contracts')
      .send({ organizationId, reference: `OCSC-${RUN}-${++counter}`, ...TERMS })
      .expect(201);
    contract2 = second.body.id;
    await status(contract2, 'ACTIVE');
    await scope(contract1, { coveredSchoolIds: [schoolA] });
    await scope(contract2, { coveredSchoolIds: [schoolB] });
  }, 300_000);

  afterAll(async () => {
    const where = { organizationId: { in: organizations } };
    await db.schoolYear.deleteMany({ where });
    await db.school.deleteMany({ where });
    await db.schoolGroup.deleteMany({ where });
    await prisma.suiteContractEvent.deleteMany({
      where: { contract: { organizationId: { in: organizations } } },
    });
    await cleanup(prisma);
    await app.close();
  });

  it('deux contrats actifs, un par établissement : écriture sur chacun, rien hors couverture', async () => {
    await createYear(owner, schoolA, '2026-2027').expect(201);
    await createYear(owner, schoolB, '2026-2027').expect(201);
    // Établissement couvert par aucun contrat : invisible, en lecture comme en écriture.
    await createYear(owner, schoolC, '2026-2027').expect(404);
    const ctx = await owner.get('/api/v1/school/context').expect(200);
    expect(ctx.body.schools.map((s: { id: string }) => s.id).sort()).toEqual(
      [schoolA, schoolB].sort(),
    );
    expect(ctx.body.schools.map((s: { contractAccess: string }) => s.contractAccess)).toEqual([
      'full',
      'full',
    ]);
  });

  it('B seulement sous contrat suspendu : lecture seule sur B, écriture maintenue sur A', async () => {
    await status(contract2, 'SUSPENDED');
    const refused = await createYear(owner, schoolB, '2027-2028').expect(403);
    expect(refused.body.code).toBe('CONTRACT_READ_ONLY');
    await owner.get(`/api/v1/school/years?schoolId=${schoolB}`).expect(200);
    await createYear(owner, schoolA, '2027-2028').expect(201);
    const ctx = await owner.get('/api/v1/school/context').expect(200);
    const access = Object.fromEntries(
      ctx.body.schools.map((s: { id: string; contractAccess: string }) => [s.id, s.contractAccess]),
    );
    expect(access).toEqual({ [schoolA]: 'full', [schoolB]: 'read_only' });
  });

  it('limite d’établissements : celle des contrats actifs seulement (un contrat suspendu n’ouvre rien)', async () => {
    await scope(contract1, { coveredSchoolIds: [], limits: { maxSchools: 3 } });
    await scope(contract2, { limits: { maxSchools: 50 } });
    // Trois établissements existent ; le contrat actif en autorise 3 : création refusée.
    const res = await owner
      .post('/api/v1/school/schools')
      .send({ name: `Ecole D ${RUN}`, type: 'PRIMARY', countryCode: 'SN' })
      .expect(409);
    expect(res.body.code).toBe('CONTRACT_SCHOOL_LIMIT');
    await scope(contract1, { coveredSchoolIds: [schoolA], limits: {} });
  });

  it('les deux contrats suspendus : tout en lecture seule ; réactivation de A seulement', async () => {
    await status(contract1, 'SUSPENDED');
    const refused = await createYear(owner, schoolA, '2028-2029').expect(403);
    expect(refused.body.code).toBe('CONTRACT_READ_ONLY');
    await status(contract1, 'ACTIVE');
    await createYear(owner, schoolA, '2028-2029').expect(201);
    await createYear(owner, schoolB, '2028-2029').expect(403);
  });

  it('autre client : aucun droit sur les établissements du premier, quel que soit son contrat', async () => {
    await other.get(`/api/v1/school/years?schoolId=${schoolA}`).expect(404);
    await createYear(other, schoolA, '2029-2030').expect(404);
  });
});
