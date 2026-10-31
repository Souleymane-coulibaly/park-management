import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { addDays, localMoment } from '@ocall/shared';
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

/**
 * Sprint 13 — API ajoutées pour la PWA du parc : visiteurs, historique par journée, billets encore
 * valables, et reprise d'un scan dont la réponse a été perdue.
 * Exécuté uniquement sur la base de test (TEST_DATABASE_URL).
 */
describe('Sprint 13 — PWA du parc (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let parkA: SignedUpOwner;
  let parkB: SignedUpOwner;
  let estA: string;
  let estB: string;
  let category: string;
  let cashier: Agent;
  let gate: Agent;
  let qrs: string[];
  let saleNumber: string;

  async function employee(owner: SignedUpOwner, role: string, establishmentId: string) {
    const created = await owner.agent
      .post('/api/v1/employees')
      .send({ firstName: 'Fanta', lastName: role, role, establishmentIds: [establishmentId] })
      .expect(201);
    const session = await login(app, created.body.employee.loginId, created.body.temporaryPassword);
    await session.agent
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: created.body.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return session.agent;
  }

  const scan = (agent: Agent, qr: string, clientRequestId = randomUUID()) =>
    agent
      .post('/api/v1/access/scans')
      .send({ establishmentId: estA, entryPoint: 'Entrée', qr, clientRequestId });

  const today = () => localMoment(new Date(), 'Africa/Bamako').date;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    parkA = await signup(app, 's13a', 'PARK');
    parkB = await signup(app, 's13b', 'PARK');
    estA = (await parkA.agent.get('/api/v1/establishments').expect(200)).body[0].id;
    estB = (await parkB.agent.get('/api/v1/establishments').expect(200)).body[0].id;
    category = (
      await parkA.agent
        .post('/api/v1/ticketing/categories')
        .send({ establishmentId: estA, kind: 'ADULT', name: 'Adulte', price: 3000 })
        .expect(201)
    ).body.id;
    cashier = await employee(parkA, 'CASHIER', estA);
    gate = await employee(parkA, 'GATE_AGENT', estA);
    await cashier
      .post('/api/v1/cash-sessions')
      .send({ establishmentId: estA, openingFloat: 0 })
      .expect(201);
    const sale = (
      await cashier
        .post('/api/v1/ticketing/orders')
        .send({
          establishmentId: estA,
          lines: [
            { ticketCategoryId: category, quantity: 3, visitorNames: ['Awa', 'Seydou', 'Kadi'] },
          ],
        })
        .expect(201)
    ).body;
    saleNumber = String(sale.number);
    await cashier
      .post(`/api/v1/sales/${sale.id}/payments`)
      .send({ method: 'CASH', amountTendered: sale.total })
      .expect(200);
    const tickets = (await cashier.get('/api/v1/tickets').query({ saleId: sale.id }).expect(200))
      .body;
    qrs = tickets.map((t: { qr: string }) => t.qr);
  }, 240_000);

  afterAll(async () => {
    await cleanup(prisma);
    await app.close();
  });

  describe('reprise après une réponse perdue', () => {
    it('même clé : le premier résultat est renvoyé, sans second passage ni faux « déjà utilisé »', async () => {
      const key = randomUUID();
      const first = await scan(gate, qrs[0]!, key).expect(200);
      expect(first.body.result).toBe('ACCEPTED');
      const replay = await scan(gate, qrs[0]!, key).expect(200);
      expect(replay.body.id).toBe(first.body.id);
      expect(replay.body.result).toBe('ACCEPTED');
      expect(await prisma.ticketScan.count({ where: { clientRequestId: key } })).toBe(1);
    });

    it('nouvelle clé sur un billet déjà consommé : refus', async () => {
      const again = await scan(gate, qrs[0]!).expect(200);
      expect(again.body.result).toBe('REFUSED');
      expect(again.body.refusalReason).toBe('ALREADY_USED');
    });

    it('une clé utilisée par un autre agent est refusée', async () => {
      const key = randomUUID();
      await scan(gate, qrs[1]!, key).expect(200);
      const other = await employee(parkA, 'GATE_AGENT', estA);
      const res = await scan(other, qrs[1]!, key).expect(409);
      expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });
  });

  describe('visiteurs', () => {
    const search = (agent: Agent, query: Record<string, string> = {}) =>
      agent.get('/api/v1/tickets/search').query({ establishmentId: estA, ...query });

    it('liste la journée, sans jeton ni QR', async () => {
      const res = await search(parkA.agent).expect(200);
      expect(res.body.total).toBe(3);
      expect(res.body.items.map((t: { visitorName: string }) => t.visitorName).sort()).toEqual([
        'Awa',
        'Kadi',
        'Seydou',
      ]);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('OCP1-');
      expect(raw).not.toContain('token');
    });

    it('recherche par prénom, numéro de vente et statut', async () => {
      const byName = await search(parkA.agent, { q: 'kad' }).expect(200);
      expect(byName.body.items.map((t: { visitorName: string }) => t.visitorName)).toEqual([
        'Kadi',
      ]);
      expect((await search(parkA.agent, { q: saleNumber }).expect(200)).body.total).toBe(3);
      expect((await search(parkA.agent, { status: 'USED' }).expect(200)).body.total).toBe(2);
      expect((await search(parkA.agent, { status: 'VALID' }).expect(200)).body.total).toBe(1);
    });

    it('une autre journée est vide ; une date invalide est refusée', async () => {
      const other = await search(parkA.agent, { date: addDays(today(), -3) }).expect(200);
      expect(other.body.total).toBe(0);
      await search(parkA.agent, { date: '2026-13-45' }).expect(400);
    });

    it('réservé aux responsables : caissier et agent d’entrée refusés', async () => {
      await search(cashier).expect(403);
      await search(gate).expect(403);
    });

    it('un autre établissement client n’est jamais accessible', async () => {
      await search(parkB.agent).expect(404);
      const own = await parkB.agent
        .get('/api/v1/tickets/search')
        .query({ establishmentId: estB })
        .expect(200);
      expect(own.body.total).toBe(0);
    });
  });

  describe('historique par journée', () => {
    const scans = (agent: Agent, query: Record<string, string>) =>
      agent.get('/api/v1/access/scans').query({ establishmentId: estA, ...query });

    it('filtre la journée locale du parc', async () => {
      const day = await scans(gate, { date: today() }).expect(200);
      expect(day.body.length).toBeGreaterThanOrEqual(2);
      const empty = await scans(gate, { date: addDays(today(), -3) }).expect(200);
      expect(empty.body).toEqual([]);
    });

    it('caissier sans droit de contrôle refusé ; autre organisation refusée', async () => {
      await scans(cashier, { date: today() }).expect(403);
      await scans(parkB.agent, { date: today() }).expect(404);
    });
  });

  it('tableau de bord : compte aussi les billets vendus un autre jour et encore valables', async () => {
    const before = (
      await parkA.agent
        .get('/api/v1/ticketing/dashboard')
        .query({ establishmentId: estA })
        .expect(200)
    ).body;
    expect(before.validUnused).toBe(1);
    const ticket = await prisma.ticket.findFirstOrThrow({
      where: { establishmentId: estA, status: 'VALID' },
    });
    // Vendu il y a deux jours, valable encore demain.
    const soldAt = new Date(Date.now() - 2 * 86_400_000);
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { createdAt: soldAt, validUntil: new Date(Date.now() + 86_400_000) },
    });
    const after = (
      await parkA.agent
        .get('/api/v1/ticketing/dashboard')
        .query({ establishmentId: estA })
        .expect(200)
    ).body;
    expect(after.today.unused).toBe(0);
    expect(after.validUnused).toBe(1);
  });
});
