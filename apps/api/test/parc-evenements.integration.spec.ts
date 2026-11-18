import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addDays, localMoment } from '@ocall/shared';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  type Agent,
  PASSWORD,
  type SignedUpOwner,
  cleanup,
  createTestApp,
  grantShowcasePlan,
  login,
  signup,
} from './helpers';

const TZ = 'Africa/Bamako';
const api = (path: string) => `/api/v1${path}`;
const hhmm = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

interface IssuedTicket {
  id: string;
  visitorName: string;
  status: string;
  pricePaid: number;
  validFrom: string;
  validUntil: string;
  qr: string;
  event: { name: string; session: string } | null;
}

/**
 * Événements du parc (lots E1 à E4) : événements, séances, tarifs, vente au guichet, capacité
 * atomique, quotas par tarif, prénom facultatif, contrôle QR selon la séance, annulation avec liste
 * des acheteurs, suivi, agenda public, et non-régression de la billetterie classique.
 * Exécuté uniquement sur la base de test (TEST_DATABASE_URL).
 */
describe('Événements du parc (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let park: SignedUpOwner;
  let other: SignedUpOwner;
  let est: string;
  let estOther: string;
  let cashier: Agent;
  let gate: Agent;
  let eventId: string;
  let nowSession: string; // séance en cours (capacité 3)
  let laterSession: string; // séance dans deux jours (capacité 50)
  let standard: string; // 5 000 FCFA, non nominatif
  let vip: string; // 15 000 FCFA, nominatif, quota 1 par séance
  let classicAdult: string; // billet classique « Adulte » 3 000 FCFA

  async function employee(owner: SignedUpOwner, role: string, ids: string[]): Promise<Agent> {
    const created = await owner.agent
      .post(api('/employees'))
      .send({ firstName: 'Awa', lastName: role, role, establishmentIds: ids })
      .expect(201);
    const session = await login(app, created.body.employee.loginId, created.body.temporaryPassword);
    await session.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: created.body.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return session.agent;
  }

  type Line = {
    ticketCategoryId: string;
    quantity: number;
    visitorNames: string[];
    eventSessionId?: string;
  };
  const order = (a: Agent, lines: Line[], establishmentId = est) =>
    a.post(api('/ticketing/orders')).send({ establishmentId, lines });
  const pay = (a: Agent, saleId: string, amount: number) =>
    a.post(api(`/sales/${saleId}/payments`)).send({ method: 'CASH', amountTendered: amount });
  const ticketsOf = async (a: Agent, saleId: string): Promise<IssuedTicket[]> =>
    (await a.get(api('/tickets')).query({ saleId }).expect(200)).body;
  const scan = (a: Agent, qr: string) =>
    a.post(api('/access/scans')).send({ establishmentId: est, entryPoint: 'Scène', qr });
  async function buy(a: Agent, lines: Line[]) {
    const sale = (await order(a, lines).expect(201)).body;
    await pay(a, sale.id, sale.total).expect(200);
    return { sale, tickets: await ticketsOf(a, sale.id) };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    park = await signup(app, 'eva', 'PARK');
    other = await signup(app, 'evo', 'PARK');
    est = (await park.agent.get(api('/establishments')).expect(200)).body[0].id;
    estOther = (await other.agent.get(api('/establishments')).expect(200)).body[0].id;
    cashier = await employee(park, 'CASHIER', [est]);
    gate = await employee(park, 'GATE_AGENT', [est]);
    for (const a of [cashier, park.agent]) {
      await a
        .post(api('/cash-sessions'))
        .send({ establishmentId: est, openingFloat: 0 })
        .expect(201);
    }
    await other.agent
      .post(api('/cash-sessions'))
      .send({ establishmentId: estOther, openingFloat: 0 })
      .expect(201);
    classicAdult = (
      await park.agent
        .post(api('/ticketing/categories'))
        .send({ establishmentId: est, kind: 'ADULT', name: 'Adulte', price: 3000 })
        .expect(201)
    ).body.id;
  }, 300_000);

  afterAll(async () => {
    try {
      if (prisma) await cleanup(prisma);
    } finally {
      await app?.close();
    }
  });

  describe('E1 — événements, séances et tarifs', () => {
    it('crée un événement en brouillon ; publication refusée sans séance ni tarif', async () => {
      const created = await park.agent
        .post(api('/ticketing/events'))
        .send({
          establishmentId: est,
          name: 'Concert de Noël',
          description: 'Concert en plein air',
          entryOpensBeforeMinutes: 60,
          entryClosesAfterMinutes: 15,
        })
        .expect(201);
      eventId = created.body.id;
      expect(created.body).toMatchObject({ status: 'DRAFT', sessions: [], tariffs: [] });
      const notReady = await park.agent
        .patch(api(`/ticketing/events/${eventId}`))
        .send({ status: 'PUBLISHED' })
        .expect(400);
      expect(notReady.body.code).toBe('PARK_EVENT_NOT_READY');
      const dup = await park.agent
        .post(api('/ticketing/events'))
        .send({ establishmentId: est, name: 'Concert de Noël' })
        .expect(409);
      expect(dup.body.code).toBe('PARK_EVENT_NAME_TAKEN');
    });

    it('séances : en cours, à venir ; séance passée et doublon refusés', async () => {
      const now = localMoment(new Date(), TZ);
      const start = Math.max(0, now.minutes - 30);
      const res = await park.agent
        .post(api(`/ticketing/events/${eventId}/sessions`))
        .send({
          date: now.date,
          startTime: hhmm(start),
          endTime: hhmm(now.minutes + 120),
          capacity: 3,
        })
        .expect(201);
      nowSession = res.body.sessions[0].id;
      const later = await park.agent
        .post(api(`/ticketing/events/${eventId}/sessions`))
        .send({ date: addDays(now.date, 2), startTime: '20:00', endTime: '23:30', capacity: 50 })
        .expect(201);
      laterSession = later.body.sessions.find((s: { id: string }) => s.id !== nowSession).id;
      const past = await park.agent
        .post(api(`/ticketing/events/${eventId}/sessions`))
        .send({ date: addDays(now.date, -2), startTime: '20:00', endTime: '22:00', capacity: 10 })
        .expect(400);
      expect(past.body.code).toBe('EVENT_SESSION_IN_PAST');
      const dup = await park.agent
        .post(api(`/ticketing/events/${eventId}/sessions`))
        .send({ date: addDays(now.date, 2), startTime: '20:00', endTime: '22:00', capacity: 10 })
        .expect(409);
      expect(dup.body.code).toBe('EVENT_SESSION_DUPLICATE');
    });

    it('tarifs d’événement : quota facultatif, prénom facultatif ; nom « Adulte » libre par portée', async () => {
      const a = await park.agent
        .post(api(`/ticketing/events/${eventId}/tariffs`))
        .send({ kind: 'CUSTOM', name: 'Standard', price: 5000 })
        .expect(201);
      standard = a.body.tariffs[0].id;
      expect(a.body.tariffs[0]).toMatchObject({ requiresVisitorName: false, sessionQuota: null });
      const b = await park.agent
        .post(api(`/ticketing/events/${eventId}/tariffs`))
        .send({
          kind: 'CUSTOM',
          name: 'VIP',
          price: 15000,
          sessionQuota: 1,
          requiresVisitorName: true,
        })
        .expect(201);
      vip = b.body.tariffs.find((t: { name: string }) => t.name === 'VIP').id;
      // Même nom qu'un tarif classique : autorisé (portée de l'événement).
      await park.agent
        .post(api(`/ticketing/events/${eventId}/tariffs`))
        .send({ kind: 'ADULT', name: 'Adulte', price: 4000 })
        .expect(201);
      const dup = await park.agent
        .post(api(`/ticketing/events/${eventId}/tariffs`))
        .send({ kind: 'ADULT', name: 'Adulte', price: 4500 })
        .expect(409);
      expect(dup.body.code).toBe('TICKET_CATEGORY_NAME_TAKEN');
    });

    it('non-régression : la billetterie classique ne voit pas les tarifs d’événement', async () => {
      const list = (
        await park.agent
          .get(api('/ticketing/categories'))
          .query({ establishmentId: est })
          .expect(200)
      ).body as { id: string }[];
      expect(list.map((c) => c.id)).toEqual([classicAdult]);
      const catalog = (
        await cashier.get(api('/ticketing/catalog')).query({ establishmentId: est }).expect(200)
      ).body;
      expect(catalog.categories.map((c: { id: string }) => c.id)).toEqual([classicAdult]);
      // Un tarif d'événement ne se modifie pas par la route classique.
      await park.agent
        .patch(api(`/ticketing/categories/${standard}`))
        .send({ price: 1 })
        .expect(404);
    });

    it('un événement en brouillon n’est pas en vente ; publication possible ensuite', async () => {
      const draft = await order(cashier, [
        { ticketCategoryId: standard, quantity: 1, visitorNames: [], eventSessionId: nowSession },
      ]).expect(409);
      expect(draft.body.code).toBe('EVENT_SESSION_NOT_ON_SALE');
      await park.agent
        .patch(api(`/ticketing/events/${eventId}`))
        .send({ status: 'PUBLISHED' })
        .expect(200);
      const catalog = (
        await cashier
          .get(api('/ticketing/event-catalog'))
          .query({ establishmentId: est })
          .expect(200)
      ).body;
      expect(catalog).toHaveLength(1);
      expect(catalog[0].sessions.map((s: { placesLeft: number }) => s.placesLeft)).toEqual([3, 50]);
    });

    it('droits : caissier et agent ne gèrent pas ; autre organisation isolée', async () => {
      await cashier
        .post(api('/ticketing/events'))
        .send({ establishmentId: est, name: 'Pirate' })
        .expect(403);
      await gate.get(api('/ticketing/events')).query({ establishmentId: est }).expect(403);
      await other.agent.get(api(`/ticketing/events/${eventId}`)).expect(404);
      const cross = await order(
        other.agent,
        [{ ticketCategoryId: standard, quantity: 1, visitorNames: [], eventSessionId: nowSession }],
        estOther,
      ).expect(400);
      expect(cross.body.code).toBe('EVENT_TARIFF_UNAVAILABLE');
    });
  });

  describe('E2 — vente au guichet', () => {
    it('billet non nominatif : aucun prénom ; billet daté de la séance, avec l’événement', async () => {
      const { sale, tickets } = await buy(cashier, [
        { ticketCategoryId: standard, quantity: 1, visitorNames: [], eventSessionId: laterSession },
      ]);
      expect(sale.total).toBe(5000);
      expect(sale.lines[0].productName).toBe('Concert de Noël — Standard');
      expect(tickets).toHaveLength(1);
      expect(tickets[0]).toMatchObject({ visitorName: '', status: 'VALID', pricePaid: 5000 });
      expect(tickets[0]!.event?.name).toBe('Concert de Noël');
      const session = await prisma.parkEventSession.findUniqueOrThrow({
        where: { id: laterSession },
      });
      expect(new Date(tickets[0]!.validFrom).getTime()).toBe(
        session.startsAt.getTime() - 60 * 60_000,
      );
      expect(new Date(tickets[0]!.validUntil).getTime()).toBe(
        session.endsAt.getTime() + 15 * 60_000,
      );
    });

    it('billet nominatif : prénom obligatoire ; quota du tarif par séance', async () => {
      const missing = await order(cashier, [
        { ticketCategoryId: vip, quantity: 1, visitorNames: [''], eventSessionId: laterSession },
      ]).expect(400);
      expect(missing.body.code).toBe('VISITOR_NAMES_MISMATCH');
      const tooMany = await order(cashier, [
        {
          ticketCategoryId: vip,
          quantity: 2,
          visitorNames: ['A', 'B'],
          eventSessionId: laterSession,
        },
      ]).expect(409);
      expect(tooMany.body.code).toBe('EVENT_TARIFF_SOLD_OUT');
      const { tickets } = await buy(cashier, [
        {
          ticketCategoryId: vip,
          quantity: 1,
          visitorNames: ['Moussa'],
          eventSessionId: laterSession,
        },
      ]);
      expect(tickets[0]!.visitorName).toBe('Moussa');
      const again = await order(cashier, [
        {
          ticketCategoryId: vip,
          quantity: 1,
          visitorNames: ['Kadi'],
          eventSessionId: laterSession,
        },
      ]).expect(409);
      expect(again.body.code).toBe('EVENT_TARIFF_SOLD_OUT');
    });

    it('acheteur facultatif : fiche client de l’organisation rattachée à la vente', async () => {
      const customer = (
        await park.agent
          .post(api('/customers'))
          .send({ consent: true, firstName: 'Fanta', lastName: 'Traoré', phone: '+22370000001' })
          .expect(201)
      ).body;
      const foreign = (
        await other.agent
          .post(api('/customers'))
          .send({ consent: true, firstName: 'Autre', phone: '+22370000002' })
          .expect(201)
      ).body;
      const line = {
        ticketCategoryId: standard,
        quantity: 1,
        visitorNames: [],
        eventSessionId: laterSession,
      };
      const refused = await cashier
        .post(api('/ticketing/orders'))
        .send({ establishmentId: est, customerId: foreign.id, lines: [line] })
        .expect(400);
      expect(refused.body.code).toBe('CUSTOMER_NOT_FOUND');
      const sale = (
        await cashier
          .post(api('/ticketing/orders'))
          .send({ establishmentId: est, customerId: customer.id, lines: [line] })
          .expect(201)
      ).body;
      await pay(cashier, sale.id, sale.total).expect(200);
      const stored = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
      expect(stored.customerId).toBe(customer.id);
    });

    it('tarif d’événement sans séance, ou séance d’un autre événement : refus explicite', async () => {
      const noSession = await order(cashier, [
        { ticketCategoryId: standard, quantity: 1, visitorNames: [] },
      ]).expect(400);
      expect(noSession.body.code).toBe('EVENT_SESSION_REQUIRED');
      const classicWithSession = await order(cashier, [
        {
          ticketCategoryId: classicAdult,
          quantity: 1,
          visitorNames: ['Awa'],
          eventSessionId: laterSession,
        },
      ]).expect(400);
      expect(classicWithSession.body.code).toBe('EVENT_TARIFF_UNAVAILABLE');
    });

    it('encaissement et réservation atomiques : deux caisses, une seule obtient les dernières places', async () => {
      // Séance de 3 places : 2 + 2 commandées en même temps, toutes deux acceptées à la commande.
      const lines = [
        { ticketCategoryId: standard, quantity: 2, visitorNames: [], eventSessionId: nowSession },
      ];
      const s1 = (await order(cashier, lines).expect(201)).body;
      const s2 = (await order(park.agent, lines).expect(201)).body;
      const [r1, r2] = await Promise.all([
        pay(cashier, s1.id, s1.total),
        pay(park.agent, s2.id, s2.total),
      ]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([200, 409]);
      const refused = r1.status === 409 ? r1 : r2;
      expect(refused.body.code).toBe('EVENT_SOLD_OUT');
      const refusedSale = r1.status === 409 ? s1 : s2;
      // Rien n'est encaissé ni émis pour la vente refusée.
      expect(await prisma.payment.count({ where: { saleId: refusedSale.id } })).toBe(0);
      expect(await prisma.ticket.count({ where: { saleId: refusedSale.id } })).toBe(0);
      expect(
        await prisma.ticket.count({
          where: { eventSessionId: nowSession, status: { not: 'CANCELLED' } },
        }),
      ).toBe(2);
      const last = await order(cashier, [
        { ticketCategoryId: standard, quantity: 2, visitorNames: [], eventSessionId: nowSession },
      ]).expect(409);
      expect(last.body).toMatchObject({ code: 'EVENT_SOLD_OUT', details: { placesLeft: 1 } });
      // La vente refusée reste non payée et peut être annulée par le moteur de caisse.
      await park.agent
        .post(api(`/sales/${refusedSale.id}/cancel`))
        .send({ reason: 'Séance complète' })
        .expect(200);
    });

    it('capacité : jamais sous les places vendues', async () => {
      const res = await park.agent
        .patch(api(`/ticketing/events/${eventId}/sessions/${nowSession}`))
        .send({ capacity: 1 })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'EVENT_CAPACITY_BELOW_SOLD', details: { sold: 2 } });
    });

    it('verrou de séance : l’encaissement attend une opération concurrente et voit son résultat', async () => {
      const date = addDays(localMoment(new Date(), TZ).date, 3);
      const created = await park.agent
        .post(api(`/ticketing/events/${eventId}/sessions`))
        .send({ date, startTime: '18:00', endTime: '20:00', capacity: 5 })
        .expect(201);
      const sessionId = created.body.sessions.find((s: { date: string }) => s.date === date).id;
      const sale = (
        await order(cashier, [
          { ticketCategoryId: standard, quantity: 1, visitorNames: [], eventSessionId: sessionId },
        ]).expect(201)
      ).body;
      let settled = false;
      let pending: Promise<request.Response> | undefined;
      // Transaction concurrente : séance verrouillée, encaissement lancé, puis séance annulée.
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "ParkEventSession" WHERE id = ${sessionId}::uuid FOR UPDATE`;
          pending = pay(cashier, sale.id, sale.total).then((r) => {
            settled = true;
            return r;
          });
          await new Promise((resolve) => setTimeout(resolve, 1500));
          expect(settled).toBe(false); // l'encaissement attend le verrou
          await tx.parkEventSession.update({
            where: { id: sessionId },
            data: { status: 'CANCELLED', salesOpen: false, cancelReason: 'Test de verrou' },
          });
        },
        { timeout: 20_000 },
      );
      const res = await pending!;
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('EVENT_SESSION_CANCELLED');
      expect(await prisma.payment.count({ where: { saleId: sale.id } })).toBe(0);
    });
  });

  describe('E3 — contrôle QR et annulation', () => {
    it('entrée selon la séance, même parc fermé ; une seule entrée ; séance future refusée', async () => {
      // Parc fermé toute la semaine : la billetterie classique est suspendue, pas l'événement.
      await park.agent
        .put(api('/ticketing/schedule/weekly'))
        .send({
          establishmentId: est,
          days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, isClosed: true })),
        })
        .expect(200);
      const closed = await order(cashier, [
        { ticketCategoryId: classicAdult, quantity: 1, visitorNames: ['Awa'] },
      ]).expect(409);
      expect(closed.body.code).toBe('PARK_CLOSED');
      const { tickets } = await buy(cashier, [
        { ticketCategoryId: standard, quantity: 1, visitorNames: [], eventSessionId: nowSession },
      ]);
      const first = (await scan(gate, tickets[0]!.qr).expect(200)).body;
      expect(first).toMatchObject({ result: 'ACCEPTED' });
      expect(first.ticket.event.name).toBe('Concert de Noël');
      const second = (await scan(gate, tickets[0]!.qr).expect(200)).body;
      expect(second).toMatchObject({ result: 'REFUSED', refusalReason: 'ALREADY_USED' });

      const later = await prisma.ticket.findFirstOrThrow({
        where: { eventSessionId: laterSession, status: 'VALID' },
        select: { token: true },
      });
      const early = (await scan(gate, `OCP1-${later.token}`).expect(200)).body;
      expect(early).toMatchObject({ result: 'REFUSED', refusalReason: 'NOT_YET_VALID' });
      await park.agent
        .put(api('/ticketing/schedule/weekly'))
        .send({ establishmentId: est, days: [] })
        .expect(200);
    });

    it('nouvel horaire ou nouvelle tolérance : validité des billets recalculée', async () => {
      const date = addDays(localMoment(new Date(), TZ).date, 2);
      await park.agent
        .patch(api(`/ticketing/events/${eventId}/sessions/${laterSession}`))
        .send({ startTime: '19:00' })
        .expect(200);
      await park.agent
        .patch(api(`/ticketing/events/${eventId}`))
        .send({ entryOpensBeforeMinutes: 30 })
        .expect(200);
      const t = await prisma.ticket.findFirstOrThrow({
        where: { eventSessionId: laterSession, status: 'VALID' },
      });
      // 19:00 locales (UTC à Bamako) moins 30 minutes.
      expect(t.validFrom.toISOString()).toBe(`${date}T18:30:00.000Z`);
    });

    it('annulation de séance : billets annulés, liste des acheteurs, encaissement refusé ensuite', async () => {
      const pending = (
        await order(park.agent, [
          {
            ticketCategoryId: standard,
            quantity: 1,
            visitorNames: [],
            eventSessionId: laterSession,
          },
        ]).expect(201)
      ).body;
      await cashier
        .post(api(`/ticketing/events/${eventId}/sessions/${laterSession}/cancel`))
        .send({ reason: 'Intempéries' })
        .expect(403);
      const res = await park.agent
        .post(api(`/ticketing/events/${eventId}/sessions/${laterSession}/cancel`))
        .send({ reason: 'Intempéries' })
        .expect(200);
      expect(res.body.session.status).toBe('CANCELLED');
      expect(res.body.totals).toMatchObject({ sales: 3, tickets: 3, amount: 25000, cancelled: 3 });
      expect(res.body.sales.map((s: { visitorNames: string[] }) => s.visitorNames)).toEqual([
        [],
        ['Moussa'],
        [],
      ]);
      // Contact de l'acheteur pour le remboursement.
      expect(res.body.sales[2].customer).toEqual({ name: 'Fanta Traoré', phone: '+22370000001' });
      expect(
        await prisma.ticket.count({ where: { eventSessionId: laterSession, status: 'VALID' } }),
      ).toBe(0);
      const t = await prisma.ticket.findFirstOrThrow({
        where: { eventSessionId: laterSession },
        select: { token: true, cancelReason: true },
      });
      expect(t.cancelReason).toBe('Séance annulée : Intempéries');
      const refused = (await scan(gate, `OCP1-${t.token}`).expect(200)).body;
      expect(refused).toMatchObject({ result: 'REFUSED', refusalReason: 'CANCELLED' });
      const late = await pay(park.agent, pending.id, pending.total).expect(409);
      expect(late.body.code).toBe('EVENT_SESSION_CANCELLED');
      expect(await prisma.payment.count({ where: { saleId: pending.id } })).toBe(0);
      await park.agent
        .post(api(`/ticketing/events/${eventId}/sessions/${laterSession}/cancel`))
        .send({ reason: 'Encore' })
        .expect(409);
      const buyers = await park.agent
        .get(api(`/ticketing/events/${eventId}/sessions/${laterSession}/buyers`))
        .expect(200);
      expect(buyers.body.totals.sales).toBe(3);
    });
  });

  describe('E4 — suivi et agenda public', () => {
    it('tableau de bord : places, entrées, annulations, chiffre d’affaires par séance', async () => {
      const d = (await park.agent.get(api(`/ticketing/events/${eventId}/dashboard`)).expect(200))
        .body;
      const now = d.sessions.find((s: { id: string }) => s.id === nowSession);
      expect(now).toMatchObject({
        capacity: 3,
        sold: 3,
        placesLeft: 0,
        entered: 1,
        expected: 2,
        cancelled: 0,
        revenue: 15000,
        fillRate: 100,
      });
      const cancelled = d.sessions.find((s: { id: string }) => s.id === laterSession);
      expect(cancelled).toMatchObject({ status: 'CANCELLED', sold: 0, cancelled: 3, revenue: 0 });
      expect(d.totals).toMatchObject({ sessions: 1, sold: 3, entered: 1, revenue: 15000 });
      await cashier.get(api(`/ticketing/events/${eventId}/dashboard`)).expect(403);
    });

    it('tableau de bord du jour : les billets d’événement n’entrent pas dans « non utilisés »', async () => {
      const d = (
        await park.agent
          .get(api('/ticketing/dashboard'))
          .query({ establishmentId: est })
          .expect(200)
      ).body;
      expect(d.validUnused).toBe(0);
    });

    it('agenda public du site : événements publiés uniquement, prix indicatifs, complet signalé', async () => {
      await grantShowcasePlan(prisma, park.organizationId);
      await park.agent
        .post(api('/ticketing/events'))
        .send({ establishmentId: est, name: 'Brouillon caché' })
        .expect(201);
      const slug = `evt-${Date.now().toString(36)}`;
      const site = (
        await park.agent.post(api('/sites')).send({ establishmentId: est, slug }).expect(201)
      ).body;
      await park.agent.post(api(`/sites/${site.id}/publish`)).expect(201);
      const pub = (
        await request(app.getHttpServer())
          .get(api(`/public/sites/${slug}`))
          .expect(200)
      ).body;
      expect(pub.events).toHaveLength(1);
      expect(pub.events[0]).toMatchObject({ name: 'Concert de Noël' });
      expect(pub.events[0].sessions).toEqual([
        expect.objectContaining({ soldOut: true }), // séance en cours complète ; l'annulée absente
      ]);
      expect(pub.events[0].tariffs.map((t: { name: string }) => t.name)).toEqual(
        expect.arrayContaining(['Standard', 'VIP']),
      );
      expect(JSON.stringify(pub.events)).not.toMatch(/capacity|sold"|id"/);
    });
  });
});
