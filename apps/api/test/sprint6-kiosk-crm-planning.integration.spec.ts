import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../src/prisma/prisma.service';
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

/**
 * Sprint 6 — bornes de commande, CRM, fidélité Parc / Restaurant, planning du personnel.
 * Exécuté uniquement sur la base de test (TEST_DATABASE_URL).
 */
describe('Sprint 6 — bornes, CRM, fidélité, planning (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let resto: SignedUpOwner;
  let restoB: SignedUpOwner;
  let duo: SignedUpOwner;
  let estR1: string;
  let estR2: string;
  let estB: string;
  let estDuo: string;
  let estDuoPark: string;
  let cashier: Agent;
  let cashierId: string;
  let supervisor: Agent;
  let kitchen: Agent;
  let poulet: string; // 4 000 FCFA
  let jus: string; // 1 000 FCFA
  let variantB: string;
  let duoPlat: string; // 3 000 FCFA (restaurant du parc + restaurant)
  let duoAdult: string; // billet adulte 2 000 FCFA
  let kioskAgent: Agent;
  let kioskId: string;

  const api = (path: string) => `/api/v1${path}`;

  async function employee(owner: SignedUpOwner, role: string, establishmentIds: string[]) {
    const created = await owner.agent
      .post(api('/employees'))
      .send({ firstName: 'Seydou', lastName: role, role, establishmentIds })
      .expect(201);
    const session = await login(app, created.body.employee.loginId, created.body.temporaryPassword);
    await session.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: created.body.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return { agent: session.agent, membershipId: created.body.employee.id as string };
  }

  async function product(
    owner: SignedUpOwner,
    name: string,
    price: number,
    establishmentIds: string[],
  ) {
    const category =
      (await owner.agent.get(api('/catalog/categories')).expect(200)).body[0]?.id ??
      (await owner.agent.post(api('/catalog/categories')).send({ name: 'Plats' }).expect(201)).body
        .id;
    const res = await owner.agent
      .post(api('/catalog/products'))
      .send({
        name,
        categoryId: category,
        imageUrl: `https://images.example.com/${encodeURIComponent(name)}.jpg`,
        variants: [
          {
            name: 'Standard',
            prices: establishmentIds.map((establishmentId) => ({ establishmentId, price })),
          },
        ],
      })
      .expect(201);
    return res.body.variants[0].id as string;
  }

  const order = (
    a: Agent,
    establishmentId: string,
    lines: { variantId: string; quantity: number }[],
  ) => a.post(api('/orders')).send({ establishmentId, channel: 'COUNTER', lines });

  const pay = (a: Agent, saleId: string, amountTendered: number, clientRequestId?: string) =>
    a
      .post(api(`/sales/${saleId}/payments`))
      .send({ method: 'CASH', amountTendered, clientRequestId });

  const createCustomer = (a: Agent, body: Record<string, unknown>) =>
    a.post(api('/customers')).send({ consent: true, ...body });

  const wallet = async (a: Agent, customerId: string, activity: 'PARK' | 'RESTAURANT') =>
    (
      (await a.get(api(`/customers/${customerId}`)).expect(200)).body.wallets as {
        activity: string;
        balance: number;
      }[]
    ).find((w) => w.activity === activity)!.balance;

  const at = (days: number, hour: number) => {
    const d = new Date(Date.now() + days * 86_400_000);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    resto = await signup(app, 's6r', 'RESTAURANT');
    restoB = await signup(app, 's6b', 'RESTAURANT');
    duo = await signup(app, 's6d', 'PARK_RESTAURANT');
    estR1 = (await resto.agent.get(api('/establishments')).expect(200)).body[0].id;
    estR2 = (
      await resto.agent
        .post(api('/establishments'))
        .send({ name: 'Annexe', businessType: 'RESTAURANT', city: 'Kayes' })
        .expect(201)
    ).body.id;
    estB = (await restoB.agent.get(api('/establishments')).expect(200)).body[0].id;
    estDuo = (await duo.agent.get(api('/establishments')).expect(200)).body[0].id;
    estDuoPark = (
      await duo.agent
        .post(api('/establishments'))
        .send({ name: 'Parc seul', businessType: 'PARK', city: 'Kati' })
        .expect(201)
    ).body.id;

    poulet = await product(resto, 'Poulet braisé', 4000, [estR1, estR2]);
    jus = await product(resto, 'Jus de bissap', 1000, [estR1]);
    variantB = await product(restoB, 'Tô', 1500, [estB]);
    duoPlat = await product(duo, 'Riz gras', 3000, [estDuo]);
    duoAdult = (
      await duo.agent
        .post(api('/ticketing/categories'))
        .send({ establishmentId: estDuo, kind: 'ADULT', name: 'Adulte', price: 2000 })
        .expect(201)
    ).body.id;

    const c = await employee(resto, 'CASHIER', [estR1]);
    cashier = c.agent;
    cashierId = c.membershipId;
    supervisor = (await employee(resto, 'SUPERVISOR', [estR1])).agent;
    kitchen = (await employee(resto, 'KITCHEN', [estR1])).agent;
    for (const a of [cashier, resto.agent]) {
      await a
        .post(api('/cash-sessions'))
        .send({ establishmentId: estR1, openingFloat: 0 })
        .expect(201);
    }
    await duo.agent
      .post(api('/cash-sessions'))
      .send({ establishmentId: estDuo, openingFloat: 0 })
      .expect(201);

    // Fidélité : 1 point par 1 000 FCFA, 1 point = 10 FCFA, 100 points minimum.
    const rule = { isActive: true, earnAmountStep: 1000, redeemValue: 10, minRedeemPoints: 100 };
    await resto.agent.put(api('/loyalty/rules/RESTAURANT')).send(rule).expect(200);
    await duo.agent.put(api('/loyalty/rules/RESTAURANT')).send(rule).expect(200);
    await duo.agent
      .put(api('/loyalty/rules/PARK'))
      .send({ ...rule, earnAmountStep: 500 })
      .expect(200);

    // Borne appairée sur l'établissement principal.
    const created = (
      await resto.agent
        .post(api('/kiosk-devices'))
        .send({ establishmentId: estR1, name: 'Borne entrée' })
        .expect(201)
    ).body;
    kioskId = created.device.id;
    expect(created.pairingCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    kioskAgent = agent(app);
    const paired = await kioskAgent
      .post(api('/kiosk/pair'))
      .send({ code: created.pairingCode })
      .expect(200);
    expect(paired.body).toEqual({
      deviceName: 'Borne entrée',
      establishmentName: expect.any(String),
    });
    const cookie = (paired.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('ocp_kiosk='),
    )!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/kiosk/);
    expect(cookie).toMatch(/SameSite=Strict/i);
  }, 300_000);

  afterAll(async () => {
    try {
      if (prisma) await cleanup(prisma);
    } finally {
      await app?.close();
    }
  });

  describe('bornes de commande', () => {
    it('1. commande depuis la borne : menu avec photos, numéro affiché, une commande par session', async () => {
      const menu = (await kioskAgent.get(api('/kiosk/menu')).expect(200)).body;
      const products = menu.categories.flatMap(
        (c: { products: { name: string; imageUrl: string }[] }) => c.products,
      );
      expect(products.find((p: { name: string }) => p.name === 'Poulet braisé').imageUrl).toMatch(
        /^https:\/\//,
      );
      const session = (await kioskAgent.post(api('/kiosk/sessions')).expect(201)).body;
      const body = {
        clientRequestId: randomUUID(),
        customerName: 'Oumar',
        lines: [
          { variantId: poulet, quantity: 1, notes: 'Sans piment' },
          { variantId: jus, quantity: 2 },
        ],
      };
      const created = (
        await kioskAgent
          .post(api(`/kiosk/sessions/${session.id}/orders`))
          .send(body)
          .expect(201)
      ).body;
      expect(created).toMatchObject({ status: 'PENDING_VALIDATION', estimatedTotal: 6000 });
      expect(created.displayNumber).toBeGreaterThan(0);
      // Renvoi réseau : même commande, même numéro.
      const replay = (
        await kioskAgent
          .post(api(`/kiosk/sessions/${session.id}/orders`))
          .send(body)
          .expect(201)
      ).body;
      expect(replay.displayNumber).toBe(created.displayNumber);
      // Seconde commande dans la même session : refusée (protection contre les commandes répétées).
      const second = await kioskAgent
        .post(api(`/kiosk/sessions/${session.id}/orders`))
        .send({ ...body, clientRequestId: randomUUID() });
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('KIOSK_SESSION_CLOSED');
      // Prix envoyés par la borne : refusés.
      const s2 = (await kioskAgent.post(api('/kiosk/sessions')).expect(201)).body;
      await kioskAgent
        .post(api(`/kiosk/sessions/${s2.id}/orders`))
        .send({
          clientRequestId: randomUUID(),
          lines: [{ variantId: jus, quantity: 1, unitPrice: 1 }],
        })
        .expect(400);
      await kioskAgent.post(api(`/kiosk/sessions/${s2.id}/end`)).expect(204);
      await kioskAgent
        .post(api(`/kiosk/sessions/${s2.id}/orders`))
        .send({ clientRequestId: randomUUID(), lines: [{ variantId: jus, quantity: 1 }] })
        .expect(409);
    });

    it('2. commande de borne en attente de paiement à la caisse, puis 3. aucune préparation après paiement', async () => {
      const session = (await kioskAgent.post(api('/kiosk/sessions')).expect(201)).body;
      const created = (
        await kioskAgent
          .post(api(`/kiosk/sessions/${session.id}/orders`))
          .send({ clientRequestId: randomUUID(), lines: [{ variantId: poulet, quantity: 1 }] })
          .expect(201)
      ).body;
      const pending = (
        await cashier.get(api(`/orders/qr-requests?establishmentId=${estR1}`)).expect(200)
      ).body;
      const request = pending.find(
        (r: { displayNumber: number }) => r.displayNumber === created.displayNumber,
      );
      expect(request).toMatchObject({
        source: 'KIOSK',
        location: 'Borne · Borne entrée',
        status: 'PENDING_VALIDATION',
      });
      const sale = (await cashier.post(api(`/orders/qr-requests/${request.id}/accept`)).expect(200))
        .body;
      expect(sale).toMatchObject({
        channel: 'KIOSK',
        paymentStatus: 'UNPAID',
        preparationStatus: 'NOT_SENT',
        total: 4000,
      });
      const paid = (await pay(cashier, sale.id, 4000).expect(200)).body;
      expect(paid.sale).toMatchObject({ paymentStatus: 'PAID', preparationStatus: 'NOT_SENT' });
      const queue = (await kitchen.get(api(`/kitchen/orders?establishmentId=${estR1}`)).expect(200))
        .body;
      expect(queue.map((o: { id: string }) => o.id)).not.toContain(sale.id);
    });

    it('4. jeton de borne absent, invalide, code réutilisé ou borne révoquée : refus', async () => {
      await agent(app).get(api('/kiosk/menu')).expect(401);
      await agent(app).get(api('/kiosk/menu')).set('Cookie', 'ocp_kiosk=faux-jeton').expect(401);
      // Le jeton de borne ne donne accès à aucune route d'employé.
      await kioskAgent.get(api(`/orders?establishmentId=${estR1}`)).expect(401);
      await kioskAgent.get(api('/customers?q=Awa')).expect(401);

      const created = (
        await resto.agent
          .post(api('/kiosk-devices'))
          .send({ establishmentId: estR1, name: 'Borne terrasse' })
          .expect(201)
      ).body;
      const tablet = agent(app);
      await tablet.post(api('/kiosk/pair')).send({ code: created.pairingCode }).expect(200);
      // Code à usage unique.
      const reused = await agent(app).post(api('/kiosk/pair')).send({ code: created.pairingCode });
      expect(reused.status).toBe(401);
      expect(reused.body.code).toBe('INVALID_PAIRING_CODE');
      await tablet.get(api('/kiosk/me')).expect(200);
      const session = (await tablet.post(api('/kiosk/sessions')).expect(201)).body;
      await resto.agent.post(api(`/kiosk-devices/${created.device.id}/revoke`)).expect(200);
      const revoked = await tablet.get(api('/kiosk/menu'));
      expect(revoked.status).toBe(401);
      expect(revoked.body.code).toBe('KIOSK_UNPAIRED');
      await tablet
        .post(api(`/kiosk/sessions/${session.id}/orders`))
        .send({ clientRequestId: randomUUID(), lines: [{ variantId: jus, quantity: 1 }] })
        .expect(401);
      const list = (
        await resto.agent.get(api(`/kiosk-devices?establishmentId=${estR1}`)).expect(200)
      ).body;
      expect(list.find((d: { id: string }) => d.id === created.device.id).status).toBe('REVOKED');
      expect(JSON.stringify(list)).not.toMatch(/tokenHash|pairingCodeHash/);
      // Une session d'une autre borne ne peut pas être utilisée.
      const other = await kioskAgent
        .post(api(`/kiosk/sessions/${session.id}/orders`))
        .send({ clientRequestId: randomUUID(), lines: [{ variantId: jus, quantity: 1 }] });
      expect(other.status).toBe(409);
    });

    it('5. isolation multi-tenant des bornes', async () => {
      await restoB.agent.get(api(`/kiosk-devices?establishmentId=${estR1}`)).expect(404);
      await restoB.agent.post(api(`/kiosk-devices/${kioskId}/revoke`)).expect(404);
      await restoB.agent.post(api(`/kiosk-devices/${kioskId}/pairing-code`)).expect(404);
      await restoB.agent
        .post(api('/kiosk-devices'))
        .send({ establishmentId: estR1, name: 'Intrus' })
        .expect(404);
      // La borne ne vend que les articles de son établissement.
      const session = (await kioskAgent.post(api('/kiosk/sessions')).expect(201)).body;
      const foreign = await kioskAgent
        .post(api(`/kiosk/sessions/${session.id}/orders`))
        .send({ clientRequestId: randomUUID(), lines: [{ variantId: variantB, quantity: 1 }] });
      expect(foreign.status).toBe(400);
      expect(foreign.body.code).toBe('PRODUCT_UNAVAILABLE');
      await restoB.agent.get(api(`/orders/qr-requests?establishmentId=${estR1}`)).expect(404);
      // Pas de borne dans un établissement sans restaurant.
      const parkOnly = await duo.agent
        .post(api('/kiosk-devices'))
        .send({ establishmentId: estDuoPark, name: 'Parc' });
      expect(parkOnly.status).toBe(400);
      expect(parkOnly.body.code).toBe('ESTABLISHMENT_NOT_RESTAURANT');
    });

    it('ticket de commande imprimé par la borne : imprimante contrôlée, historisé, sans réimpression', async () => {
      // Imprimantes pilotées par le navigateur (PWA) : identifiant facultatif, contrôlé s'il est fourni.
      const webUsb = (
        await resto.agent
          .post(api('/pos-terminals'))
          .send({
            establishmentId: estR1,
            name: 'Borne USB',
            printerConnection: 'WEBUSB',
            paperWidth: 58,
          })
          .expect(201)
      ).body;
      expect(webUsb).toMatchObject({ printerConnection: 'WEBUSB', printerAddress: null });
      await resto.agent
        .post(api('/pos-terminals'))
        .send({
          establishmentId: estR1,
          name: 'Borne BLE',
          printerConnection: 'WEBBLUETOOTH',
          printerAddress: 'MTP',
        })
        .expect(201);
      await resto.agent
        .post(api('/pos-terminals'))
        .send({
          establishmentId: estR1,
          name: 'Borne USB 2',
          printerConnection: 'WEBUSB',
          printerAddress: 'imprimante',
        })
        .expect(400);
      const noPrinter = (
        await resto.agent
          .post(api('/pos-terminals'))
          .send({ establishmentId: estR1, name: 'Sans imprimante' })
          .expect(201)
      ).body;
      const annex = (
        await resto.agent
          .post(api('/pos-terminals'))
          .send({ establishmentId: estR2, name: 'Annexe', printerConnection: 'SIMULATED' })
          .expect(201)
      ).body;
      const simulated = (
        await resto.agent
          .post(api('/pos-terminals'))
          .send({
            establishmentId: estR1,
            name: 'Ticket borne',
            printerConnection: 'SIMULATED',
            paperWidth: 58,
          })
          .expect(201)
      ).body;
      // Contrôles : même établissement, imprimante configurée, droits.
      await resto.agent
        .post(api(`/kiosk-devices/${kioskId}/printer`))
        .send({ terminalId: annex.id })
        .expect(404);
      const none = await resto.agent
        .post(api(`/kiosk-devices/${kioskId}/printer`))
        .send({ terminalId: noPrinter.id });
      expect(none.body.code).toBe('PRINTER_NOT_CONFIGURED');
      await supervisor
        .post(api(`/kiosk-devices/${kioskId}/printer`))
        .send({ terminalId: simulated.id })
        .expect(403);
      const set = (
        await resto.agent
          .post(api(`/kiosk-devices/${kioskId}/printer`))
          .send({ terminalId: simulated.id })
          .expect(200)
      ).body;
      expect(set.printerTerminal).toMatchObject({ id: simulated.id, name: 'Ticket borne' });
      expect((await kioskAgent.get(api('/kiosk/me')).expect(200)).body.printer).toEqual({
        connection: 'SIMULATED',
        address: null,
      });

      const session = (await kioskAgent.post(api('/kiosk/sessions')).expect(201)).body;
      const body = {
        clientRequestId: randomUUID(),
        lines: [{ variantId: poulet, quantity: 2, notes: 'Sans piment' }],
      };
      const created = (
        await kioskAgent
          .post(api(`/kiosk/sessions/${session.id}/orders`))
          .send(body)
          .expect(201)
      ).body;
      expect(created.print).toMatchObject({ printer: { connection: 'SIMULATED' }, paperWidth: 58 });
      expect(created.print.data).toEqual(expect.any(String));
      const preview = created.print.preview.join('\n');
      expect(preview).toContain(`B-${String(created.displayNumber).padStart(4, '0')}`);
      expect(preview).toContain('2 x Poulet braisé');
      expect(preview).toContain('pas un reçu');
      expect(created.print.preview.every((l: string) => l.length <= 32)).toBe(true);
      // Une autre borne ne peut pas rapporter le résultat de ce ticket.
      const other = (
        await resto.agent
          .post(api('/kiosk-devices'))
          .send({ establishmentId: estR1, name: 'Borne bar' })
          .expect(201)
      ).body;
      const otherTablet = agent(app);
      await otherTablet.post(api('/kiosk/pair')).send({ code: other.pairingCode }).expect(200);
      await otherTablet
        .post(api(`/kiosk/print-jobs/${created.print.jobId}/result`))
        .send({ status: 'SUCCEEDED' })
        .expect(404);
      await kioskAgent
        .post(api(`/kiosk/print-jobs/${created.print.jobId}/result`))
        .send({ status: 'SUCCEEDED' })
        .expect(200);
      // Renvoi réseau de la même commande : même ticket, sans nouveau flux (pas de réimpression).
      const replay = (
        await kioskAgent
          .post(api(`/kiosk/sessions/${session.id}/orders`))
          .send(body)
          .expect(201)
      ).body;
      expect(replay.print.jobId).toBe(created.print.jobId);
      expect(replay.print.data).toBeNull();
      // Historique d'impression du poste : ticket de borne, attribué à la borne, sans employé.
      const jobs = (
        await resto.agent.get(api(`/print-jobs?terminalId=${simulated.id}`)).expect(200)
      ).body;
      expect(jobs).toEqual([
        expect.objectContaining({
          kind: 'KIOSK_TICKET',
          status: 'SUCCEEDED',
          requestedByName: 'Borne Borne entrée',
        }),
      ]);
      // Retrait de l'imprimante : plus de ticket.
      await resto.agent
        .post(api(`/kiosk-devices/${kioskId}/printer`))
        .send({ terminalId: null })
        .expect(200);
      const s2 = (await kioskAgent.post(api('/kiosk/sessions')).expect(201)).body;
      const plain = (
        await kioskAgent
          .post(api(`/kiosk/sessions/${s2.id}/orders`))
          .send({ clientRequestId: randomUUID(), lines: [{ variantId: jus, quantity: 1 }] })
          .expect(201)
      ).body;
      expect(plain.print).toBeNull();
    });
  });

  describe('CRM', () => {
    let awa: string;

    it('6. création et recherche de clients : consentement, identifiant minimal, téléphone unique', async () => {
      await resto.agent
        .post(api('/customers'))
        .send({ firstName: 'Sans', consent: false })
        .expect(400);
      const none = await createCustomer(resto.agent, { notes: 'rien' });
      expect(none.status).toBe(400);
      expect(none.body.code).toBe('IDENTIFIER_REQUIRED');
      await createCustomer(resto.agent, { phone: '12' }).expect(400);
      const created = (
        await createCustomer(cashier, {
          firstName: 'Awa',
          lastName: 'Diarra',
          phone: '+223 70 11 22 33',
          marketingConsent: true,
        }).expect(201)
      ).body;
      awa = created.id;
      expect(created).toMatchObject({
        firstName: 'Awa',
        phone: '+22370112233',
        marketingConsent: true,
      });
      // Visiteur qui ne veut donner que son téléphone : fiche sans nom.
      await createCustomer(cashier, { phone: '70 99 88 77' }).expect(201);
      const duplicate = await createCustomer(resto.agent, {
        firstName: 'Autre',
        phone: '+22370112233',
      });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.code).toBe('PHONE_TAKEN');
      const byPhone = (await cashier.get(api('/customers?q=1122')).expect(200)).body;
      expect(byPhone.map((c: { id: string }) => c.id)).toContain(awa);
      const byName = (await resto.agent.get(api('/customers?q=diar')).expect(200)).body;
      expect(byName[0].id).toBe(awa);
      const marketing = (await resto.agent.get(api('/customers?filter=marketing')).expect(200))
        .body;
      expect(marketing.map((c: { id: string }) => c.id)).toEqual([awa]);
      // Une autre organisation a ses propres clients : même téléphone autorisé chez elle.
      await createCustomer(restoB.agent, { phone: '+22370112233' }).expect(201);
    });

    it('7. protection des données : accès restreint du caissier, isolation, anonymisation, conservation', async () => {
      const short = await cashier.get(api('/customers?q=aw'));
      expect(short.status).toBe(400);
      expect(short.body.code).toBe('SEARCH_TOO_SHORT');
      await cashier.get(api('/customers')).expect(400);
      await resto.agent
        .patch(api(`/customers/${awa}`))
        .send({ notes: 'Préfère la terrasse' })
        .expect(200);
      const limited = (await cashier.get(api(`/customers/${awa}`)).expect(200)).body;
      expect(limited.notes).toBeUndefined();
      expect(limited.purchases).toBeUndefined();
      expect(limited.totalSpent).toBeUndefined();
      const full = (await supervisor.get(api(`/customers/${awa}`)).expect(200)).body;
      expect(full.notes).toBe('Préfère la terrasse');
      expect(full.purchases).toEqual(expect.any(Array));
      await kitchen.get(api('/customers?q=Awa')).expect(403);
      await restoB.agent.get(api(`/customers/${awa}`)).expect(404);
      await restoB.agent
        .patch(api(`/customers/${awa}`))
        .send({ notes: 'x' })
        .expect(404);
      await cashier
        .post(api(`/customers/${awa}/anonymize`))
        .send({ reason: 'Demande' })
        .expect(403);
      await supervisor
        .post(api(`/customers/${awa}/anonymize`))
        .send({ reason: 'Demande' })
        .expect(403);

      // Demande de suppression : anonymisation, points annulés.
      const leaving = (
        await createCustomer(resto.agent, { firstName: 'Moussa', phone: '+22376000001' }).expect(
          201,
        )
      ).body;
      await resto.agent
        .post(api('/loyalty/adjustments'))
        .send({
          customerId: leaving.id,
          activity: 'RESTAURANT',
          points: 40,
          reason: 'Bienvenue',
          clientRequestId: randomUUID(),
        })
        .expect(201);
      await resto.agent
        .post(api(`/customers/${leaving.id}/anonymize`))
        .send({ reason: 'Demande du client' })
        .expect(200);
      const erased = (await resto.agent.get(api(`/customers/${leaving.id}`)).expect(200)).body;
      expect(erased).toMatchObject({
        firstName: null,
        phone: null,
        anonymizedAt: expect.any(String),
      });
      expect(
        erased.wallets.find((w: { activity: string }) => w.activity === 'RESTAURANT').balance,
      ).toBe(0);
      const audits = await prisma.auditLog.findMany({ where: { targetId: leaving.id } });
      expect(JSON.stringify(audits)).not.toMatch(/Moussa|76000001/);
      await resto.agent
        .patch(api(`/customers/${leaving.id}`))
        .send({ firstName: 'Retour' })
        .expect(409);

      // Règle de conservation : fiche sans visite depuis plus de 36 mois.
      const old = (await createCustomer(resto.agent, { firstName: 'Ancien' }).expect(201)).body;
      await prisma.customer.update({
        where: { id: old.id },
        data: {
          createdAt: new Date('2020-01-01T00:00:00Z'),
          lastVisitAt: new Date('2021-06-01T00:00:00Z'),
        },
      });
      await supervisor.post(api('/customers/retention/apply')).expect(403);
      const retention = (await resto.agent.post(api('/customers/retention/apply')).expect(200))
        .body;
      expect(retention.anonymized).toBeGreaterThanOrEqual(1);
      expect(
        (await prisma.customer.findUniqueOrThrow({ where: { id: old.id } })).anonymizedAt,
      ).not.toBeNull();
      expect(
        (await prisma.customer.findUniqueOrThrow({ where: { id: awa } })).anonymizedAt,
      ).toBeNull();
    });
  });

  describe('fidélité', () => {
    let fatou: string;

    beforeAll(async () => {
      fatou = (
        await createCustomer(cashier, { firstName: 'Fatou', phone: '+22366554433' }).expect(201)
      ).body.id;
    });

    it('8. points attribués après paiement, et 9. jamais sur une commande impayée ou annulée', async () => {
      const sale = (await order(cashier, estR1, [{ variantId: poulet, quantity: 1 }]).expect(201))
        .body;
      await cashier
        .put(api(`/sales/${sale.id}/customer`))
        .send({ customerId: fatou })
        .expect(200);
      expect(await wallet(cashier, fatou, 'RESTAURANT')).toBe(0);
      await pay(cashier, sale.id, 4000).expect(200);
      expect(await wallet(cashier, fatou, 'RESTAURANT')).toBe(4);
      const tx = await prisma.loyaltyTransaction.findMany({ where: { saleId: sale.id } });
      expect(tx.map((t) => [t.kind, t.points])).toEqual([['EARN', 4]]);

      const unpaid = (await order(cashier, estR1, [{ variantId: poulet, quantity: 2 }]).expect(201))
        .body;
      await cashier
        .put(api(`/sales/${unpaid.id}/customer`))
        .send({ customerId: fatou })
        .expect(200);
      await resto.agent
        .post(api(`/sales/${unpaid.id}/cancel`))
        .send({ reason: 'Parti' })
        .expect(200);
      expect(await wallet(cashier, fatou, 'RESTAURANT')).toBe(4);
      expect(await prisma.loyaltyTransaction.count({ where: { saleId: unpaid.id } })).toBe(0);
      // Le client d'une vente payée ne change plus.
      const other = (
        await createCustomer(cashier, { firstName: 'Autre', phone: '+22366000000' }).expect(201)
      ).body.id;
      const locked = await cashier
        .put(api(`/sales/${sale.id}/customer`))
        .send({ customerId: other });
      expect(locked.status).toBe(409);
      expect(locked.body.code).toBe('CUSTOMER_LOCKED');
    });

    it('10. paiement répété ou rattachement tardif : une seule attribution', async () => {
      const before = await wallet(cashier, fatou, 'RESTAURANT');
      const sale = (
        await order(cashier, estR1, [
          { variantId: poulet, quantity: 1 },
          { variantId: jus, quantity: 1 },
        ]).expect(201)
      ).body;
      await cashier
        .put(api(`/sales/${sale.id}/customer`))
        .send({ customerId: fatou })
        .expect(200);
      const key = randomUUID();
      const [a, b] = await Promise.all([
        pay(cashier, sale.id, 5000, key),
        pay(cashier, sale.id, 5000, key),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      await pay(cashier, sale.id, 5000).expect(409);
      expect(await wallet(cashier, fatou, 'RESTAURANT')).toBe(before + 5);

      // Vente payée sans client, rattachée ensuite : crédit unique, même si le rattachement est rejoué.
      const late = (await order(cashier, estR1, [{ variantId: poulet, quantity: 1 }]).expect(201))
        .body;
      await pay(cashier, late.id, 4000).expect(200);
      await Promise.all([
        cashier.put(api(`/sales/${late.id}/customer`)).send({ customerId: fatou }),
        cashier.put(api(`/sales/${late.id}/customer`)).send({ customerId: fatou }),
      ]);
      expect(await wallet(cashier, fatou, 'RESTAURANT')).toBe(before + 9);
      expect(
        await prisma.loyaltyTransaction.count({ where: { saleId: late.id, kind: 'EARN' } }),
      ).toBe(1);
    });

    it('11. parc + restaurant : deux soldes indépendants, sans transfert', async () => {
      const client = (
        await createCustomer(duo.agent, { firstName: 'Kadi', phone: '+22377001122' }).expect(201)
      ).body.id;
      const ticket = (
        await duo.agent
          .post(api('/ticketing/orders'))
          .send({
            establishmentId: estDuo,
            lines: [{ ticketCategoryId: duoAdult, quantity: 1, visitorNames: ['Kadi'] }],
          })
          .expect(201)
      ).body;
      await duo.agent
        .put(api(`/sales/${ticket.id}/customer`))
        .send({ customerId: client })
        .expect(200);
      await pay(duo.agent, ticket.id, 2000).expect(200);
      const meal = (
        await order(duo.agent, estDuo, [{ variantId: duoPlat, quantity: 1 }]).expect(201)
      ).body;
      await duo.agent
        .put(api(`/sales/${meal.id}/customer`))
        .send({ customerId: client })
        .expect(200);
      await pay(duo.agent, meal.id, 3000).expect(200);
      const wallets = (await duo.agent.get(api(`/customers/${client}`)).expect(200)).body.wallets;
      // Parc : 1 point / 500 FCFA → 4 ; restaurant : 1 point / 1 000 FCFA → 3.
      expect(wallets).toEqual([
        { activity: 'PARK', balance: 4 },
        { activity: 'RESTAURANT', balance: 3 },
      ]);
      // Un restaurant seul n'a pas de portefeuille Parc.
      const restoWallets = (await resto.agent.get(api(`/customers/${fatou}`)).expect(200)).body
        .wallets;
      expect(restoWallets.map((w: { activity: string }) => w.activity)).toEqual(['RESTAURANT']);
      await resto.agent
        .put(api('/loyalty/rules/PARK'))
        .send({ isActive: true, earnAmountStep: 1, redeemValue: 1, minRedeemPoints: 1 })
        .expect(403);
    });

    it('12. utilisation des points : remise serveur, minimum, plafond, sans solde négatif ; annulation', async () => {
      await resto.agent
        .post(api('/loyalty/adjustments'))
        .send({
          customerId: fatou,
          activity: 'RESTAURANT',
          points: 200,
          reason: 'Geste commercial',
          clientRequestId: randomUUID(),
        })
        .expect(201);
      const balance = await wallet(cashier, fatou, 'RESTAURANT');
      const sale = (await order(cashier, estR1, [{ variantId: poulet, quantity: 1 }]).expect(201))
        .body;
      const noCustomer = await cashier
        .post(api(`/sales/${sale.id}/loyalty-redemption`))
        .send({ points: 150 });
      expect(noCustomer.body.code).toBe('CUSTOMER_REQUIRED');
      await cashier
        .put(api(`/sales/${sale.id}/customer`))
        .send({ customerId: fatou })
        .expect(200);
      for (const [points, code] of [
        [50, 'BELOW_MINIMUM'],
        [balance + 1, 'INSUFFICIENT_POINTS'],
      ] as const) {
        const res = await cashier
          .post(api(`/sales/${sale.id}/loyalty-redemption`))
          .send({ points });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe(code);
      }
      // Une remise supérieure au total est refusée (le client ne peut pas « gagner » de l'argent).
      const big = (await order(cashier, estR1, [{ variantId: jus, quantity: 1 }]).expect(201)).body;
      await cashier
        .put(api(`/sales/${big.id}/customer`))
        .send({ customerId: fatou })
        .expect(200);
      const exceeds = await cashier
        .post(api(`/sales/${big.id}/loyalty-redemption`))
        .send({ points: 150 });
      expect(exceeds.body.code).toBe('EXCEEDS_TOTAL');

      const redeemed = (
        await cashier
          .post(api(`/sales/${sale.id}/loyalty-redemption`))
          .send({ points: 150 })
          .expect(200)
      ).body;
      expect(redeemed).toMatchObject({
        total: 2500,
        loyaltyDiscount: 1500,
        loyaltyPointsRedeemed: 150,
      });
      expect(await wallet(cashier, fatou, 'RESTAURANT')).toBe(balance - 150);
      // Articles figés tant que la remise est appliquée ; client figé aussi.
      const edit = await cashier
        .patch(api(`/orders/${sale.id}`))
        .send({ lines: [{ variantId: jus, quantity: 1 }] });
      expect(edit.body.code).toBe('LOYALTY_APPLIED');
      // Retrait de la remise puis nouvelle utilisation, enfin paiement du montant réduit.
      await cashier.delete(api(`/sales/${sale.id}/loyalty-redemption`)).expect(200);
      expect(await wallet(cashier, fatou, 'RESTAURANT')).toBe(balance);
      await cashier
        .post(api(`/sales/${sale.id}/loyalty-redemption`))
        .send({ points: 100 })
        .expect(200);
      const paid = (await pay(cashier, sale.id, 3000).expect(200)).body;
      expect(paid.payment.amount).toBe(3000);
      // Points gagnés sur le montant payé (3 000 → 3 points).
      expect(await wallet(cashier, fatou, 'RESTAURANT')).toBe(balance - 100 + 3);

      // Annulation d'une vente non payée avec remise : points recrédités.
      const cancelled = (
        await order(cashier, estR1, [{ variantId: poulet, quantity: 1 }]).expect(201)
      ).body;
      await cashier
        .put(api(`/sales/${cancelled.id}/customer`))
        .send({ customerId: fatou })
        .expect(200);
      const now = await wallet(cashier, fatou, 'RESTAURANT');
      await cashier
        .post(api(`/sales/${cancelled.id}/loyalty-redemption`))
        .send({ points: 100 })
        .expect(200);
      await resto.agent
        .post(api(`/sales/${cancelled.id}/cancel`))
        .send({ reason: 'Erreur' })
        .expect(200);
      expect(await wallet(cashier, fatou, 'RESTAURANT')).toBe(now);
    });

    it('13. mouvements concurrents : jamais de solde négatif, correction rejouée appliquée une fois', async () => {
      const client = (
        await createCustomer(cashier, { firstName: 'Concurrence', phone: '+22365000001' }).expect(
          201,
        )
      ).body.id;
      await resto.agent
        .post(api('/loyalty/adjustments'))
        .send({
          customerId: client,
          activity: 'RESTAURANT',
          points: 150,
          reason: 'Test',
          clientRequestId: randomUUID(),
        })
        .expect(201);
      const sales = [];
      for (let i = 0; i < 2; i++) {
        const s = (await order(cashier, estR1, [{ variantId: poulet, quantity: 1 }]).expect(201))
          .body;
        await cashier
          .put(api(`/sales/${s.id}/customer`))
          .send({ customerId: client })
          .expect(200);
        sales.push(s);
      }
      const results = await Promise.all(
        sales.map((s) =>
          cashier.post(api(`/sales/${s.id}/loyalty-redemption`)).send({ points: 100 }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await wallet(cashier, client, 'RESTAURANT')).toBe(50);
      const negative = await resto.agent.post(api('/loyalty/adjustments')).send({
        customerId: client,
        activity: 'RESTAURANT',
        points: -60,
        reason: 'Erreur',
        clientRequestId: randomUUID(),
      });
      expect(negative.body.code).toBe('INSUFFICIENT_POINTS');
      const key = randomUUID();
      const adj = {
        customerId: client,
        activity: 'RESTAURANT',
        points: 25,
        reason: 'Rejeu',
        clientRequestId: key,
      };
      const [x, y] = await Promise.all([
        resto.agent.post(api('/loyalty/adjustments')).send(adj),
        resto.agent.post(api('/loyalty/adjustments')).send(adj),
      ]);
      expect([x.status, y.status]).toEqual([201, 201]);
      expect(x.body.id).toBe(y.body.id);
      expect(await wallet(cashier, client, 'RESTAURANT')).toBe(75);
      // Garde-fou en base : la contrainte CHECK refuse un solde négatif même hors application.
      await expect(
        prisma.loyaltyWallet.updateMany({ where: { customerId: client }, data: { balance: -1 } }),
      ).rejects.toThrow();
      // Corrections réservées : le caissier ne peut pas ajouter de points.
      await cashier
        .post(api('/loyalty/adjustments'))
        .send({ ...adj, clientRequestId: randomUUID() })
        .expect(403);
    });
  });

  describe('planning du personnel', () => {
    let positions: { id: string; name: string; kind: string }[];

    it('14. création du planning et 15. affectation des postes', async () => {
      positions = (await resto.agent.get(api('/planning/positions')).expect(200)).body;
      expect(positions.map((p) => p.name)).toEqual(
        expect.arrayContaining(['Caisse', 'Cuisine', 'Entrée', 'Surveillance', 'Entretien']),
      );
      const bar = (
        await resto.agent
          .post(api('/planning/positions'))
          .send({ name: 'Bar', kind: 'OTHER' })
          .expect(201)
      ).body;
      await resto.agent
        .post(api('/planning/positions'))
        .send({ name: 'Bar', kind: 'OTHER' })
        .expect(409);
      const caisse = positions.find((p) => p.name === 'Caisse')!;
      const staff = (
        await resto.agent.get(api(`/planning/staff?establishmentId=${estR1}`)).expect(200)
      ).body;
      expect(staff.map((s: { membershipId: string }) => s.membershipId)).toContain(cashierId);
      const shift = (
        await supervisor
          .post(api('/planning/assignments'))
          .send({
            establishmentId: estR1,
            membershipId: cashierId,
            positionId: caisse.id,
            startsAt: at(2, 8),
            endsAt: at(2, 16),
          })
          .expect(201)
      ).body;
      expect(shift).toMatchObject({
        position: { name: 'Caisse' },
        employee: { membershipId: cashierId },
      });
      await resto.agent
        .post(api('/planning/assignments'))
        .send({
          establishmentId: estR1,
          membershipId: cashierId,
          positionId: bar.id,
          startsAt: at(3, 18),
          endsAt: at(3, 23),
        })
        .expect(201);
      const week = (
        await supervisor
          .get(
            api(`/planning/assignments?establishmentId=${estR1}&from=${at(1, 0)}&to=${at(8, 0)}`),
          )
          .expect(200)
      ).body;
      expect(week.length).toBeGreaterThanOrEqual(2);
      // Chaque employé voit son propre planning.
      const mine = (
        await cashier.get(api(`/planning/me?from=${at(1, 0)}&to=${at(8, 0)}`)).expect(200)
      ).body;
      expect(mine.map((a: { position: { name: string } }) => a.position.name).sort()).toEqual([
        'Bar',
        'Caisse',
      ]);
      // Modification d'une affectation : changement de poste.
      const moved = (
        await supervisor
          .patch(api(`/planning/assignments/${shift.id}`))
          .send({ positionId: bar.id })
          .expect(200)
      ).body;
      expect(moved.position.name).toBe('Bar');
      await supervisor
        .patch(api(`/planning/assignments/${shift.id}`))
        .send({ positionId: caisse.id })
        .expect(200);
    });

    it('16. détection des conflits horaires (tous établissements), créneaux bout à bout acceptés', async () => {
      const caisse = positions.find((p) => p.name === 'Caisse')!;
      const base = { membershipId: cashierId, positionId: caisse.id };
      const overlap = await supervisor
        .post(api('/planning/assignments'))
        .send({ ...base, establishmentId: estR1, startsAt: at(2, 15), endsAt: at(2, 20) });
      expect(overlap.status).toBe(409);
      expect(overlap.body.code).toBe('STAFF_OVERLAP');
      await supervisor
        .post(api('/planning/assignments'))
        .send({ ...base, establishmentId: estR1, startsAt: at(2, 16), endsAt: at(2, 18) })
        .expect(201);
      // Le propriétaire (vision globale) ne peut pas non plus être planifié deux fois en même temps.
      const owner = (
        await resto.agent.get(api(`/planning/staff?establishmentId=${estR2}`)).expect(200)
      ).body.find((s: { role: string }) => s.role === 'OWNER').membershipId;
      await resto.agent
        .post(api('/planning/assignments'))
        .send({
          membershipId: owner,
          positionId: caisse.id,
          establishmentId: estR1,
          startsAt: at(5, 8),
          endsAt: at(5, 12),
        })
        .expect(201);
      const crossSite = await resto.agent.post(api('/planning/assignments')).send({
        membershipId: owner,
        positionId: caisse.id,
        establishmentId: estR2,
        startsAt: at(5, 10),
        endsAt: at(5, 14),
      });
      expect(crossSite.body.code).toBe('STAFF_OVERLAP');
      // Deux saisies simultanées du même créneau : une seule acceptée.
      const slot = { ...base, establishmentId: estR1, startsAt: at(6, 8), endsAt: at(6, 12) };
      const [a, b] = await Promise.all([
        supervisor.post(api('/planning/assignments')).send(slot),
        resto.agent.post(api('/planning/assignments')).send(slot),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      // Créneaux incohérents.
      await supervisor
        .post(api('/planning/assignments'))
        .send({ ...base, establishmentId: estR1, startsAt: at(7, 12), endsAt: at(7, 10) })
        .expect(400);
      await supervisor
        .post(api('/planning/assignments'))
        .send({ ...base, establishmentId: estR1, startsAt: at(7, 0), endsAt: at(7, 23) })
        .expect(400);
    });

    it('17. RBAC et 18. isolation entre établissements et organisations', async () => {
      const caisse = positions.find((p) => p.name === 'Caisse')!;
      await cashier.get(api('/planning/positions')).expect(403);
      await cashier
        .post(api('/planning/assignments'))
        .send({
          establishmentId: estR1,
          membershipId: cashierId,
          positionId: caisse.id,
          startsAt: at(9, 8),
          endsAt: at(9, 10),
        })
        .expect(403);
      await kitchen.get(api(`/planning/me?from=${at(1, 0)}&to=${at(8, 0)}`)).expect(200);
      await supervisor.get(api(`/kiosk-devices?establishmentId=${estR1}`)).expect(403);
      await supervisor
        .put(api('/loyalty/rules/RESTAURANT'))
        .send({ isActive: false, earnAmountStep: 1000, redeemValue: 10, minRedeemPoints: 100 })
        .expect(403);
      await kitchen.get(api(`/kiosk-devices?establishmentId=${estR1}`)).expect(403);
      // Un superviseur affecté au site principal ne voit ni ne planifie l'annexe.
      await supervisor
        .get(api(`/planning/assignments?establishmentId=${estR2}&from=${at(1, 0)}&to=${at(8, 0)}`))
        .expect(404);
      await supervisor
        .post(api('/planning/assignments'))
        .send({
          establishmentId: estR2,
          membershipId: cashierId,
          positionId: caisse.id,
          startsAt: at(10, 8),
          endsAt: at(10, 10),
        })
        .expect(404);
      // Un employé non affecté à l'annexe ne peut pas y être planifié.
      const notAssigned = await resto.agent.post(api('/planning/assignments')).send({
        establishmentId: estR2,
        membershipId: cashierId,
        positionId: caisse.id,
        startsAt: at(10, 8),
        endsAt: at(10, 10),
      });
      expect(notAssigned.body.code).toBe('EMPLOYEE_NOT_ASSIGNED');
      // Une autre organisation : rien n'est visible ni modifiable.
      const shift = (
        await cashier.get(api(`/planning/me?from=${at(1, 0)}&to=${at(8, 0)}`)).expect(200)
      ).body[0];
      await restoB.agent
        .patch(api(`/planning/assignments/${shift.id}`))
        .send({ notes: 'x' })
        .expect(404);
      await restoB.agent.delete(api(`/planning/assignments/${shift.id}`)).expect(404);
      await restoB.agent
        .post(api('/planning/assignments'))
        .send({
          establishmentId: estB,
          membershipId: cashierId,
          positionId: caisse.id,
          startsAt: at(11, 8),
          endsAt: at(11, 10),
        })
        .expect(404);
      await restoB.agent.get(api(`/planning/staff?establishmentId=${estR1}`)).expect(404);
      // Suppression d'un créneau par un responsable, journalisée.
      await supervisor.delete(api(`/planning/assignments/${shift.id}`)).expect(204);
      expect(
        await prisma.auditLog.count({
          where: { action: 'planning.assignment_deleted', targetId: shift.id },
        }),
      ).toBe(1);
    });
  });
});
