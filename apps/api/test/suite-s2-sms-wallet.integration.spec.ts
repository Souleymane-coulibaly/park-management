import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { SchoolPrismaService } from '../src/modules/school/school-prisma.service';
import {
  SCHOOL_SMS_PROVIDER,
  type SimulatedSmsProvider,
} from '../src/modules/school/school-sms.provider';
import { SchoolSmsService } from '../src/modules/school/school-sms.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { purgeSmsWallets } from './school-sms-support';
import {
  type Agent,
  type InternalAccount,
  PASSWORD,
  RUN,
  cleanup,
  createTestApp,
  email,
  internalAccount,
  login,
} from './helpers';

/**
 * Sprint S2 — portefeuille SMS prépayé Ocall School : demandes de recharge, validation unique par Ocall,
 * réservation atomique avant envoi, consommation ou restitution selon le résultat réel, multipart,
 * international, concurrence, reprise après incident, isolation des établissements. Fournisseur simulé
 * uniquement (aucun SMS réel), bases de test locales jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const schoolSuite =
  (process.env.SCHOOL_TEST_DATABASE_URL ?? process.env.TEST_SCHOOL_DATABASE_URL)
    ? describe
    : describe.skip;

interface Client {
  organizationId: string;
  contractId: string;
  agent: Agent;
  schoolId: string;
}

schoolSuite('Ocall School S2 : portefeuille SMS prépayé (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: SchoolPrismaService;
  let sms: SchoolSmsService;
  let provider: SimulatedSmsProvider;
  let owner: InternalAccount;
  let auditor: InternalAccount;
  let a: Client;
  let b: Client;
  let seq = 0;

  async function client(label: string): Promise<Client> {
    const res = await owner.agent
      .post(api('/platform/contracts/clients'))
      .send({
        organizationName: `Test ${label} ${RUN}`,
        countryCode: 'SN',
        ownerFirstName: 'Aminata',
        ownerLastName: 'Diallo',
        ownerEmail: email(`owner-${label}`),
        reference: `S2-${label}-${RUN}`,
        startsOn: '2026-01-01',
        endsOn: '2099-12-31',
        limits: { tier: 'PAID' },
      })
      .expect(201);
    await owner.agent
      .post(api(`/platform/contracts/${res.body.contract.id}/status`))
      .send({ status: 'ACTIVE', reason: 'Contrat payant fictif' })
      .expect(200);
    const session = await login(app, res.body.loginId, res.body.temporaryPassword);
    await session.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: res.body.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    const schoolId = (
      await session.agent
        .post(api('/school/schools'))
        .send({ name: `Ecole ${label} ${RUN}`, type: 'PRIMARY', countryCode: 'SN' })
        .expect(201)
    ).body.id as string;
    return {
      organizationId: res.body.contract.organizationId,
      contractId: res.body.contract.id,
      agent: session.agent,
      schoolId,
    };
  }

  const wallet = async (c: Client) =>
    (await c.agent.get(api(`/school/sms/wallet?schoolId=${c.schoolId}`)).expect(200)).body as {
      balance: number;
      reserved: number;
      consumed: number;
      included: boolean;
      pendingRequest: { id: string } | null;
    };
  const requestTopUp = (c: Client, credits: number) =>
    c.agent.post(api('/school/sms/top-ups')).send({ schoolId: c.schoolId, credits });
  const queue = (c: Client, phone: string, body: string) =>
    db.schoolSmsMessage.create({
      data: {
        organizationId: c.organizationId,
        schoolId: c.schoolId,
        phone,
        body,
        kind: 'ABSENCE',
        dedupeKey: `s2-${RUN}-${++seq}`,
      },
    });
  const message = (id: string) => db.schoolSmsMessage.findUniqueOrThrow({ where: { id } });
  const ledgerKinds = async (messageId: string) =>
    (
      await db.schoolSmsLedgerEntry.findMany({
        where: { messageId },
        orderBy: { createdAt: 'asc' },
        select: { kind: true },
      })
    ).map((e) => e.kind);
  /** Ajuste le solde disponible de l'établissement à une valeur exacte (correction Ocall tracée). */
  const setBalance = async (c: Client, target: number) => {
    const current = (await wallet(c)).balance;
    if (current === target) return;
    await owner.agent
      .post(api(`/platform/school-sms/wallets/${c.schoolId}/adjustments`))
      .send({
        credits: target - current,
        reason: 'Mise au solde pour un essai',
        idempotencyKey: randomUUID(),
      })
      .expect(200);
  };
  const later = () => new Date(Date.now() + 60_000);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(SchoolPrismaService);
    sms = app.get(SchoolSmsService);
    provider = app.get(SCHOOL_SMS_PROVIDER);
    owner = await internalAccount(app, prisma, `s2sms-owner-${RUN}`, 'PLATFORM_OWNER');
    auditor = await internalAccount(app, prisma, `s2sms-audit-${RUN}`, 'READ_ONLY_AUDITOR');
    a = await client('smsa');
    b = await client('smsb');
  }, 300_000);

  afterAll(async () => {
    try {
      const where = {
        organizationId: { in: [a?.organizationId, b?.organizationId].filter(Boolean) },
      };
      if (db) {
        await db.schoolSmsMessage.deleteMany({ where });
        await purgeSmsWallets(db, where);
        await db.schoolSmsSettings.deleteMany({ where });
        await db.schoolAccessDecision.deleteMany({ where });
        await db.schoolMemberAssignment.deleteMany({ where });
        await db.schoolMember.deleteMany({ where });
        await db.school.deleteMany({ where });
        await db.schoolGroup.deleteMany({ where });
      }
      if (prisma) {
        await prisma.suiteContractEvent.deleteMany({
          where: { contract: { organizationId: { in: where.organizationId.in } } },
        });
        await cleanup(prisma);
      }
    } finally {
      await app?.close();
    }
  });

  describe('recharges', () => {
    it('portefeuille vide au départ ; demande de recharge sans crédit immédiat ; une seule en attente', async () => {
      expect(await wallet(a)).toMatchObject({
        balance: 0,
        reserved: 0,
        consumed: 0,
        included: true,
      });
      const first = await requestTopUp(a, 500).expect(201);
      expect(first.body).toMatchObject({ creditsRequested: 500, status: 'PENDING' });
      // Aucun crédit à la simple demande (paiement hors plateforme, validation Ocall requise).
      expect((await wallet(a)).balance).toBe(0);
      expect((await wallet(a)).pendingRequest).toMatchObject({ id: first.body.id });
      const again = await requestTopUp(a, 200);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('SMS_TOPUP_ALREADY_PENDING');
      // Bornes : trop peu ou montant fourni par le client refusés.
      await a.agent
        .post(api('/school/sms/top-ups'))
        .send({ schoolId: a.schoolId, credits: 1 })
        .expect(400);
      await a.agent
        .post(api('/school/sms/top-ups'))
        .send({ schoolId: a.schoolId, credits: 500, quotedAmountXof: 1 })
        .expect(400);
    });

    it('validation Ocall : crédit unique, même sous validations simultanées ; client prévenu', async () => {
      const pending = (await owner.agent.get(api('/platform/school-sms/top-ups')).expect(200))
        .body as {
        id: string;
        schoolId: string;
        schoolName: string;
        organization: { id: string };
      }[];
      const mine = pending.find((p) => p.schoolId === a.schoolId)!;
      expect(mine.schoolName).toContain('Ecole smsa');
      expect(mine.organization.id).toBe(a.organizationId);
      // Auditeur en lecture seule : validation refusée ; client : aucun accès Super Admin.
      await auditor.agent
        .post(api(`/platform/school-sms/top-ups/${mine.id}/approve`))
        .send({ paymentReference: 'VIR-0001' })
        .expect(403);
      await a.agent.get(api('/platform/school-sms/top-ups')).expect(403);

      const runs = await Promise.all(
        [1, 2, 3, 4].map(() =>
          owner.agent
            .post(api(`/platform/school-sms/top-ups/${mine.id}/approve`))
            .send({ paymentReference: 'VIR-0001', note: 'Note interne de contrôle' }),
        ),
      );
      expect(runs.filter((r) => r.status === 200)).toHaveLength(1);
      for (const r of runs.filter((x) => x.status !== 200)) {
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('SMS_TOPUP_ALREADY_HANDLED');
      }
      expect((await wallet(a)).balance).toBe(500);
      expect(
        await db.schoolSmsLedgerEntry.count({ where: { topUpRequestId: mine.id, kind: 'TOPUP' } }),
      ).toBe(1);
      // Référence de règlement et note internes : jamais dans les réponses de l'établissement.
      const ledger = await a.agent
        .get(api(`/school/sms/ledger?schoolId=${a.schoolId}`))
        .expect(200);
      const topUps = await a.agent
        .get(api(`/school/sms/top-ups?schoolId=${a.schoolId}`))
        .expect(200);
      expect(JSON.stringify(ledger.body)).not.toContain('VIR-0001');
      expect(ledger.body.items[0]).not.toHaveProperty('reason');
      expect(JSON.stringify(topUps.body)).not.toContain('VIR-0001');
      expect(JSON.stringify(topUps.body)).not.toContain('Note interne');
      // Le Super Admin, lui, retrouve la référence.
      const adminLedger = await owner.agent
        .get(api(`/platform/school-sms/wallets/${a.schoolId}/ledger`))
        .expect(200);
      expect(JSON.stringify(adminLedger.body)).toContain('VIR-0001');
      // Refus après validation : impossible.
      await owner.agent
        .post(api(`/platform/school-sms/top-ups/${mine.id}/reject`))
        .send({ note: 'Trop tard' })
        .expect(409);
      expect(
        await prisma.suiteNotification.count({
          where: { organizationId: a.organizationId, kind: 'SMS_TOPUP_APPROVED' },
        }),
      ).toBeGreaterThan(0);
      expect(
        await prisma.auditLog.count({
          where: { action: 'platform.sms_topup_approved', targetId: mine.id },
        }),
      ).toBe(1);
    });

    it('refus motivé : aucun crédit, établissement prévenu ; annulation par l’établissement', async () => {
      const req = (await requestTopUp(a, 300).expect(201)).body;
      await owner.agent
        .post(api(`/platform/school-sms/top-ups/${req.id}/reject`))
        .send({ note: 'Règlement non reçu' })
        .expect(200);
      expect((await wallet(a)).balance).toBe(500);
      const refused = await prisma.suiteNotification.findFirstOrThrow({
        where: { organizationId: a.organizationId, kind: 'SMS_TOPUP_REJECTED' },
      });
      expect(refused.params).toMatchObject({ note: 'Règlement non reçu' });
      const other = (await requestTopUp(a, 100).expect(201)).body;
      // Une autre organisation ne peut pas annuler la demande.
      await b.agent
        .post(api(`/school/sms/top-ups/${other.id}/cancel`))
        .send({ schoolId: a.schoolId })
        .expect(404);
      await a.agent
        .post(api(`/school/sms/top-ups/${other.id}/cancel`))
        .send({ schoolId: a.schoolId })
        .expect(200);
      const history = (
        await a.agent.get(api(`/school/sms/top-ups?schoolId=${a.schoolId}`)).expect(200)
      ).body as { items: { status: string; handlingNote: string | null }[]; nextCursor: null };
      expect(history.items.map((h) => h.status)).toEqual(['CANCELLED', 'REJECTED', 'APPROVED']);
      // Motif visible pour un refus seulement.
      expect(history.items[1]!.handlingNote).toBe('Règlement non reçu');
      expect(history.items[2]!.handlingNote).toBeNull();
      expect(history.nextCursor).toBeNull();
    });

    it('contrats par établissement : l’offre payante d’un établissement ne vaut pas pour un établissement Free', async () => {
      const second = (
        await b.agent
          .post(api('/school/schools'))
          .send({ name: `Ecole smsb2 ${RUN}`, type: 'PRIMARY', countryCode: 'SN' })
          .expect(201)
      ).body.id as string;
      const paid = await prisma.suiteContract.findUniqueOrThrow({ where: { id: b.contractId } });
      // Contrat payant limité au premier établissement, offre gratuite (sans SMS) pour le second.
      await prisma.suiteContract.update({
        where: { id: b.contractId },
        data: { coveredSchoolIds: [b.schoolId] },
      });
      const free = await prisma.suiteContract.create({
        data: {
          organizationId: b.organizationId,
          productId: paid.productId,
          reference: `S2-FREE-${RUN}`,
          status: 'ACTIVE',
          startsOn: new Date('2026-01-01'),
          endsOn: new Date('9999-12-31'),
          modules: [],
          limits: { tier: 'FREE', sms: false },
          coveredSchoolIds: [second],
          createdById: owner.id,
        },
      });
      try {
        const freeSchool = { ...b, schoolId: second };
        const res = await requestTopUp(freeSchool, 500);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('SCHOOL_FREE_SMS_NOT_INCLUDED');
        expect((await wallet(freeSchool)).included).toBe(false);
        expect((await wallet(b)).included).toBe(true);
        // Envoi : un SMS de l'établissement Free est annulé, jamais transmis.
        const m = await queue(freeSchool, '+221 77 600 00 01', 'Etablissement gratuit');
        await sms.processDue(later());
        expect(await message(m.id)).toMatchObject({
          status: 'CANCELLED',
          lastError: 'SMS_NOT_IN_CONTRACT',
        });
        // Demande en attente puis passage à l'offre gratuite : validation refusée.
        const pending = (await requestTopUp(b, 100).expect(201)).body;
        await prisma.suiteContract.update({
          where: { id: b.contractId },
          data: { limits: { tier: 'FREE', sms: false } },
        });
        const approve = await owner.agent
          .post(api(`/platform/school-sms/top-ups/${pending.id}/approve`))
          .send({ paymentReference: 'VIR-0002' });
        expect(approve.status).toBe(409);
        expect(approve.body.code).toBe('SCHOOL_FREE_SMS_NOT_INCLUDED');
        await owner.agent
          .post(api(`/platform/school-sms/top-ups/${pending.id}/reject`))
          .send({ note: 'Offre gratuite' })
          .expect(200);
      } finally {
        await prisma.suiteContractEvent.deleteMany({ where: { contractId: free.id } });
        await prisma.suiteContract.delete({ where: { id: free.id } });
        await prisma.suiteContract.update({
          where: { id: b.contractId },
          data: { coveredSchoolIds: [], limits: paid.limits ?? {} },
        });
        await db.schoolSmsMessage.deleteMany({ where: { schoolId: second } });
      }
    });

    it('contrat suspendu (aucun contrat actif) : SMS non inclus, envoi annulé, recharge non validée', async () => {
      const pending = (await requestTopUp(b, 100).expect(201)).body;
      const m = await queue(b, '+221 77 700 00 01', 'Contrat suspendu');
      await prisma.suiteContract.update({
        where: { id: b.contractId },
        data: { status: 'SUSPENDED' },
      });
      try {
        // Lecture seule : l'établissement reste consultable, sans droit aux SMS.
        expect((await wallet(b)).included).toBe(false);
        await setBalance(b, 10);
        await sms.processDue(later());
        expect(await message(m.id)).toMatchObject({
          status: 'CANCELLED',
          lastError: 'SMS_NOT_IN_CONTRACT',
        });
        const approve = await owner.agent
          .post(api(`/platform/school-sms/top-ups/${pending.id}/approve`))
          .send({ paymentReference: 'VIR-0003' });
        expect(approve.status).toBe(409);
        expect(approve.body.code).toBe('SCHOOL_FREE_SMS_NOT_INCLUDED');
      } finally {
        await prisma.suiteContract.update({
          where: { id: b.contractId },
          data: { status: 'ACTIVE' },
        });
        await setBalance(b, 0);
        await owner.agent
          .post(api(`/platform/school-sms/top-ups/${pending.id}/reject`))
          .send({ note: 'Contrat suspendu' })
          .expect(200);
      }
    });

    it('offre sans SMS (gratuite) : recharge refusée', async () => {
      const contract = await prisma.suiteContract.findUniqueOrThrow({
        where: { id: b.contractId },
      });
      await prisma.suiteContract.update({
        where: { id: b.contractId },
        data: { limits: { tier: 'FREE', sms: false } },
      });
      try {
        const res = await requestTopUp(b, 500);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('SCHOOL_FREE_SMS_NOT_INCLUDED');
        expect((await wallet(b)).included).toBe(false);
      } finally {
        await prisma.suiteContract.update({
          where: { id: b.contractId },
          data: { limits: contract.limits ?? {} },
        });
      }
    });
  });

  describe('consommation', () => {
    it('envoi : crédits réservés puis consommés ; multipart GSM-7 = 2 crédits ; historique sans texte', async () => {
      await setBalance(a, 100);
      const m = await queue(a, '+221 77 100 00 01', 'A'.repeat(200));
      const before = provider.sent.length;
      expect((await sms.processDue(later())).sent).toBeGreaterThanOrEqual(1);
      expect(provider.sent.length).toBe(before + 1);
      expect(await message(m.id)).toMatchObject({
        status: 'SENT',
        segments: 2,
        encoding: 'GSM7',
        international: false,
        creditsReserved: 2,
        creditState: 'CAPTURED',
      });
      expect(await ledgerKinds(m.id)).toEqual(['RESERVE', 'CAPTURE']);
      expect(await wallet(a)).toMatchObject({ balance: 98, reserved: 0, consumed: 2 });
      const history = (
        await a.agent.get(api(`/school/sms/messages?schoolId=${a.schoolId}`)).expect(200)
      ).body.items[0];
      expect(history).toMatchObject({ segments: 2, creditState: 'CAPTURED' });
      expect(history).not.toHaveProperty('body');
      expect(history.phone).not.toContain('100 00');
    });

    it('UCS-2 (arabe) : 70 caractères par segment, 67 au-delà', async () => {
      await setBalance(a, 10);
      const m = await queue(a, '+221 77 100 00 02', 'ب'.repeat(80));
      await sms.processDue(later());
      expect(await message(m.id)).toMatchObject({
        status: 'SENT',
        encoding: 'UCS2',
        segments: 2,
        creditsReserved: 2,
      });
      expect((await wallet(a)).balance).toBe(8);
    });

    it('solde insuffisant : message annulé, jamais transmis, solde inchangé et jamais négatif', async () => {
      await setBalance(a, 1);
      const before = provider.sent.length;
      const m = await queue(a, '+221 77 100 00 03', 'B'.repeat(200));
      await sms.processDue(later());
      expect(await message(m.id)).toMatchObject({
        status: 'CANCELLED',
        lastError: 'SMS_INSUFFICIENT_CREDITS',
        creditState: 'NONE',
        sentAt: null,
      });
      expect(provider.sent.length).toBe(before);
      expect(await wallet(a)).toMatchObject({ balance: 1, reserved: 0 });
    });

    it('envois concurrents : jamais plus de SMS que de crédits, aucun double débit', async () => {
      await setBalance(a, 3);
      const before = provider.sent.length;
      const ids = [];
      for (let i = 0; i < 6; i += 1)
        ids.push((await queue(a, `+221 77 200 00 1${i}`, 'Absence')).id);
      await Promise.all([1, 2, 3].map(() => sms.processDue(later())));
      const rows = await db.schoolSmsMessage.findMany({ where: { id: { in: ids } } });
      expect(rows.filter((r) => r.status === 'SENT')).toHaveLength(3);
      expect(rows.filter((r) => r.lastError === 'SMS_INSUFFICIENT_CREDITS')).toHaveLength(3);
      expect(provider.sent.length).toBe(before + 3);
      expect(await wallet(a)).toMatchObject({ balance: 0, reserved: 0 });
      for (const r of rows.filter((x) => x.status === 'SENT')) {
        expect(await ledgerKinds(r.id)).toEqual(['RESERVE', 'CAPTURE']);
      }
    });

    it('échec définitif du fournisseur : crédits rendus ; échec passager : réservation conservée, débit unique', async () => {
      await setBalance(a, 5);
      const invalid = await queue(a, '+221 77 300 00 00', 'Numéro invalide');
      await sms.processDue(later());
      expect(await message(invalid.id)).toMatchObject({
        status: 'FAILED',
        lastError: 'INVALID_NUMBER',
        creditState: 'RELEASED',
      });
      expect(await ledgerKinds(invalid.id)).toEqual(['RESERVE', 'RELEASE']);
      expect(await wallet(a)).toMatchObject({ balance: 5, reserved: 0 });

      const flaky = await queue(a, '+221 77 300 99 99', 'Fournisseur indisponible');
      const now = Date.now() + 60_000;
      expect((await sms.processDue(new Date(now))).retried).toBe(1);
      expect(await message(flaky.id)).toMatchObject({ status: 'PENDING', creditState: 'RESERVED' });
      expect(await wallet(a)).toMatchObject({ balance: 4, reserved: 1 });
      await sms.processDue(new Date(now + 6 * 60_000));
      await sms.processDue(new Date(now + 20 * 60_000));
      expect(await message(flaky.id)).toMatchObject({ status: 'SENT', creditState: 'CAPTURED' });
      // Trois tentatives, une seule réservation et une seule consommation.
      expect(await ledgerKinds(flaky.id)).toEqual(['RESERVE', 'CAPTURE']);
      expect(await wallet(a)).toMatchObject({ balance: 4, reserved: 0 });
    });

    /** Message réservé puis pris en charge (bail expiré) sans résultat enregistré, ou en échec connu. */
    const interrupted = async (attempts: number, lastError: string) => {
      const m = await queue(
        a,
        `+221 77 400 0${attempts} ${String(++seq).padStart(2, '0')}`,
        'Interrompu',
      );
      await db.$transaction(async (tx) => {
        const w = await tx.schoolSmsWallet.update({
          where: { schoolId: a.schoolId },
          data: { balance: { decrement: 1 }, reserved: { increment: 1 } },
        });
        await tx.schoolSmsLedgerEntry.create({
          data: {
            organizationId: a.organizationId,
            schoolId: a.schoolId,
            kind: 'RESERVE',
            availableDelta: -1,
            reservedDelta: 1,
            balanceAfter: w.balance,
            reservedAfter: w.reserved,
            messageId: m.id,
            idempotencyKey: `reserve:${m.id}`,
          },
        });
        await tx.schoolSmsMessage.update({
          where: { id: m.id },
          data: {
            attempts,
            lastError,
            creditsReserved: 1,
            creditState: 'RESERVED',
            nextAttemptAt: new Date(Date.now() - 1000),
          },
        });
      });
      return m;
    };

    it('reprise après incident : résultat inconnu → jamais renvoyé, crédits consommés ; échec connu → rendus', async () => {
      await setBalance(a, 5);
      // Arrêt brutal entre la prise en charge et l'enregistrement du résultat : le fournisseur a pu
      // accepter le message. Avant la dernière tentative comme à la dernière : aucun renvoi.
      const midway = await interrupted(2, 'SENDING');
      const last = await interrupted(5, 'SENDING');
      // Dernière tentative en échec passager enregistré, puis bail expiré : jamais accepté.
      const known = await interrupted(5, 'PROVIDER_UNAVAILABLE');
      const before = provider.sent.length;
      await sms.processDue(later());
      expect(provider.sent.length).toBe(before);
      for (const id of [midway.id, last.id]) {
        expect(await message(id)).toMatchObject({
          status: 'FAILED',
          lastError: 'OUTCOME_UNKNOWN',
          creditState: 'CAPTURED',
        });
        expect(await ledgerKinds(id)).toEqual(['RESERVE', 'CAPTURE']);
      }
      expect(await message(known.id)).toMatchObject({
        status: 'FAILED',
        lastError: 'ATTEMPTS_EXHAUSTED',
        creditState: 'RELEASED',
      });
      // 5 − 3 réservés, 1 rendu : 3 disponibles, rien en réserve.
      expect(await wallet(a)).toMatchObject({ balance: 3, reserved: 0 });
      // Relancé : rien n'est réglé deux fois.
      await sms.processDue(later());
      expect(await ledgerKinds(known.id)).toEqual(['RESERVE', 'RELEASE']);
      expect(await wallet(a)).toMatchObject({ balance: 3, reserved: 0 });
    });

    it('marqueur de prise en charge : posé pendant l’envoi, effacé une fois le résultat enregistré', async () => {
      await setBalance(a, 2);
      const m = await queue(a, '+221 77 410 00 01', 'Marqueur');
      await sms.processDue(later());
      expect(await message(m.id)).toMatchObject({ status: 'SENT', lastError: null });
    });

    it('international : refusé sans tarif ; facturé selon le tarif versionné une fois fixé par Ocall', async () => {
      await setBalance(a, 20);
      const latest = await db.schoolSmsTariff.findFirst({ orderBy: { version: 'desc' } });
      if (latest?.internationalCreditsPerSegment != null) {
        // Base réutilisée : on repart d'un tarif sans international pour la première partie.
        await owner.agent
          .post(api('/platform/school-sms/tariffs'))
          .send({ note: 'Essai : international fermé' })
          .expect(201);
      }
      const abroad = await queue(a, '+33 6 00 00 00 01', 'Message fictif');
      await sms.processDue(later());
      expect(await message(abroad.id)).toMatchObject({
        status: 'CANCELLED',
        lastError: 'SMS_DESTINATION_NOT_ALLOWED',
        international: true,
      });
      // Tarif : réservé à la gestion des offres ; nouvelle version, historique conservé.
      await auditor.agent
        .post(api('/platform/school-sms/tariffs'))
        .send({ internationalCreditsPerSegment: 3 })
        .expect(403);
      const tariff = (
        await owner.agent
          .post(api('/platform/school-sms/tariffs'))
          .send({
            creditPriceXof: 25,
            providerCostPerSegmentXof: '12.50',
            internationalCreditsPerSegment: 3,
            note: 'Tarif fictif de test',
          })
          .expect(201)
      ).body;
      expect(tariff.version).toBeGreaterThan(latest?.version ?? 0);
      const again = await queue(a, '+33 6 00 00 00 02', 'Message fictif');
      await sms.processDue(later());
      expect(await message(again.id)).toMatchObject({ status: 'SENT', creditsReserved: 3 });
      expect((await wallet(a)).balance).toBe(17);
      // Montant indicatif d'une recharge selon le tarif publié ; coût fournisseur jamais exposé.
      const view = (await a.agent.get(api(`/school/sms/wallet?schoolId=${a.schoolId}`)).expect(200))
        .body;
      expect(view.tariff).toMatchObject({ creditPriceXof: 25, internationalAllowed: true });
      expect(JSON.stringify(view)).not.toContain('12.5');
      const req = (await requestTopUp(a, 200).expect(201)).body;
      expect(req.quotedAmountXof).toBe(5000);
      await a.agent
        .post(api(`/school/sms/top-ups/${req.id}/cancel`))
        .send({ schoolId: a.schoolId })
        .expect(200);
    });
  });

  describe('registre, corrections et isolation', () => {
    it('corrections Ocall : motivées, idempotentes, jamais un solde négatif', async () => {
      await setBalance(a, 10);
      const key = randomUUID();
      const send = () =>
        owner.agent
          .post(api(`/platform/school-sms/wallets/${a.schoolId}/adjustments`))
          .send({ credits: 5, reason: 'Geste commercial fictif', idempotencyKey: key });
      const runs = await Promise.all([send(), send(), send()]);
      for (const r of runs) expect(r.status).toBe(200);
      expect(runs.filter((r) => r.body.status === 'APPLIED')).toHaveLength(1);
      expect((await wallet(a)).balance).toBe(15);
      const negative = await owner.agent
        .post(api(`/platform/school-sms/wallets/${a.schoolId}/adjustments`))
        .send({ credits: -16, reason: 'Retrait trop important', idempotencyKey: randomUUID() });
      expect(negative.status).toBe(409);
      expect(negative.body.code).toBe('SMS_BALANCE_INSUFFICIENT');
      await owner.agent
        .post(api(`/platform/school-sms/wallets/${a.schoolId}/adjustments`))
        .send({ credits: 5, reason: 'court', idempotencyKey: randomUUID() })
        .expect(400);
      expect((await wallet(a)).balance).toBe(15);
      expect(
        await prisma.auditLog.count({
          where: { action: 'platform.sms_wallet_adjusted', targetId: a.schoolId },
        }),
      ).toBeGreaterThan(0);
    });

    it('registre en ajout seul : toute modification est refusée par la base', async () => {
      const entry = await db.schoolSmsLedgerEntry.findFirstOrThrow({
        where: { organizationId: a.organizationId },
      });
      await expect(
        db.schoolSmsLedgerEntry.update({ where: { id: entry.id }, data: { availableDelta: 9999 } }),
      ).rejects.toThrow();
      // Chaque solde du registre se recalcule à partir des écritures.
      const entries = await db.schoolSmsLedgerEntry.findMany({
        where: { schoolId: a.schoolId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const sum = entries.reduce((n, e) => n + e.availableDelta, 0);
      const reserved = entries.reduce((n, e) => n + e.reservedDelta, 0);
      expect(await wallet(a)).toMatchObject({ balance: sum, reserved });
    });

    it('isolation : un établissement d’un autre client est introuvable ; les crédits ne se partagent pas', async () => {
      await b.agent.get(api(`/school/sms/wallet?schoolId=${a.schoolId}`)).expect(404);
      await b.agent.get(api(`/school/sms/ledger?schoolId=${a.schoolId}`)).expect(404);
      await b.agent
        .post(api('/school/sms/top-ups'))
        .send({ schoolId: a.schoolId, credits: 100 })
        .expect(404);
      // L'établissement B, sans crédit, ne consomme jamais ceux de A.
      const balanceA = (await wallet(a)).balance;
      const m = await queue(b, '+221 77 500 00 01', 'Message B');
      await sms.processDue(later());
      expect(await message(m.id)).toMatchObject({
        status: 'CANCELLED',
        lastError: 'SMS_INSUFFICIENT_CREDITS',
      });
      expect((await wallet(a)).balance).toBe(balanceA);
      // Registre Super Admin : écritures de l'établissement demandé seulement.
      const ledger = (
        await owner.agent.get(api(`/platform/school-sms/wallets/${a.schoolId}/ledger`)).expect(200)
      ).body.items as { messageId: string | null }[];
      expect(ledger.length).toBeGreaterThan(0);
      const bMessages = new Set(
        (await db.schoolSmsMessage.findMany({ where: { schoolId: b.schoolId } })).map((x) => x.id),
      );
      expect(ledger.some((e) => e.messageId && bMessages.has(e.messageId))).toBe(false);
      const failures = (await owner.agent.get(api('/platform/school-sms/failures')).expect(200))
        .body as { phone: string; lastError: string }[];
      expect(failures.length).toBeGreaterThan(0);
      for (const f of failures) expect(f.phone).not.toMatch(/77 \d{3}/);
      expect(JSON.stringify(failures)).not.toContain('Message B');
    });
  });
});
