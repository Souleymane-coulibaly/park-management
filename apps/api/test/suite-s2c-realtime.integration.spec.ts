import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
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
import { openSse } from './sse-client';

/**
 * Ocall Suite — Sprint 2C, risque « flux temps réel et anciens onglets » : un flux ouvert avant un
 * changement d'organisation ne reçoit plus aucun évènement de l'ancienne organisation, même entre deux
 * battements. Le battement est volontairement très long ici (10 min) : seul le contrôle fait avant
 * chaque évènement peut fermer le flux. Données fictives, bases jetables.
 */
const api = (path: string) => `/api/v1${path}`;

describe('Ocall Suite S2C — flux temps réel après changement d’organisation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let port: number;
  let resto: SignedUpOwner;
  let other: SignedUpOwner;
  let site: string;
  let variant: string;
  let cashier: Agent;
  const previousHeartbeat = process.env.REALTIME_HEARTBEAT_MS;

  async function employee(role: string) {
    const created = await resto.agent
      .post(api('/employees'))
      .send({ firstName: 'Kadiatou', lastName: role, role, establishmentIds: [site] })
      .expect(201);
    const session = await login(app, created.body.employee.loginId, created.body.temporaryPassword);
    await session.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: created.body.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return { agent: session.agent, loginId: created.body.employee.loginId as string };
  }

  async function cookieOf(identifier: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(api('/auth/login'))
      .send({ identifier, password: PASSWORD })
      .expect(200);
    const raw = res.headers['set-cookie'] as unknown as string[];
    return raw.find((c) => c.startsWith('ocp_session='))!.split(';')[0]!;
  }

  async function sendToKitchen(): Promise<string> {
    const order = (
      await cashier
        .post(api('/orders'))
        .send({
          establishmentId: site,
          channel: 'COUNTER',
          lines: [{ variantId: variant, quantity: 1 }],
        })
        .expect(201)
    ).body as { id: string };
    await cashier.post(api(`/orders/${order.id}/send-to-kitchen`)).expect(200);
    return order.id;
  }

  beforeAll(async () => {
    process.env.REALTIME_HEARTBEAT_MS = '600000';
    ({ app, prisma } = await createTestApp());
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;
    resto = await signup(app, 's2crt', 'RESTAURANT');
    other = await signup(app, 's2crt-b', 'PARK');
    site = (await resto.agent.get(api('/establishments')).expect(200)).body[0].id;
    const category = (
      await resto.agent.post(api('/catalog/categories')).send({ name: 'Plats' }).expect(201)
    ).body.id;
    variant = (
      await resto.agent
        .post(api('/catalog/products'))
        .send({
          name: 'Jus de bissap',
          categoryId: category,
          variants: [{ name: 'Standard', prices: [{ establishmentId: site, price: 1000 }] }],
        })
        .expect(201)
    ).body.variants[0].id;
    cashier = (await employee('CASHIER')).agent;
    await cashier
      .post(api('/cash-sessions'))
      .send({ establishmentId: site, openingFloat: 0 })
      .expect(201);
  });

  afterAll(async () => {
    if (previousHeartbeat === undefined) delete process.env.REALTIME_HEARTBEAT_MS;
    else process.env.REALTIME_HEARTBEAT_MS = previousHeartbeat;
    try {
      if (prisma) await cleanup(prisma);
    } finally {
      await app?.close();
    }
  });

  it('après le changement d’organisation, plus aucun évènement de l’ancienne ; le flux se ferme', async () => {
    const cook = await employee('KITCHEN');
    // La personne accepte une invitation d'une autre organisation.
    await other.agent
      .post(api('/organization/invitations'))
      .send({ identifier: cook.loginId, role: 'ADMIN' })
      .expect(201);
    const cookie = await cookieOf(cook.loginId);
    const [invitation] = (
      await request(app.getHttpServer())
        .get(api('/auth/invitations'))
        .set('Cookie', cookie)
        .expect(200)
    ).body as { id: string }[];
    await request(app.getHttpServer())
      .post(api(`/auth/invitations/${invitation!.id}/accept`))
      .set('Cookie', cookie)
      .expect(200);

    // Flux cuisine ouvert dans l'organisation du restaurant : il reçoit bien les évènements.
    const live = await openSse(port, api(`/kitchen/stream?establishmentId=${site}`), cookie);
    await live.waitFor((m) => m.type === 'ready');
    const before = await sendToKitchen();
    await live.waitFor((m) => m.data.saleId === before);

    // Changement d'organisation avec ce même cookie : la session du flux est révoquée.
    await request(app.getHttpServer())
      .post(api('/auth/switch-organization'))
      .set('Cookie', cookie)
      .send({ organizationId: other.organizationId })
      .expect(200);
    const after = await sendToKitchen();
    await live.waitClosed(5000);
    expect(live.messages.some((m) => m.data.saleId === after)).toBe(false);
    live.close();
  });

  it('un flux ouvert avec une session révoquée est refusé', async () => {
    const cook = await employee('KITCHEN');
    const cookie = await cookieOf(cook.loginId);
    await request(app.getHttpServer()).post(api('/auth/logout')).set('Cookie', cookie).expect(204);
    await expect(
      openSse(port, api(`/kitchen/stream?establishmentId=${site}`), cookie),
    ).rejects.toMatchObject({ status: 401 });
  });
});
