import type { INestApplication } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { localMoment, ticketQrPayload } from '@ocall/shared';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  type Agent,
  PASSWORD,
  type SignedUpOwner,
  cleanup,
  createTestApp,
  login,
  signup,
} from './helpers';

const QR_FORMAT = /^OCP1-[A-Za-z0-9_-]{22}$/;

interface IssuedTicket {
  id: string;
  visitorName: string;
  status: string;
  pricePaid: number;
  qr: string;
  ticketCategory: { id: string; name: string; kind: string };
}

/**
 * Sprint 4 — billetterie du parc, QR codes et contrôle d'accès.
 * Exécuté uniquement sur la base de test (TEST_DATABASE_URL).
 */
describe('Sprint 4 — billetterie et contrôle d’accès (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let parkA: SignedUpOwner;
  let parkC: SignedUpOwner;
  let resto: SignedUpOwner;
  let duo: SignedUpOwner;
  let estA1: string;
  let estA2: string;
  let estC: string;
  let estDuo: string;
  let cashier: Agent;
  let cashier2: Agent;
  let gate1: Agent;
  let gate2: Agent;
  let adult: string; // 3 000 FCFA
  let child: string; // 1 500 FCFA
  let family: string; // 10 000 FCFA pour 3 personnes
  let adultA2: string;
  let adultC: string;

  async function employee(
    owner: SignedUpOwner,
    role: string,
    establishmentIds: string[],
  ): Promise<Agent> {
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

  async function category(
    owner: SignedUpOwner,
    establishmentId: string,
    body: Record<string, unknown>,
  ) {
    const res = await owner.agent
      .post('/api/v1/ticketing/categories')
      .send({ establishmentId, ...body })
      .expect(201);
    return res.body.id as string;
  }

  type Line = { ticketCategoryId: string; quantity: number; visitorNames: string[] };

  const order = (a: Agent, establishmentId: string, lines: Line[], clientRequestId?: string) =>
    a.post('/api/v1/ticketing/orders').send({ establishmentId, lines, clientRequestId });

  const pay = (a: Agent, saleId: string, amountTendered: number, clientRequestId?: string) =>
    a
      .post(`/api/v1/sales/${saleId}/payments`)
      .send({ method: 'CASH', amountTendered, clientRequestId });

  const ticketsOf = async (a: Agent, saleId: string): Promise<IssuedTicket[]> =>
    (await a.get('/api/v1/tickets').query({ saleId }).expect(200)).body;

  /** Commande encaissée : renvoie la vente et ses billets émis. */
  async function buy(a: Agent, establishmentId: string, lines: Line[]) {
    const sale = (await order(a, establishmentId, lines).expect(201)).body;
    await pay(a, sale.id, sale.total).expect(200);
    return { sale, tickets: await ticketsOf(a, sale.id) };
  }

  const scan = (a: Agent, establishmentId: string, qr: string, clientRequestId?: string) =>
    a
      .post('/api/v1/access/scans')
      .send({ establishmentId, entryPoint: 'Entrée principale', qr, clientRequestId });

  const today = () => localMoment(new Date(), 'Africa/Bamako');

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    parkA = await signup(app, 'tka', 'PARK');
    parkC = await signup(app, 'tkc', 'PARK');
    resto = await signup(app, 'tkr', 'RESTAURANT');
    duo = await signup(app, 'tkd', 'PARK_RESTAURANT');
    estA1 = (await parkA.agent.get('/api/v1/establishments').expect(200)).body[0].id;
    estA2 = (
      await parkA.agent
        .post('/api/v1/establishments')
        .send({ name: 'Parc annexe', businessType: 'PARK', city: 'Ségou' })
        .expect(201)
    ).body.id;
    estC = (await parkC.agent.get('/api/v1/establishments').expect(200)).body[0].id;
    estDuo = (await duo.agent.get('/api/v1/establishments').expect(200)).body[0].id;

    adult = await category(parkA, estA1, { kind: 'ADULT', name: 'Adulte', price: 3000 });
    child = await category(parkA, estA1, {
      kind: 'CHILD',
      name: 'Enfant',
      price: 1500,
      conditions: 'Moins de 12 ans',
    });
    family = await category(parkA, estA1, {
      kind: 'FAMILY',
      name: 'Famille 3',
      price: 10000,
      peopleIncluded: 3,
    });
    adultA2 = await category(parkA, estA2, { kind: 'ADULT', name: 'Adulte', price: 2500 });
    adultC = await category(parkC, estC, { kind: 'ADULT', name: 'Adulte', price: 2000 });

    cashier = await employee(parkA, 'CASHIER', [estA1]);
    gate1 = await employee(parkA, 'GATE_AGENT', [estA1]);
    gate2 = await employee(parkA, 'GATE_AGENT', [estA2]);
    // Une seule session de caisse ouverte par membre : l'annexe a son propre caissier.
    cashier2 = await employee(parkA, 'CASHIER', [estA2]);
    await cashier
      .post('/api/v1/cash-sessions')
      .send({ establishmentId: estA1, openingFloat: 0 })
      .expect(201);
    await parkA.agent
      .post('/api/v1/cash-sessions')
      .send({ establishmentId: estA1, openingFloat: 0 })
      .expect(201);
    await cashier2
      .post('/api/v1/cash-sessions')
      .send({ establishmentId: estA2, openingFloat: 0 })
      .expect(201);
    await parkC.agent
      .post('/api/v1/cash-sessions')
      .send({ establishmentId: estC, openingFloat: 0 })
      .expect(201);
  }, 240_000);

  afterAll(async () => {
    await cleanup(prisma);
    await app.close();
  });

  describe('vente de billets', () => {
    it('1. vend un billet adulte : un QR au format attendu, sans donnée personnelle', async () => {
      const { sale, tickets } = await buy(cashier, estA1, [
        { ticketCategoryId: adult, quantity: 1, visitorNames: ['Awa'] },
      ]);
      expect(sale).toMatchObject({ activity: 'PARK', total: 3000 });
      expect(tickets).toHaveLength(1);
      expect(tickets[0]).toMatchObject({ visitorName: 'Awa', status: 'VALID', pricePaid: 3000 });
      expect(tickets[0]!.qr).toMatch(QR_FORMAT);
      expect(tickets[0]!.qr).not.toMatch(/awa|3000|tka/i);
    });

    it('2. vend des billets enfant : un billet par enfant', async () => {
      const { sale, tickets } = await buy(cashier, estA1, [
        { ticketCategoryId: child, quantity: 2, visitorNames: ['Ibrahim', 'Mariam'] },
      ]);
      expect(sale.total).toBe(3000);
      expect(tickets.map((t) => [t.visitorName, t.pricePaid])).toEqual([
        ['Ibrahim', 1500],
        ['Mariam', 1500],
      ]);
    });

    it('3. vend une formule famille : un QR distinct par personne, prix réparti sans perte', async () => {
      const { sale, tickets } = await buy(cashier, estA1, [
        { ticketCategoryId: family, quantity: 1, visitorNames: ['Seydou', 'Kadi', 'Oumou'] },
      ]);
      expect(sale.total).toBe(10000);
      expect(tickets).toHaveLength(3);
      expect(new Set(tickets.map((t) => t.qr)).size).toBe(3);
      expect(tickets.map((t) => t.pricePaid)).toEqual([3334, 3333, 3333]);
      expect(tickets.reduce((s, t) => s + t.pricePaid, 0)).toBe(10000);
    });

    it('4. calcule le tarif côté serveur : aucun prix du navigateur n’est accepté', async () => {
      const quote = await cashier
        .post('/api/v1/ticketing/quote')
        .send({
          establishmentId: estA1,
          lines: [
            { ticketCategoryId: adult, quantity: 2, visitorNames: ['A', 'B'] },
            { ticketCategoryId: family, quantity: 1, visitorNames: ['C', 'D', 'E'] },
          ],
        })
        .expect(200);
      expect(quote.body.total).toBe(16000);
      expect(quote.body.lines[0]).toMatchObject({
        unitPrice: 3000,
        lineTotal: 6000,
        peoplePerUnit: 1,
      });

      const forged = await cashier.post('/api/v1/ticketing/orders').send({
        establishmentId: estA1,
        lines: [{ ticketCategoryId: adult, quantity: 1, visitorNames: ['A'], unitPrice: 1 }],
      });
      expect(forged.status).toBe(400);
      const total = await cashier.post('/api/v1/ticketing/orders').send({
        establishmentId: estA1,
        total: 1,
        lines: [{ ticketCategoryId: adult, quantity: 1, visitorNames: ['A'] }],
      });
      expect(total.status).toBe(400);

      const names = await order(cashier, estA1, [
        { ticketCategoryId: family, quantity: 1, visitorNames: ['Seul'] },
      ]);
      expect(names.status).toBe(400);
      expect(names.body.code).toBe('VISITOR_NAMES_MISMATCH');

      // Nouveau tarif : il s'applique aux ventes suivantes, sans toucher aux billets déjà émis.
      await parkA.agent
        .patch(`/api/v1/ticketing/categories/${child}`)
        .send({ price: 2000 })
        .expect(200);
      const repriced = (
        await order(cashier, estA1, [
          { ticketCategoryId: child, quantity: 1, visitorNames: ['Ali'] },
        ]).expect(201)
      ).body;
      expect(repriced.total).toBe(2000);
      expect(
        await prisma.ticket.count({ where: { ticketCategoryId: child, pricePaid: 1500 } }),
      ).toBe(2);
      await parkA.agent
        .patch(`/api/v1/ticketing/categories/${child}`)
        .send({ price: 1500 })
        .expect(200);

      // Catégorie désactivée ou hors période de vente : refusée.
      const off = await category(parkA, estA1, { kind: 'CUSTOM', name: 'Nocturne', price: 5000 });
      await parkA.agent
        .patch(`/api/v1/ticketing/categories/${off}`)
        .send({ isActive: false })
        .expect(200);
      const inactive = await order(cashier, estA1, [
        { ticketCategoryId: off, quantity: 1, visitorNames: ['X'] },
      ]);
      expect(inactive.body.code).toBe('TICKET_CATEGORY_UNAVAILABLE');
      const later = await category(parkA, estA1, {
        kind: 'CUSTOM',
        name: 'Festival',
        price: 5000,
        availableFrom: '2099-01-01',
      });
      const notYet = await order(cashier, estA1, [
        { ticketCategoryId: later, quantity: 1, visitorNames: ['X'] },
      ]);
      expect(notYet.body.code).toBe('TICKET_CATEGORY_UNAVAILABLE');
      const catalog = (
        await cashier.get('/api/v1/ticketing/catalog').query({ establishmentId: estA1 }).expect(200)
      ).body;
      expect(catalog.categories.map((c: { id: string }) => c.id)).not.toEqual(
        expect.arrayContaining([off]),
      );
      expect(catalog.categories.map((c: { id: string }) => c.id)).not.toEqual(
        expect.arrayContaining([later]),
      );
      // Une catégorie d'un autre établissement n'est pas vendable ici.
      const foreign = await order(cashier, estA1, [
        { ticketCategoryId: adultA2, quantity: 1, visitorNames: ['X'] },
      ]);
      expect(foreign.body.code).toBe('TICKET_CATEGORY_UNAVAILABLE');
    });

    it('5. un billet non payé n’existe pas : aucun QR utilisable avant paiement', async () => {
      const sale = (
        await order(cashier, estA1, [
          { ticketCategoryId: adult, quantity: 1, visitorNames: ['Bintou'] },
        ]).expect(201)
      ).body;
      expect(sale.paymentStatus).toBe('UNPAID');
      expect(await ticketsOf(cashier, sale.id)).toEqual([]);
      expect(await prisma.ticket.count({ where: { saleId: sale.id } })).toBe(0);
    });

    it('6. émet les billets dans la transaction du paiement confirmé, avec audit', async () => {
      const sale = (
        await order(cashier, estA1, [
          { ticketCategoryId: child, quantity: 1, visitorNames: ['Nana'] },
        ]).expect(201)
      ).body;
      const res = await pay(cashier, sale.id, 2000).expect(200);
      expect(res.body.payment).toMatchObject({ amount: 1500, changeGiven: 500 });
      const tickets = await ticketsOf(cashier, sale.id);
      expect(tickets).toHaveLength(1);
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'tickets.issued', targetId: sale.id },
      });
      expect(audit?.metadata).toMatchObject({ tickets: 1 });
    });

    it('7. paiement et commande rejoués : aucune double émission', async () => {
      const orderKey = randomUUID();
      const lines = [{ ticketCategoryId: adult, quantity: 2, visitorNames: ['Ali', 'Sali'] }];
      const first = (await order(cashier, estA1, lines, orderKey).expect(201)).body;
      const again = (await order(cashier, estA1, lines, orderKey).expect(201)).body;
      expect(again.id).toBe(first.id);

      const key = randomUUID();
      const [p1, p2] = await Promise.all([
        pay(cashier, first.id, 6000, key),
        pay(cashier, first.id, 6000, key),
      ]);
      expect([p1.status, p2.status]).toEqual([200, 200]);
      expect(p2.body.payment.id).toBe(p1.body.payment.id);
      const other = await pay(cashier, first.id, 6000);
      expect(other.status).toBe(409);
      expect(other.body.code).toBe('SALE_ALREADY_PAID');
      expect(await prisma.payment.count({ where: { saleId: first.id } })).toBe(1);
      expect(await prisma.ticket.count({ where: { saleId: first.id } })).toBe(2);
    });
  });

  describe('contrôle d’accès', () => {
    it('8. scan valide : entrée acceptée, billet utilisé', async () => {
      const { tickets } = await buy(cashier, estA1, [
        { ticketCategoryId: adult, quantity: 1, visitorNames: ['Moussa'] },
      ]);
      const res = await scan(gate1, estA1, tickets[0]!.qr).expect(200);
      expect(res.body).toMatchObject({
        result: 'ACCEPTED',
        refusalReason: null,
        entryPoint: 'Entrée principale',
      });
      expect(res.body.ticket).toMatchObject({
        visitorName: 'Moussa',
        categoryName: 'Adulte',
        status: 'USED',
      });
      const db = await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0]!.id } });
      expect(db.status).toBe('USED');
      expect(db.usedAt).not.toBeNull();

      // 9. Second scan du même billet : refusé, avec l'heure de la première entrée.
      const second = await scan(gate1, estA1, tickets[0]!.qr).expect(200);
      expect(second.body).toMatchObject({ result: 'REFUSED', refusalReason: 'ALREADY_USED' });
      expect(second.body.ticket.usedAt).toBe(res.body.ticket.usedAt);
    });

    it('10. scans simultanés du même billet : une seule entrée acceptée', async () => {
      const { tickets } = await buy(cashier, estA1, [
        { ticketCategoryId: adult, quantity: 1, visitorNames: ['Rokia'] },
      ]);
      const qr = tickets[0]!.qr;
      const results = await Promise.all([
        scan(gate1, estA1, qr),
        scan(parkA.agent, estA1, qr),
        scan(gate1, estA1, qr),
        scan(parkA.agent, estA1, qr),
        scan(gate1, estA1, qr),
      ]);
      expect(results.every((r) => r.status === 200)).toBe(true);
      const accepted = results.filter((r) => r.body.result === 'ACCEPTED');
      expect(accepted).toHaveLength(1);
      expect(results.filter((r) => r.body.refusalReason === 'ALREADY_USED')).toHaveLength(4);
      expect(
        await prisma.ticketScan.count({ where: { ticketId: tickets[0]!.id, result: 'ACCEPTED' } }),
      ).toBe(1);
      expect(await prisma.ticketScan.count({ where: { ticketId: tickets[0]!.id } })).toBe(5);
    });

    it('scan rejoué avec la même clé : un seul enregistrement', async () => {
      const { tickets } = await buy(cashier, estA1, [
        { ticketCategoryId: adult, quantity: 1, visitorNames: ['Fily'] },
      ]);
      const key = randomUUID();
      const a = await scan(gate1, estA1, tickets[0]!.qr, key).expect(200);
      const b = await scan(gate1, estA1, tickets[0]!.qr, key).expect(200);
      expect(b.body).toMatchObject({ id: a.body.id, result: 'ACCEPTED' });
      expect(await prisma.ticketScan.count({ where: { ticketId: tickets[0]!.id } })).toBe(1);
    });

    it('11. billet expiré ou pas encore valable : refusé', async () => {
      const { tickets } = await buy(cashier, estA1, [
        { ticketCategoryId: adult, quantity: 2, visitorNames: ['Hier', 'Demain'] },
      ]);
      await prisma.ticket.update({
        where: { id: tickets[0]!.id },
        data: { validUntil: new Date(Date.now() - 60_000) },
      });
      const expired = await scan(gate1, estA1, tickets[0]!.qr).expect(200);
      expect(expired.body).toMatchObject({ result: 'REFUSED', refusalReason: 'EXPIRED' });
      expect(
        (await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0]!.id } })).status,
      ).toBe('EXPIRED');

      await prisma.ticket.update({
        where: { id: tickets[1]!.id },
        data: { validFrom: new Date(Date.now() + 86_400_000) },
      });
      const early = await scan(gate1, estA1, tickets[1]!.qr).expect(200);
      expect(early.body).toMatchObject({ result: 'REFUSED', refusalReason: 'NOT_YET_VALID' });
      expect(
        (await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[1]!.id } })).status,
      ).toBe('VALID');
    });

    it('12. billet annulé : refusé ; annulation réservée, atomique et auditée', async () => {
      const { tickets } = await buy(cashier, estA1, [
        { ticketCategoryId: adult, quantity: 2, visitorNames: ['Erreur', 'Entré'] },
      ]);
      const [toCancel, used] = tickets as [IssuedTicket, IssuedTicket];
      await cashier
        .post(`/api/v1/tickets/${toCancel.id}/cancel`)
        .send({ reason: 'Erreur de prénom' })
        .expect(403);
      await gate1
        .post(`/api/v1/tickets/${toCancel.id}/cancel`)
        .send({ reason: 'Erreur de prénom' })
        .expect(403);
      const cancelled = await parkA.agent
        .post(`/api/v1/tickets/${toCancel.id}/cancel`)
        .send({ reason: 'Erreur de prénom' })
        .expect(200);
      expect(cancelled.body).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Erreur de prénom',
      });
      const refused = await scan(gate1, estA1, toCancel.qr).expect(200);
      expect(refused.body).toMatchObject({ result: 'REFUSED', refusalReason: 'CANCELLED' });
      const twice = await parkA.agent
        .post(`/api/v1/tickets/${toCancel.id}/cancel`)
        .send({ reason: 'Encore' });
      expect(twice.status).toBe(409);
      expect(twice.body.code).toBe('TICKET_NOT_CANCELLABLE');

      await scan(gate1, estA1, used.qr).expect(200);
      const afterEntry = await parkA.agent
        .post(`/api/v1/tickets/${used.id}/cancel`)
        .send({ reason: 'Trop tard' });
      expect(afterEntry.body.code).toBe('TICKET_NOT_CANCELLABLE');
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'ticket.cancelled', targetId: toCancel.id },
      });
      expect(audit?.metadata).toMatchObject({ reason: 'Erreur de prénom' });
    });

    it('13. QR falsifié ou d’une autre organisation : « inconnu », sans aucun détail', async () => {
      const forged = ticketQrPayload(randomBytes(16).toString('base64url'));
      for (const qr of [
        forged,
        'hello',
        'OCP1-trop-court',
        `${forged}x`,
        'https://exemple.test/billet',
      ]) {
        const res = await scan(gate1, estA1, qr).expect(200);
        expect(res.body).toMatchObject({
          result: 'REFUSED',
          refusalReason: 'UNKNOWN',
          ticket: null,
        });
      }
      const { tickets } = await buy(parkC.agent, estC, [
        { ticketCategoryId: adultC, quantity: 1, visitorNames: ['Autre'] },
      ]);
      const foreign = await scan(gate1, estA1, tickets[0]!.qr).expect(200);
      expect(foreign.body).toMatchObject({
        result: 'REFUSED',
        refusalReason: 'UNKNOWN',
        ticket: null,
      });
      expect(await prisma.ticketScan.count({ where: { ticketId: tickets[0]!.id } })).toBe(0);
      expect(
        (await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0]!.id } })).status,
      ).toBe('VALID');
    });

    it('14. QR d’un autre établissement : refusé ; un agent de A ne valide jamais un billet de B', async () => {
      const { tickets } = await buy(cashier2, estA2, [
        { ticketCategoryId: adultA2, quantity: 1, visitorNames: ['Ségou'] },
      ]);
      const res = await scan(gate1, estA1, tickets[0]!.qr).expect(200);
      expect(res.body).toMatchObject({
        result: 'REFUSED',
        refusalReason: 'OTHER_ESTABLISHMENT',
        ticket: null,
      });
      // L'agent ne peut pas se déclarer au contrôle d'un établissement qui ne lui est pas affecté.
      const spoof = await scan(gate1, estA2, tickets[0]!.qr);
      expect(spoof.status).toBe(404);
      expect(
        (await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0]!.id } })).status,
      ).toBe('VALID');
      const ok = await scan(gate2, estA2, tickets[0]!.qr).expect(200);
      expect(ok.body.result).toBe('ACCEPTED');
    });

    it('historique des scans : réservé à l’établissement, nom de l’agent inclus', async () => {
      const history = (
        await gate1.get('/api/v1/access/scans').query({ establishmentId: estA1 }).expect(200)
      ).body;
      expect(history.length).toBeGreaterThan(0);
      expect(history[0]).toHaveProperty('scannedBy');
      await gate1.get('/api/v1/access/scans').query({ establishmentId: estA2 }).expect(404);
      await parkC.agent.get('/api/v1/access/scans').query({ establishmentId: estA1 }).expect(404);
    });
  });

  describe('15. permissions et isolation', () => {
    it('agent d’entrée : scanne, ne vend pas ; caissier : vend, ne scanne pas, ne configure pas', async () => {
      const lines = [{ ticketCategoryId: adult, quantity: 1, visitorNames: ['X'] }];
      await gate1
        .post('/api/v1/ticketing/orders')
        .send({ establishmentId: estA1, lines })
        .expect(403);
      await gate1.get('/api/v1/ticketing/catalog').query({ establishmentId: estA1 }).expect(403);
      expect(
        (await gate1.get('/api/v1/access/establishments').expect(200)).body.map(
          (e: { id: string }) => e.id,
        ),
      ).toEqual([estA1]);

      await cashier
        .post('/api/v1/access/scans')
        .send({ establishmentId: estA1, entryPoint: 'X', qr: 'x' })
        .expect(403);
      await cashier
        .get('/api/v1/ticketing/categories')
        .query({ establishmentId: estA1 })
        .expect(403);
      await cashier
        .post('/api/v1/ticketing/categories')
        .send({ establishmentId: estA1, kind: 'ADULT', name: 'Pirate', price: 1 })
        .expect(403);
      await cashier
        .put('/api/v1/ticketing/schedule/weekly')
        .send({ establishmentId: estA1, days: [] })
        .expect(403);
      await cashier
        .get('/api/v1/ticketing/dashboard')
        .query({ establishmentId: estA1 })
        .expect(403);
      // Le caissier n'est affecté qu'à A1.
      const a2 = await cashier.get('/api/v1/ticketing/catalog').query({ establishmentId: estA2 });
      expect(a2.status).toBe(404);
    });

    it('une organisation restaurant n’a pas accès à la billetterie ; un parc n’utilise pas la vente restaurant', async () => {
      const res = await resto.agent.get('/api/v1/ticketing/establishments');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MODULE_NOT_IN_PLAN');
      await resto.agent
        .post('/api/v1/access/scans')
        .send({ establishmentId: estA1, entryPoint: 'X', qr: 'x' })
        .expect(403);
      const restaurantSale = await parkA.agent
        .post('/api/v1/sales')
        .send({ establishmentId: estA1, lines: [] });
      expect(restaurantSale.status).toBe(403);
    });

    it('isolation entre organisations : ventes, billets, catégories et horaires inaccessibles', async () => {
      const { sale, tickets } = await buy(cashier, estA1, [
        { ticketCategoryId: adult, quantity: 1, visitorNames: ['Privé'] },
      ]);
      await parkC.agent.get('/api/v1/tickets').query({ saleId: sale.id }).expect(404);
      await parkC.agent
        .post(`/api/v1/tickets/${tickets[0]!.id}/cancel`)
        .send({ reason: 'Intrusion' })
        .expect(404);
      await parkC.agent
        .patch(`/api/v1/ticketing/categories/${adult}`)
        .send({ price: 1 })
        .expect(404);
      await parkC.agent
        .get('/api/v1/ticketing/schedule')
        .query({ establishmentId: estA1 })
        .expect(404);
      await parkC.agent
        .get('/api/v1/ticketing/dashboard')
        .query({ establishmentId: estA1 })
        .expect(404);
      await order(parkC.agent, estA1, [
        { ticketCategoryId: adult, quantity: 1, visitorNames: ['X'] },
      ]).expect(404);
      await scan(parkC.agent, estA1, tickets[0]!.qr).expect(404);
    });

    it('un caissier ne voit que les billets de ses propres ventes', async () => {
      const { sale } = await buy(parkA.agent, estA1, [
        { ticketCategoryId: adult, quantity: 1, visitorNames: ['Patron'] },
      ]);
      await cashier.get('/api/v1/tickets').query({ saleId: sale.id }).expect(404);
    });
  });

  describe('16. horaires d’ouverture', () => {
    it('fermeture exceptionnelle : vente et entrée refusées, puis rétablies', async () => {
      const { tickets } = await buy(cashier, estA1, [
        { ticketCategoryId: adult, quantity: 1, visitorNames: ['Tôt'] },
      ]);
      const closed = await parkA.agent
        .post('/api/v1/ticketing/schedule/exceptions')
        .send({ establishmentId: estA1, date: today().date, isClosed: true, label: 'Maintenance' })
        .expect(201);
      expect(closed.body.openToday).toBe(false);
      const exceptionId = closed.body.exceptions.find(
        (e: { date: string }) => e.date === today().date,
      ).id;

      const sale = await order(cashier, estA1, [
        { ticketCategoryId: adult, quantity: 1, visitorNames: ['X'] },
      ]);
      expect(sale.status).toBe(409);
      expect(sale.body.code).toBe('PARK_CLOSED');
      const catalog = (
        await cashier.get('/api/v1/ticketing/catalog').query({ establishmentId: estA1 }).expect(200)
      ).body;
      expect(catalog.openToday).toBe(false);
      const entry = await scan(gate1, estA1, tickets[0]!.qr).expect(200);
      expect(entry.body).toMatchObject({ result: 'REFUSED', refusalReason: 'PARK_CLOSED' });
      expect(
        (await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0]!.id } })).status,
      ).toBe('VALID');

      await parkA.agent.delete(`/api/v1/ticketing/schedule/exceptions/${exceptionId}`).expect(200);
      expect((await scan(gate1, estA1, tickets[0]!.qr).expect(200)).body.result).toBe('ACCEPTED');
    });

    it('semaine type : jour fermé ou hors horaires refusé ; horaires incohérents refusés', async () => {
      const weekday = today().weekday;
      const bad = await parkA.agent.put('/api/v1/ticketing/schedule/weekly').send({
        establishmentId: estA1,
        days: [{ weekday, isClosed: false, opensAt: '18:00', closesAt: '09:00' }],
      });
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe('INVALID_HOURS');

      const { tickets } = await buy(cashier, estA1, [
        { ticketCategoryId: adult, quantity: 1, visitorNames: ['Semaine'] },
      ]);
      await parkA.agent
        .put('/api/v1/ticketing/schedule/weekly')
        .send({ establishmentId: estA1, days: [{ weekday, isClosed: true }] })
        .expect(200);
      expect(
        (
          await order(cashier, estA1, [
            { ticketCategoryId: adult, quantity: 1, visitorNames: ['X'] },
          ])
        ).body.code,
      ).toBe('PARK_CLOSED');
      expect((await scan(gate1, estA1, tickets[0]!.qr).expect(200)).body.refusalReason).toBe(
        'PARK_CLOSED',
      );

      // Ouvert aujourd'hui mais sur un créneau déjà passé ou pas encore commencé : la vente du jour reste
      // possible, l'entrée est refusée en dehors des horaires.
      const minutes = today().minutes;
      const slot =
        minutes >= 60
          ? { opensAt: '00:00', closesAt: '00:30' }
          : { opensAt: '23:00', closesAt: '23:30' };
      const hours = await parkA.agent
        .put('/api/v1/ticketing/schedule/weekly')
        .send({ establishmentId: estA1, days: [{ weekday, isClosed: false, ...slot }] })
        .expect(200);
      expect(hours.body.status).toMatchObject({ open: false, reason: 'OUTSIDE_HOURS' });
      await order(cashier, estA1, [
        { ticketCategoryId: adult, quantity: 1, visitorNames: ['X'] },
      ]).expect(201);
      expect((await scan(gate1, estA1, tickets[0]!.qr).expect(200)).body.refusalReason).toBe(
        'PARK_CLOSED',
      );

      await parkA.agent
        .put('/api/v1/ticketing/schedule/weekly')
        .send({ establishmentId: estA1, days: [] })
        .expect(200);
      expect((await scan(gate1, estA1, tickets[0]!.qr).expect(200)).body.result).toBe('ACCEPTED');
    });

    it('parc + restaurant : fermer le parc ne ferme pas le restaurant', async () => {
      const cat = (
        await duo.agent.post('/api/v1/catalog/categories').send({ name: 'Snack' }).expect(201)
      ).body.id;
      const product = (
        await duo.agent
          .post('/api/v1/catalog/products')
          .send({
            name: 'Brochette',
            categoryId: cat,
            variants: [{ name: 'Standard', prices: [{ establishmentId: estDuo, price: 1000 }] }],
          })
          .expect(201)
      ).body;
      const ticketCat = await category(duo, estDuo, { kind: 'ADULT', name: 'Adulte', price: 2000 });
      await duo.agent
        .post('/api/v1/cash-sessions')
        .send({ establishmentId: estDuo, openingFloat: 0 })
        .expect(201);
      await duo.agent
        .post('/api/v1/ticketing/schedule/exceptions')
        .send({ establishmentId: estDuo, date: today().date, isClosed: true, label: 'Parc fermé' })
        .expect(201);

      const ticketSale = await order(duo.agent, estDuo, [
        { ticketCategoryId: ticketCat, quantity: 1, visitorNames: ['X'] },
      ]);
      expect(ticketSale.body.code).toBe('PARK_CLOSED');
      const meal = (
        await duo.agent
          .post('/api/v1/sales')
          .send({
            establishmentId: estDuo,
            lines: [{ variantId: product.variants[0].id, quantity: 2 }],
          })
          .expect(201)
      ).body;
      expect(meal).toMatchObject({ activity: 'RESTAURANT', total: 2000 });
      await pay(duo.agent, meal.id, 2000).expect(200);
      expect(await prisma.ticket.count({ where: { saleId: meal.id } })).toBe(0);
    });
  });

  describe('17. impression des billets', () => {
    let terminal: string;
    let saleId: string;
    let tickets: IssuedTicket[];

    beforeAll(async () => {
      terminal = (
        await parkA.agent
          .post('/api/v1/pos-terminals')
          .send({
            establishmentId: estA1,
            name: 'Guichet 1',
            printerConnection: 'SIMULATED',
            paperWidth: 80,
            drawerEnabled: false,
          })
          .expect(201)
      ).body.id;
      ({
        sale: { id: saleId },
        tickets,
      } = await buy(parkA.agent, estA1, [
        { ticketCategoryId: family, quantity: 1, visitorNames: ['Papa', 'Maman', 'Bébé'] },
      ]));
    });

    const print = (body: Record<string, unknown>) =>
      parkA.agent
        .post('/api/v1/print-jobs')
        .send({ terminalId: terminal, clientRequestId: randomUUID(), ...body });

    it('imprime un billet par visiteur, avec QR (ESC/POS), en 80 mm', async () => {
      const res = await print({ kind: 'RECEIPT', saleId }).expect(201);
      const preview = (res.body.preview as string[]).join('\n');
      expect(preview.match(/BILLET D.ENTR/g)).toHaveLength(3);
      expect(preview).toMatch(/Papa/);
      expect(preview).toMatch(/Bébé|Bebe/);
      expect(preview).toMatch(/Billet 3\/3/);
      expect((res.body.preview as string[]).every((l) => l.length <= 48)).toBe(true);
      const bytes = Buffer.from(res.body.data, 'base64');
      // Commande QR « store data » (GS ( k … 1 P 0) contenant le jeton du premier billet.
      expect(bytes.includes(Buffer.from(tickets[0]!.qr, 'ascii'))).toBe(true);
      expect(bytes.includes(Buffer.from([0x1d, 0x28, 0x6b]))).toBe(true);
      await parkA.agent
        .post(`/api/v1/print-jobs/${res.body.job.id}/result`)
        .send({ status: 'SUCCEEDED' })
        .expect(200);
    });

    it('réimpression contrôlée d’un seul billet : motif obligatoire, mention DUPLICATA, historique', async () => {
      const noReason = await print({ kind: 'REPRINT', saleId, ticketId: tickets[1]!.id });
      expect(noReason.body.code).toBe('REASON_REQUIRED');
      const res = await print({
        kind: 'REPRINT',
        saleId,
        ticketId: tickets[1]!.id,
        reason: 'Billet froissé',
      }).expect(201);
      const preview = (res.body.preview as string[]).join('\n');
      expect(preview).toMatch(/DUPLICATA/);
      expect(preview.match(/BILLET D.ENTR/g)).toHaveLength(1);
      expect(preview).toMatch(/Maman/);
      expect(preview).not.toMatch(/Papa/);
      expect(res.body.job).toMatchObject({ kind: 'REPRINT', ticketId: tickets[1]!.id });

      const wrongKind = await print({ kind: 'RECEIPT', saleId, ticketId: tickets[1]!.id });
      expect(wrongKind.body.code).toBe('TICKET_REPRINT_ONLY');
      const other = (
        await buy(parkA.agent, estA1, [
          { ticketCategoryId: adult, quantity: 1, visitorNames: ['Z'] },
        ])
      ).tickets[0]!;
      const mismatch = await print({
        kind: 'REPRINT',
        saleId,
        ticketId: other.id,
        reason: 'Mauvais billet',
      });
      expect(mismatch.status).toBe(404);
      expect(mismatch.body.code).toBe('TICKET_NOT_FOUND');
      // Un caissier ne réimprime pas.
      const cashierReprint = await cashier.post('/api/v1/print-jobs').send({
        terminalId: terminal,
        kind: 'REPRINT',
        saleId,
        reason: 'Essai',
        clientRequestId: randomUUID(),
      });
      expect(cashierReprint.status).toBe(403);
      expect(await prisma.printJob.count({ where: { saleId } })).toBe(2);
    });

    it('un billet annulé n’est plus imprimé', async () => {
      await parkA.agent
        .post(`/api/v1/tickets/${tickets[2]!.id}/cancel`)
        .send({ reason: 'Bébé non venu' })
        .expect(200);
      const res = await print({ kind: 'REPRINT', saleId, reason: 'Recompte' }).expect(201);
      expect((res.body.preview as string[]).join('\n').match(/BILLET D.ENTR/g)).toHaveLength(2);
    });
  });

  describe('18. statistiques', () => {
    it('le tableau de bord du parc correspond exactement aux données enregistrées', async () => {
      const dash = (
        await parkA.agent
          .get('/api/v1/ticketing/dashboard')
          .query({ establishmentId: estA1 })
          .expect(200)
      ).body;
      const where = { establishmentId: estA1, createdAt: { gte: new Date(dash.today.date) } };
      const [sold, cancelled, unused, entries, refused, revenue] = await Promise.all([
        prisma.ticket.count({ where: { ...where, status: { not: 'CANCELLED' } } }),
        prisma.ticket.count({ where: { ...where, status: 'CANCELLED' } }),
        prisma.ticket.count({ where: { ...where, status: 'VALID' } }),
        prisma.ticketScan.count({ where: { ...where, result: 'ACCEPTED' } }),
        prisma.ticketScan.count({ where: { ...where, result: 'REFUSED' } }),
        prisma.sale.aggregate({
          where: { ...where, activity: 'PARK', status: 'OPEN', paymentStatus: 'PAID' },
          _sum: { total: true },
        }),
      ]);
      expect(dash.today).toMatchObject({
        ticketsSold: sold,
        cancelled,
        unused,
        entries,
        refused,
        revenue: revenue._sum.total,
      });
      expect(sold).toBeGreaterThan(10);
      expect(dash.yesterday).toMatchObject({ ticketsSold: 0, entries: 0, revenue: 0 });
      const byCategory = Object.fromEntries(
        dash.byCategory.map((c: { name: string; tickets: number }) => [c.name, c.tickets]),
      );
      expect(dash.byCategory.reduce((s: number, c: { tickets: number }) => s + c.tickets, 0)).toBe(
        sold,
      );
      expect(byCategory['Famille 3']).toBe(
        await prisma.ticket.count({
          where: { ...where, ticketCategoryId: family, status: { not: 'CANCELLED' } },
        }),
      );
      expect(dash.byHour.reduce((s: number, h: { sold: number }) => s + h.sold, 0)).toBe(sold);
      expect(dash.byHour.reduce((s: number, h: { entries: number }) => s + h.entries, 0)).toBe(
        entries,
      );

      // Tableau de bord principal : le chiffre d'affaires parc est distinct de celui du restaurant.
      const main = (await parkA.agent.get('/api/v1/dashboard').expect(200)).body;
      expect(main.revenue.RESTAURANT).toBeNull();
      const allPark = await prisma.sale.aggregate({
        where: {
          organizationId: parkA.organizationId,
          activity: 'PARK',
          status: 'OPEN',
          paymentStatus: 'PAID',
        },
        _sum: { total: true },
      });
      expect(main.revenue.PARK.today).toBe(allPark._sum.total);
    });
  });
});
