import type { INestApplication } from '@nestjs/common';
import { AuditService } from '../src/common/audit/audit.service';
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
 * Ocall School, Sprint 3A : langue propre à chaque établissement. Le français est la langue par
 * défaut ; l'arabe est un choix de l'établissement, et changer de langue ne supprime aucune donnée.
 * Données entièrement fictives. Exige TEST_DATABASE_URL et TEST_SCHOOL_DATABASE_URL.
 */
const suite =
  (process.env.SCHOOL_TEST_DATABASE_URL ?? process.env.TEST_SCHOOL_DATABASE_URL)
    ? describe
    : describe.skip;

const TERMS = { startsOn: '2026-01-01', endsOn: '2099-12-31' };
const AR_LAST = 'الفقيرة';
const AR_FIRST = 'فاطمة';
const SETTINGS = {
  matriculeScope: 'SCHOOL',
  matriculePrefix: '',
  matriculeYear: true,
  matriculePadding: 6,
  requiredDocuments: [],
};

suite('Ocall School — Sprint 3A, langues (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: SchoolPrismaService;
  let platform: InternalAccount;
  let ownerA: Agent;
  let ownerB: Agent;
  let secretary: Agent;
  let teacher: Agent;
  let schoolA1: string;
  let schoolA2: string;
  let schoolB: string;
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
        ownerEmail: email(`owner3a-${label}`),
        reference: `OCS3A-${RUN}-${++counter}`,
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

  async function member(owner: Agent, role: string, schoolIds: string[]) {
    const res = await owner
      .post('/api/v1/school/members')
      .send({ firstName: 'Fanta', lastName: role, role, schoolIds })
      .expect(201);
    return connect(res.body.member.loginId, res.body.temporaryPassword);
  }

  /** Établissement créé sans préciser de langue : il doit être francophone. */
  async function school(owner: Agent, name: string): Promise<string> {
    const res = await owner
      .post('/api/v1/school/schools')
      .send({ name: `${name} ${RUN}`, type: 'FRANCO_ARABIC', countryCode: 'ML' })
      .expect(201);
    return res.body.id as string;
  }

  const setLocale = (agent: Agent, id: string, defaultLocale: string) =>
    agent.patch(`/api/v1/school/schools/${id}`).send({ defaultLocale });

  const localeOf = async (agent: Agent, id: string) => {
    const res = await agent.get('/api/v1/school/context').expect(200);
    return (res.body.schools as { id: string; defaultLocale: string }[]).find((s) => s.id === id)
      ?.defaultLocale;
  };

  /** En-tête d'un export CSV, sans la marque d'ordre des octets. */
  const csvHeader = async (agent: Agent, kind: string, schoolId: string) => {
    const res = await agent
      .get(`/api/v1/school/exports/${kind}?schoolId=${schoolId}&format=csv`)
      .expect(200);
    const bom = String.fromCharCode(0xfeff);
    const text = res.text.startsWith(bom) ? res.text.slice(1) : res.text;
    return (text.split('\r\n')[0] ?? '').split(';');
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(SchoolPrismaService);
    platform = await internalAccount(app, prisma, `sc3a-owner-${RUN}`, 'PLATFORM_OWNER');
    ownerA = await client('a');
    ownerB = await client('b');
    schoolA1 = await school(ownerA, 'Medersa Langue');
    schoolA2 = await school(ownerA, 'École Voisine');
    schoolB = await school(ownerB, 'Complexe Autre Client');
    secretary = await member(ownerA, 'SECRETARY', [schoolA1]);
    teacher = await member(ownerA, 'TEACHER', [schoolA1]);
  }, 300_000);

  afterAll(async () => {
    const where = { organizationId: { in: organizations } };
    await db.schoolStudentEvent.deleteMany({ where });
    await db.schoolStudentGuardian.deleteMany({ where });
    await db.schoolGuardian.deleteMany({ where });
    await db.schoolStudent.deleteMany({ where });
    await db.schoolNumberCounter.deleteMany({ where });
    await db.schoolStudentSettings.deleteMany({ where });
    await db.schoolAccessDecision.deleteMany({ where });
    await db.level.deleteMany({ where });
    await db.cycle.deleteMany({ where });
    await db.schoolMember.deleteMany({ where });
    await db.school.deleteMany({ where });
    await db.schoolGroup.deleteMany({ where });
    await cleanup(prisma);
    await app.close();
  });

  it('tout nouvel établissement est en français, et la création le journalise', async () => {
    expect(await localeOf(ownerA, schoolA1)).toBe('FR');
    expect(await localeOf(ownerB, schoolB)).toBe('FR');
    const created = await prisma.auditLog.findFirst({
      where: { action: 'school.created', targetId: schoolA1 },
    });
    expect(created?.metadata).toMatchObject({ locale: 'FR' });
  });

  it('la direction change la langue : ancienne et nouvelle valeur journalisées', async () => {
    const res = await setLocale(ownerA, schoolA1, 'BILINGUAL').expect(200);
    expect(res.body.defaultLocale).toBe('BILINGUAL');
    const changed = await prisma.auditLog.findMany({
      where: { action: 'school.locale_changed', targetId: schoolA1 },
    });
    expect(changed).toHaveLength(1);
    expect(changed[0]?.metadata).toMatchObject({ from: 'FR', to: 'BILINGUAL' });
    // Même valeur : aucune fausse trace de changement.
    await setLocale(ownerA, schoolA1, 'BILINGUAL').expect(200);
    expect(
      await prisma.auditLog.count({
        where: { action: 'school.locale_changed', targetId: schoolA1 },
      }),
    ).toBe(1);
  });

  it('la langue ne change jamais sans sa trace, même si le journal Suite est indisponible', async () => {
    const audit = app.get(AuditService);
    const original = audit.record.bind(audit);
    const spy = jest.spyOn(audit, 'record').mockImplementation((entry, tx) => {
      if (entry.action === 'school.locale_changed') {
        return Promise.reject(new Error('journal indisponible'));
      }
      return original(entry, tx);
    });
    try {
      await setLocale(ownerA, schoolA1, 'AR').expect(200);
    } finally {
      spy.mockRestore();
    }
    const pending = await db.schoolAccessDecision.findFirstOrThrow({
      where: { action: 'school.locale_changed', targetId: schoolA1, publishedAt: null },
    });
    expect(pending.metadata).toMatchObject({ from: 'BILINGUAL', to: 'AR' });
    // Reprise : la décision est publiée une seule fois, avec ses deux valeurs.
    await setLocale(ownerA, schoolA1, 'BILINGUAL').expect(200);
    const entries = await prisma.auditLog.findMany({
      where: { action: 'school.locale_changed', targetId: schoolA1 },
    });
    expect(entries.filter((e) => (e.metadata as { to?: string }).to === 'AR')).toHaveLength(1);
    expect(
      await db.schoolAccessDecision.count({ where: { targetId: schoolA1, publishedAt: null } }),
    ).toBe(0);
  });

  it('secrétariat et enseignant ne peuvent pas changer la langue', async () => {
    const before = await localeOf(ownerA, schoolA1);
    for (const agent of [secretary, teacher]) {
      const res = await setLocale(agent, schoolA1, 'AR').expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
    expect(await localeOf(ownerA, schoolA1)).toBe(before);
  });

  it("isolation : la langue d'un établissement ne touche ni ses voisins ni un autre client", async () => {
    await setLocale(ownerA, schoolA2, 'AR').expect(200);
    expect(await localeOf(ownerA, schoolA2)).toBe('AR');
    expect(await localeOf(ownerA, schoolA1)).toBe('BILINGUAL');
    expect(await localeOf(ownerB, schoolB)).toBe('FR');
    // Un autre client ne voit pas l'établissement : identifiant forgé introuvable.
    await setLocale(ownerB, schoolA2, 'FR').expect(404);
    await setLocale(ownerA, schoolB, 'AR').expect(404);
    expect(await localeOf(ownerA, schoolA2)).toBe('AR');
    expect(await localeOf(ownerB, schoolB)).toBe('FR');
  });

  it('valeur inconnue refusée', async () => {
    const res = await setLocale(ownerA, schoolA1, 'EN').expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('passer en Français masque les noms arabes sans jamais les supprimer', async () => {
    const created = await ownerA
      .post('/api/v1/school/students')
      .send({
        schoolId: schoolA1,
        lastName: `Diarra${RUN}`,
        firstName: 'Awa',
        lastNameAr: AR_LAST,
        firstNameAr: AR_FIRST,
        birthDate: '2018-03-14',
      })
      .expect(201);
    const id = created.body.id as string;
    await setLocale(ownerA, schoolA1, 'FR').expect(200);
    // Modification en Français : les champs arabes ne sont pas envoyés, ils restent intacts.
    await ownerA
      .patch(`/api/v1/school/students/${id}`)
      .send({ firstName: 'Awa Mariam' })
      .expect(200);
    const stored = await db.schoolStudent.findUniqueOrThrow({ where: { id } });
    expect(stored).toMatchObject({
      firstName: 'Awa Mariam',
      lastNameAr: AR_LAST,
      firstNameAr: AR_FIRST,
    });
    await setLocale(ownerA, schoolA1, 'BILINGUAL').expect(200);
    const back = await ownerA.get(`/api/v1/school/students/${id}`).expect(200);
    expect(back.body).toMatchObject({ lastNameAr: AR_LAST, firstNameAr: AR_FIRST });
  });

  it("les exports suivent la langue de l'établissement", async () => {
    const id = (
      await ownerA
        .post('/api/v1/school/students')
        .send({
          schoolId: schoolA2,
          lastName: `Traore${RUN}`,
          firstName: 'Issa',
          lastNameAr: AR_LAST,
          birthDate: '2017-05-02',
        })
        .expect(201)
    ).body.id as string;
    expect(id).toBeTruthy();

    // Arabe : en-têtes arabes.
    const ar = await csvHeader(ownerA, 'students', schoolA2);
    expect(ar.slice(0, 3)).toEqual(['الرقم التسلسلي', 'اللقب', 'الاسم']);
    expect(ar).toContain('اللقب بالعربية');
    expect(await csvHeader(ownerA, 'guardians', schoolA2)).toContain('صلة القرابة');

    // Bilingue : les deux langues.
    expect(await csvHeader(ownerA, 'students', schoolA1)).toContain('Nom / اللقب');

    // Français : aucune colonne arabe, même si des noms arabes sont enregistrés.
    await setLocale(ownerA, schoolA2, 'FR').expect(200);
    const fr = await csvHeader(ownerA, 'students', schoolA2);
    expect(fr).toEqual([
      'Matricule',
      'Nom',
      'Prénom',
      'Date de naissance',
      'Niveau',
      'Classe',
      'Inscription',
      'Statut',
    ]);
    const rows = (
      await ownerA
        .get(`/api/v1/school/exports/students?schoolId=${schoolA2}&format=csv`)
        .expect(200)
    ).text;
    expect(rows).not.toContain(AR_LAST);
    await setLocale(ownerA, schoolA2, 'AR').expect(200);
  });

  it("l'export complet ne sort aucun contenu arabe d'un établissement en Français", async () => {
    await ownerA
      .patch(`/api/v1/school/schools/${schoolA2}`)
      .send({ nameAr: 'مدرسة الجيران', defaultLocale: 'FR' })
      .expect(200);
    await ownerA
      .post('/api/v1/school/cycles')
      .send({ schoolId: schoolA2, name: 'Primaire', nameAr: 'الابتدائي' })
      .expect(201);
    const res = await ownerA.get('/api/v1/school/export').expect(200);
    const fr = (res.body.schools as { id: string }[]).find((s) => s.id === schoolA2);
    const text = JSON.stringify(fr);
    expect(text).not.toContain('nameAr');
    expect(text).not.toContain('الابتدائي');
    expect(text).toContain('Primaire');
    // Les données restent en base : visibles dès que l'établissement repasse en Arabe.
    await setLocale(ownerA, schoolA2, 'AR').expect(200);
    const back = await ownerA.get('/api/v1/school/export').expect(200);
    const ar = (back.body.schools as { id: string }[]).find((s) => s.id === schoolA2);
    expect(JSON.stringify(ar)).toContain('الابتدائي');
  });

  it('champs complémentaires : une donnée sensible en arabe est refusée, un libellé ordinaire accepté', async () => {
    const refused = await ownerA
      .put(`/api/v1/school/student-settings?schoolId=${schoolA2}`)
      .send({ ...SETTINGS, customFields: [{ key: 'champ_1', label: 'الديانة' }] })
      .expect(400);
    expect(refused.body.code).toBe('INVALID_CUSTOM_FIELDS');
    const hidden = await ownerA
      .put(`/api/v1/school/student-settings?schoolId=${schoolA2}`)
      .send({
        ...SETTINGS,
        customFields: [{ key: 'info', label: 'Information', labelAr: 'الحالة الصحية' }],
      })
      .expect(400);
    expect(hidden.body.code).toBe('INVALID_CUSTOM_FIELDS');
    const accepted = await ownerA
      .put(`/api/v1/school/student-settings?schoolId=${schoolA2}`)
      .send({ ...SETTINGS, customFields: [{ key: 'champ_1', label: 'المدرسة السابقة' }] })
      .expect(200);
    expect(accepted.body.customFields).toEqual([{ key: 'champ_1', label: 'المدرسة السابقة' }]);
  });
});
