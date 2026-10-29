import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { containsDrawerKick, fromBase64 } from '@ocall/shared';
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
 * Sprint 3 — postes de caisse, impression thermique et tiroir-caisse (côté serveur).
 * Le matériel n'intervient pas ici : on vérifie les autorisations, l'idempotence, l'historique
 * et les règles métier des commandes que l'appareil enverra au matériel.
 */
describe('Sprint 3 — impression et tiroir-caisse (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let restoA: SignedUpOwner;
  let restoC: SignedUpOwner;
  let parkB: SignedUpOwner;
  let estA: string;
  let estC: string;
  let variant: string;
  let terminalA: string;
  let cashier: Agent;

  async function employee(
    owner: SignedUpOwner,
    role: string,
    establishmentIds: string[],
  ): Promise<Agent> {
    const created = await owner.agent
      .post('/api/v1/employees')
      .send({ firstName: 'Awa', lastName: role, role, establishmentIds })
      .expect(201);
    const session = await login(app, created.body.employee.loginId, created.body.temporaryPassword);
    await session.agent
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: created.body.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return session.agent;
  }

  /** Vente encaissée en espèces par l'agent (session de caisse ouverte au préalable). */
  async function paidSale(agent: Agent, amountTendered = 2000) {
    const sale = (
      await agent
        .post('/api/v1/sales')
        .send({ establishmentId: estA, lines: [{ variantId: variant, quantity: 1 }] })
        .expect(201)
    ).body;
    const paid = (
      await agent
        .post(`/api/v1/sales/${sale.id}/payments`)
        .send({ method: 'CASH', amountTendered })
        .expect(200)
    ).body;
    return { saleId: sale.id as string, paymentId: paid.payment.id as string };
  }

  const print = (agent: Agent, body: Record<string, unknown>) =>
    agent.post('/api/v1/print-jobs').send({ clientRequestId: randomUUID(), ...body });
  const drawer = (agent: Agent, body: Record<string, unknown>) =>
    agent.post('/api/v1/drawer-events').send({ clientRequestId: randomUUID(), ...body });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    restoA = await signup(app, 'hwa', 'RESTAURANT');
    restoC = await signup(app, 'hwc', 'RESTAURANT');
    parkB = await signup(app, 'hwb', 'PARK');
    estA = (await restoA.agent.get('/api/v1/establishments').expect(200)).body[0].id;
    estC = (await restoC.agent.get('/api/v1/establishments').expect(200)).body[0].id;
    const category = (
      await restoA.agent.post('/api/v1/catalog/categories').send({ name: 'Boissons' }).expect(201)
    ).body.id;
    const product = (
      await restoA.agent
        .post('/api/v1/catalog/products')
        .send({
          name: 'Gingembre',
          categoryId: category,
          variants: [{ name: 'Standard', prices: [{ establishmentId: estA, price: 1000 }] }],
        })
        .expect(201)
    ).body;
    variant = product.variants[0].id;
    await restoA.agent
      .post('/api/v1/cash-sessions')
      .send({ establishmentId: estA, openingFloat: 5000 })
      .expect(201);
    cashier = await employee(restoA, 'CASHIER', [estA]);
    await cashier
      .post('/api/v1/cash-sessions')
      .send({ establishmentId: estA, openingFloat: 0 })
      .expect(201);
  });

  afterAll(async () => {
    await cleanup(prisma);
    await app.close();
  });

  describe('postes de caisse', () => {
    it('crée un poste avec imprimante simulée et tiroir', async () => {
      const res = await restoA.agent
        .post('/api/v1/pos-terminals')
        .send({
          establishmentId: estA,
          name: 'Caisse 1',
          printerConnection: 'SIMULATED',
          paperWidth: 58,
          drawerEnabled: true,
        })
        .expect(201);
      terminalA = res.body.id;
      expect(res.body).toMatchObject({
        printerConnection: 'SIMULATED',
        printerAddress: null,
        paperWidth: 58,
        drawerEnabled: true,
        drawerPin: 2,
      });
    });

    it('refuse une imprimante réseau hors du réseau local et un tiroir sans imprimante', async () => {
      const ip = await restoA.agent.post('/api/v1/pos-terminals').send({
        establishmentId: estA,
        name: 'Pirate',
        printerConnection: 'NETWORK',
        printerAddress: '8.8.8.8:9100',
      });
      expect(ip.status).toBe(400);
      expect(ip.body.code).toBe('INVALID_PRINTER_ADDRESS');
      const port = await restoA.agent.post('/api/v1/pos-terminals').send({
        establishmentId: estA,
        name: 'SSH',
        printerConnection: 'NETWORK',
        printerAddress: '192.168.1.10:22',
      });
      expect(port.body.code).toBe('INVALID_PRINTER_ADDRESS');
      const noPrinter = await restoA.agent
        .post('/api/v1/pos-terminals')
        .send({ establishmentId: estA, name: 'Sans imprimante', drawerEnabled: true });
      expect(noPrinter.status).toBe(409);
      expect(noPrinter.body.code).toBe('DRAWER_REQUIRES_PRINTER');
      const ok = await restoA.agent
        .post('/api/v1/pos-terminals')
        .send({
          establishmentId: estA,
          name: 'Caisse réseau',
          printerConnection: 'NETWORK',
          printerAddress: '192.168.1.50:9100',
          paperWidth: 80,
        })
        .expect(201);
      expect(ok.body.printerAddress).toBe('192.168.1.50:9100');
    });

    it('un caissier voit les postes mais ne les configure pas ; un parc n’y a pas accès', async () => {
      const list = (await cashier.get(`/api/v1/pos-terminals?establishmentId=${estA}`).expect(200))
        .body;
      expect(list.map((t: { id: string }) => t.id)).toContain(terminalA);
      await cashier
        .post('/api/v1/pos-terminals')
        .send({ establishmentId: estA, name: 'X' })
        .expect(403);
      await cashier
        .patch(`/api/v1/pos-terminals/${terminalA}`)
        .send({ drawerEnabled: false })
        .expect(403);
      const park = await parkB.agent.get('/api/v1/pos-terminals');
      expect(park.status).toBe(403);
      expect(park.body.code).toBe('MODULE_NOT_IN_PLAN');
    });

    it('isolation : une autre organisation ne voit ni ne modifie le poste', async () => {
      expect((await restoC.agent.get('/api/v1/pos-terminals').expect(200)).body).toEqual([]);
      await restoC.agent
        .patch(`/api/v1/pos-terminals/${terminalA}`)
        .send({ name: 'Volé' })
        .expect(404);
      await restoC.agent
        .post('/api/v1/pos-terminals')
        .send({ establishmentId: estA, name: 'Intrus' })
        .expect(404);
    });
  });

  describe('impression des tickets', () => {
    let saleId: string;

    it('refuse d’imprimer une vente non payée', async () => {
      const sale = (
        await cashier
          .post('/api/v1/sales')
          .send({ establishmentId: estA, lines: [{ variantId: variant, quantity: 1 }] })
          .expect(201)
      ).body;
      const res = await print(cashier, { terminalId: terminalA, kind: 'RECEIPT', saleId: sale.id });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SALE_NOT_PAID');
    });

    it('imprime après paiement : flux ESC/POS sans commande de tiroir, aperçu conforme, requête rejouable', async () => {
      ({ saleId } = await paidSale(cashier));
      const key = randomUUID();
      const res = await cashier
        .post('/api/v1/print-jobs')
        .send({ terminalId: terminalA, kind: 'RECEIPT', saleId, clientRequestId: key })
        .expect(201);
      expect(res.body.job).toMatchObject({ kind: 'RECEIPT', status: 'PENDING', paperWidth: 58 });
      expect(res.body.printer).toEqual({ connection: 'SIMULATED', address: null });
      expect(containsDrawerKick(fromBase64(res.body.data))).toBe(false);
      expect(res.body.preview.join('\n')).toMatch(/TOTAL\s+1\s000 FCFA/);
      expect(res.body.preview.every((l: string) => l.length <= 32)).toBe(true);

      const replay = await cashier
        .post('/api/v1/print-jobs')
        .send({ terminalId: terminalA, kind: 'RECEIPT', saleId, clientRequestId: key })
        .expect(201);
      expect(replay.body.job.id).toBe(res.body.job.id);
      expect(await prisma.printJob.count({ where: { saleId } })).toBe(1);

      // Une impression du même ticket déjà en cours n'est pas dupliquée.
      const concurrent = await print(cashier, { terminalId: terminalA, kind: 'RECEIPT', saleId });
      expect(concurrent.status).toBe(409);
      expect(concurrent.body.code).toBe('PRINT_IN_PROGRESS');

      // Imprimante indisponible : l'échec est historisé, la vente reste encaissée.
      const failed = await cashier
        .post(`/api/v1/print-jobs/${res.body.job.id}/result`)
        .send({
          status: 'FAILED',
          errorCode: 'PRINTER_UNREACHABLE',
          errorMessage: 'Imprimante éteinte',
        })
        .expect(200);
      expect(failed.body).toMatchObject({ status: 'FAILED', errorCode: 'PRINTER_UNREACHABLE' });
      const sale = await prisma.sale.findUniqueOrThrow({
        where: { id: saleId },
        include: { payments: true },
      });
      expect(sale).toMatchObject({
        status: 'OPEN',
        paymentStatus: 'PAID',
        preparationStatus: 'NOT_SENT',
      });
      expect(sale.payments).toHaveLength(1);
    });

    it('une nouvelle tentative après échec est possible ; le ticket original n’est imprimé qu’une fois', async () => {
      const key = randomUUID();
      const retry = await cashier
        .post('/api/v1/print-jobs')
        .send({ terminalId: terminalA, kind: 'RECEIPT', saleId, clientRequestId: key })
        .expect(201);
      await cashier
        .post(`/api/v1/print-jobs/${retry.body.job.id}/result`)
        .send({ status: 'SUCCEEDED' })
        .expect(200);
      // Résultat rejoué : idempotent ; résultat contradictoire : refusé.
      await cashier
        .post(`/api/v1/print-jobs/${retry.body.job.id}/result`)
        .send({ status: 'SUCCEEDED' })
        .expect(200);
      await cashier
        .post(`/api/v1/print-jobs/${retry.body.job.id}/result`)
        .send({ status: 'FAILED', errorCode: 'X' })
        .expect(409);

      const again = await print(cashier, { terminalId: terminalA, kind: 'RECEIPT', saleId });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('RECEIPT_ALREADY_PRINTED');
      // La requête d'origine rejouée après succès ne renvoie plus de flux : pas de second ticket.
      const replay = await cashier
        .post('/api/v1/print-jobs')
        .send({ terminalId: terminalA, kind: 'RECEIPT', saleId, clientRequestId: key })
        .expect(201);
      expect(replay.body).toMatchObject({ data: null, alreadyCompleted: true });

      const history = (await restoA.agent.get(`/api/v1/print-jobs?saleId=${saleId}`).expect(200))
        .body;
      expect(history.map((j: { status: string }) => j.status).sort()).toEqual([
        'FAILED',
        'SUCCEEDED',
      ]);
    });

    it('réimpression contrôlée : réservée aux responsables, motivée, marquée DUPLICATA et auditée', async () => {
      await print(cashier, {
        terminalId: terminalA,
        kind: 'REPRINT',
        saleId,
        reason: 'Client',
      }).expect(403);
      const noReason = await print(restoA.agent, {
        terminalId: terminalA,
        kind: 'REPRINT',
        saleId,
      });
      expect(noReason.body.code).toBe('REASON_REQUIRED');
      const res = await print(restoA.agent, {
        terminalId: terminalA,
        kind: 'REPRINT',
        saleId,
        reason: 'Ticket abîmé',
      }).expect(201);
      expect(res.body.preview.join('\n')).toContain('DUPLICATA');
      const audit = await prisma.auditLog.findFirst({
        where: { targetId: res.body.job.id, action: 'print.reprint_requested' },
      });
      expect(audit?.metadata).toMatchObject({ reason: 'Ticket abîmé' });
    });

    it('impression de test réservée à la configuration ; poste sans imprimante refusé', async () => {
      const test = await print(restoA.agent, { terminalId: terminalA, kind: 'TEST' }).expect(201);
      expect(test.body.preview.join('\n')).toContain('TEST D');
      await print(cashier, { terminalId: terminalA, kind: 'TEST' }).expect(403);
      const bare = (
        await restoA.agent
          .post('/api/v1/pos-terminals')
          .send({ establishmentId: estA, name: 'Sans imprimante' })
          .expect(201)
      ).body;
      const res = await print(restoA.agent, { terminalId: bare.id, kind: 'TEST' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PRINTER_NOT_CONFIGURED');
    });

    it('le poste doit appartenir à l’établissement de la vente', async () => {
      const other = (
        await restoA.agent
          .post('/api/v1/establishments')
          .send({ name: `Annexe ${Date.now()}`, businessType: 'RESTAURANT' })
          .expect(201)
      ).body;
      const terminal = (
        await restoA.agent
          .post('/api/v1/pos-terminals')
          .send({ establishmentId: other.id, name: 'Annexe', printerConnection: 'SIMULATED' })
          .expect(201)
      ).body;
      const { saleId: ownerSale } = await paidSale(restoA.agent);
      const res = await print(restoA.agent, {
        terminalId: terminal.id,
        kind: 'RECEIPT',
        saleId: ownerSale,
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TERMINAL_ESTABLISHMENT_MISMATCH');
    });

    it('isolation : une autre organisation ne peut imprimer ni la vente ni sur le poste de A', async () => {
      const terminalC = (
        await restoC.agent
          .post('/api/v1/pos-terminals')
          .send({ establishmentId: estC, name: 'C1', printerConnection: 'SIMULATED' })
          .expect(201)
      ).body;
      await print(restoC.agent, { terminalId: terminalC.id, kind: 'RECEIPT', saleId }).expect(404);
      await print(restoC.agent, { terminalId: terminalA, kind: 'TEST' }).expect(404);
      expect(
        (await restoC.agent.get(`/api/v1/print-jobs?saleId=${saleId}`).expect(200)).body,
      ).toEqual([]);
    });
  });

  describe('tiroir-caisse', () => {
    it('s’ouvre une seule fois après un paiement en espèces confirmé', async () => {
      const { paymentId } = await paidSale(cashier, 5000);
      const first = await drawer(cashier, {
        terminalId: terminalA,
        reason: 'CASH_PAYMENT',
        paymentId,
      }).expect(201);
      expect(first.body).toMatchObject({
        command: { pin: 2 },
        alreadyIssued: false,
        printer: { connection: 'SIMULATED' },
      });
      const second = await drawer(cashier, {
        terminalId: terminalA,
        reason: 'CASH_PAYMENT',
        paymentId,
      }).expect(201);
      expect(second.body).toMatchObject({ command: null, alreadyIssued: true });
      expect(second.body.event.id).toBe(first.body.event.id);
      expect(await prisma.drawerEvent.count({ where: { paymentId } })).toBe(1);
    });

    it('deux demandes simultanées pour un même paiement : une seule commande d’ouverture', async () => {
      const { paymentId } = await paidSale(cashier);
      const [a, b] = await Promise.all([
        drawer(cashier, { terminalId: terminalA, reason: 'CASH_PAYMENT', paymentId }),
        drawer(cashier, { terminalId: terminalA, reason: 'CASH_PAYMENT', paymentId }),
      ]);
      const commands = [a.body, b.body].filter((r) => r.command !== null);
      expect(commands).toHaveLength(1);
      expect(await prisma.drawerEvent.count({ where: { paymentId } })).toBe(1);
    });

    it('aucune ouverture automatique pour un paiement Wave (paiement simulé inséré en base de test)', async () => {
      const sale = (
        await cashier
          .post('/api/v1/sales')
          .send({ establishmentId: estA, lines: [{ variantId: variant, quantity: 1 }] })
          .expect(201)
      ).body;
      const stored = await prisma.sale.findUniqueOrThrow({
        where: { id: sale.id },
        select: { organizationId: true, cashSessionId: true, cashierId: true, total: true },
      });
      // Wave n'est pas activé : on simule ici un futur paiement Wave confirmé, directement en base de test.
      const wave = await prisma.payment.create({
        data: {
          organizationId: stored.organizationId,
          saleId: sale.id,
          cashSessionId: stored.cashSessionId,
          receivedById: stored.cashierId,
          method: 'WAVE',
          status: 'SUCCEEDED',
          amount: stored.total,
        },
      });
      const res = await drawer(cashier, {
        terminalId: terminalA,
        reason: 'CASH_PAYMENT',
        paymentId: wave.id,
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DRAWER_NOT_ALLOWED_FOR_METHOD');
    });

    it('refuse le paiement d’un autre employé et un paiement trop ancien', async () => {
      const { paymentId: ownerPayment } = await paidSale(restoA.agent);
      await drawer(cashier, {
        terminalId: terminalA,
        reason: 'CASH_PAYMENT',
        paymentId: ownerPayment,
      }).expect(404);
      const { paymentId } = await paidSale(cashier);
      await prisma.payment.update({
        where: { id: paymentId },
        data: { createdAt: new Date(Date.now() - 11 * 60 * 1000) },
      });
      const old = await drawer(cashier, {
        terminalId: terminalA,
        reason: 'CASH_PAYMENT',
        paymentId,
      });
      expect(old.status).toBe(409);
      expect(old.body.code).toBe('PAYMENT_TOO_OLD');
    });

    it('ouverture manuelle : réservée, justifiée, auditée et protégée contre les répétitions', async () => {
      await drawer(cashier, {
        terminalId: terminalA,
        reason: 'MANUAL',
        justification: 'Rendre la monnaie',
      }).expect(403);
      const noJustification = await drawer(restoA.agent, {
        terminalId: terminalA,
        reason: 'MANUAL',
      });
      expect(noJustification.body.code).toBe('JUSTIFICATION_REQUIRED');
      const opened = await drawer(restoA.agent, {
        terminalId: terminalA,
        reason: 'MANUAL',
        justification: 'Dépôt de fond de caisse',
      }).expect(201);
      expect(opened.body.command).toEqual({ pin: 2 });
      const repeated = await drawer(restoA.agent, {
        terminalId: terminalA,
        reason: 'MANUAL',
        justification: 'Encore une fois',
      });
      expect(repeated.status).toBe(429);
      expect(repeated.body.code).toBe('DRAWER_COOLDOWN');

      await restoA.agent
        .post(`/api/v1/drawer-events/${opened.body.event.id}/result`)
        .send({ status: 'SUCCEEDED' })
        .expect(200);
      const audit = await prisma.auditLog.findMany({
        where: { targetId: opened.body.event.id },
        select: { action: true },
      });
      expect(audit.map((a) => a.action).sort()).toEqual([
        'drawer.manual_open_requested',
        'drawer.opened',
      ]);
    });

    it('poste sans tiroir : aucune ouverture ; historique cloisonné', async () => {
      const network = (
        await restoA.agent.get(`/api/v1/pos-terminals?establishmentId=${estA}`).expect(200)
      ).body.find((t: { name: string }) => t.name === 'Caisse réseau');
      const { paymentId } = await paidSale(cashier);
      const res = await drawer(cashier, {
        terminalId: network.id,
        reason: 'CASH_PAYMENT',
        paymentId,
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DRAWER_NOT_CONFIGURED');

      const own = (await cashier.get('/api/v1/drawer-events').expect(200)).body;
      expect(own.every((e: { reason: string }) => e.reason === 'CASH_PAYMENT')).toBe(true);
      const all = (await restoA.agent.get('/api/v1/drawer-events').expect(200)).body;
      expect(all.some((e: { reason: string }) => e.reason === 'MANUAL')).toBe(true);
      expect((await restoC.agent.get('/api/v1/drawer-events').expect(200)).body).toEqual([]);
    });
  });
});
