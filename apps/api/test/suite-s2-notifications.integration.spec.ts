import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { extendSubscription } from '../src/common/subscription-billing';
import { SuiteRemindersService } from '../src/modules/suite-notifications/suite-reminders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  type InternalAccount,
  type SignedUpOwner,
  RUN,
  cleanup,
  createTestApp,
  internalAccount,
  signup,
} from './helpers';

/**
 * Sprint S2 — notifications du portail Ocall Suite, rappels d'échéance (J-7, J-3, J-1, J), demandes de
 * renouvellement et de changement d'offre, suivi Super Admin. Données fictives, base de test jetable.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;

interface NotificationView {
  id: string;
  kind: string;
  title: string;
  body: string;
  readAt: string | null;
}

describe('Ocall Suite S2 : notifications, échéances et renouvellements (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reminders: SuiteRemindersService;
  let owner: InternalAccount;
  let billing: InternalAccount;
  let auditor: InternalAccount;
  let parkA: SignedUpOwner;
  let parkB: SignedUpOwner;

  const notifications = async (who: SignedUpOwner, unread = false) =>
    (await who.agent.get(api(`/suite/notifications${unread ? '?unread=true' : ''}`)).expect(200))
      .body as { items: NotificationView[]; unread: number; nextCursor: string | null };
  const kinds = async (who: SignedUpOwner) => (await notifications(who)).items.map((n) => n.kind);
  const count = (organizationId: string, kind: string) =>
    prisma.suiteNotification.count({ where: { organizationId, kind: kind as never } });
  const subOf = (organizationId: string) =>
    prisma.subscription.findFirstOrThrow({
      where: { organizationId, product: { code: 'OCALL_PARK' } },
      include: { plan: true },
    });
  const trialOf = (organizationId: string) =>
    prisma.productTrial.findFirstOrThrow({
      where: { organizationId, product: { code: 'OCALL_PARK' } },
    });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    reminders = app.get(SuiteRemindersService);
    owner = await internalAccount(app, prisma, `s2owner-${RUN}`, 'PLATFORM_OWNER');
    billing = await internalAccount(app, prisma, `s2billing-${RUN}`, 'BILLING_MANAGER');
    auditor = await internalAccount(app, prisma, `s2audit-${RUN}`, 'READ_ONLY_AUDITOR');
    parkA = await signup(app, 's2parka', 'PARK');
    parkB = await signup(app, 's2parkb', 'PARK');
  }, 300_000);

  afterAll(async () => {
    try {
      if (prisma) await cleanup(prisma);
    } finally {
      await app?.close();
    }
  });

  describe('centre de notifications', () => {
    it('essai démarré à l’inscription : notifié, non lu, texte lisible ; marquage lu et tout lu', async () => {
      const list = await notifications(parkA);
      expect(list.items.map((n) => n.kind)).toContain('TRIAL_STARTED');
      const started = list.items.find((n) => n.kind === 'TRIAL_STARTED')!;
      expect(started.title).toBe('Essai de Ocall Park démarré');
      expect(started.body).toMatch(/jusqu’au \d{2}\/\d{2}\/\d{4}/);
      expect(started.readAt).toBeNull();
      expect(
        (await parkA.agent.get(api('/suite/notifications/unread-count')).expect(200)).body.unread,
      ).toBe(list.unread);

      await parkA.agent.post(api(`/suite/notifications/${started.id}/read`)).expect(204);
      // Idempotent : une seconde lecture ne change rien.
      await parkA.agent.post(api(`/suite/notifications/${started.id}/read`)).expect(204);
      expect((await notifications(parkA, true)).items.map((n) => n.id)).not.toContain(started.id);
      await parkA.agent.post(api('/suite/notifications/read-all')).expect(204);
      expect((await notifications(parkA)).unread).toBe(0);
    });

    it('isolation : une organisation ne lit ni ne marque les notifications d’une autre', async () => {
      const mine = (await notifications(parkA)).items[0]!;
      expect((await notifications(parkB)).items.map((n) => n.id)).not.toContain(mine.id);
      const res = await parkB.agent.post(api(`/suite/notifications/${mine.id}/read`));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOTIFICATION_NOT_FOUND');
      // Un compte Ocall n'a pas de centre client, et un client n'a pas d'accès Super Admin.
      await parkA.agent.get(api('/platform/suite-notifications')).expect(403);
      await parkA.agent.get(api('/platform/suite-notifications/due-soon')).expect(403);
    });

    it('destinataires : seuls les membres qui voient l’abonnement (un caissier ne reçoit rien)', async () => {
      const cashier = await prisma.user.create({
        data: {
          loginId: `s2cash-${RUN}`.toLowerCase(),
          email: `s2cash-${RUN}@test.ocall.invalid`.toLowerCase(),
          firstName: 'Caisse',
          lastName: 'Test',
          passwordHash: 'x',
          memberships: { create: { organizationId: parkA.organizationId, role: 'CASHIER' } },
        },
      });
      const sub = await subOf(parkA.organizationId);
      await owner.agent
        .post(api(`/platform/subscriptions/${sub.id}/suspend`))
        .send({ reason: 'Essai : impayé fictif' })
        .expect(200);
      expect(await prisma.suiteNotification.count({ where: { userId: cashier.id } })).toBe(0);
      expect(await kinds(parkA)).toContain('SUSPENDED');
      // Motif interne jamais transmis au client.
      const suspended = (await notifications(parkA)).items.find((n) => n.kind === 'SUSPENDED')!;
      expect(suspended.body).not.toContain('impayé fictif');
      await owner.agent
        .post(api(`/platform/subscriptions/${sub.id}/reactivate`))
        .send({ reason: 'Essai : régularisé' })
        .expect(200);
      expect(await kinds(parkA)).toContain('REACTIVATED');
      expect((await subOf(parkA.organizationId)).status).toBe('TRIALING');
    });
  });

  describe('rappels d’échéance', () => {
    it('essai : J-7, J-3, J-1 puis J, une seule fois chacun, même relancé ou en parallèle', async () => {
      const trial = await trialOf(parkA.organizationId);
      const at = (days: number) => new Date(trial.endsAt.getTime() - days * DAY + 60_000);
      expect((await reminders.run(at(8))).status).toBe('SUCCEEDED');
      expect(await count(parkA.organizationId, 'TRIAL_ENDING')).toBe(0);

      await reminders.run(at(7));
      expect(await count(parkA.organizationId, 'TRIAL_ENDING')).toBe(1);
      // Relance au même instant, puis cinq exécutions simultanées : aucun doublon.
      await reminders.run(at(7));
      const parallel = await Promise.all([1, 2, 3, 4, 5].map(() => reminders.run(at(6))));
      expect(parallel.some((r) => r.status === 'SUCCEEDED')).toBe(true);
      for (const r of parallel) expect(['SUCCEEDED', 'SKIPPED_LOCKED']).toContain(r.status);
      expect(await count(parkA.organizationId, 'TRIAL_ENDING')).toBe(1);

      await reminders.run(at(3));
      await reminders.run(at(1));
      expect(await count(parkA.organizationId, 'TRIAL_ENDING')).toBe(3);
      await reminders.run(new Date(trial.endsAt.getTime() + 3_600_000));
      await reminders.run(new Date(trial.endsAt.getTime() + 2 * DAY));
      expect(await count(parkA.organizationId, 'TRIAL_EXPIRED')).toBe(1);

      const texts = (await notifications(parkA)).items.filter((n) => n.kind === 'TRIAL_ENDING');
      expect(texts.map((n) => n.title).sort()).toEqual(
        [
          'Essai de Ocall Park : plus que 1 jour',
          'Essai de Ocall Park : plus que 3 jours',
          'Essai de Ocall Park : plus que 7 jours',
        ].sort(),
      );
      // L'organisation voisine, à une autre échéance, n'est pas mélangée.
      const keys = await prisma.suiteNotification.findMany({
        where: { organizationId: parkB.organizationId, kind: 'TRIAL_ENDING' },
        select: { dedupeKey: true },
      });
      const trialB = await trialOf(parkB.organizationId);
      for (const k of keys) expect(k.dedupeKey).toContain(trialB.id);
    });

    it('rappels sans effet sur l’accès : la lecture seule reste décidée par le serveur', async () => {
      // Un rappel « expiré » n'a rien changé : l'abonnement reste en essai, l'accès est calculé.
      expect((await subOf(parkA.organizationId)).status).toBe('TRIALING');
    });

    it('historique des traitements : exécutions et statistiques visibles du Super Admin', async () => {
      const runs = (
        await billing.agent.get(api('/platform/suite-notifications/job-runs')).expect(200)
      ).body as { job: string; status: string; stats: Record<string, number> | null }[];
      expect(runs.length).toBeGreaterThan(0);
      expect(runs[0]).toMatchObject({ job: 'suite-reminders' });
      expect(runs.every((r) => r.status !== 'RUNNING')).toBe(true);
      // Lancement manuel : gestion des abonnements requise.
      await auditor.agent.post(api('/platform/suite-notifications/run-reminders')).expect(403);
      const manual = await billing.agent
        .post(api('/platform/suite-notifications/run-reminders'))
        .expect(201);
      expect(['SUCCEEDED', 'FAILED', 'SKIPPED_LOCKED']).toContain(manual.body.status);
    });

    it('abonnement payant : activation confirmée, J-3 puis J ; un renouvellement réarme les rappels', async () => {
      const sub = await subOf(parkA.organizationId);
      const today = new Date();
      await prisma.$transaction((tx) =>
        extendSubscription(tx, {
          subscriptionId: sub.id,
          periodStart: today,
          periodEnd: new Date(today.getTime() + 29 * DAY),
          actorUserId: owner.id,
          reason: 'Règlement fictif vérifié',
        }),
      );
      expect(await count(parkA.organizationId, 'ACTIVATION_CONFIRMED')).toBe(1);
      const active = await subOf(parkA.organizationId);
      const end = active.expiresAt!;
      await reminders.run(new Date(end.getTime() - 3 * DAY + 60_000));
      expect(await count(parkA.organizationId, 'SUBSCRIPTION_ENDING')).toBe(1);
      await reminders.run(new Date(end.getTime() + 60_000));
      expect(await count(parkA.organizationId, 'SUBSCRIPTION_EXPIRED')).toBe(1);
      // Essai converti : plus aucun rappel d'essai.
      const trialEnding = await count(parkA.organizationId, 'TRIAL_ENDING');
      await reminders.run(new Date((await trialOf(parkA.organizationId)).endsAt.getTime() - DAY));
      expect(await count(parkA.organizationId, 'TRIAL_ENDING')).toBe(trialEnding);

      // Prolongation : nouvelle échéance → nouveaux rappels (clé = seuil + échéance).
      await prisma.$transaction((tx) =>
        extendSubscription(tx, {
          subscriptionId: sub.id,
          periodStart: new Date(end.getTime()),
          periodEnd: new Date(end.getTime() + 29 * DAY),
          actorUserId: owner.id,
          reason: 'Renouvellement fictif',
        }),
      );
      expect(await count(parkA.organizationId, 'ACTIVATION_CONFIRMED')).toBe(2);
      const renewed = (await subOf(parkA.organizationId)).expiresAt!;
      expect(renewed.getTime()).toBeGreaterThan(end.getTime());
      await reminders.run(new Date(renewed.getTime() - 3 * DAY + 60_000));
      expect(await count(parkA.organizationId, 'SUBSCRIPTION_ENDING')).toBe(2);
    });

    it('échéances Super Admin : contrat listé avec jours restants, filtres application et organisation', async () => {
      const due = (
        await billing.agent
          .get(
            api(
              `/platform/suite-notifications/due-soon?productCode=OCALL_PARK&organizationId=${parkA.organizationId}&days=90`,
            ),
          )
          .expect(200)
      ).body;
      expect(due.subscriptions).toHaveLength(1);
      expect(due.subscriptions[0]).toMatchObject({
        organization: { id: parkA.organizationId },
        product: { code: 'OCALL_PARK' },
        status: 'ACTIVE',
        monthlyPrice: 50000,
      });
      expect(due.subscriptions[0].daysRemaining).toBeGreaterThan(30);
      const other = (
        await billing.agent
          .get(
            api(
              `/platform/suite-notifications/due-soon?productCode=OCALL_SCHOOL&organizationId=${parkA.organizationId}`,
            ),
          )
          .expect(200)
      ).body;
      expect(other.subscriptions).toHaveLength(0);
      // Essai de l'organisation B (non converti) parmi les essais suivis.
      const trials = (
        await billing.agent
          .get(api(`/platform/suite-notifications/due-soon?organizationId=${parkB.organizationId}`))
          .expect(200)
      ).body.trials;
      expect(trials[0]).toMatchObject({ subscriptionStatus: 'TRIALING', expired: false });
      const sent = (
        await billing.agent
          .get(api(`/platform/suite-notifications?organizationId=${parkA.organizationId}`))
          .expect(200)
      ).body as { kind: string; recipients: number }[];
      expect(sent.map((n) => n.kind)).toEqual(
        expect.arrayContaining(['TRIAL_STARTED', 'TRIAL_ENDING', 'SUBSCRIPTION_ENDING']),
      );
      expect(sent.every((n) => n.recipients >= 1)).toBe(true);
    });
  });

  describe('renouvellement et changement d’offre', () => {
    const park = async (who: SignedUpOwner) =>
      (
        (await who.agent.get(api('/suite/overview')).expect(200)).body as {
          code: string;
          requestKinds: string[];
          pendingRequest: { kind: string } | null;
          subscription: { planId: string; monthlyPrice: number; daysRemaining: number | null };
          plans: { id: string; includesShowcase: boolean }[];
        }[]
      ).find((a) => a.code === 'OCALL_PARK')!;

    it('jamais activé : seule l’activation est proposée ; renouvellement refusé', async () => {
      const view = await park(parkB);
      expect(view.requestKinds).toEqual(['ACTIVATION']);
      const res = await parkB.agent
        .post(api('/suite/apps/OCALL_PARK/activation-request'))
        .send({ planId: view.plans[0]!.id, kind: 'RENEWAL' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SUBSCRIPTION_NOT_STARTED');
    });

    it('renouvellement au tarif contractuel figé (tarif historique), une seule demande en attente', async () => {
      const sub = await subOf(parkA.organizationId);
      // Contrat historique conclu à 45 000 : le renouvellement garde ce tarif.
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { agreedMonthlyPrice: 45000 },
      });
      const view = await park(parkA);
      expect(view.requestKinds).toEqual(['RENEWAL', 'PLAN_CHANGE']);
      expect(view.subscription).toMatchObject({ planId: sub.planId, monthlyPrice: 45000 });
      expect(view.subscription.daysRemaining).toBeGreaterThan(0);

      const other = view.plans.find((p) => p.id !== sub.planId)!;
      const mismatch = await parkA.agent
        .post(api('/suite/apps/OCALL_PARK/activation-request'))
        .send({ planId: other.id, kind: 'RENEWAL' });
      expect(mismatch.body.code).toBe('RENEWAL_PLAN_MISMATCH');

      const runs = await Promise.all(
        [1, 2, 3].map(() =>
          parkA.agent
            .post(api('/suite/apps/OCALL_PARK/activation-request'))
            .send({ planId: sub.planId, kind: 'RENEWAL' }),
        ),
      );
      expect(runs.filter((r) => r.status === 201)).toHaveLength(1);
      for (const r of runs.filter((x) => x.status !== 201)) {
        expect(r.body.code).toBe('ACTIVATION_ALREADY_REQUESTED');
      }
      const created = runs.find((r) => r.status === 201)!.body;
      // Devis entier au tarif contractuel (jamais le tarif du jour sur une partie du devis).
      expect(created).toMatchObject({
        kind: 'RENEWAL',
        quote: { monthlyPrice: 45000, recurring: 45000 },
      });
      expect(created.quote.firstPayment).toBe(created.quote.setupFee + 45000);
      expect(await kinds(parkA)).toContain('REQUEST_RECEIVED');
      expect((await park(parkA)).pendingRequest).toMatchObject({ kind: 'RENEWAL' });
      expect((await park(parkA)).requestKinds).toEqual([]);

      const pending = (
        await billing.agent
          .get(
            api(
              `/platform/suite-commercial/activation-requests?kind=RENEWAL&organizationId=${parkA.organizationId}`,
            ),
          )
          .expect(200)
      ).body;
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({ kind: 'RENEWAL', quotedMonthly: 45000 });
      await billing.agent
        .post(api(`/platform/suite-commercial/activation-requests/${created.id}/close`))
        .send({ outcome: 'HANDLED', note: 'Virement interne REF-TEST-001' })
        .expect(200);
      const handled = (await notifications(parkA)).items.find((n) => n.kind === 'REQUEST_HANDLED')!;
      expect(handled.title).toBe('Demande de renouvellement traitée');
      // Référence de règlement interne jamais montrée au client.
      expect(handled.body).not.toContain('REF-TEST');
      const history = (await parkA.agent.get(api('/suite/apps/OCALL_PARK/requests')).expect(200))
        .body;
      expect(history[0]).toMatchObject({ kind: 'RENEWAL', status: 'HANDLED', reason: null });
    });

    it('règles de type : abonnement payé → plus d’activation ; suspendu → aucune demande', async () => {
      const sub = await subOf(parkA.organizationId);
      const activation = await parkA.agent
        .post(api('/suite/apps/OCALL_PARK/activation-request'))
        .send({ planId: sub.planId });
      expect(activation.status).toBe(409);
      expect(activation.body.code).toBe('SUBSCRIPTION_ALREADY_STARTED');
      expect((await park(parkA)).requestKinds).not.toContain('ACTIVATION');
      await owner.agent
        .post(api(`/platform/subscriptions/${sub.id}/suspend`))
        .send({ reason: 'Essai : règles de demande' })
        .expect(200);
      try {
        for (const kind of ['ACTIVATION', 'RENEWAL', undefined]) {
          const res = await parkA.agent
            .post(api('/suite/apps/OCALL_PARK/activation-request'))
            .send({ planId: sub.planId, ...(kind ? { kind } : {}) });
          expect(res.body.code).toBe('SUBSCRIPTION_SUSPENDED');
        }
        const view = await park(parkA);
        expect(view.requestKinds).toEqual([]);
      } finally {
        await owner.agent
          .post(api(`/platform/subscriptions/${sub.id}/reactivate`))
          .send({ reason: 'Essai : fin' })
          .expect(200);
      }
    });

    it('offre historique retirée du catalogue : renouvelable à son tarif contractuel', async () => {
      const sub = await subOf(parkA.organizationId);
      const legacy = await prisma.subscriptionPlan.findFirst({
        where: { isActive: false, product: { code: { in: ['OCALL_PARK', 'OCALL_RESTAURANT'] } } },
      });
      if (!legacy) return; // Catalogue sans offre historique : rien à vérifier.
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { planId: legacy.id, agreedMonthlyPrice: 40000 },
      });
      try {
        const view = await park(parkA);
        expect(view.requestKinds).toContain('RENEWAL');
        expect(view.subscription.planId).toBe(legacy.id);
        const res = await parkA.agent
          .post(api('/suite/apps/OCALL_PARK/activation-request'))
          .send({ planId: legacy.id, kind: 'RENEWAL' })
          .expect(201);
        expect(res.body.quote).toMatchObject({ monthlyPrice: 40000, recurring: 40000 });
        await billing.agent
          .post(api(`/platform/suite-commercial/activation-requests/${res.body.id}/close`))
          .send({ outcome: 'HANDLED', note: 'Renouvellement historique vérifié' })
          .expect(200);
      } finally {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { planId: sub.planId, agreedMonthlyPrice: 45000 },
        });
      }
    });

    it('essai suspendu (jamais payé) : aucune demande proposée ni acceptée', async () => {
      const sub = await subOf(parkB.organizationId);
      expect(sub.status).toBe('TRIALING');
      await owner.agent
        .post(api(`/platform/subscriptions/${sub.id}/suspend`))
        .send({ reason: 'Essai : suspension' })
        .expect(200);
      try {
        const overview = (
          (await parkB.agent.get(api('/suite/overview')).expect(200)).body as {
            code: string;
            requestKinds: string[];
            canRequestActivation: boolean;
          }[]
        ).find((a) => a.code === 'OCALL_PARK')!;
        expect(overview).toMatchObject({ requestKinds: [], canRequestActivation: false });
        const res = await parkB.agent
          .post(api('/suite/apps/OCALL_PARK/activation-request'))
          .send({ planId: sub.planId });
        expect(res.body.code).toBe('SUBSCRIPTION_SUSPENDED');
      } finally {
        await owner.agent
          .post(api(`/platform/subscriptions/${sub.id}/reactivate`))
          .send({ reason: 'Essai : fin' })
          .expect(200);
      }
    });

    it('changement d’offre : autre offre au tarif en vigueur ; refus motivé visible du client', async () => {
      const sub = await subOf(parkA.organizationId);
      const same = await parkA.agent
        .post(api('/suite/apps/OCALL_PARK/activation-request'))
        .send({ planId: sub.planId, kind: 'PLAN_CHANGE' });
      expect(same.body.code).toBe('PLAN_UNCHANGED');
      const view = await park(parkA);
      const target = view.plans.find((p) => p.id !== sub.planId)!;
      const res = await parkA.agent
        .post(api('/suite/apps/OCALL_PARK/activation-request'))
        .send({ planId: target.id, kind: 'PLAN_CHANGE' })
        .expect(201);
      expect(res.body.quote.monthlyPrice).toBe(65000);
      await billing.agent
        .post(api(`/platform/suite-commercial/activation-requests/${res.body.id}/close`))
        .send({ outcome: 'CANCELLED', note: 'Vitrine non disponible ce mois-ci' })
        .expect(200);
      const refused = (await notifications(parkA)).items.find((n) => n.kind === 'REQUEST_REFUSED')!;
      expect(refused.body).toContain('Vitrine non disponible');
      const history = (await parkA.agent.get(api('/suite/apps/OCALL_PARK/requests')).expect(200))
        .body;
      expect(history[0]).toMatchObject({
        kind: 'PLAN_CHANGE',
        status: 'CANCELLED',
        reason: 'Vitrine non disponible ce mois-ci',
      });
      // Historique d'une autre organisation : vide (aucun identifiant accepté du client).
      expect(
        (await parkB.agent.get(api('/suite/apps/OCALL_PARK/requests')).expect(200)).body,
      ).toHaveLength(0);
      // Demande anonyme d'identifiant arbitraire : refusée.
      await parkB.agent.post(api(`/suite/notifications/${randomUUID()}/read`)).expect(404);
    });
  });
});
