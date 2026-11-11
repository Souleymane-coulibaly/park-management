import type { INestApplication } from '@nestjs/common';
import { purgeFactureOrganizations } from '@ocall/facture-database';
import { FACTURE_PRODUCT_CODE } from '@ocall/shared';
import { MailService } from '../src/common/mail/mail.service';
import { FactureNotificationsService } from '../src/modules/facture/facture-notifications.service';
import { FacturePrismaService } from '../src/modules/facture/facture-prisma.service';
import {
  FACTURE_WHATSAPP_PROVIDER,
  type SimulatedWhatsAppProvider,
} from '../src/modules/facture/facture-whatsapp.provider';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  type Agent,
  PASSWORD,
  RUN,
  type SignedUpOwner,
  cleanup,
  createTestApp,
  login,
  signup,
} from './helpers';

/**
 * Ocall Facture — notifications de rendez-vous F4 : rendez-vous confirmé, reporté, rappelé, annulé ;
 * WhatsApp avec consentement (fournisseur simulé), e-mail en secours (simulé), échecs définitifs et
 * passagers, résultat inconnu jamais renvoyé, rappels obsolètes annulés, envoi concurrent sans doublon,
 * notification figée par la base, rôles, isolation. Données fictives, bases locales jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const enabled = Boolean(process.env.TEST_FACTURE_DATABASE_URL);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

(enabled ? describe : describe.skip)('Ocall Facture F4 — notifications (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: FacturePrismaService;
  let mail: MailService;
  let whatsapp: SimulatedWhatsAppProvider;
  let notifications: FactureNotificationsService;
  let orgA: SignedUpOwner;
  let orgB: SignedUpOwner;
  let planId: string;
  let sales: Agent;
  let tech: { id: string; agent: Agent };

  async function startTrial(organizationId: string) {
    const product = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: FACTURE_PRODUCT_CODE },
    });
    await prisma.productTrial.create({
      data: {
        organizationId,
        productId: product.id,
        startedAt: new Date(),
        endsAt: new Date(Date.now() + 14 * DAY),
        startedByOcall: true,
      },
    });
    await prisma.subscription.create({
      data: { organizationId, productId: product.id, planId, status: 'TRIALING' },
    });
  }

  async function member(role: string) {
    const res = await orgA.agent
      .post(api('/facture/members'))
      .send({ firstName: 'Membre', lastName: role, role })
      .expect(201);
    const session = await login(app, res.body.member.loginId, res.body.temporaryPassword);
    expect(session.status).toBe(200);
    await session.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: res.body.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return { id: res.body.member.id as string, agent: session.agent };
  }

  const settings = (agent: Agent, over: Record<string, unknown> = {}) =>
    agent.put(api('/facture/notification-settings')).send({
      enabled: true,
      sendConfirmation: true,
      reminderDayBefore: true,
      reminderHoursBefore: 2,
      emailFallback: true,
      ...over,
    });

  let clientSeq = 0;
  async function client(over: Record<string, unknown> = {}) {
    clientSeq += 1;
    return (
      await orgA.agent
        .post(api('/facture/clients'))
        .send({
          name: `Client ${clientSeq}`,
          phone: '+223 70 11 22 33',
          email: `client${clientSeq}.${RUN}@test.ocallpark.local`,
          whatsappOptIn: true,
          ...over,
        })
        .expect(201)
    ).body.id as string;
  }

  /** Rendez-vous dans `days` jours à 08:00 (heure du Mali = UTC). */
  const at = (days: number, hour = 8) => {
    const d = new Date(Date.now() + days * DAY);
    return new Date(`${isoDay(d)}T${String(hour).padStart(2, '0')}:00:00Z`);
  };

  async function plan(clientId: string, start = at(3), agent: Agent = orgA.agent) {
    return (
      await agent
        .post(api('/facture/interventions'))
        .send({
          clientId,
          title: 'Entretien climatiseur',
          scheduledStart: start.toISOString(),
          scheduledEnd: new Date(start.getTime() + 2 * HOUR).toISOString(),
          technicianIds: [tech.id],
        })
        .expect(201)
    ).body as { id: string; number: string };
  }

  const rows = (interventionId: string) =>
    db.factureNotification.findMany({
      where: { interventionId },
      orderBy: [{ sendAt: 'asc' }, { createdAt: 'asc' }],
    });
  const sentFor = (number: string) => whatsapp.sent.filter((m) => m.body.includes(number));

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(FacturePrismaService);
    mail = app.get(MailService);
    whatsapp = app.get(FACTURE_WHATSAPP_PROVIDER);
    notifications = app.get(FactureNotificationsService);
    const product = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: FACTURE_PRODUCT_CODE },
    });
    planId = (
      await prisma.subscriptionPlan.create({
        data: {
          productId: product.id,
          name: `Facture F4 test ${RUN}`,
          monthlyPrice: 50_000,
          setupFee: 200_000,
          isActive: false,
        },
      })
    ).id;
    orgA = await signup(app, 'factureF4A', 'PARK');
    orgB = await signup(app, 'factureF4B', 'PARK');
    await startTrial(orgA.organizationId);
    await startTrial(orgB.organizationId);
    for (const [owner, name] of [
      [orgA, 'Froid Services'],
      [orgB, 'Kati Clim'],
    ] as const) {
      await owner.agent
        .put(api('/facture/settings'))
        .send({
          legalName: `${name} ${RUN} SARL`,
          tradeName: name,
          address: 'ACI 2000',
          city: 'Bamako',
          phone: '+223 20 22 00 00',
          email: `contact.${RUN}@test.ocallpark.local`,
          nif: '084123456A',
          taxRegime: 'Régime du réel normal',
          defaultVatRate: 18,
          paymentTermsDays: 30,
        })
        .expect(200);
    }
    // Quatre connexions en tout (inscriptions comprises) : sous la limite du compartiment « auth ».
    tech = await member('TECHNICIAN');
    sales = (await member('SALES')).agent;
  }, 300_000);

  afterAll(async () => {
    try {
      if (db && orgA && orgB) {
        await purgeFactureOrganizations(db, [orgA.organizationId, orgB.organizationId]);
      }
      if (prisma) {
        await cleanup(prisma);
        if (planId) await prisma.subscriptionPlan.deleteMany({ where: { id: planId } });
      }
    } finally {
      await app?.close();
    }
  });

  it('réglages : désactivées par défaut (aucun message), gérant seul, rappels bornés', async () => {
    const initial = (await orgA.agent.get(api('/facture/notification-settings')).expect(200)).body;
    expect(initial).toMatchObject({
      enabled: false,
      reminderHoursBefore: 2,
      whatsappAvailable: true,
      emailAvailable: true,
    });
    const quiet = await plan(await client());
    expect(await rows(quiet.id)).toEqual([]);

    await settings(sales).expect(403);
    await settings(orgA.agent, { reminderHoursBefore: 5 }).expect(400);
    const saved = (await settings(orgA.agent).expect(200)).body;
    expect(saved).toMatchObject({ enabled: true, sendConfirmation: true, emailFallback: true });
    // Consentement daté sur la fiche client, retiré en décochant.
    const id = await client();
    const row = await db.factureClient.findUniqueOrThrow({ where: { id } });
    expect(row.whatsappOptInAt).toBeInstanceOf(Date);
    await orgA.agent
      .patch(api(`/facture/clients/${id}`))
      .send({ whatsappOptIn: false })
      .expect(200);
    expect(
      (await db.factureClient.findUniqueOrThrow({ where: { id } })).whatsappOptInAt,
    ).toBeNull();
  });

  it('rendez-vous confirmé puis rappelé : WhatsApp à l’heure, une seule fois chacun', async () => {
    await settings(orgA.agent).expect(200);
    const start = at(3);
    const i = await plan(await client(), start);
    const planned = await rows(i.id);
    expect(planned.map((n) => [n.kind, n.channel, n.status])).toEqual([
      ['CONFIRMATION', 'WHATSAPP', 'PENDING'],
      ['REMINDER', 'WHATSAPP', 'PENDING'],
      ['REMINDER', 'WHATSAPP', 'PENDING'],
    ]);
    expect(planned[1]!.sendAt).toEqual(new Date(start.getTime() - 24 * HOUR));
    expect(planned[2]!.sendAt).toEqual(new Date(start.getTime() - 2 * HOUR));

    await notifications.processDue(new Date());
    expect(sentFor(i.number)).toHaveLength(1);
    expect(sentFor(i.number)[0]).toMatchObject({
      to: '+223 70 11 22 33',
      template: 'ocall_rdv_confirmation',
    });
    expect(sentFor(i.number)[0]!.body).toContain('Froid Services confirme votre rendez-vous');
    // Rappels : envoyés à leur heure, jamais avant, jamais deux fois.
    await notifications.processDue(new Date(start.getTime() - 25 * HOUR));
    expect(sentFor(i.number)).toHaveLength(1);
    await notifications.processDue(new Date(start.getTime() - 24 * HOUR));
    await notifications.processDue(new Date(start.getTime() - 2 * HOUR));
    await notifications.processDue(new Date(start.getTime() - HOUR));
    expect(sentFor(i.number).map((m) => m.template)).toEqual([
      'ocall_rdv_confirmation',
      'ocall_rdv_rappel',
      'ocall_rdv_rappel',
    ]);
    expect((await rows(i.id)).every((n) => n.status === 'SENT' && n.sentAt)).toBe(true);

    // Historique sur la fiche de l'intervention, numéro masqué.
    const view = (await orgA.agent.get(api(`/facture/interventions/${i.id}`)).expect(200)).body;
    expect(view.notifications).toHaveLength(3);
    expect(view.notifications[0].recipient).toMatch(/^•+2233$/);
    expect(JSON.stringify(view.notifications)).not.toContain('70 11 22 33');
  });

  it('rendez-vous reporté : rappels obsolètes annulés, avis de report, nouveaux rappels', async () => {
    await settings(orgA.agent).expect(200);
    const start = at(3);
    const later = at(4, 10);
    const i = await plan(await client(), start);
    await notifications.processDue(new Date());
    await orgA.agent
      .patch(api(`/facture/interventions/${i.id}`))
      .send({
        scheduledStart: later.toISOString(),
        scheduledEnd: new Date(later.getTime() + HOUR).toISOString(),
      })
      .expect(200);
    const after = await rows(i.id);
    expect(after.filter((n) => n.status === 'CANCELLED').map((n) => [n.kind, n.lastError])).toEqual(
      [
        ['REMINDER', 'RESCHEDULED'],
        ['REMINDER', 'RESCHEDULED'],
      ],
    );
    const pending = after.filter((n) => n.status === 'PENDING');
    expect(pending.map((n) => n.kind)).toEqual(['RESCHEDULED', 'REMINDER', 'REMINDER']);
    expect(pending.every((n) => n.appointmentAt.getTime() === later.getTime())).toBe(true);

    await notifications.processDue(new Date());
    const report = sentFor(i.number).find((m) => m.template === 'ocall_rdv_report')!;
    expect(report.body).toContain('est reporté au');
    expect(report.body).toContain('10:00');
    // Ancienne heure du rappel : rien ; nouvelle : le rappel part.
    await notifications.processDue(new Date(start.getTime() - 2 * HOUR));
    expect(sentFor(i.number).filter((m) => m.template === 'ocall_rdv_rappel')).toHaveLength(0);
    await notifications.processDue(new Date(later.getTime() - 24 * HOUR));
    expect(sentFor(i.number).filter((m) => m.template === 'ocall_rdv_rappel')).toHaveLength(1);

    // Retour au créneau d'origine : les rappels sont programmés de nouveau.
    await orgA.agent
      .patch(api(`/facture/interventions/${i.id}`))
      .send({
        scheduledStart: start.toISOString(),
        scheduledEnd: new Date(start.getTime() + HOUR).toISOString(),
      })
      .expect(200);
    expect(
      (await rows(i.id)).filter((n) => n.status === 'PENDING' && n.kind === 'REMINDER'),
    ).toHaveLength(2);
  });

  it('rendez-vous annulé ou commencé : rappels annulés, avis d’annulation envoyé', async () => {
    await settings(orgA.agent).expect(200);
    const cancelled = await plan(await client());
    await orgA.agent
      .post(api(`/facture/interventions/${cancelled.id}/cancel`))
      .send({ reason: 'Client absent' })
      .expect(200);
    let list = await rows(cancelled.id);
    expect(
      list.filter((n) => n.kind !== 'CANCELLATION').every((n) => n.status === 'CANCELLED'),
    ).toBe(true);
    await notifications.processDue(new Date());
    expect(sentFor(cancelled.number).map((m) => m.template)).toEqual(['ocall_rdv_annulation']);
    expect(sentFor(cancelled.number)[0]!.body).toContain('est annulé');

    const started = await plan(await client());
    await notifications.processDue(new Date());
    await tech.agent.post(api(`/facture/interventions/${started.id}/start`)).expect(200);
    list = await rows(started.id);
    expect(list.filter((n) => n.kind === 'REMINDER').map((n) => [n.status, n.lastError])).toEqual([
      ['CANCELLED', 'INTERVENTION_STARTED'],
      ['CANCELLED', 'INTERVENTION_STARTED'],
    ]);
  });

  it('e-mail en secours ; échec définitif puis secours ; échec passager retenté ; consentement retiré', async () => {
    await settings(orgA.agent).expect(200);
    // Sans consentement WhatsApp : e-mail.
    const byMail = await plan(await client({ whatsappOptIn: false }));
    expect((await rows(byMail.id)).every((n) => n.channel === 'EMAIL')).toBe(true);
    const before = mail.outbox.length;
    await notifications.processDue(new Date());
    const message = mail.outbox.slice(before).find((m) => m.text.includes(byMail.number))!;
    expect(message.subject).toBe('Confirmation de votre rendez-vous — Froid Services');
    expect(message.idempotencyKey).toMatch(/^facture-notification\//);

    // Numéro sans WhatsApp (refus définitif) : échec, puis le même message par e-mail.
    const refused = await plan(await client({ phone: '+223 70 00 00 00' }));
    await notifications.processDue(new Date());
    let list = await rows(refused.id);
    const failed = list.find((n) => n.kind === 'CONFIRMATION' && n.channel === 'WHATSAPP')!;
    expect(failed).toMatchObject({ status: 'FAILED', lastError: 'NOT_ON_WHATSAPP' });
    const fallback = list.find((n) => n.kind === 'CONFIRMATION' && n.channel === 'EMAIL')!;
    expect(fallback.body).toBe(failed.body);
    await notifications.processDue(new Date());
    expect((await rows(refused.id)).find((n) => n.id === fallback.id)!.status).toBe('SENT');

    // Indisponibilité passagère : deux échecs, nouvelles tentatives différées, puis envoi.
    const flaky = await plan(await client({ phone: '+223 70 99 99 99' }));
    const t0 = new Date();
    await notifications.processDue(t0);
    await notifications.processDue(new Date(t0.getTime() + 30_000));
    list = await rows(flaky.id);
    expect(list.find((n) => n.kind === 'CONFIRMATION')).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      lastError: 'PROVIDER_UNAVAILABLE',
    });
    await notifications.processDue(new Date(t0.getTime() + 61_000));
    await notifications.processDue(new Date(t0.getTime() + 7 * 60_000));
    expect((await rows(flaky.id)).find((n) => n.kind === 'CONFIRMATION')).toMatchObject({
      status: 'SENT',
      attempts: 3,
    });

    // Consentement retiré avant le rappel : rappel annulé, jamais envoyé.
    const clientId = await client();
    const start = at(3);
    const withdrawn = await plan(clientId, start);
    await orgA.agent
      .patch(api(`/facture/clients/${clientId}`))
      .send({ whatsappOptIn: false })
      .expect(200);
    await notifications.processDue(new Date(start.getTime() - 24 * HOUR));
    expect(
      (await rows(withdrawn.id)).filter((n) => n.status === 'CANCELLED').map((n) => n.lastError),
    ).toEqual(['CONSENT_WITHDRAWN', 'CONSENT_WITHDRAWN']);
    expect(sentFor(withdrawn.number)).toEqual([]);
  });

  it('résultat inconnu jamais renvoyé ; envois simultanés sans doublon ; notification figée', async () => {
    await settings(orgA.agent).expect(200);
    const i = await plan(await client());
    const confirmation = (await rows(i.id)).find((n) => n.kind === 'CONFIRMATION')!;
    // Processus arrêté entre l'envoi et son enregistrement : bail expiré, marqueur resté.
    await db.factureNotification.update({
      where: { id: confirmation.id },
      data: { attempts: 1, lastError: 'SENDING', nextAttemptAt: new Date(Date.now() - 1_000) },
    });
    await notifications.processDue(new Date());
    expect((await rows(i.id)).find((n) => n.id === confirmation.id)).toMatchObject({
      status: 'UNKNOWN',
      lastError: 'OUTCOME_UNKNOWN',
    });
    expect(sentFor(i.number)).toEqual([]);

    // Deux répartiteurs en même temps : chaque notification part une seule fois.
    const many = await Promise.all([
      plan(await client()),
      plan(await client()),
      plan(await client()),
    ]);
    await Promise.all([
      notifications.processDue(new Date()),
      notifications.processDue(new Date()),
      notifications.processDue(new Date()),
    ]);
    for (const m of many) expect(sentFor(m.number)).toHaveLength(1);

    const sent = (await rows(many[0]!.id)).find((n) => n.status === 'SENT')!;
    await expect(
      db.factureNotification.update({
        where: { id: sent.id },
        data: { status: 'PENDING', sentAt: null },
      }),
    ).rejects.toThrow(/FACTURE_NOTIFICATION_FROZEN/);
    await expect(
      db.factureNotification.update({ where: { id: confirmation.id }, data: { body: 'Autre' } }),
    ).rejects.toThrow(/FACTURE_NOTIFICATION_FROZEN/);
    await expect(db.factureNotification.delete({ where: { id: sent.id } })).rejects.toThrow(
      /FACTURE_NOTIFICATION_FROZEN/,
    );
  });

  it('revérifiées à l’envoi : créneau changé ou notifications désactivées → jamais envoyées', async () => {
    await settings(orgA.agent).expect(200);
    const i = await plan(await client());
    const confirmation = (await rows(i.id)).find((n) => n.kind === 'CONFIRMATION')!;
    // Créneau modifié sans annulation préalable (ex. écriture concurrente) : obsolète à l'envoi.
    await db.factureNotification.create({
      data: {
        organizationId: orgA.organizationId,
        interventionId: i.id,
        kind: 'REMINDER',
        channel: 'WHATSAPP',
        recipient: '+223 70 11 22 33',
        body: `Ancien créneau ${i.number}`,
        appointmentAt: new Date(Date.now() + 9 * DAY),
        sendAt: new Date(Date.now() - 1_000),
        nextAttemptAt: new Date(Date.now() - 1_000),
        dedupeKey: `test/${i.id}/stale`,
      },
    });
    await settings(orgA.agent, { enabled: false }).expect(200);
    await notifications.processDue(new Date());
    const list = await rows(i.id);
    expect(list.find((n) => n.id === confirmation.id)).toMatchObject({
      status: 'CANCELLED',
      lastError: 'NOTIFICATIONS_DISABLED',
    });
    await settings(orgA.agent).expect(200);
    const j = await plan(await client());
    await db.factureNotification.create({
      data: {
        organizationId: orgA.organizationId,
        interventionId: j.id,
        kind: 'REMINDER',
        channel: 'WHATSAPP',
        recipient: '+223 70 11 22 33',
        body: `Ancien créneau ${j.number}`,
        appointmentAt: new Date(Date.now() + 9 * DAY),
        sendAt: new Date(Date.now() - 1_000),
        nextAttemptAt: new Date(Date.now() - 1_000),
        dedupeKey: `test/${j.id}/stale`,
      },
    });
    await notifications.processDue(new Date());
    expect((await rows(j.id)).find((n) => n.dedupeKey.endsWith('/stale'))).toMatchObject({
      status: 'CANCELLED',
      lastError: 'OBSOLETE',
    });
    expect(whatsapp.sent.some((m) => m.body.startsWith('Ancien créneau'))).toBe(false);
  });

  it('audit V1 : envoi en cours jamais « annulé » ; contact corrigé → rappels refaits ; bail près d’expirer', async () => {
    await settings(orgA.agent).expect(200);
    const digits = (v: string) => v.replace(/\D/g, '');

    // Contact corrigé sans changer le créneau : les notifications en attente sont refaites vers le
    // nouveau numéro, sans avis de report ; plus rien ne part vers l'ancien.
    const moved = await plan(await client());
    expect((await rows(moved.id)).filter((n) => n.status === 'PENDING').map((n) => n.kind)).toEqual(
      ['CONFIRMATION', 'REMINDER', 'REMINDER'],
    );
    await orgA.agent
      .patch(api(`/facture/interventions/${moved.id}`))
      .send({ contactName: 'Moussa Diarra', contactPhone: '+223 76 55 44 33' })
      .expect(200);
    let list = await rows(moved.id);
    expect(list.filter((n) => n.status === 'CANCELLED').map((n) => n.lastError)).toEqual([
      'DETAILS_CHANGED',
      'DETAILS_CHANGED',
      'DETAILS_CHANGED',
    ]);
    const redone = list.filter((n) => n.status === 'PENDING');
    expect(redone.map((n) => n.kind)).toEqual(['CONFIRMATION', 'REMINDER', 'REMINDER']);
    expect(redone.every((n) => digits(n.recipient) === '22376554433')).toBe(true);
    expect(redone.every((n) => n.body.includes('Moussa Diarra'))).toBe(true);
    await notifications.processDue(new Date());
    expect(sentFor(moved.number).map((m) => [m.template, digits(m.to)])).toEqual([
      ['ocall_rdv_confirmation', '22376554433'],
    ]);
    // Correction sans effet (mêmes valeurs) : rien n'est refait.
    await orgA.agent
      .patch(api(`/facture/interventions/${moved.id}`))
      .send({ contactName: 'Moussa Diarra' })
      .expect(200);
    expect((await rows(moved.id)).length).toBe(list.length);

    // Notification en cours d'envoi au moment de l'annulation : elle n'est pas marquée « annulée »
    // (elle part peut-être) ; les autres le sont.
    const inFlight = await plan(await client());
    const confirmation = (await rows(inFlight.id)).find((n) => n.kind === 'CONFIRMATION')!;
    await db.factureNotification.update({
      where: { id: confirmation.id },
      data: { attempts: 1, lastError: 'SENDING', nextAttemptAt: new Date(Date.now() + HOUR) },
    });
    await orgA.agent
      .post(api(`/facture/interventions/${inFlight.id}/cancel`))
      .send({ reason: 'Client absent' })
      .expect(200);
    list = await rows(inFlight.id);
    expect(list.find((n) => n.id === confirmation.id)).toMatchObject({
      status: 'PENDING',
      lastError: 'SENDING',
    });
    expect(list.filter((n) => n.kind === 'REMINDER').map((n) => [n.status, n.lastError])).toEqual([
      ['CANCELLED', 'INTERVENTION_CANCELLED'],
      ['CANCELLED', 'INTERVENTION_CANCELLED'],
    ]);
    await db.factureNotification.update({
      where: { id: confirmation.id },
      data: { lastError: null, nextAttemptAt: new Date(Date.now() - 1_000) },
    });
    await notifications.processDue(new Date());

    // Bail près d'expirer (fournisseur lent) : rien n'est envoyé, la notification revient dans la
    // file (tentative comptée), puis part au passage suivant — jamais « résultat inconnu ».
    const slow = await plan(await client());
    const pending = (await rows(slow.id)).find((n) => n.kind === 'CONFIRMATION')!;
    const skipped = await notifications.processDue(new Date(), 20, new Date(0));
    expect(skipped.sent).toBe(0);
    expect(sentFor(slow.number)).toEqual([]);
    expect((await rows(slow.id)).find((n) => n.id === pending.id)).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      lastError: 'NOT_SENT_LEASE',
    });
    await notifications.processDue(new Date());
    expect((await rows(slow.id)).find((n) => n.id === pending.id)).toMatchObject({
      status: 'SENT',
    });
    expect(sentFor(slow.number)).toHaveLength(1);
  });

  it('isolation : réglages et historique propres à chaque organisation', async () => {
    const b = (await orgB.agent.get(api('/facture/notification-settings')).expect(200)).body;
    expect(b.enabled).toBe(false);
    const i = await plan(await client());
    expect((await orgB.agent.get(api(`/facture/interventions/${i.id}`))).status).toBe(404);
    // Le technicien affecté voit l'historique de son intervention.
    const view = (await tech.agent.get(api(`/facture/interventions/${i.id}`)).expect(200)).body;
    expect(view.notifications.length).toBeGreaterThan(0);
  });
});
