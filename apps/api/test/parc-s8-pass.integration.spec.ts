import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import { addDays, localMoment } from '@ocall/shared';
import { APP_CONFIG, type AppConfig } from '../src/config/app-config';
import type { PrismaService } from '../src/prisma/prisma.service';
import { PassQrSigner } from '../src/modules/ticketing/pass-qr';
import {
  type Agent,
  PASSWORD,
  type SignedUpOwner,
  agent,
  cleanup,
  createTestApp,
  login,
  signup,
} from './helpers';

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

/**
 * Ocall Parc sprint 8 — pass et abonnements (offres, vente, activation au paiement, QR fixe et
 * dynamique, cartes, quotas, fuseaux, suspensions, renouvellements, droits).
 * Exécuté uniquement sur la base de test jetable (TEST_DATABASE_URL).
 */
describe('Ocall Parc sprint 8 — pass et abonnements (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let signer: PassQrSigner;
  let parkA: SignedUpOwner;
  let parkC: SignedUpOwner;
  let resto: SignedUpOwner;
  let estA1: string;
  let estA2: string;
  let estA3: string;
  let estC: string;
  let estResto: string;
  let cashier: Agent;
  let cashier2: Agent;
  let supervisor: Agent;
  let gate1: Agent;
  let gate2: Agent;
  let offerDay: string;
  let offerWeek: string;
  let offerMonth: string;
  let offerYear: string;
  let offerTotal3: string;

  async function employee(owner: SignedUpOwner, role: string, establishmentIds: string[]) {
    const created = await owner.agent
      .post('/api/v1/employees')
      .send({ firstName: 'Fanta', lastName: role, role, establishmentIds })
      .expect(201);
    const session = await login(app, created.body.employee.loginId, created.body.temporaryPassword);
    await session.agent
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: created.body.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return session.agent;
  }

  const createOffer = async (body: Record<string, unknown>) =>
    (await parkA.agent.post('/api/v1/pass-offers').send(body).expect(201)).body as {
      id: string;
      [k: string]: unknown;
    };

  let customerSeq = 0;
  const customer = async (owner: SignedUpOwner = parkA, firstName = 'Awa') => {
    customerSeq += 1;
    const res = await owner.agent
      .post('/api/v1/customers')
      .send({
        firstName,
        lastName: `Titulaire${customerSeq}`,
        phone: `+2237000${String(customerSeq).padStart(4, '0')}`,
        consent: true,
      })
      .expect(201);
    return res.body.id as string;
  };

  const photo = async (a: Agent = cashier) => {
    const jpeg = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#2f7d4f' },
    })
      .jpeg()
      .toBuffer();
    const res = await a.post('/api/v1/passes/photos').attach('file', jpeg, 'photo.jpg').expect(201);
    return res.body.id as string;
  };

  const pay = (a: Agent, saleId: string, amount: number) =>
    a.post(`/api/v1/sales/${saleId}/payments`).send({ method: 'CASH', amountTendered: amount });

  const todayIn = (tz = 'Africa/Bamako') => localMoment(new Date(), tz).date;

  /** Vente d'un pass (non payée). */
  const order = (
    a: Agent,
    offerId: string,
    customerId: string,
    extra: Record<string, unknown> = {},
    establishmentId = estA1,
  ) =>
    a.post('/api/v1/passes/orders').send({
      establishmentId,
      offerId,
      customerId,
      startDate: todayIn(),
      ...extra,
    });

  /** Vente encaissée : renvoie le pass actif. */
  async function sell(offerId: string, extra: Record<string, unknown> = {}, a: Agent = cashier) {
    const customerId = (extra.customerId as string | undefined) ?? (await customer());
    const res = await order(a, offerId, customerId, extra).expect(201);
    await pay(a, res.body.sale.id, res.body.sale.total).expect(200);
    const pass = (await a.get(`/api/v1/passes/${res.body.pass.id}`).expect(200)).body;
    return { ...pass, saleId: res.body.sale.id as string, customerId };
  }

  const scan = (a: Agent, establishmentId: string, qr: string) =>
    a.post('/api/v1/access/scans').send({ establishmentId, entryPoint: 'Entrée', qr });

  const publicIdOf = async (passId: string) =>
    (await prisma.pass.findUniqueOrThrow({ where: { id: passId }, select: { publicId: true } }))
      .publicId;

  /** QR dynamique du titulaire par son lien personnel (page publique, sans compte). */
  async function holderQr(passId: string, a: Agent = cashier) {
    const link = (await a.post(`/api/v1/passes/${passId}/link`).expect(201)).body;
    const page = (await agent(app).get(`/api/v1/public/passes/${link.token}`).expect(200)).body;
    return { token: link.token as string, page };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    signer = new PassQrSigner(app.get<AppConfig>(APP_CONFIG).storageSigningKey);
    parkA = await signup(app, 'psa', 'PARK');
    parkC = await signup(app, 'psc', 'PARK');
    resto = await signup(app, 'psr', 'RESTAURANT');
    estA1 = (await parkA.agent.get('/api/v1/establishments').expect(200)).body[0].id;
    const newPark = async (name: string) =>
      (
        await parkA.agent
          .post('/api/v1/establishments')
          .send({ name, businessType: 'PARK', city: 'Ségou' })
          .expect(201)
      ).body.id as string;
    estA2 = await newPark('Parc annexe');
    estA3 = await newPark('Parc hors pass');
    estC = (await parkC.agent.get('/api/v1/establishments').expect(200)).body[0].id;
    estResto = (await resto.agent.get('/api/v1/establishments').expect(200)).body[0].id;

    cashier = await employee(parkA, 'CASHIER', [estA1]);
    cashier2 = await employee(parkA, 'CASHIER', [estA2]);
    supervisor = await employee(parkA, 'SUPERVISOR', [estA1]);
    gate1 = await employee(parkA, 'GATE_AGENT', [estA1]);
    gate2 = await employee(parkA, 'GATE_AGENT', [estA2]);
    await cashier
      .post('/api/v1/cash-sessions')
      .send({ establishmentId: estA1, openingFloat: 0 })
      .expect(201);
    await cashier2
      .post('/api/v1/cash-sessions')
      .send({ establishmentId: estA2, openingFloat: 0 })
      .expect(201);
    await parkA.agent
      .post('/api/v1/cash-sessions')
      .send({ establishmentId: estA1, openingFloat: 0 })
      .expect(201);

    offerDay = (
      await createOffer({
        kind: 'DAY',
        name: 'Journée',
        price: 3000,
        sites: [{ establishmentId: estA1 }],
      })
    ).id;
    offerWeek = (
      await createOffer({
        kind: 'WEEK',
        name: 'Semaine',
        price: 12000,
        sites: [{ establishmentId: estA1 }, { establishmentId: estA2, price: 10000 }],
      })
    ).id;
    offerMonth = (
      await createOffer({
        kind: 'MONTHLY',
        name: 'Mensuel',
        price: 25000,
        maxSuspensionDays: 10,
        sites: [{ establishmentId: estA1 }, { establishmentId: estA2 }],
      })
    ).id;
    offerYear = (
      await createOffer({
        kind: 'ANNUAL',
        name: 'Annuel libre',
        price: 200000,
        sites: [{ establishmentId: estA1 }, { establishmentId: estA2 }],
      })
    ).id;
    offerTotal3 = (
      await createOffer({
        kind: 'WEEK',
        name: 'Carnet 3 entrées',
        price: 8000,
        totalEntries: 3,
        dailyEntries: null,
        sites: [{ establishmentId: estA1 }, { establishmentId: estA2 }],
      })
    ).id;
  }, 240_000);

  afterAll(async () => {
    await cleanup(prisma);
    await app.close();
  });

  describe('Lot A — offres et ventes', () => {
    it('offres : valeurs par défaut par type, tarif par parc, photo imposée aux abonnements', async () => {
      const offers = (await parkA.agent.get('/api/v1/pass-offers').expect(200)).body;
      const byName = Object.fromEntries(offers.map((o: { name: string }) => [o.name, o]));
      expect(byName['Journée']).toMatchObject({
        durationUnit: 'DAYS',
        durationValue: 1,
        totalEntries: 1,
        qrMode: 'STATIC',
        photoRequired: false,
      });
      expect(byName['Semaine']).toMatchObject({
        durationUnit: 'DAYS',
        durationValue: 7,
        dailyEntries: 1,
        qrMode: 'STATIC',
      });
      expect(byName['Mensuel']).toMatchObject({
        durationUnit: 'MONTHS',
        durationValue: 1,
        qrMode: 'DYNAMIC',
        photoRequired: true,
        renewable: true,
      });
      expect(byName['Annuel libre']).toMatchObject({
        durationValue: 12,
        dailyEntries: null,
        photoRequired: true,
      });
      expect(
        byName['Semaine'].sites.find(
          (s: { establishmentId: string }) => s.establishmentId === estA2,
        ).effectivePrice,
      ).toBe(10000);
      // Même en le demandant, un abonnement mensuel ne peut pas se passer de photo (D9).
      const forced = await createOffer({
        kind: 'MONTHLY',
        name: 'Mensuel sans photo ?',
        price: 1,
        photoRequired: false,
        sites: [{ establishmentId: estA1 }],
      });
      expect(forced.photoRequired).toBe(true);
    });

    it('offres : parc d’une autre organisation ou restaurant refusé, nom unique, réservé à la configuration', async () => {
      const other = await parkA.agent
        .post('/api/v1/pass-offers')
        .send({ kind: 'DAY', name: 'Intrus', price: 1, sites: [{ establishmentId: estC }] });
      expect(other.status).toBe(400);
      expect(other.body.code).toBe('PASS_SITE_INVALID');
      const dup = await parkA.agent
        .post('/api/v1/pass-offers')
        .send({ kind: 'DAY', name: 'Journée', price: 1, sites: [{ establishmentId: estA1 }] });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('PASS_OFFER_NAME_TAKEN');
      await cashier
        .post('/api/v1/pass-offers')
        .send({ kind: 'DAY', name: 'X', price: 1, sites: [{ establishmentId: estA1 }] })
        .expect(403);
      await cashier.get('/api/v1/pass-offers').expect(403);
      await parkC.agent.patch(`/api/v1/pass-offers/${offerDay}`).send({ price: 1 }).expect(404);
    });

    it('vente : pass en attente jusqu’au paiement, puis actif ; fiche client obligatoire ; fidélité rattachée', async () => {
      const customerId = await customer();
      const res = await order(cashier, offerDay, customerId).expect(201);
      expect(res.body.sale).toMatchObject({
        activity: 'PARK',
        total: 3000,
        paymentStatus: 'UNPAID',
      });
      expect(res.body.pass).toMatchObject({
        status: 'PENDING',
        kind: 'DAY',
        startDate: todayIn(),
        endDate: todayIn(),
      });
      // Avant paiement, le QR fixe est refusé (pas encore valable).
      const before = await scan(gate1, estA1, res.body.pass.staticQr).expect(200);
      expect(before.body).toMatchObject({ result: 'REFUSED', refusalReason: 'NOT_YET_VALID' });
      await pay(cashier, res.body.sale.id, 3000).expect(200);
      const pass = (await cashier.get(`/api/v1/passes/${res.body.pass.id}`).expect(200)).body;
      expect(pass).toMatchObject({ status: 'ACTIVE', state: 'ACTIVE' });
      expect(pass.periods).toHaveLength(1);
      expect(pass.periods[0]).toMatchObject({ status: 'PAID', price: 3000, isRenewal: false });
      expect(pass.events.map((e: { type: string }) => e.type)).toEqual(['ACTIVATED', 'SOLD']);
      const sale = await prisma.sale.findUniqueOrThrow({
        where: { id: res.body.sale.id },
        select: { customerId: true },
      });
      expect(sale.customerId).toBe(customerId);
      // Aucun billet émis pour une vente de pass.
      expect(await prisma.ticket.count({ where: { saleId: res.body.sale.id } })).toBe(0);

      const noCustomer = await order(cashier, offerDay, '00000000-0000-4000-8000-000000000000');
      expect(noCustomer.status).toBe(400);
      expect(noCustomer.body.code).toBe('PASS_CUSTOMER_REQUIRED');
      const otherOrgCustomer = await customer(parkC);
      expect((await order(cashier, offerDay, otherOrgCustomer)).body.code).toBe(
        'PASS_CUSTOMER_REQUIRED',
      );
      const past = await order(cashier, offerDay, customerId, {
        startDate: addDays(todayIn(), -1),
      });
      expect(past.body.code).toBe('PASS_START_INVALID');
    });

    it('vente : photo obligatoire pour mensuel et annuel, facultative pour journalier et hebdomadaire', async () => {
      const missing = await order(cashier, offerMonth, await customer());
      expect(missing.status).toBe(400);
      expect(missing.body.code).toBe('PASS_PHOTO_REQUIRED');
      const week = await sell(offerWeek);
      expect(week).toMatchObject({ kind: 'WEEK', hasPhoto: false, endDate: addDays(todayIn(), 6) });
      const month = await sell(offerMonth, { photoFileId: await photo() });
      expect(month).toMatchObject({ kind: 'MONTHLY', hasPhoto: true });
      expect(month.photoUrl).toMatch(/^\/api\/v1\/files\//);
      // La photo stockée est un JPEG réencodé, conservée un an après la fin de validité.
      const file = await prisma.storedFile.findFirstOrThrow({
        where: { kind: 'PASS_HOLDER_PHOTO', organizationId: parkA.organizationId },
        orderBy: { createdAt: 'desc' },
      });
      expect(file.mimeType).toBe('image/jpeg');
      expect(file.retentionUntil!.getTime()).toBeGreaterThan(day(month.endDate).getTime());
      // Une photo ne sert qu'à un seul pass.
      const reuse = await order(cashier, offerYear, await customer(), { photoFileId: file.id });
      expect(reuse.body.code).toBe('PASS_PHOTO_IN_USE');
    });

    it('vente : les quatre types — durées (jours consécutifs, mois calendaires)', async () => {
      const t = todayIn();
      const d = await sell(offerDay);
      const w = await sell(offerWeek);
      const m = await sell(offerMonth, { photoFileId: await photo() });
      const y = await sell(offerYear, { photoFileId: await photo() });
      expect([d.endDate, w.endDate]).toEqual([t, addDays(t, 6)]);
      const [yy, mm, dd] = t.split('-').map(Number) as [number, number, number];
      const plus = (months: number) => {
        const total = yy * 12 + (mm - 1) + months;
        const last = new Date(Date.UTC(Math.floor(total / 12), (total % 12) + 1, 0)).getUTCDate();
        return addDays(
          `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-${String(Math.min(dd, last)).padStart(2, '0')}`,
          -1,
        );
      };
      expect(m.endDate).toBe(plus(1));
      expect(y.endDate).toBe(plus(12));
    });

    it('annulation d’une vente non payée : le pass jamais activé est annulé avec elle', async () => {
      const res = await order(cashier, offerDay, await customer()).expect(201);
      await parkA.agent
        .post(`/api/v1/sales/${res.body.sale.id}/cancel`)
        .send({ reason: 'Erreur' })
        .expect(200);
      const pass = (await cashier.get(`/api/v1/passes/${res.body.pass.id}`).expect(200)).body;
      expect(pass).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Vente annulée avant paiement',
      });
      expect(pass.periods[0].status).toBe('CANCELLED');
    });
  });

  describe('Lot B — contrôle d’accès', () => {
    it('pass journalier : une entrée, deuxième passage refusé ; parc non autorisé refusé', async () => {
      const p = await sell(offerDay);
      expect(p.staticQr).toMatch(/^OCPS-[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}$/);
      const ok = await scan(gate1, estA1, p.staticQr).expect(200);
      expect(ok.body).toMatchObject({ result: 'ACCEPTED', refusalReason: null });
      expect(ok.body.pass).toMatchObject({ id: p.id, kind: 'DAY', offerName: 'Journée' });
      const again = await scan(gate1, estA1, p.staticQr).expect(200);
      expect(again.body.refusalReason).toBe('DAILY_QUOTA_REACHED');
      const elsewhere = await scan(gate2, estA2, p.staticQr).expect(200);
      expect(elsewhere.body).toMatchObject({
        result: 'REFUSED',
        refusalReason: 'OTHER_ESTABLISHMENT',
        pass: null,
      });
    });

    it('pass hebdomadaire : une entrée par jour, remise à zéro le lendemain (jour du parc), expiré après 7 jours', async () => {
      const p = await sell(offerWeek);
      await scan(gate1, estA1, p.staticQr).expect(200);
      expect((await scan(gate2, estA2, p.staticQr)).body.refusalReason).toBe('DAILY_QUOTA_REACHED');
      // Le passage d'hier ne compte plus aujourd'hui.
      await prisma.ticketScan.updateMany({
        where: { passId: p.id },
        data: { localDate: day(addDays(todayIn(), -1)) },
      });
      expect((await scan(gate2, estA2, p.staticQr)).body.result).toBe('ACCEPTED');
      // Huitième jour : expiré.
      const start = addDays(todayIn(), -7);
      await prisma.passPeriod.updateMany({
        where: { passId: p.id },
        data: { startDate: day(start), endDate: day(addDays(start, 6)) },
      });
      await prisma.pass.update({
        where: { id: p.id },
        data: { startDate: day(start), endDate: day(addDays(start, 6)) },
      });
      expect((await scan(gate1, estA1, p.staticQr)).body.refusalReason).toBe('EXPIRED');
      // Pas encore commencé.
      const later = await sell(offerWeek, { startDate: addDays(todayIn(), 3) });
      expect(later.state).toBe('UPCOMING');
      expect((await scan(gate1, estA1, later.staticQr)).body.refusalReason).toBe('NOT_YET_VALID');
    });

    it('quota global partagé entre parcs : 5 passages simultanés dans deux parcs → exactement 3 acceptés', async () => {
      const p = await sell(offerTotal3);
      const results = await Promise.all(
        [gate1, gate2, gate1, gate2, gate1].map((g, i) =>
          scan(g, i % 2 === 0 ? estA1 : estA2, p.staticQr),
        ),
      );
      const accepted = results.filter((r) => r.body.result === 'ACCEPTED');
      expect(accepted).toHaveLength(3);
      expect(results.filter((r) => r.body.refusalReason === 'QUOTA_REACHED')).toHaveLength(2);
      const period = await prisma.passPeriod.findFirstOrThrow({ where: { passId: p.id } });
      expect(period.entriesUsed).toBe(3);
      expect(await prisma.ticketScan.count({ where: { passId: p.id, result: 'ACCEPTED' } })).toBe(
        3,
      );
    });

    it('deux scans simultanés dans deux parcs différents (une entrée par jour) : un seul accepté', async () => {
      const p = await sell(offerMonth, { photoFileId: await photo() });
      const { page } = await holderQr(p.id);
      const [a, b] = await Promise.all([scan(gate1, estA1, page.qr), scan(gate2, estA2, page.qr)]);
      const results = [a.body, b.body].map((r) => r.result).sort();
      expect(results).toEqual(['ACCEPTED', 'REFUSED']);
      const refused = [a.body, b.body].find((r) => r.result === 'REFUSED');
      expect(['DAILY_QUOTA_REACHED', 'QR_REUSED']).toContain(refused.refusalReason);
      expect(await prisma.ticketScan.count({ where: { passId: p.id, result: 'ACCEPTED' } })).toBe(
        1,
      );
    });

    it('QR dynamique : contenu signé, renouvelé toutes les 30 s, réutilisé, périmé et falsifié refusés', async () => {
      const p = await sell(offerYear, { photoFileId: await photo() });
      expect(p.staticQr).toBeNull(); // le QR d'un abonnement n'est servi qu'au titulaire
      const { page } = await holderQr(p.id);
      expect(page).toMatchObject({
        qrMode: 'DYNAMIC',
        state: 'ACTIVE',
        offerName: 'Annuel libre',
        holderFirstName: 'Awa',
      });
      expect(page.qr).toMatch(/^OCPD-[A-Za-z0-9_-]{16}\.\d+\.[A-Za-z0-9_-]{22}$/);
      expect(page.refreshInSeconds).toBeLessThanOrEqual(30);
      expect(JSON.stringify(page)).not.toMatch(/key|secret|photo|phone|Titulaire/i);
      const ok = await scan(gate1, estA1, page.qr).expect(200);
      expect(ok.body.result).toBe('ACCEPTED');
      // Contrôle visuel : photo et titulaire affichés au point de contrôle.
      expect(ok.body.pass.photoUrl).toMatch(/^\/api\/v1\/files\//);
      expect(ok.body.pass.holderName).toMatch(/^Awa Titulaire/);
      // Même QR (même fenêtre de 30 s), même dans un autre parc : refusé.
      expect((await scan(gate2, estA2, page.qr)).body.refusalReason).toBe('QR_REUSED');
      const publicId = await publicIdOf(p.id);
      const old = signer.dynamicQr(publicId, 1, Date.now() - 5 * 60_000).qr;
      expect((await scan(gate1, estA1, old)).body).toMatchObject({
        refusalReason: 'QR_EXPIRED',
        pass: expect.objectContaining({ id: p.id }),
      });
      const fresh = signer.dynamicQr(publicId, 1).qr;
      const forged = fresh.slice(0, -2) + (fresh.endsWith('AA') ? 'BB' : 'AA');
      expect((await scan(gate1, estA1, forged)).body).toMatchObject({
        refusalReason: 'UNKNOWN',
        pass: null,
      });
      const future = signer.dynamicQr(publicId, 1, Date.now() + 10 * 60_000).qr;
      expect((await scan(gate1, estA1, future)).body.refusalReason).toBe('QR_EXPIRED');
      // Signature d'une autre clé (QR fabriqué hors du serveur) : inconnu.
      const foreign = new PassQrSigner(Buffer.alloc(32, 7)).dynamicQr(publicId, 1).qr;
      expect((await scan(gate1, estA1, foreign)).body.refusalReason).toBe('UNKNOWN');
      // Historique des validations et refus sur la fiche.
      const detail = (await cashier.get(`/api/v1/passes/${p.id}`).expect(200)).body;
      expect(detail.scans.map((s: { refusalReason: string | null }) => s.refusalReason)).toEqual(
        expect.arrayContaining([null, 'QR_REUSED', 'QR_EXPIRED']),
      );
    });

    it('lien personnel révocable : l’ancien lien et le QR déjà affiché cessent de fonctionner', async () => {
      const p = await sell(offerYear, { photoFileId: await photo() });
      const { token, page } = await holderQr(p.id);
      await cashier.delete(`/api/v1/passes/${p.id}/link`).expect(403);
      await supervisor.delete(`/api/v1/passes/${p.id}/link`).expect(200);
      await agent(app).get(`/api/v1/public/passes/${token}`).expect(404);
      expect((await scan(gate1, estA1, page.qr)).body.refusalReason).toBe('UNKNOWN');
      const second = await holderQr(p.id);
      expect((await scan(gate1, estA1, second.page.qr)).body.result).toBe('ACCEPTED');
      // Un nouveau lien remplace le précédent.
      const third = await holderQr(p.id);
      await agent(app).get(`/api/v1/public/passes/${second.token}`).expect(404);
      await agent(app).get(`/api/v1/public/passes/${third.token}`).expect(200);
      await agent(app).get('/api/v1/public/passes/abc').expect(400);
    });

    it('autre organisation : QR inconnu, sans aucun détail', async () => {
      const p = await sell(offerDay);
      const gateC = parkC.agent;
      const res = await scan(gateC, estC, p.staticQr).expect(200);
      expect(res.body).toMatchObject({ result: 'REFUSED', refusalReason: 'UNKNOWN', pass: null });
      const stored = await prisma.ticketScan.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(stored.passId).toBeNull();
      await parkC.agent.get(`/api/v1/passes/${p.id}`).expect(404);
    });

    it('fuseaux : le quota du jour se remet à zéro à minuit dans le fuseau de chaque parc', async () => {
      // Deux parcs à 25 h d'écart : leurs dates locales diffèrent toujours.
      await parkA.agent
        .patch(`/api/v1/establishments/${estA2}`)
        .send({ timezone: 'Pacific/Kiritimati' })
        .expect(200);
      await parkA.agent
        .patch(`/api/v1/establishments/${estA3}`)
        .send({ timezone: 'Pacific/Pago_Pago' })
        .expect(200);
      try {
        const offer = await createOffer({
          kind: 'WEEK',
          name: 'Semaine deux fuseaux',
          price: 5000,
          sites: [{ establishmentId: estA2 }, { establishmentId: estA3 }],
        });
        // Vendu au guichet de l'annexe (fuseau de Kiritimati) : date de début dans ce fuseau.
        const sold = await order(
          cashier2,
          offer.id,
          await customer(),
          { startDate: localMoment(new Date(), 'Pacific/Kiritimati').date },
          estA2,
        ).expect(201);
        await pay(cashier2, sold.body.sale.id, 5000).expect(200);
        const p = (await parkA.agent.get(`/api/v1/passes/${sold.body.pass.id}`).expect(200)).body;
        expect(p.rules.timezone).toBe('Pacific/Kiritimati');
        const start = addDays(todayIn(), -3);
        await prisma.passPeriod.updateMany({
          where: { passId: p.id },
          data: { startDate: day(start), endDate: day(addDays(start, 6)) },
        });
        await prisma.pass.update({
          where: { id: p.id },
          data: { startDate: day(start), endDate: day(addDays(start, 6)) },
        });
        const east = await scan(parkA.agent, estA2, p.staticQr).expect(200);
        const west = await scan(parkA.agent, estA3, p.staticQr).expect(200);
        expect([east.body.result, west.body.result]).toEqual(['ACCEPTED', 'ACCEPTED']);
        const rows = await prisma.ticketScan.findMany({
          where: { passId: p.id },
          select: { localDate: true, establishmentId: true },
        });
        const dates = new Map(
          rows.map((r) => [r.establishmentId, r.localDate!.toISOString().slice(0, 10)]),
        );
        expect(dates.get(estA2)).toBe(localMoment(new Date(), 'Pacific/Kiritimati').date);
        expect(dates.get(estA3)).toBe(localMoment(new Date(), 'Pacific/Pago_Pago').date);
        expect(dates.get(estA2)).not.toBe(dates.get(estA3));
        expect((await scan(parkA.agent, estA2, p.staticQr)).body.refusalReason).toBe(
          'DAILY_QUOTA_REACHED',
        );
      } finally {
        await parkA.agent
          .patch(`/api/v1/establishments/${estA2}`)
          .send({ timezone: 'Africa/Bamako' })
          .expect(200);
        await parkA.agent
          .patch(`/api/v1/establishments/${estA3}`)
          .send({ timezone: 'Africa/Bamako' })
          .expect(200);
      }
    });

    it('billets classiques inchangés : un billet se scanne comme avant, sans bloc pass', async () => {
      const cat = (
        await parkA.agent
          .post('/api/v1/ticketing/categories')
          .send({ establishmentId: estA1, kind: 'ADULT', name: 'Adulte S8', price: 2000 })
          .expect(201)
      ).body.id;
      const sale = (
        await cashier
          .post('/api/v1/ticketing/orders')
          .send({
            establishmentId: estA1,
            lines: [{ ticketCategoryId: cat, quantity: 1, visitorNames: ['Moussa'] }],
          })
          .expect(201)
      ).body;
      await pay(cashier, sale.id, 2000).expect(200);
      const tickets = (await cashier.get('/api/v1/tickets').query({ saleId: sale.id }).expect(200))
        .body;
      expect(tickets).toHaveLength(1);
      expect(await prisma.passPeriod.count({ where: { saleId: sale.id } })).toBe(0);
      const res = await scan(gate1, estA1, tickets[0].qr).expect(200);
      expect(res.body).toMatchObject({
        result: 'ACCEPTED',
        pass: null,
        ticket: expect.objectContaining({ visitorName: 'Moussa' }),
      });
      expect((await scan(gate1, estA1, tickets[0].qr)).body.refusalReason).toBe('ALREADY_USED');
    });
  });

  describe('Lot C — titulaires, suspensions, renouvellements, cartes', () => {
    it('suspension : motif obligatoire, réservée au superviseur, refuse les entrées, prolonge à la réactivation (plafond)', async () => {
      const p = await sell(offerMonth, { photoFileId: await photo() });
      await cashier.post(`/api/v1/passes/${p.id}/suspend`).send({ reason: 'Voyage' }).expect(403);
      await supervisor.post(`/api/v1/passes/${p.id}/suspend`).send({}).expect(400);
      const s = (
        await supervisor
          .post(`/api/v1/passes/${p.id}/suspend`)
          .send({ reason: 'Voyage' })
          .expect(200)
      ).body;
      expect(s).toMatchObject({ status: 'SUSPENDED', suspensionReason: 'Voyage' });
      const { page } = await holderQr(p.id);
      expect(page.state).toBe('SUSPENDED');
      expect(page.qr).toBeNull();
      const qr = signer.dynamicQr(await publicIdOf(p.id), 1).qr;
      expect((await scan(gate1, estA1, qr)).body.refusalReason).toBe('SUSPENDED');
      const renew = await cashier
        .post(`/api/v1/passes/${p.id}/renew`)
        .send({ establishmentId: estA1 });
      expect(renew.body.code).toBe('PASS_NOT_RENEWABLE');
      // Suspendu depuis 4 jours : +4 jours.
      await prisma.pass.update({
        where: { id: p.id },
        data: { suspendedAt: new Date(Date.now() - 4 * 86_400_000) },
      });
      const r = (await supervisor.post(`/api/v1/passes/${p.id}/reactivate`).expect(200)).body;
      expect(r.status).toBe('ACTIVE');
      expect(r.endDate).toBe(addDays(p.endDate, 4));
      expect(r.periods[0].extendedDays).toBe(4);
      // Suspendu 30 jours, plafond 10 : +10.
      await supervisor
        .post(`/api/v1/passes/${p.id}/suspend`)
        .send({ reason: 'Maladie' })
        .expect(200);
      await prisma.pass.update({
        where: { id: p.id },
        data: { suspendedAt: new Date(Date.now() - 30 * 86_400_000) },
      });
      const r2 = (await supervisor.post(`/api/v1/passes/${p.id}/reactivate`).expect(200)).body;
      expect(r2.endDate).toBe(addDays(p.endDate, 14));
      const events = r2.events.map((e: { type: string }) => e.type);
      expect(events.filter((t: string) => t === 'SUSPENDED')).toHaveLength(2);
      // Offre sans suspension (journalier : 0 jour).
      const d = await sell(offerDay);
      expect(
        (await supervisor.post(`/api/v1/passes/${d.id}/suspend`).send({ reason: 'Essai' })).body
          .code,
      ).toBe('PASS_SUSPENSION_NOT_ALLOWED');
    });

    it('renouvellement : à l’échéance, prix actuel du parc, un seul en attente, historique conservé', async () => {
      const p = await sell(offerMonth, { photoFileId: await photo() });
      await parkA.agent
        .patch(`/api/v1/pass-offers/${offerMonth}`)
        .send({ price: 27000 })
        .expect(200);
      const r = (
        await cashier
          .post(`/api/v1/passes/${p.id}/renew`)
          .send({ establishmentId: estA1 })
          .expect(201)
      ).body;
      expect(r.sale.total).toBe(27000);
      expect(r.pass.pendingRenewal).toBe(true);
      const dup = await cashier
        .post(`/api/v1/passes/${p.id}/renew`)
        .send({ establishmentId: estA1 });
      expect(dup.body.code).toBe('PASS_RENEWAL_PENDING');
      await pay(cashier, r.sale.id, 27000).expect(200);
      const after = (await cashier.get(`/api/v1/passes/${p.id}`).expect(200)).body;
      expect(after.periods).toHaveLength(2);
      expect(after.periods[1]).toMatchObject({
        status: 'PAID',
        isRenewal: true,
        price: 27000,
        startDate: addDays(p.endDate, 1),
      });
      expect(after.endDate).toBe(after.periods[1].endDate);
      expect(after.periods[0]).toMatchObject({
        price: 25000,
        startDate: p.startDate,
        endDate: p.endDate,
      });
      expect(after.events.map((e: { type: string }) => e.type)).toEqual(
        expect.arrayContaining(['RENEWED', 'RENEWAL_ORDERED', 'ACTIVATED', 'SOLD']),
      );
      // Les entrées de la période précédente restent dans l'historique ; la nouvelle période repart à zéro.
      await parkA.agent
        .patch(`/api/v1/pass-offers/${offerMonth}`)
        .send({ price: 25000 })
        .expect(200);
    });

    it('renouvellement d’un pass expiré : commence le jour du paiement, sans chevauchement', async () => {
      const p = await sell(offerMonth, { photoFileId: await photo() });
      const start = addDays(todayIn(), -40);
      await prisma.passPeriod.updateMany({
        where: { passId: p.id },
        data: { startDate: day(start), endDate: day(addDays(start, 29)) },
      });
      await prisma.pass.update({
        where: { id: p.id },
        data: { startDate: day(start), endDate: day(addDays(start, 29)) },
      });
      expect((await cashier.get(`/api/v1/passes/${p.id}`)).body.state).toBe('EXPIRED');
      const r = (
        await cashier
          .post(`/api/v1/passes/${p.id}/renew`)
          .send({ establishmentId: estA1 })
          .expect(201)
      ).body;
      await pay(cashier, r.sale.id, r.sale.total).expect(200);
      const after = (await cashier.get(`/api/v1/passes/${p.id}`).expect(200)).body;
      expect(after.periods[1].startDate).toBe(todayIn());
      expect(after.state).toBe('ACTIVE');
      // Renouvellement non payé puis annulé : la période est annulée, le pass reste actif.
      const r2 = (
        await cashier
          .post(`/api/v1/passes/${p.id}/renew`)
          .send({ establishmentId: estA1 })
          .expect(201)
      ).body;
      await parkA.agent
        .post(`/api/v1/sales/${r2.sale.id}/cancel`)
        .send({ reason: 'Oubli' })
        .expect(200);
      const last = (await cashier.get(`/api/v1/passes/${p.id}`).expect(200)).body;
      expect(last.status).toBe('ACTIVE');
      expect(last.periods.map((x: { status: string }) => x.status)).toEqual([
        'PAID',
        'PAID',
        'CANCELLED',
      ]);
      // Pass non renouvelable (journalier).
      const d = await sell(offerDay);
      expect(
        (await cashier.post(`/api/v1/passes/${d.id}/renew`).send({ establishmentId: estA1 })).body
          .code,
      ).toBe('PASS_NOT_RENEWABLE');
    });

    it('cartes : une seule active, perte → révocation sans toucher l’abonnement, remplacement lié au même titulaire', async () => {
      const p = await sell(offerYear, { photoFileId: await photo() });
      await cashier.post(`/api/v1/passes/${p.id}/cards`).expect(403);
      const issued = (await supervisor.post(`/api/v1/passes/${p.id}/cards`).expect(201)).body;
      const card1 = issued.cards[0];
      expect(card1).toMatchObject({ status: 'ACTIVE' });
      expect((await supervisor.post(`/api/v1/passes/${p.id}/cards`)).body.code).toBe(
        'PASS_CARD_ACTIVE',
      );
      // Contrat d'impression Ocall Print.
      const print = (
        await supervisor.post(`/api/v1/passes/${p.id}/cards/${card1.id}/print-data`).expect(200)
      ).body;
      expect(print).toMatchObject({
        format: 'ocall-print/pass-card@1',
        cardNumber: card1.cardNumber,
        offerName: 'Annuel libre',
      });
      expect(print.qr).toMatch(/^OCPC-[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}$/);
      expect(print.photoUrl).toMatch(/^\/api\/v1\/files\//);
      expect(JSON.stringify(print)).not.toMatch(/secret|signingKey/i);
      const ok = await scan(gate1, estA1, print.qr).expect(200);
      expect(ok.body).toMatchObject({ result: 'ACCEPTED', cardId: card1.id });
      // Carte perdue : remplacée ; l'ancienne est refusée, la nouvelle acceptée, même pass.
      const replaced = (
        await supervisor
          .post(`/api/v1/passes/${p.id}/cards/${card1.id}/replace`)
          .send({ reason: 'Carte perdue' })
          .expect(200)
      ).body;
      const card2 = replaced.cards.find((c: { status: string }) => c.status === 'ACTIVE');
      expect(card2).toMatchObject({ replacesCardId: card1.id });
      expect(replaced.status).toBe('ACTIVE');
      expect((await scan(gate2, estA2, print.qr)).body.refusalReason).toBe('CARD_REVOKED');
      const qr2 = signer.cardQr(card2.cardNumber);
      expect((await scan(gate2, estA2, qr2)).body.result).toBe('ACCEPTED');
      // Une carte révoquée ne se réactive jamais.
      expect(
        (
          await supervisor
            .post(`/api/v1/passes/${p.id}/cards/${card1.id}/revoke`)
            .send({ reason: 'Encore' })
        ).body.code,
      ).toBe('PASS_CARD_NOT_ACTIVE');
      await supervisor
        .post(`/api/v1/passes/${p.id}/cards/${card2.id}/revoke`)
        .send({ reason: 'Vol' })
        .expect(200);
      expect((await scan(gate1, estA1, qr2)).body.refusalReason).toBe('CARD_REVOKED');
      // Numéro de carte inventé ou signature fausse : inconnu.
      const fake = qr2.slice(0, -2) + (qr2.endsWith('AA') ? 'BB' : 'AA');
      expect((await scan(gate1, estA1, fake)).body.refusalReason).toBe('UNKNOWN');
      expect(await prisma.passCard.count({ where: { passId: p.id } })).toBe(2);
    });

    it('annulation : superviseur, motif, sans remboursement ; cartes et lien révoqués ; vente en attente bloquante', async () => {
      const p = await sell(offerMonth, { photoFileId: await photo() });
      await supervisor.post(`/api/v1/passes/${p.id}/cards`).expect(201);
      const { token } = await holderQr(p.id);
      const r = (
        await cashier
          .post(`/api/v1/passes/${p.id}/renew`)
          .send({ establishmentId: estA1 })
          .expect(201)
      ).body;
      expect(
        (await supervisor.post(`/api/v1/passes/${p.id}/cancel`).send({ reason: 'Fraude' })).body
          .code,
      ).toBe('PASS_PENDING_SALE');
      await parkA.agent.post(`/api/v1/sales/${r.sale.id}/cancel`).send({}).expect(200);
      await cashier.post(`/api/v1/passes/${p.id}/cancel`).send({ reason: 'Fraude' }).expect(403);
      const c = (
        await supervisor
          .post(`/api/v1/passes/${p.id}/cancel`)
          .send({ reason: 'Fraude' })
          .expect(200)
      ).body;
      expect(c).toMatchObject({ status: 'CANCELLED', cancelReason: 'Fraude', hasLink: false });
      expect(c.cards.every((x: { status: string }) => x.status === 'REVOKED')).toBe(true);
      await agent(app).get(`/api/v1/public/passes/${token}`).expect(404);
      const sale = await prisma.sale.findUniqueOrThrow({ where: { id: p.saleId } });
      expect(sale).toMatchObject({ paymentStatus: 'PAID', status: 'OPEN' });
      const qr = signer.dynamicQr(await publicIdOf(p.id), 1).qr;
      expect((await scan(gate1, estA1, qr)).body.refusalReason).toBe('CANCELLED');
    });

    it('photo : changement tracé, ancienne photo purgée sous 30 jours ; anonymisation du client', async () => {
      const p = await sell(offerMonth, { photoFileId: await photo() });
      const oldId = (await prisma.pass.findUniqueOrThrow({ where: { id: p.id } })).photoFileId!;
      const newId = await photo();
      const updated = (
        await cashier.put(`/api/v1/passes/${p.id}/photo`).send({ photoFileId: newId }).expect(200)
      ).body;
      expect(updated.events[0].type).toBe('PHOTO_UPDATED');
      const old = await prisma.storedFile.findUniqueOrThrow({ where: { id: oldId } });
      expect(old.retentionUntil!.getTime()).toBeLessThan(Date.now() + 31 * 86_400_000);
      await holderQr(p.id);
      await parkA.agent
        .post(`/api/v1/customers/${p.customerId}/anonymize`)
        .send({ reason: 'Demande du client' })
        .expect(200);
      const row = await prisma.pass.findUniqueOrThrow({ where: { id: p.id } });
      expect(row).toMatchObject({
        holderName: 'Client anonymisé',
        photoFileId: null,
        linkTokenHash: null,
      });
      const purged = await prisma.storedFile.findUniqueOrThrow({ where: { id: newId } });
      expect(purged.retentionUntil!.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('Lot D — droits, organisations, compatibilité', () => {
    it('droits par rôle et par établissement', async () => {
      const p = await sell(offerDay);
      // Agent de contrôle : ni vente ni fiche.
      await gate1
        .post('/api/v1/passes/orders')
        .send({
          establishmentId: estA1,
          offerId: offerDay,
          customerId: p.customerId,
          startDate: todayIn(),
        })
        .expect(403);
      await gate1.get(`/api/v1/passes/${p.id}`).expect(403);
      // Caissier de l'annexe : un pass valable seulement au parc principal lui est invisible.
      await cashier2.get(`/api/v1/passes/${p.id}`).expect(404);
      const list2 = (await cashier2.get('/api/v1/passes').expect(200)).body;
      expect(list2.some((x: { id: string }) => x.id === p.id)).toBe(false);
      // Vente dans un parc où l'offre n'est pas proposée.
      const off = await cashier2.post('/api/v1/passes/orders').send({
        establishmentId: estA2,
        offerId: offerDay,
        customerId: p.customerId,
        startDate: todayIn(),
      });
      expect(off.body.code).toBe('PASS_OFFER_UNAVAILABLE');
      // Parc non affecté au caissier.
      expect(
        (
          await cashier.post('/api/v1/passes/orders').send({
            establishmentId: estA2,
            offerId: offerWeek,
            customerId: p.customerId,
            startDate: todayIn(),
          })
        ).status,
      ).toBe(404);
      // Recherche par nom.
      const found = (await cashier.get('/api/v1/passes').query({ q: 'awa' }).expect(200)).body;
      expect(found.length).toBeGreaterThan(0);
      // Offres en vente au guichet : prix du parc.
      const sellable = (
        await cashier2.get('/api/v1/passes/offers').query({ establishmentId: estA2 }).expect(200)
      ).body;
      expect(sellable.offers.find((o: { id: string }) => o.id === offerWeek).price).toBe(10000);
    });

    it('offre désactivée ou hors période de vente : plus vendable, les pass vendus restent valables', async () => {
      const offer = await createOffer({
        kind: 'DAY',
        name: 'Éphémère',
        price: 1000,
        sites: [{ establishmentId: estA1 }],
      });
      const p = await sell(offer.id);
      await parkA.agent
        .patch(`/api/v1/pass-offers/${offer.id}`)
        .send({ isActive: false })
        .expect(200);
      expect((await order(cashier, offer.id, p.customerId)).body.code).toBe(
        'PASS_OFFER_UNAVAILABLE',
      );
      expect((await scan(gate1, estA1, p.staticQr)).body.result).toBe('ACCEPTED');
      await parkA.agent
        .patch(`/api/v1/pass-offers/${offer.id}`)
        .send({
          isActive: true,
          saleUntil: addDays(todayIn(), -1),
          saleFrom: addDays(todayIn(), -5),
        })
        .expect(200);
      expect((await order(cashier, offer.id, p.customerId)).body.code).toBe(
        'PASS_OFFER_UNAVAILABLE',
      );
      const bad = await parkA.agent
        .patch(`/api/v1/pass-offers/${offer.id}`)
        .send({ saleFrom: addDays(todayIn(), 3), saleUntil: todayIn() });
      expect(bad.body.code).toBe('PASS_SALE_WINDOW_INVALID');
    });

    it('compatibilité Restaurant : pas d’accès aux pass, caisse restaurant inchangée', async () => {
      const res = await resto.agent.get('/api/v1/passes');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MODULE_NOT_IN_PLAN');
      await resto.agent.get('/api/v1/pass-offers').expect(403);
      const categoryId = (
        await resto.agent.post('/api/v1/catalog/categories').send({ name: 'Boissons' }).expect(201)
      ).body.id;
      const product = (
        await resto.agent
          .post('/api/v1/catalog/products')
          .send({
            name: 'Bissap',
            categoryId,
            variants: [{ name: 'Verre', prices: [{ establishmentId: estResto, price: 500 }] }],
          })
          .expect(201)
      ).body;
      await resto.agent
        .post('/api/v1/cash-sessions')
        .send({ establishmentId: estResto, openingFloat: 0 })
        .expect(201);
      const s1 = (
        await resto.agent
          .post('/api/v1/sales')
          .send({
            establishmentId: estResto,
            lines: [{ variantId: product.variants[0].id, quantity: 2 }],
          })
          .expect(201)
      ).body;
      await pay(resto.agent, s1.id, 1000).expect(200);
      const s2 = (
        await resto.agent
          .post('/api/v1/sales')
          .send({
            establishmentId: estResto,
            lines: [{ variantId: product.variants[0].id, quantity: 1 }],
          })
          .expect(201)
      ).body;
      await resto.agent.post(`/api/v1/sales/${s2.id}/cancel`).send({}).expect(200);
      expect(await prisma.pass.count({ where: { organizationId: resto.organizationId } })).toBe(0);
    });

    it('fréquentation et fidélité : les entrées de pass sont des passages du journal, la vente crédite le titulaire', async () => {
      const p = await sell(offerDay);
      await scan(gate1, estA1, p.staticQr).expect(200);
      const scans = (
        await gate1.get('/api/v1/access/scans').query({ establishmentId: estA1 }).expect(200)
      ).body;
      expect(scans.some((s: { pass: { id: string } | null }) => s.pass?.id === p.id)).toBe(true);
      const customerRow = await prisma.customer.findUniqueOrThrow({ where: { id: p.customerId } });
      expect(customerRow.lastVisitAt).not.toBeNull();
      // Statistiques du parc : entrées comprises dans la fréquentation, ventes par offre de pass.
      const stats = (
        await parkA.agent
          .get('/api/v1/analytics/park')
          .query({ period: 'today', establishmentId: estA1 })
          .expect(200)
      ).body;
      const dayRow = stats.passOffers.find((o: { offerId: string }) => o.offerId === offerDay);
      expect(dayRow).toMatchObject({ offer: 'Journée', kind: 'DAY' });
      expect(dayRow.paidUnits).toBeGreaterThanOrEqual(1);
      expect(dayRow.entries).toBeGreaterThanOrEqual(1);
      expect(dayRow.revenue).toBe(dayRow.paidUnits * 3000);
      expect(stats.totals.scanned.current).toBeGreaterThanOrEqual(dayRow.entries);
      const restoStats = await resto.agent.get('/api/v1/analytics/park').query({ period: 'today' });
      expect(restoStats.status).toBe(403);
    });
  });

  describe('Compléments — cas limites révélés par les mutations', () => {
    it('carte d’une autre organisation et QR fixe à la signature falsifiée : inconnus, sans détail', async () => {
      const p = await sell(offerDay);
      const forged = p.staticQr.slice(0, -1) + (p.staticQr.endsWith('A') ? 'B' : 'A');
      const f = (await scan(gate1, estA1, forged).expect(200)).body;
      expect(f).toMatchObject({ result: 'REFUSED', refusalReason: 'UNKNOWN', pass: null });
      const card = (await supervisor.post(`/api/v1/passes/${p.id}/cards`).expect(201)).body;
      const cardNumber = (card.cards ?? []).find((c: { status: string }) => c.status === 'ACTIVE')
        ?.cardNumber as string;
      expect(cardNumber).toBeTruthy();
      const other = (await scan(parkC.agent, estC, signer.cardQr(cardNumber)).expect(200)).body;
      expect(other).toMatchObject({ result: 'REFUSED', refusalReason: 'UNKNOWN', pass: null });
      // Rien n'est consommé : la carte reste valable dans son parc.
      const own = (await scan(gate1, estA1, signer.cardQr(cardNumber)).expect(200)).body;
      expect(own.result).toBe('ACCEPTED');
    });

    it('renouvellement dans un parc ajouté à l’offre après la vente : refusé (règles figées)', async () => {
      const offer = (
        await createOffer({
          kind: 'MONTHLY',
          name: 'Mensuel parc principal',
          price: 20000,
          sites: [{ establishmentId: estA1 }],
        })
      ).id;
      const p = await sell(offer, { photoFileId: await photo() });
      await parkA.agent
        .patch(`/api/v1/pass-offers/${offer}`)
        .send({ sites: [{ establishmentId: estA1 }, { establishmentId: estA2 }] })
        .expect(200);
      const r = await cashier2
        .post(`/api/v1/passes/${p.id}/renew`)
        .send({ establishmentId: estA2 });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('PASS_OTHER_ESTABLISHMENT');
    });

    it('réactivation : la période suivante déjà payée est décalée d’autant, sans chevauchement', async () => {
      const p = await sell(offerMonth, { photoFileId: await photo() });
      const r = (
        await cashier
          .post(`/api/v1/passes/${p.id}/renew`)
          .send({ establishmentId: estA1 })
          .expect(201)
      ).body;
      await pay(cashier, r.sale.id, r.sale.total).expect(200);
      const before = (await cashier.get(`/api/v1/passes/${p.id}`).expect(200)).body;
      await supervisor
        .post(`/api/v1/passes/${p.id}/suspend`)
        .send({ reason: 'Voyage' })
        .expect(200);
      await prisma.pass.update({
        where: { id: p.id },
        data: { suspendedAt: new Date(Date.now() - 3 * 86_400_000) },
      });
      const after = (await supervisor.post(`/api/v1/passes/${p.id}/reactivate`).expect(200)).body;
      const [b0, b1] = before.periods;
      const [a0, a1] = after.periods;
      expect(a0.endDate).toBe(addDays(b0.endDate, 3));
      expect(a1.startDate).toBe(addDays(b1.startDate, 3));
      expect(a1.endDate).toBe(addDays(b1.endDate, 3));
      expect(a1.startDate).toBe(addDays(a0.endDate, 1));
      expect(after.endDate).toBe(a1.endDate);
    });

    it('paiement d’une vente dont la période est passée, ou d’un pass annulé : refusé, rien n’est activé', async () => {
      const res = await order(cashier, offerDay, await customer()).expect(201);
      const past = day(addDays(todayIn(), -3));
      await prisma.pass.update({
        where: { id: res.body.pass.id },
        data: { startDate: past, endDate: past },
      });
      const late = await pay(cashier, res.body.sale.id, res.body.sale.total);
      expect(late.status).toBe(409);
      expect(late.body.code).toBe('PASS_DATES_PASSED');
      const res2 = await order(cashier, offerDay, await customer()).expect(201);
      await prisma.pass.update({
        where: { id: res2.body.pass.id },
        data: { status: 'CANCELLED' },
      });
      const cancelled = await pay(cashier, res2.body.sale.id, res2.body.sale.total);
      expect(cancelled.status).toBe(409);
      expect(cancelled.body.code).toBe('PASS_CANCELLED');
      for (const id of [res.body.sale.id, res2.body.sale.id]) {
        const sale = await prisma.sale.findUniqueOrThrow({ where: { id } });
        expect(sale.paymentStatus).not.toBe('PAID');
      }
    });
  });
});
