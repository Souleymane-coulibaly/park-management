import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import { defaultPrintLayout } from '@ocall/shared';
import { PRINT_GATEWAY, type PrintGateway } from '../src/common/integration/print-gateway';
import { STORAGE_PROVIDER, type StorageProvider } from '../src/common/storage/storage-provider';
import { PrintPrismaService } from '../src/modules/ocall-print/print-prisma.service';
import { PrintQrSigner } from '../src/modules/ocall-print/print-qr';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  type Agent,
  type InternalAccount,
  PASSWORD,
  type SignedUpOwner,
  cleanup,
  createTestApp,
  internalAccount,
  login,
  signup,
} from './helpers';

/**
 * Ocall Print — lots PR-1 (socle : modèles, fiches, cartes, QR, rendu) et PR-2 (commandes, atelier,
 * encaissement à la livraison, purge à 90 jours), en accès autonome et par le contrat d'intégration.
 */
const api = (path: string) => `/api/v1${path}`;
const enabled = Boolean(process.env.TEST_PRINT_DATABASE_URL);
const DAY = 86_400_000;

const delivery = {
  address: 'ACI 2000, rue 123, Bamako',
  contactName: 'Awa Traoré',
  contactPhone: '+223 70 00 00 00',
  note: 'Livraison le matin',
};

(enabled ? describe : describe.skip)('Ocall Print PR-1 et PR-2 (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: PrintPrismaService;
  let storage: StorageProvider;
  let gateway: PrintGateway;
  let orgA: SignedUpOwner;
  let orgB: SignedUpOwner;
  let printer: InternalAccount;
  let admin: InternalAccount;
  let support: InternalAccount;
  let photo: Buffer;
  let templateId: string;
  let staffTemplateId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(PrintPrismaService);
    storage = app.get(STORAGE_PROVIDER);
    gateway = app.get(PRINT_GATEWAY);
    orgA = await signup(app, 'printA', 'PARK');
    orgB = await signup(app, 'printB', 'PARK');
    printer = await internalAccount(app, prisma, 'print-imprimeur', 'PRINT_OPERATOR');
    admin = await internalAccount(app, prisma, 'print-admin', 'PLATFORM_ADMIN');
    support = await internalAccount(app, prisma, 'print-support', 'SUPPORT_AGENT');
    photo = await sharp({ create: { width: 480, height: 600, channels: 3, background: '#557799' } })
      .withMetadata({ exif: { IFD0: { Copyright: 'appareil-secret' } } })
      .jpeg()
      .toBuffer();
  });

  afterAll(async () => {
    try {
      if (db && orgA && orgB) {
        const { purgePrintOrganizations } = await import('@ocall/print-database');
        await purgePrintOrganizations(db, [orgA.organizationId, orgB.organizationId]);
      }
      if (prisma) await cleanup(prisma);
    } finally {
      await app?.close();
    }
  });

  async function person(org: Agent, body: Record<string, unknown>, withPhoto = true) {
    const res = await org.post(api('/ocall-print/persons')).send(body).expect(201);
    if (withPhoto)
      await org
        .put(api(`/ocall-print/persons/${res.body.id}/photo`))
        .attach('file', photo, 'photo.jpg')
        .expect(200);
    return res.body.id as string;
  }

  async function issue(org: Agent, personIds: string[]) {
    const res = await org
      .post(api('/ocall-print/cards'))
      .send({ personIds, validUntil: '2027-07-31' })
      .expect(201);
    return res.body as { id: string; cardNumber: string; holderId: string }[];
  }

  async function order(org: Agent, cardIds: string[], key = randomUUID(), tpl = templateId) {
    return org
      .post(api('/ocall-print/orders'))
      .send({ templateId: tpl, cardIds, delivery, idempotencyKey: key });
  }

  describe('accès autonome gratuit', () => {
    it('propriétaire : accès sans abonnement ; tarif et conservation exposés', async () => {
      const res = await orgA.agent.get(api('/ocall-print/settings')).expect(200);
      expect(res.body).toEqual({
        unitPrice: 3000,
        currency: 'XOF',
        retentionDays: 90,
        payment: 'CASH_ON_DELIVERY',
      });
    });

    it('caissier de l’organisation, compte interne Ocall, visiteur : refusés', async () => {
      const site = await prisma.establishment.findFirstOrThrow({
        where: { organizationId: orgA.organizationId },
      });
      const created = await orgA.agent
        .post(api('/employees'))
        .send({
          firstName: 'Kadi',
          lastName: 'Keita',
          role: 'CASHIER',
          establishmentIds: [site.id],
        })
        .expect(201);
      const cashier = await login(
        app,
        created.body.employee.loginId,
        created.body.temporaryPassword,
      );
      await cashier.agent
        .post(api('/auth/change-password'))
        .send({ currentPassword: created.body.temporaryPassword, newPassword: PASSWORD })
        .expect(204);
      await cashier.agent.get(api('/ocall-print/persons')).expect(403);
      await printer.agent.get(api('/ocall-print/persons')).expect(403);
    });
  });

  describe('modèles recto verso', () => {
    it('création, validation de la mise en page, versions successives, logo', async () => {
      const created = await orgA.agent
        .post(api('/ocall-print/templates'))
        .send({ name: 'Carte élève 2026', kind: 'STUDENT', layout: defaultPrintLayout('STUDENT') })
        .expect(201);
      templateId = created.body.id;
      expect(created.body.currentVersion).toBe(1);
      const bad = await orgA.agent
        .post(api('/ocall-print/templates'))
        .send({
          name: 'Mauvais',
          kind: 'STUDENT',
          layout: { ...defaultPrintLayout('STUDENT'), colors: { primary: 'url(javascript:x)' } },
        })
        .expect(400);
      expect(bad.body.code).toBe('PRINT_LAYOUT_INVALID');
      const layout = defaultPrintLayout('STUDENT');
      const updated = await orgA.agent
        .patch(api(`/ocall-print/templates/${templateId}`))
        .send({ layout: { ...layout, orientation: 'PORTRAIT' } })
        .expect(200);
      expect(updated.body.currentVersion).toBe(2);
      expect(updated.body.layout.orientation).toBe('PORTRAIT');
      const logo = await sharp({
        create: {
          width: 200,
          height: 200,
          channels: 4,
          background: { r: 0, g: 90, b: 0, alpha: 1 },
        },
      })
        .png()
        .toBuffer();
      const withLogo = await orgA.agent
        .put(api(`/ocall-print/templates/${templateId}/logo`))
        .attach('file', logo, 'logo.png')
        .expect(200);
      expect(withLogo.body).toMatchObject({ currentVersion: 3, hasLogo: true });
      const preview = await orgA.agent
        .get(api(`/ocall-print/templates/${templateId}/preview`))
        .expect(200);
      expect(preview.body.front).toContain('<svg');
      expect(preview.body.front).toContain('data:image/png;base64,');
      expect(preview.body.back).toContain('XXXX-XXXX-XXXX');
      const staff = await orgA.agent
        .post(api('/ocall-print/templates'))
        .send({ name: 'Badge', kind: 'STAFF', layout: defaultPrintLayout('STAFF') })
        .expect(201);
      staffTemplateId = staff.body.id;
    });

    it('une autre organisation ne voit ni ne modifie le modèle', async () => {
      const list = await orgB.agent.get(api('/ocall-print/templates')).expect(200);
      expect(list.body).toEqual([]);
      await orgB.agent
        .patch(api(`/ocall-print/templates/${templateId}`))
        .send({ name: 'Volé' })
        .expect(404);
      await orgB.agent.get(api(`/ocall-print/templates/${templateId}/preview`)).expect(404);
    });
  });

  describe('fiches, photos et cartes', () => {
    let aminata: string;
    let moussa: string;
    let cardA: { id: string; cardNumber: string };

    it('fiches élève et personnel sans compte ; matricule unique ; photo réencodée sans EXIF', async () => {
      aminata = await person(orgA.agent, {
        kind: 'STUDENT',
        lastName: 'Diallo',
        firstName: 'Aminata',
        reference: `MAT-${randomUUID().slice(0, 6)}`,
        groupLabel: '6e A',
        birthDate: '2014-03-12',
      });
      moussa = await person(orgA.agent, {
        kind: 'STAFF',
        lastName: 'Traoré',
        firstName: 'Moussa',
        jobTitle: 'Gardien',
        groupLabel: 'Sécurité',
      });
      const ref = (await db.printPerson.findUniqueOrThrow({ where: { id: aminata } })).reference;
      const dup = await orgA.agent
        .post(api('/ocall-print/persons'))
        .send({ kind: 'STUDENT', lastName: 'X', firstName: 'Y', reference: ref })
        .expect(409);
      expect(dup.body.code).toBe('PRINT_REFERENCE_TAKEN');
      const served = await orgA.agent.get(api(`/ocall-print/persons/${aminata}/photo`)).expect(200);
      const meta = await sharp(served.body as Buffer).metadata();
      expect(meta.exif).toBeUndefined();
      expect((served.body as Buffer).includes(Buffer.from('appareil-secret'))).toBe(false);
      await orgB.agent.get(api(`/ocall-print/persons/${aminata}/photo`)).expect(404);
      await orgB.agent.get(api(`/ocall-print/persons/${aminata}`)).expect(404);
    });

    it('une seule carte active par titulaire, même en création simultanée', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          orgA.agent.post(api('/ocall-print/cards')).send({ personIds: [aminata] }),
        ),
      );
      expect(results.every((r) => r.status === 201)).toBe(true);
      const ids = new Set(results.map((r) => r.body[0].id));
      expect(ids.size).toBe(1);
      expect(await db.printCard.count({ where: { holderId: aminata, status: 'ACTIVE' } })).toBe(1);
      [cardA] = results[0]!.body;
      expect(cardA.cardNumber).toMatch(/^[2-9A-HJKMNP-TV-Z]{4}(-[2-9A-HJKMNP-TV-Z]{4}){2}$/);
      await orgB.agent
        .post(api('/ocall-print/cards'))
        .send({ personIds: [aminata] })
        .expect(404);
    });

    it('aperçu d’une carte avec un modèle ; modèle d’un autre type refusé', async () => {
      const res = await orgA.agent
        .get(api(`/ocall-print/cards/${cardA.id}/preview?templateId=${templateId}`))
        .expect(200);
      expect(res.body.front).toContain('DIALLO Aminata');
      expect(res.body.back).toContain(cardA.cardNumber);
      await orgA.agent
        .get(api(`/ocall-print/cards/${cardA.id}/preview?templateId=${staffTemplateId}`))
        .expect(400);
    });

    it('remplacement : nouvelle carte, ancienne révoquée ; QR vérifié par l’organisation seule', async () => {
      const [staffCard] = await issue(orgA.agent, [moussa]);
      const replaced = await orgA.agent
        .post(api(`/ocall-print/cards/${staffCard!.id}/replace`))
        .send({ reason: 'Carte perdue' })
        .expect(201);
      expect(replaced.body.cardNumber).not.toBe(staffCard!.cardNumber);
      expect(replaced.body.replacesCardId).toBe(staffCard!.id);
      const qrNew = await gatewayQr(replaced.body.cardNumber);
      const qrOld = await gatewayQr(staffCard!.cardNumber);
      const valid = await orgA.agent.post(api('/ocall-print/cards/verify')).send({ qr: qrNew });
      expect(valid.body).toMatchObject({ result: 'VALID', holder: { lastName: 'Traoré' } });
      const revoked = await orgA.agent.post(api('/ocall-print/cards/verify')).send({ qr: qrOld });
      expect(revoked.body.result).toBe('REVOKED');
      const other = await orgB.agent.post(api('/ocall-print/cards/verify')).send({ qr: qrNew });
      expect(other.body).toEqual({ result: 'UNKNOWN' });
      const forged = await orgA.agent
        .post(api('/ocall-print/cards/verify'))
        .send({ qr: `${qrNew.slice(0, -2)}AA` });
      expect(forged.body).toEqual({ result: 'UNKNOWN' });
    });

    /** QR d'une carte, calculé par le moteur (aperçu de carte), jamais stocké hors des commandes. */
    async function gatewayQr(cardNumber: string): Promise<string> {
      const card = await db.printCard.findUniqueOrThrow({ where: { cardNumber } });
      const preview = await gateway.cardPreview(
        { organizationId: orgA.organizationId, userId: randomUUID() },
        { sourceApp: 'OCALL_PRINT', scopeIds: null },
        card.id,
        staffTemplateId,
        {
          issuer: { name: 'x', nameAr: null, contact: null },
          holder: {
            firstName: 'x',
            lastName: 'y',
            firstNameAr: null,
            lastNameAr: null,
            reference: null,
            group: null,
            jobTitle: null,
            birthDate: null,
          },
          period: null,
          validUntil: null,
        },
        null,
      );
      expect(preview.back).toContain(cardNumber);
      return app.get(PrintQrSigner).qr(cardNumber);
    }
  });

  describe('commandes, atelier, encaissement', () => {
    let s1: string;
    let s2: string;
    let s3: string;
    let c1: string;
    let c2: string;
    let c3: string;
    let orderId: string;

    beforeAll(async () => {
      s1 = await person(orgA.agent, { kind: 'STUDENT', lastName: 'Coulibaly', firstName: 'Fanta' });
      s2 = await person(orgA.agent, { kind: 'STUDENT', lastName: 'Keita', firstName: 'Oumar' });
      s3 = await person(
        orgA.agent,
        { kind: 'STUDENT', lastName: 'Sangaré', firstName: 'Ina' },
        false,
      );
      [c1, c2, c3] = (await issue(orgA.agent, [s1, s2, s3])).map((c) => c.id) as [
        string,
        string,
        string,
      ];
    });

    it('photo obligatoire pour commander', async () => {
      const res = await order(orgA.agent, [c1, c3]);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'PRINT_PHOTO_REQUIRED', details: { cardIds: [c3] } });
    });

    it('prix unitaire, quantité, total ; renvoi idempotent ; une carte ne se commande qu’une fois', async () => {
      const key = randomUUID();
      const first = await order(orgA.agent, [c1, c2], key);
      expect(first.status).toBe(201);
      orderId = first.body.id;
      expect(first.body).toMatchObject({
        status: 'SUBMITTED',
        unitPrice: 3000,
        quantity: 2,
        totalAmount: 6000,
        currency: 'XOF',
        paymentStatus: 'UNPAID',
      });
      expect(first.body.number).toMatch(/^IMP-\d{4}-\d{5}$/);
      const replay = await order(orgA.agent, [c1, c2], key);
      expect(replay.status).toBe(201);
      expect(replay.body.id).toBe(orderId);
      expect(await db.printOrder.count({ where: { organizationId: orgA.organizationId } })).toBe(1);
      const again = await order(orgA.agent, [c1]);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('PRINT_CARD_ALREADY_ORDERED');
      // Données figées et photo copiée, réencodée, dans le stockage Print.
      const items = await db.printOrderItem.findMany({ where: { orderId } });
      expect(items).toHaveLength(2);
      for (const item of items) {
        expect((item.data as { format: string }).format).toBe('ocall-print/card@1');
        const stored = await storage.get(item.photoKey!);
        expect(stored && (await sharp(stored).metadata()).exif).toBeUndefined();
      }
    });

    it('autre organisation : commande introuvable ; bon à tirer PDF pour le client', async () => {
      await orgB.agent.get(api(`/ocall-print/orders/${orderId}`)).expect(404);
      await orgB.agent
        .post(api(`/ocall-print/orders/${orderId}/cancel`))
        .send({ reason: 'xxx' })
        .expect(404);
      const pdf = await orgA.agent
        .get(api(`/ocall-print/orders/${orderId}/proof.pdf`))
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('rôles : support refusé ; imprimeur limité à la production', async () => {
      await support.agent.get(api('/platform/print/orders')).expect(403);
      await printer.agent.get(api('/platform/organizations')).expect(403);
      await printer.agent.get(api('/platform/print/overview')).expect(403);
      const queue = await printer.agent.get(api('/platform/print/orders')).expect(200);
      expect(queue.body.some((o: { id: string }) => o.id === orderId)).toBe(true);
      await orgA.agent.get(api('/platform/print/orders')).expect(403);
    });

    it('étapes dans l’ordre ; refus d’une carte ; annulation client impossible après production', async () => {
      const jump = await printer.agent
        .post(api(`/platform/print/orders/${orderId}/advance`))
        .send({ status: 'READY' });
      expect(jump.status).toBe(409);
      await printer.agent
        .post(api(`/platform/print/orders/${orderId}/advance`))
        .send({ status: 'ACCEPTED' })
        .expect(200);
      const detail = await printer.agent.get(api(`/platform/print/orders/${orderId}`)).expect(200);
      const item = detail.body.items.find((i: { cardId: string }) => i.cardId === c2);
      const rejected = await printer.agent
        .post(api(`/platform/print/orders/${orderId}/items/${item.id}/reject`))
        .send({ reason: 'Photo floue' })
        .expect(200);
      expect(rejected.body).toMatchObject({ quantity: 1, totalAmount: 3000 });
      await printer.agent
        .post(api(`/platform/print/orders/${orderId}/advance`))
        .send({ status: 'IN_PRODUCTION' })
        .expect(200);
      const cancel = await orgA.agent
        .post(api(`/ocall-print/orders/${orderId}/cancel`))
        .send({ reason: 'Erreur' });
      expect(cancel.status).toBe(409);
      // La carte refusée redevient commandable.
      const reorder = await order(orgA.agent, [c2]);
      expect(reorder.status).toBe(201);
      const pdf = await printer.agent
        .get(api(`/platform/print/orders/${orderId}/production.pdf`))
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect((pdf.body as Buffer).toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
    });

    it('encaissement en espèces à la livraison, montant exact, correction par la supervision', async () => {
      const early = await printer.agent
        .post(api(`/platform/print/orders/${orderId}/payment`))
        .send({ amount: 3000, reference: 'REC-001' });
      expect(early.body.code).toBe('PRINT_PAYMENT_TOO_EARLY');
      await printer.agent
        .post(api(`/platform/print/orders/${orderId}/advance`))
        .send({ status: 'READY' })
        .expect(200);
      const wrong = await printer.agent
        .post(api(`/platform/print/orders/${orderId}/payment`))
        .send({ amount: 6000, reference: 'REC-001' });
      expect(wrong.body.code).toBe('PRINT_PAYMENT_AMOUNT');
      await printer.agent
        .post(api(`/platform/print/orders/${orderId}/advance`))
        .send({ status: 'DELIVERED' })
        .expect(200);
      const paid = await printer.agent
        .post(api(`/platform/print/orders/${orderId}/payment`))
        .send({ amount: 3000, reference: 'REC-001' })
        .expect(200);
      expect(paid.body).toMatchObject({
        paymentStatus: 'PAID',
        paidAmount: 3000,
        status: 'DELIVERED',
      });
      const twice = await printer.agent
        .post(api(`/platform/print/orders/${orderId}/payment`))
        .send({ amount: 3000, reference: 'REC-002' });
      expect(twice.body.code).toBe('PRINT_ALREADY_PAID');
      await printer.agent
        .post(api(`/platform/print/orders/${orderId}/payment/cancel`))
        .send({ reason: 'Saisie erronée' })
        .expect(403);
      await admin.agent
        .post(api(`/platform/print/orders/${orderId}/payment/cancel`))
        .send({ reason: 'Saisie erronée' })
        .expect(200);
      await admin.agent
        .post(api(`/platform/print/orders/${orderId}/payment`))
        .send({ amount: 3000, reference: 'REC-003' })
        .expect(200);
      const client = await orgA.agent.get(api(`/ocall-print/orders/${orderId}`)).expect(200);
      expect(client.body).toMatchObject({ paymentStatus: 'PAID', paymentReference: 'REC-003' });
      expect(client.body.events.map((e: { type: string }) => e.type)).toEqual(
        expect.arrayContaining([
          'SUBMITTED',
          'ACCEPTED',
          'ITEM_REJECTED',
          'DELIVERED',
          'PAYMENT_CANCELLED',
        ]),
      );
      const audit = await prisma.auditLog.count({
        where: { targetId: orderId, action: { startsWith: 'print.' } },
      });
      expect(audit).toBeGreaterThanOrEqual(7);
      const overview = await admin.agent.get(api('/platform/print/overview')).expect(200);
      expect(overview.body.some((r: { status: string }) => r.status === 'DELIVERED')).toBe(true);
    });

    it('purge des fichiers 90 jours après la livraison ; le suivi administratif reste', async () => {
      await db.printOrder.update({
        where: { id: orderId },
        data: { deliveredAt: new Date(Date.now() - 91 * DAY) },
      });
      const keys = (await db.printOrderItem.findMany({ where: { orderId } })).map(
        (i) => i.photoKey!,
      );
      await printer.agent.post(api('/platform/print/retention/run')).expect(403);
      const run = await admin.agent.post(api('/platform/print/retention/run')).expect(200);
      expect(run.body.status).toBe('SUCCEEDED');
      const after = await orgA.agent.get(api(`/ocall-print/orders/${orderId}`)).expect(200);
      expect(after.body).toMatchObject({
        filesPurged: true,
        quantity: 1,
        totalAmount: 3000,
        paymentStatus: 'PAID',
      });
      expect(
        after.body.items.every((i: { holderLabel: string | null }) => i.holderLabel === null),
      ).toBe(true);
      for (const key of keys) expect(await storage.get(key)).toBeNull();
      const proof = await orgA.agent.get(api(`/ocall-print/orders/${orderId}/proof.pdf`));
      expect(proof.body.code).toBe('PRINT_FILES_PURGED');
      // L'historique de la commande survit à la purge et reste en ajout seul (déclencheur en base).
      const events = await db.printOrderEvent.findMany({ where: { orderId } });
      expect(events.length).toBeGreaterThan(0);
      await expect(
        db.printOrderEvent.update({ where: { id: events[0]!.id }, data: { type: 'ALTERE' } }),
      ).rejects.toThrow(/PRINT_HISTORY_APPEND_ONLY/);
      await expect(db.printOrderEvent.delete({ where: { id: events[0]!.id } })).rejects.toThrow(
        /PRINT_HISTORY_APPEND_ONLY/,
      );
    });
  });

  describe('révocation et commandes simultanées', () => {
    it('deux commandes simultanées de la même carte : une seule passe', async () => {
      const p = await person(orgA.agent, { kind: 'STUDENT', lastName: 'Touré', firstName: 'Sali' });
      const [card] = await issue(orgA.agent, [p]);
      const results = await Promise.all(
        Array.from({ length: 4 }, () => order(orgA.agent, [card!.id])),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
      expect(
        await db.printOrderItem.count({ where: { cardId: card!.id, status: 'PENDING' } }),
      ).toBe(1);
    });

    it('une carte révoquée sort de la commande non commencée ; sans carte, la commande est annulée', async () => {
      const p1 = await person(orgA.agent, {
        kind: 'STUDENT',
        lastName: 'Bah',
        firstName: 'Mariam',
      });
      const p2 = await person(orgA.agent, {
        kind: 'STUDENT',
        lastName: 'Cissé',
        firstName: 'Adama',
      });
      const [k1, k2] = await issue(orgA.agent, [p1, p2]);
      const created = await order(orgA.agent, [k1!.id, k2!.id]);
      expect(created.status).toBe(201);
      await orgA.agent
        .post(api(`/ocall-print/cards/${k1!.id}/revoke`))
        .send({ reason: 'Départ de l’élève' })
        .expect(201);
      let detail = await orgA.agent.get(api(`/ocall-print/orders/${created.body.id}`)).expect(200);
      expect(detail.body).toMatchObject({ status: 'SUBMITTED', quantity: 1, totalAmount: 3000 });
      await orgA.agent.delete(api(`/ocall-print/persons/${p2}`)).expect(204);
      detail = await orgA.agent.get(api(`/ocall-print/orders/${created.body.id}`)).expect(200);
      expect(detail.body).toMatchObject({ status: 'CANCELLED', quantity: 0, totalAmount: 0 });
      const revoked = await orgA.agent
        .post(api('/ocall-print/orders'))
        .send({ templateId, cardIds: [k1!.id], delivery, idempotencyKey: randomUUID() });
      expect(revoked.body.code).toBe('PRINT_CARD_NOT_ACTIVE');
    });
  });

  describe('reprise des fiches par Ocall School (contrat d’intégration)', () => {
    it('cartes reprises sans réimpression, sans doublon ; reprise rejouée sans effet', async () => {
      const actor = { organizationId: orgA.organizationId, userId: randomUUID() };
      const p = await person(orgA.agent, {
        kind: 'STAFF',
        lastName: 'Sidibé',
        firstName: 'Bakary',
      });
      const [card] = await issue(orgA.agent, [p]);
      const list = await gateway.transferablePersons(actor);
      expect(list.find((x) => x.id === p)).toMatchObject({
        hasPhoto: true,
        activeCardNumber: card!.cardNumber,
      });
      expect(await gateway.personPhoto(actor, p)).toBeInstanceOf(Buffer);
      // Une autre organisation ne lit rien.
      expect(
        (
          await gateway.transferablePersons({
            organizationId: orgB.organizationId,
            userId: actor.userId,
          })
        ).length,
      ).toBe(0);
      await expect(
        gateway.personPhoto({ organizationId: orgB.organizationId, userId: actor.userId }, p),
      ).rejects.toMatchObject({ status: 404 });
      const schoolStaffId = randomUUID();
      const schoolId = randomUUID();
      const target = {
        sourceApp: 'OCALL_SCHOOL' as const,
        holderId: schoolStaffId,
        scopeId: schoolId,
      };
      await gateway.completeTransfer(actor, p, target);
      await gateway.completeTransfer(actor, p, target);
      await expect(
        gateway.completeTransfer(actor, p, { ...target, holderId: randomUUID() }),
      ).rejects.toMatchObject({ status: 409 });
      const moved = await db.printCard.findUniqueOrThrow({ where: { id: card!.id } });
      expect(moved).toMatchObject({
        sourceApp: 'OCALL_SCHOOL',
        holderId: schoolStaffId,
        scopeId: schoolId,
        status: 'ACTIVE',
        cardNumber: card!.cardNumber,
      });
      expect((await gateway.transferablePersons(actor)).some((x) => x.id === p)).toBe(false);
      // Le périmètre School ne voit que ses établissements.
      const inScope = await gateway.listCards(
        actor,
        { sourceApp: 'OCALL_SCHOOL', scopeIds: [schoolId] },
        {},
      );
      expect(inScope.map((c) => c.id)).toEqual([card!.id]);
      const outOfScope = await gateway.listCards(
        actor,
        { sourceApp: 'OCALL_SCHOOL', scopeIds: [randomUUID()] },
        {},
      );
      expect(outOfScope).toEqual([]);
      const edit = await orgA.agent
        .patch(api(`/ocall-print/persons/${p}`))
        .send({ firstName: 'B' });
      expect(edit.body.code).toBe('PRINT_PERSON_TRANSFERRED');
    });
  });
});
