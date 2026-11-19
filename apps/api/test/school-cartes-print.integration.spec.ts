import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import { defaultPrintLayout } from '@ocall/shared';
import { PrintPrismaService } from '../src/modules/ocall-print/print-prisma.service';
import { PrintQrSigner } from '../src/modules/ocall-print/print-qr';
import { SchoolPrismaService } from '../src/modules/school/school-prisma.service';
import type { PrismaService } from '../src/prisma/prisma.service';
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
 * Ocall School × Ocall Print (lots SC-1 et SC-2 côté API) : fiches du personnel avec ou sans compte,
 * cartes scolaires et badges, photo obligatoire pour commander, commandes, droits par rôle, isolation
 * entre clients et entre établissements, révocation automatique, lecture du QR, reprise des fiches Print.
 * Données fictives. Exige les bases de test Suite, School et Print.
 */
const api = (path: string) => `/api/v1${path}`;
const enabled =
  Boolean(process.env.SCHOOL_TEST_DATABASE_URL ?? process.env.TEST_SCHOOL_DATABASE_URL) &&
  Boolean(process.env.TEST_PRINT_DATABASE_URL);
const TERMS = { startsOn: '2026-01-01', endsOn: '2099-12-31' };
const delivery = {
  address: 'Hamdallaye ACI, Bamako',
  contactName: 'Direction',
  contactPhone: '+223 70 11 22 33',
};

interface Structure {
  schoolId: string;
  yearId: string;
  levelId: string;
  classId: string;
}

(enabled ? describe : describe.skip)('Ocall School — cartes et personnel (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: SchoolPrismaService;
  let printDb: PrintPrismaService;
  let signer: PrintQrSigner;
  let platform: InternalAccount;
  let ownerA: Agent;
  let ownerB: Agent;
  let secretary: Agent;
  let supervisor: Agent;
  let teacher: Agent;
  let a1: Structure;
  let a2: Structure;
  let photo: Buffer;
  let studentTemplate: string;
  let staffTemplate: string;
  const organizations: string[] = [];
  let counter = 0;

  async function connect(identifier: string, temporaryPassword: string): Promise<Agent> {
    const session = await login(app, identifier, temporaryPassword);
    expect(session.status).toBe(200);
    await session.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return session.agent;
  }

  async function client(label: string) {
    const res = await platform.agent
      .post(api('/platform/contracts/clients'))
      .send({
        organizationName: `Test ${label} ${RUN}`,
        countryCode: 'ML',
        ownerFirstName: 'Aminata',
        ownerLastName: 'Keita',
        ownerEmail: email(`owner-cards-${label}`),
        reference: `OCSC-${RUN}-${++counter}`,
        ...TERMS,
      })
      .expect(201);
    organizations.push(res.body.contract.organizationId);
    await platform.agent
      .post(api(`/platform/contracts/${res.body.contract.id}/status`))
      .send({ status: 'ACTIVE', reason: 'Décision de test' })
      .expect(200);
    return connect(res.body.loginId, res.body.temporaryPassword);
  }

  async function member(owner: Agent, role: string, schoolIds: string[]) {
    const res = await owner
      .post(api('/school/members'))
      .send({ firstName: 'Fanta', lastName: role, role, schoolIds })
      .expect(201);
    return connect(res.body.member.loginId, res.body.temporaryPassword);
  }

  async function structure(owner: Agent, name: string): Promise<Structure> {
    const school = await owner
      .post(api('/school/schools'))
      .send({
        name: `${name} ${RUN}`,
        type: 'PRIMARY',
        countryCode: 'ML',
        phone: '+223 20 20 20 20',
      })
      .expect(201);
    const schoolId = school.body.id as string;
    const year = await owner
      .post(api('/school/years'))
      .send({ schoolId, label: '2026-2027', startsOn: '2026-10-01', endsOn: '2027-06-30' })
      .expect(201);
    await owner
      .post(api(`/school/years/${year.body.id}/status`))
      .send({ status: 'ACTIVE' })
      .expect(200);
    const cycle = await owner
      .post(api('/school/cycles'))
      .send({ schoolId, name: 'Primaire' })
      .expect(201);
    const level = await owner
      .post(api('/school/levels'))
      .send({ cycleId: cycle.body.id, name: 'CE1' })
      .expect(201);
    const cls = await owner
      .post(api('/school/classes'))
      .send({ schoolYearId: year.body.id, levelId: level.body.id, name: 'CE1 A' })
      .expect(201);
    return { schoolId, yearId: year.body.id, levelId: level.body.id, classId: cls.body.id };
  }

  async function enrolled(owner: Agent, s: Structure, lastName = `Diarra${++counter}`) {
    const created = await owner
      .post(api('/school/students'))
      .send({ schoolId: s.schoolId, lastName, firstName: 'Awa', birthDate: '2018-03-14' })
      .expect(201);
    const parent = await owner
      .post(api('/school/guardians'))
      .send({ schoolId: s.schoolId, lastName, firstName: 'Moussa', phone: '+223 70 00 00 01' })
      .expect(201);
    await owner
      .post(api(`/school/students/${created.body.id}/guardians`))
      .send({ guardianId: parent.body.id, relation: 'FATHER' })
      .expect(201);
    const enrollment = await owner
      .post(api('/school/enrollments'))
      .send({
        studentId: created.body.id,
        schoolYearId: s.yearId,
        levelId: s.levelId,
        classId: s.classId,
        submit: true,
      })
      .expect(201);
    await owner
      .post(api(`/school/enrollments/${enrollment.body.id}/status`))
      .send({ status: 'VALIDATED' })
      .expect(200);
    return {
      id: created.body.id as string,
      matricule: created.body.matricule as string,
      enrollmentId: enrollment.body.id as string,
    };
  }

  const addPhoto = (owner: Agent, studentId: string) =>
    owner
      .post(api(`/school/students/${studentId}/documents`))
      .field('category', 'PHOTO')
      .attach('file', photo, 'photo.jpg')
      .expect(201);

  const order = (agent: Agent, schoolId: string, cardIds: string[], key = randomUUID()) =>
    agent.post(api('/school/card-orders')).send({
      schoolId,
      templateId: studentTemplate,
      cardIds,
      delivery,
      idempotencyKey: key,
    });

  const qr = (cardNumber: string) => signer.qr(cardNumber);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(SchoolPrismaService);
    printDb = app.get(PrintPrismaService);
    signer = app.get(PrintQrSigner);
    platform = await internalAccount(app, prisma, `cards-owner-${RUN}`, 'PLATFORM_OWNER');
    ownerA = await client('a');
    ownerB = await client('b');
    a1 = await structure(ownerA, 'École Les Baobabs');
    a2 = await structure(ownerA, 'École Espoir');
    await structure(ownerB, 'Complexe Bakary');
    secretary = await member(ownerA, 'SECRETARY', [a1.schoolId]);
    supervisor = await member(ownerA, 'SUPERVISOR', [a1.schoolId]);
    teacher = await member(ownerA, 'TEACHER', [a1.schoolId]);
    photo = await sharp({ create: { width: 480, height: 600, channels: 3, background: '#6688AA' } })
      .withMetadata({ exif: { IFD0: { Copyright: 'telephone-parent' } } })
      .jpeg()
      .toBuffer();
  }, 400_000);

  afterAll(async () => {
    try {
      if (printDb && organizations.length) {
        const { purgePrintOrganizations } = await import('@ocall/print-database');
        await purgePrintOrganizations(printDb, organizations);
      }
      if (db && organizations.length) {
        const tables = await db.$queryRaw<{ table_name: string }[]>`
          SELECT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'organizationId'`;
        let pending = tables.map((t) => t.table_name);
        for (let pass = 0; pass < 20 && pending.length > 0; pass++) {
          const blocked: string[] = [];
          for (const table of pending) {
            try {
              await db.$executeRawUnsafe(
                `DELETE FROM "${table}" WHERE "organizationId"::text = ANY($1::text[])`,
                organizations,
              );
            } catch {
              blocked.push(table);
            }
          }
          pending = blocked;
        }
      }
      if (prisma) await cleanup(prisma);
    } finally {
      await app?.close();
    }
  });

  describe('droits', () => {
    it('enseignant : aucun accès ; surveillant : lecture et vérification ; secrétariat : pas de commande', async () => {
      await teacher.get(api('/school/cards')).expect(403);
      await teacher.get(api('/school/staff')).expect(403);
      await supervisor.get(api('/school/cards')).expect(200);
      await supervisor
        .post(api('/school/cards/staff'))
        .send({ staffIds: [randomUUID()] })
        .expect(403);
      await supervisor.post(api('/school/staff')).send({}).expect(403);
      await secretary
        .post(api('/school/card-orders'))
        .send({
          schoolId: a1.schoolId,
          templateId: randomUUID(),
          cardIds: [randomUUID()],
          delivery,
          idempotencyKey: randomUUID(),
        })
        .expect(403);
      const settings = await secretary.get(api('/school/cards/settings')).expect(200);
      expect(settings.body).toMatchObject({ enabled: true, unitPrice: 3000, currency: 'XOF' });
    });
  });

  describe('personnel avec ou sans compte', () => {
    let guard: string;

    it('fiche sans compte (gardien), numéro attribué, hors périmètre introuvable', async () => {
      const res = await secretary
        .post(api('/school/staff'))
        .send({
          schoolId: a1.schoolId,
          lastName: 'Coulibaly',
          firstName: 'Bakary',
          category: 'SECURITY',
          jobTitle: 'Gardien',
        })
        .expect(201);
      guard = res.body.id;
      expect(res.body.staffNumber).toMatch(/^P-\d{6}$/);
      expect(res.body.memberId).toBeNull();
      await secretary
        .post(api('/school/staff'))
        .send({ schoolId: a2.schoolId, lastName: 'X', firstName: 'Y', category: 'CATERING' })
        .expect(404);
      await ownerB.get(api(`/school/staff/${guard}`)).expect(404);
      await secretary.get(api(`/school/staff/${guard}`)).expect(200);
    });

    it('fiches créées depuis l’équipe, une seule par compte', async () => {
      const first = await secretary
        .post(api('/school/staff/import-members'))
        .send({ schoolId: a1.schoolId })
        .expect(201);
      expect(first.body.created).toBe(3);
      const again = await secretary
        .post(api('/school/staff/import-members'))
        .send({ schoolId: a1.schoolId })
        .expect(201);
      expect(again.body.created).toBe(0);
      const list = await secretary.get(api(`/school/staff?schoolId=${a1.schoolId}`)).expect(200);
      const teacherFiche = list.body.find(
        (s: { memberRole: string }) => s.memberRole === 'TEACHER',
      );
      expect(teacherFiche).toMatchObject({ category: 'TEACHING', jobTitle: 'Enseignant' });
      const dup = await secretary
        .patch(api(`/school/staff/${guard}`))
        .send({ memberId: teacherFiche.memberId });
      expect(dup.status).toBe(409);
    });

    it('photo réencodée sans EXIF ; image trop petite refusée', async () => {
      const tiny = await sharp({
        create: { width: 60, height: 60, channels: 3, background: '#000' },
      })
        .png()
        .toBuffer();
      await secretary
        .put(api(`/school/staff/${guard}/photo`))
        .attach('file', tiny, 'p.png')
        .expect(400);
      const ok = await secretary
        .put(api(`/school/staff/${guard}/photo`))
        .attach('file', photo, 'p.jpg')
        .expect(200);
      expect(ok.body.hasPhoto).toBe(true);
      const served = await secretary.get(api(`/school/staff/${guard}/photo`)).expect(200);
      expect((await sharp(served.body as Buffer).metadata()).exif).toBeUndefined();
      await ownerB.get(api(`/school/staff/${guard}/photo`)).expect(404);
    });
  });

  describe('modèles, cartes et commandes', () => {
    let s1: { id: string; matricule: string; enrollmentId: string };
    let s2: { id: string; matricule: string; enrollmentId: string };
    let card1: { id: string; cardNumber: string };
    let card2: { id: string; cardNumber: string };
    let orderId: string;

    it('modèles par établissement ; aperçu aux couleurs de l’école ; autre client : rien', async () => {
      const t = await ownerA
        .post(api('/school/card-templates'))
        .send({
          schoolId: a1.schoolId,
          name: 'Carte élève',
          kind: 'STUDENT',
          layout: defaultPrintLayout('STUDENT'),
        })
        .expect(201);
      studentTemplate = t.body.id;
      const st = await secretary
        .post(api('/school/card-templates'))
        .send({
          schoolId: a1.schoolId,
          name: 'Badge',
          kind: 'STAFF',
          layout: defaultPrintLayout('STAFF'),
        })
        .expect(201);
      staffTemplate = st.body.id;
      await secretary
        .post(api('/school/card-templates'))
        .send({
          schoolId: a2.schoolId,
          name: 'Hors périmètre',
          kind: 'STAFF',
          layout: defaultPrintLayout('STAFF'),
        })
        .expect(404);
      const preview = await secretary
        .get(api(`/school/card-templates/${studentTemplate}/preview`))
        .expect(200);
      expect(preview.body.front).toContain('École Les Baobabs');
      expect(preview.body.back).toContain('+223 20 20 20 20');
      expect((await ownerB.get(api('/school/card-templates')).expect(200)).body).toEqual([]);
      await ownerB.get(api(`/school/card-templates/${studentTemplate}/preview`)).expect(404);
    });

    it('carte pour un élève inscrit seulement ; carte de classe ; une seule carte active', async () => {
      const draft = await ownerA
        .post(api('/school/students'))
        .send({
          schoolId: a1.schoolId,
          lastName: 'Sans',
          firstName: 'Inscription',
          birthDate: '2018-01-01',
        })
        .expect(201);
      const refused = await secretary
        .post(api('/school/cards/students'))
        .send({ studentIds: [draft.body.id] })
        .expect(409);
      expect(refused.body).toMatchObject({
        code: 'CARD_STUDENT_NOT_ENROLLED',
        details: { studentIds: [draft.body.id] },
      });
      s1 = await enrolled(ownerA, a1);
      s2 = await enrolled(ownerA, a1);
      const cls = await secretary
        .post(api('/school/cards/class'))
        .send({ schoolYearId: a1.yearId, classId: a1.classId })
        .expect(201);
      expect(cls.body).toHaveLength(2);
      card1 = cls.body.find((c: { holderId: string }) => c.holderId === s1.id);
      card2 = cls.body.find((c: { holderId: string }) => c.holderId === s2.id);
      expect(card1).toMatchObject({
        validUntil: '2027-06-30',
        scopeId: a1.schoolId,
        status: 'ACTIVE',
      });
      const again = await secretary
        .post(api('/school/cards/students'))
        .send({ studentIds: [s1.id] })
        .expect(201);
      expect(again.body[0].id).toBe(card1.id);
      await ownerB
        .post(api('/school/cards/students'))
        .send({ studentIds: [s1.id] })
        .expect(404);
    });

    it('photo obligatoire pour commander, réencodée sans EXIF dans le dossier', async () => {
      const missing = await order(ownerA, a1.schoolId, [card1.id]);
      expect(missing.status).toBe(409);
      expect(missing.body).toMatchObject({
        code: 'PRINT_PHOTO_REQUIRED',
        details: { cardIds: [card1.id] },
      });
      const doc = await addPhoto(ownerA, s1.id);
      expect(doc.body.mimeType).toBe('image/jpeg');
      await addPhoto(ownerA, s2.id);
      const served = await secretary.get(api(`/school/students/${s1.id}/card-photo`)).expect(200);
      expect((await sharp(served.body as Buffer).metadata()).exif).toBeUndefined();
      await secretary
        .put(api(`/school/students/${s1.id}/card-photo`))
        .send({ documentId: doc.body.id })
        .expect(200);
      await secretary
        .put(api(`/school/students/${s2.id}/card-photo`))
        .send({ documentId: doc.body.id })
        .expect(400);
    });

    it('liste et aperçu des cartes avec les données du dossier', async () => {
      const list = await secretary
        .get(api(`/school/cards?schoolId=${a1.schoolId}&kind=STUDENT`))
        .expect(200);
      const c = list.body.find((x: { id: string }) => x.id === card1.id);
      expect(c.holder).toMatchObject({ reference: s1.matricule, hasPhoto: true, active: true });
      const preview = await secretary
        .get(api(`/school/cards/${card1.id}/preview?templateId=${studentTemplate}`))
        .expect(200);
      expect(preview.body.front).toContain(s1.matricule);
      expect(preview.body.front).toContain('CE1 A');
      expect(preview.body.front).toContain('data:image/jpeg;base64,');
      expect(preview.body.back).toContain(card1.cardNumber);
    });

    it('commande par la direction : prix unitaire, quantité, total ; suivi limité au client', async () => {
      const key = randomUUID();
      const res = await order(ownerA, a1.schoolId, [card1.id, card2.id], key);
      expect(res.status).toBe(201);
      orderId = res.body.id;
      expect(res.body).toMatchObject({
        unitPrice: 3000,
        quantity: 2,
        totalAmount: 6000,
        status: 'SUBMITTED',
      });
      expect((await order(ownerA, a1.schoolId, [card1.id, card2.id], key)).body.id).toBe(orderId);
      const item = await printDb.printOrderItem.findFirstOrThrow({
        where: { orderId, cardId: card1.id },
      });
      expect(item.data).toMatchObject({
        format: 'ocall-print/card@1',
        issuer: { name: `École Les Baobabs ${RUN}` },
        holder: { reference: s1.matricule, group: 'CE1 A' },
        period: '2026-2027',
      });
      const orderRow = await printDb.printOrder.findUniqueOrThrow({ where: { id: orderId } });
      const schoolRow = await db.school.findUniqueOrThrow({ where: { id: a1.schoolId } });
      expect(orderRow.establishmentId).toBe(schoolRow.establishmentId);
      await secretary.get(api(`/school/card-orders/${orderId}`)).expect(200);
      await supervisor.get(api('/school/card-orders')).expect(200);
      await ownerB.get(api(`/school/card-orders/${orderId}`)).expect(404);
      await teacher.get(api(`/school/card-orders/${orderId}`)).expect(403);
      // Commande sur un autre établissement que celui des cartes : introuvable.
      expect((await order(ownerA, a2.schoolId, [card1.id])).status).toBe(404);
    });

    it('même client, autre établissement : modèle, carte et commande invisibles au secrétariat limité', async () => {
      const other = await enrolled(ownerA, a2);
      const tpl = await ownerA
        .post(api('/school/card-templates'))
        .send({
          schoolId: a2.schoolId,
          name: 'Carte a2',
          kind: 'STUDENT',
          layout: defaultPrintLayout('STUDENT'),
        })
        .expect(201);
      const [card] = (
        await ownerA
          .post(api('/school/cards/students'))
          .send({ studentIds: [other.id] })
          .expect(201)
      ).body;
      await addPhoto(ownerA, other.id);
      const created = await ownerA.post(api('/school/card-orders')).send({
        schoolId: a2.schoolId,
        templateId: tpl.body.id,
        cardIds: [card.id],
        delivery,
        idempotencyKey: randomUUID(),
      });
      expect(created.status).toBe(201);
      // Le secrétariat de a1 ne voit rien de a2, même sans filtre d'établissement dans la requête.
      const templates = await secretary.get(api('/school/card-templates')).expect(200);
      expect(templates.body.some((t: { id: string }) => t.id === tpl.body.id)).toBe(false);
      await secretary.get(api(`/school/card-templates/${tpl.body.id}/preview`)).expect(404);
      await secretary
        .patch(api(`/school/card-templates/${tpl.body.id}`))
        .send({ name: 'Volé' })
        .expect(404);
      const cards = await secretary.get(api('/school/cards')).expect(200);
      expect(cards.body.some((c: { id: string }) => c.id === card.id)).toBe(false);
      await secretary
        .get(api(`/school/cards/${card.id}/preview?templateId=${studentTemplate}`))
        .expect(404);
      await secretary
        .post(api(`/school/cards/${card.id}/revoke`))
        .send({ reason: 'Essai' })
        .expect(404);
      const orders = await secretary.get(api('/school/card-orders')).expect(200);
      expect(orders.body.some((o: { id: string }) => o.id === created.body.id)).toBe(false);
      // Personnel de a2 : invisible au secrétariat de a1, même en demandant explicitement a2.
      const cook = await ownerA
        .post(api('/school/staff'))
        .send({
          schoolId: a2.schoolId,
          lastName: 'Keita',
          firstName: 'Fanta',
          category: 'CATERING',
        })
        .expect(201);
      for (const query of [`?schoolId=${a2.schoolId}`, '']) {
        const staff = await secretary.get(api(`/school/staff${query}`)).expect(200);
        expect(staff.body.some((p: { id: string }) => p.id === cook.body.id)).toBe(false);
      }
      await secretary.get(api(`/school/staff/${cook.body.id}`)).expect(404);
      await secretary.get(api(`/school/card-orders/${created.body.id}`)).expect(404);
      await supervisor
        .post(api('/school/cards/verify'))
        .send({ qr: qr(card.cardNumber) })
        .expect(200)
        .then((r) => expect(r.body).toEqual({ result: 'UNKNOWN' }));
    });

    it('lecture du QR : valide pour l’établissement, inconnue ailleurs, falsifiée inconnue', async () => {
      const valid = await supervisor
        .post(api('/school/cards/verify'))
        .send({ qr: qr(card1.cardNumber) })
        .expect(200);
      expect(valid.body).toMatchObject({ result: 'VALID', holder: { reference: s1.matricule } });
      const other = await ownerB
        .post(api('/school/cards/verify'))
        .send({ qr: qr(card1.cardNumber) })
        .expect(200);
      expect(other.body).toEqual({ result: 'UNKNOWN' });
      const forged = await supervisor
        .post(api('/school/cards/verify'))
        .send({ qr: `OCP1.${card1.cardNumber}.AAAAAAAAAAAAAAAAAAAAAA` })
        .expect(200);
      expect(forged.body).toEqual({ result: 'UNKNOWN' });
      await teacher
        .post(api('/school/cards/verify'))
        .send({ qr: qr(card1.cardNumber) })
        .expect(403);
    });

    it('sortie de l’élève : carte révoquée, retirée de la commande en attente', async () => {
      await ownerA
        .post(api(`/school/enrollments/${s2.enrollmentId}/exit`))
        .send({ reason: 'LEFT', exitedOn: '2026-11-19' })
        .expect(200);
      const check = await supervisor
        .post(api('/school/cards/verify'))
        .send({ qr: qr(card2.cardNumber) })
        .expect(200);
      expect(check.body.result).toBe('REVOKED');
      const o = await ownerA.get(api(`/school/card-orders/${orderId}`)).expect(200);
      expect(o.body).toMatchObject({ quantity: 1, totalAmount: 3000 });
    });

    it('transfert vers un autre établissement : carte révoquée', async () => {
      const s3 = await enrolled(ownerA, a1);
      const [card3] = (
        await secretary
          .post(api('/school/cards/students'))
          .send({ studentIds: [s3.id] })
          .expect(201)
      ).body;
      await ownerA
        .post(api(`/school/students/${s3.id}/transfer`))
        .send({
          targetSchoolId: a2.schoolId,
          targetSchoolYearId: a2.yearId,
          targetLevelId: a2.levelId,
          effectiveOn: '2026-11-19',
          reason: 'Déménagement',
        })
        .expect(200);
      const check = await ownerA
        .post(api('/school/cards/verify'))
        .send({ qr: qr(card3.cardNumber) })
        .expect(200);
      expect(check.body.result).toBe('REVOKED');
      // L'ancienne carte (a1) ne révèle ni la nouvelle inscription (a2) ni une photo ajoutée ensuite.
      await addPhoto(ownerA, s3.id);
      const old = await secretary
        .get(api(`/school/cards/${card3.id}/preview?templateId=${studentTemplate}`))
        .expect(200);
      expect(old.body.front).toContain(s3.matricule);
      expect(old.body.front).not.toContain('CE1');
      expect(old.body.front).not.toContain('data:image/jpeg;base64,');
    });

    it('titulaire sorti sans révocation (Print indisponible au départ) : carte refusée à la lecture', async () => {
      const s4 = await enrolled(ownerA, a1);
      const [card4] = (
        await secretary
          .post(api('/school/cards/students'))
          .send({ studentIds: [s4.id] })
          .expect(201)
      ).body;
      // Départ enregistré sans que la révocation automatique ait pu passer (simulation directe en base).
      await db.schoolStudent.update({ where: { id: s4.id }, data: { status: 'DROPPED_OUT' } });
      const check = await supervisor
        .post(api('/school/cards/verify'))
        .send({ qr: qr(card4.cardNumber) })
        .expect(200);
      expect(check.body).toMatchObject({ result: 'HOLDER_INACTIVE', card: { status: 'ACTIVE' } });
    });

    it('badge du personnel ; agent désactivé : badge révoqué', async () => {
      const list = await secretary.get(api(`/school/staff?schoolId=${a1.schoolId}`)).expect(200);
      const guard = list.body.find((s: { jobTitle: string }) => s.jobTitle === 'Gardien');
      const [badge] = (
        await secretary
          .post(api('/school/cards/staff'))
          .send({ staffIds: [guard.id] })
          .expect(201)
      ).body;
      const preview = await secretary
        .get(api(`/school/cards/${badge.id}/preview?templateId=${staffTemplate}`))
        .expect(200);
      expect(preview.body.front).toContain('Gardien');
      expect(preview.body.front).toContain(guard.staffNumber);
      await secretary
        .post(api(`/school/staff/${guard.id}/active`))
        .send({ active: false })
        .expect(200);
      const check = await supervisor
        .post(api('/school/cards/verify'))
        .send({ qr: qr(badge.cardNumber) })
        .expect(200);
      expect(check.body.result).toBe('REVOKED');
      await secretary
        .post(api('/school/cards/staff'))
        .send({ staffIds: [guard.id] })
        .expect(409);
    });
  });

  describe('reprise des fiches Ocall Print à l’activation de School', () => {
    it('fiches et photos reprises sans doublon ; cartes conservées ; réservé à la direction du groupe', async () => {
      // Usage autonome préalable d'Ocall Print par le même client.
      // Client School sans aucun abonnement Ocall Park : l'accès autonome à Print reste ouvert.
      const person = await ownerA
        .post(api('/ocall-print/persons'))
        .send({
          kind: 'STUDENT',
          lastName: 'Sylla',
          firstName: 'Kadiatou',
          birthDate: '2017-05-02',
        })
        .expect(201);
      await ownerA
        .put(api(`/ocall-print/persons/${person.body.id}/photo`))
        .attach('file', photo, 'p.jpg')
        .expect(200);
      const agent = await ownerA
        .post(api('/ocall-print/persons'))
        .send({ kind: 'STAFF', lastName: 'Coulibaly', firstName: 'Bakary', jobTitle: 'Gardien' })
        .expect(201);
      const noBirth = await ownerA
        .post(api('/ocall-print/persons'))
        .send({ kind: 'STUDENT', lastName: 'Sans', firstName: 'Date' })
        .expect(201);
      const [printCard] = (
        await ownerA
          .post(api('/ocall-print/cards'))
          .send({ personIds: [person.body.id] })
          .expect(201)
      ).body;

      await secretary.get(api('/school/print-import')).expect(403);
      const candidates = await ownerA.get(api('/school/print-import')).expect(200);
      expect(
        candidates.body.find((c: { id: string }) => c.id === agent.body.id).match,
      ).not.toBeNull();

      const run = await ownerA
        .post(api('/school/print-import'))
        .send({
          schoolId: a1.schoolId,
          personIds: [person.body.id, agent.body.id, noBirth.body.id],
        })
        .expect(200);
      const byId = new Map(run.body.map((o: { personId: string }) => [o.personId, o]));
      expect(byId.get(person.body.id)).toMatchObject({ status: 'CREATED' });
      expect(byId.get(agent.body.id)).toMatchObject({ status: 'LINKED' });
      expect(byId.get(noBirth.body.id)).toMatchObject({ status: 'SKIPPED' });

      const studentId = (byId.get(person.body.id) as { targetId: string }).targetId;
      const created = await db.schoolStudent.findUniqueOrThrow({ where: { id: studentId } });
      expect(created).toMatchObject({ printPersonId: person.body.id, schoolId: a1.schoolId });
      expect(
        await db.schoolStudentDocument.count({ where: { studentId, category: 'PHOTO' } }),
      ).toBe(1);
      expect(
        await db.schoolStaff.count({
          where: {
            organizationId: created.organizationId,
            lastName: 'Coulibaly',
            firstName: 'Bakary',
          },
        }),
      ).toBe(1);
      const moved = await printDb.printCard.findUniqueOrThrow({ where: { id: printCard.id } });
      expect(moved).toMatchObject({
        sourceApp: 'OCALL_SCHOOL',
        holderId: studentId,
        scopeId: a1.schoolId,
        cardNumber: printCard.cardNumber,
        status: 'ACTIVE',
      });
      // Relance : rien n'est recréé.
      const replay = await ownerA
        .post(api('/school/print-import'))
        .send({ schoolId: a1.schoolId, personIds: [person.body.id] })
        .expect(200);
      expect(replay.body[0].status).toBe('SKIPPED');
      expect(await db.schoolStudent.count({ where: { printPersonId: person.body.id } })).toBe(1);
      // La fiche reprise n'est plus modifiable dans Print.
      const edit = await ownerA
        .patch(api(`/ocall-print/persons/${person.body.id}`))
        .send({ firstName: 'K' });
      expect(edit.body.code).toBe('PRINT_PERSON_TRANSFERRED');
    });
  });
});
