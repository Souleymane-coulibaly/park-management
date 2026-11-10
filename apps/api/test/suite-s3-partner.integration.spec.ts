import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { commissionPayableFrom } from '@ocall/shared';
import { MailService } from '../src/common/mail/mail.service';
import { currentStep, totpCode } from '../src/common/security/totp';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  type Agent,
  type InternalAccount,
  type PartnerAccount,
  PASSWORD,
  RUN,
  agent,
  cleanup,
  createTestApp,
  email,
  internalAccount,
  login,
  partnerAccount,
} from './helpers';

/**
 * Sprint S3 — Ocall Partner : candidature publique, approbation, invitation à usage unique, compte
 * revendeur actif (double authentification), CRM, inscription parrainée, attribution par application
 * (directe, arbitrage), commissions selon une règle validée uniquement (setup une seule fois,
 * mensualités jusqu'à la fin du contrat, règlement fin du mois M+1), demandes de règlement,
 * permissions et isolation. Données fictives, base de test locale jetable.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);

describe('Sprint S3 — Ocall Partner (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: InternalAccount;
  let billing: InternalAccount;
  let billing2: InternalAccount;
  let support: InternalAccount;
  let reseller: { agent: Agent; partnerId: string; code: string; email: string };
  let referrer: PartnerAccount;
  let applicationId: string;
  let invitationToken: string;
  let clientOrgId: string;
  let clientAgent: Agent;

  const application = (over: Record<string, unknown> = {}) => ({
    type: 'RESELLER',
    firstName: 'Fatoumata',
    lastName: `Revendeuse${RUN}`,
    company: `Distrib ${RUN}`,
    email: email('s3candidat'),
    phone: '+223 70 11 22 33',
    country: 'Mali',
    city: 'Bamako',
    experience: 'Dix ans de vente de logiciels aux PME.',
    targetSectors: 'Écoles privées, parcs de loisirs',
    motivation: 'Développer un réseau de distribution Ocall au Mali et au Sénégal.',
    consent: true,
    startedAt: Date.now() - 10_000,
    ...over,
  });
  const submit = (body: Record<string, unknown>) =>
    agent(app).post(api('/public/partners/applications')).send(body);

  // Abonnement Ocall Park (famille) de l'organisation : un abonnement School peut coexister.
  const subscriptionOf = (organizationId: string) =>
    prisma.subscription.findFirstOrThrow({
      where: { organizationId, product: { code: { not: 'OCALL_SCHOOL' } } },
    });
  async function invoice(organizationId: string, lines: Record<string, unknown>[]) {
    const sub = await subscriptionOf(organizationId);
    return (
      await billing.agent
        .post(api('/platform/invoices'))
        .send({ subscriptionId: sub.id, lines, idempotencyKey: randomUUID() })
        .expect(201)
    ).body as { id: string; total: number };
  }
  async function paid(
    organizationId: string,
    inv: { id: string; total: number },
    amount = inv.total,
  ) {
    const p = (
      await billing.agent
        .post(api('/platform/subscription-payments'))
        .send({
          organizationId,
          invoiceId: inv.id,
          amount,
          currency: 'XOF',
          method: 'MANUAL_TRANSFER',
          reference: `VIR-${randomUUID().slice(0, 8)}`,
          paidAt: today(),
          periodStart: '2026-11-01',
          periodEnd: '2026-11-30',
        })
        .expect(201)
    ).body as { id: string };
    await billing2.agent.post(api(`/platform/subscription-payments/${p.id}/confirm`)).expect(200);
    return p.id;
  }
  const commissionsOf = (paymentId: string) =>
    prisma.commission.findMany({
      where: { subscriptionPaymentId: paymentId },
      orderBy: { kind: 'asc' },
    });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    owner = await internalAccount(app, prisma, 's3owner', 'PLATFORM_OWNER');
    billing = await internalAccount(app, prisma, 's3billing', 'BILLING_MANAGER');
    billing2 = await internalAccount(app, prisma, 's3billing2', 'BILLING_MANAGER');
    support = await internalAccount(app, prisma, 's3support', 'SUPPORT_AGENT');
    referrer = await partnerAccount(app, owner.agent, 's3apporteur');
  }, 300_000);

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.partnerApplication.deleteMany({
          where: { emailNormalized: { endsWith: `${RUN}@test.ocallpark.local` } },
        });
        await cleanup(prisma);
      }
    } finally {
      await app?.close();
    }
  });

  describe('candidature publique et invitation', () => {
    it('dépôt public validé ; robots, doublons et adresse connue : même réponse, rien de révélé', async () => {
      expect((await submit(application()).expect(201)).body).toEqual({ received: true });
      const stored = await prisma.partnerApplication.findMany({
        where: { emailNormalized: email('s3candidat') },
      });
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ status: 'PENDING', type: 'RESELLER' });
      applicationId = stored[0]!.id;
      // Doublon en attente, robot (champ piège, remplissage trop rapide) : 201 identique, rien de plus.
      expect((await submit(application()).expect(201)).body).toEqual({ received: true });
      await submit(application({ email: email('s3robot1'), website: 'spam' })).expect(201);
      await submit(application({ email: email('s3robot2'), startedAt: Date.now() })).expect(201);
      expect(
        await prisma.partnerApplication.count({
          where: {
            emailNormalized: { in: [email('s3candidat'), email('s3robot1'), email('s3robot2')] },
          },
        }),
      ).toBe(1);
      // Validation serveur : indicatif obligatoire, consentement obligatoire, champs requis.
      await submit(application({ email: email('s3x1'), phone: '70112233' })).expect(400);
      await submit(application({ email: email('s3x2'), consent: false })).expect(400);
      await submit(application({ email: email('s3x3'), motivation: 'court' })).expect(400);
      await submit({ ...application({ email: email('s3x4') }), role: 'ADMIN' }).expect(400);
      // Journal sans donnée personnelle.
      const log = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'platform.partner_application_received', targetId: applicationId },
      });
      expect(JSON.stringify(log.metadata)).not.toContain('@');
      expect(JSON.stringify(log.metadata)).not.toContain('70 11');
      // Aucun compte créé à la candidature.
      expect(await prisma.user.count({ where: { email: email('s3candidat') } })).toBe(0);
    });

    it('Super Admin : liste paginée, approbation unique avec invitation ; client et support refusés', async () => {
      await support.agent.get(api('/platform/partner-applications')).expect(403);
      const list = (
        await owner.agent
          .get(api(`/platform/partner-applications?status=PENDING&q=Revendeuse${RUN}`))
          .expect(200)
      ).body;
      expect(list).toMatchObject({ total: 1, page: 0 });
      const approvals = await Promise.all(
        [1, 2].map(() =>
          owner.agent.post(api(`/platform/partner-applications/${applicationId}/approve`)).send({}),
        ),
      );
      expect(approvals.filter((r) => r.status === 200)).toHaveLength(1);
      expect(approvals.find((r) => r.status !== 200)!.body.code).toBe('APPLICATION_NOT_PENDING');
      const path: string = approvals.find((r) => r.status === 200)!.body.invitationPath;
      expect(path).toMatch(/^\/activation-partenaire\?token=[A-Za-z0-9_-]{40,}$/);
      invitationToken = path.split('token=')[1]!;
      // Le jeton n'est jamais stocké ni journalisé en clair.
      const stored = await prisma.partnerInvitation.findFirstOrThrow({ where: { applicationId } });
      expect(stored.tokenHash).not.toBe(invitationToken);
      const logs = await prisma.auditLog.findMany({ where: { targetId: applicationId } });
      expect(JSON.stringify(logs)).not.toContain(invitationToken);
      // Nouvelle invitation : l'ancienne est révoquée.
      const again = (
        await owner.agent
          .post(api(`/platform/partner-applications/${applicationId}/reinvite`))
          .expect(200)
      ).body.invitationPath as string;
      const check = await agent(app)
        .post(api('/public/partners/activation/check'))
        .send({ token: invitationToken })
        .expect(200);
      expect(check.body).toMatchObject({ status: 'REVOKED', firstName: null });
      invitationToken = again.split('token=')[1]!;
      const ok = await agent(app)
        .post(api('/public/partners/activation/check'))
        .send({ token: invitationToken })
        .expect(200);
      expect(ok.body).toMatchObject({
        status: 'PENDING',
        firstName: 'Fatoumata',
        type: 'RESELLER',
      });
      expect(ok.body).not.toHaveProperty('email');
    });

    it('création du compte : usage unique (même simultané), partenaire actif, double authentification exigée', async () => {
      await agent(app)
        .post(api('/public/partners/activation'))
        .send({ token: invitationToken, password: 'court' })
        .expect(400);
      const runs = await Promise.all(
        [1, 2, 3].map(() =>
          agent(app)
            .post(api('/public/partners/activation'))
            .send({ token: invitationToken, password: PASSWORD }),
        ),
      );
      expect(runs.filter((r) => r.status === 200)).toHaveLength(1);
      for (const r of runs.filter((x) => x.status !== 200)) {
        expect(r.body.code).toBe('INVALID_PARTNER_INVITATION');
      }
      const partner = await prisma.partner.findFirstOrThrow({ where: { applicationId } });
      expect(partner).toMatchObject({ status: 'ACTIVE', type: 'RESELLER', city: 'Bamako' });
      expect(partner.verifiedAt).not.toBeNull();
      expect(await prisma.partner.count({ where: { applicationId } })).toBe(1);
      // Connexion : double authentification obligatoire avant toute donnée.
      const { agent: a, status } = await login(app, email('s3candidat'), PASSWORD);
      expect(status).toBe(200);
      expect((await a.get(api('/partner/dashboard'))).status).toBe(403);
      const setup = await a.post(api('/auth/mfa/setup')).expect(200);
      await a
        .post(api('/auth/mfa/enable'))
        .send({ code: totpCode(setup.body.secret, currentStep()) })
        .expect(200);
      reseller = {
        agent: a,
        partnerId: partner.id,
        code: partner.code,
        email: email('s3candidat'),
      };
      const profile = (await a.get(api('/partner/profile')).expect(200)).body;
      expect(profile).toMatchObject({
        type: 'RESELLER',
        links: { signup: `/inscription?ref=${partner.code}` },
      });
    });

    it('e-mails (fournisseur simulé) : accusé et alerte au dépôt, rien pour un robot ; invitation au candidat ; refus motivé', async () => {
      const outbox = app.get(MailService).outbox;
      const start = outbox.length;
      const address = email('s3mail');
      await submit(application({ email: address, type: 'REFERRER' })).expect(201);
      await submit(application({ email: email('s3mailrobot'), website: 'spam' })).expect(201);
      // Doublon en attente : même réponse, aucun nouvel e-mail.
      await submit(application({ email: address, type: 'REFERRER' })).expect(201);
      const deposit = outbox.slice(start);
      expect(deposit.map((m) => m.tag).sort()).toEqual([
        'partner-application-alert',
        'partner-application-received',
      ]);
      expect(deposit.find((m) => m.tag === 'partner-application-received')!.to).toEqual([address]);
      const alert = deposit.find((m) => m.tag === 'partner-application-alert')!;
      expect(alert.to).toEqual(['alertes-partenaires@test.ocallpark.local']);
      // L'alerte interne ne recopie ni l'adresse ni le téléphone du candidat.
      expect(alert.text).not.toContain(address);
      expect(alert.text).not.toContain('70 11 22 33');
      expect(alert.text).toContain(
        'https://app.ocall-test.example.com/admin/partenaires/candidatures',
      );

      const stored = await prisma.partnerApplication.findFirstOrThrow({
        where: { emailNormalized: address },
      });
      const approved = (
        await owner.agent
          .post(api(`/platform/partner-applications/${stored.id}/approve`))
          .send({})
          .expect(200)
      ).body;
      expect(approved.emailSent).toBe(true);
      const invitation = outbox.find((m) => m.tag === 'partner-invitation' && m.to[0] === address)!;
      expect(invitation.text).toContain(
        `https://app.ocall-test.example.com${approved.invitationPath}`,
      );
      // Le lien n'apparaît jamais dans le journal d'audit.
      const token = (approved.invitationPath as string).split('token=')[1]!;
      expect(
        JSON.stringify(await prisma.auditLog.findMany({ where: { targetId: stored.id } })),
      ).not.toContain(token);
      // Réinvitation : nouvel e-mail avec le nouveau lien.
      const reinvited = (
        await owner.agent
          .post(api(`/platform/partner-applications/${stored.id}/reinvite`))
          .expect(200)
      ).body;
      expect(reinvited.emailSent).toBe(true);
      expect(outbox.at(-1)!.text).toContain(reinvited.invitationPath);

      const refusedAddress = email('s3mailrefus');
      await submit(application({ email: refusedAddress, type: 'REFERRER' })).expect(201);
      const toRefuse = await prisma.partnerApplication.findFirstOrThrow({
        where: { emailNormalized: refusedAddress },
      });
      const rejected = (
        await owner.agent
          .post(api(`/platform/partner-applications/${toRefuse.id}/reject`))
          .send({ reason: 'Secteur déjà couvert dans votre ville' })
          .expect(200)
      ).body;
      expect(rejected.emailSent).toBe(true);
      const refusal = outbox.at(-1)!;
      expect(refusal).toMatchObject({ tag: 'partner-application-rejected', to: [refusedAddress] });
      expect(refusal.text).toContain('Motif : Secteur déjà couvert dans votre ville');
    });

    it('refus motivé et anonymisation à l’échéance de conservation', async () => {
      await submit(application({ email: email('s3refus'), type: 'REFERRER' })).expect(201);
      const refused = await prisma.partnerApplication.findFirstOrThrow({
        where: { emailNormalized: email('s3refus') },
      });
      await owner.agent
        .post(api(`/platform/partner-applications/${refused.id}/reject`))
        .send({ reason: 'Zone déjà couverte' })
        .expect(200);
      await prisma.partnerApplication.update({
        where: { id: refused.id },
        data: { retentionUntil: new Date(Date.now() - DAY) },
      });
      expect(
        (await owner.agent.post(api('/platform/partner-applications/purge')).expect(200)).body
          .anonymized,
      ).toBeGreaterThanOrEqual(1);
      expect(
        await prisma.partnerApplication.findUniqueOrThrow({ where: { id: refused.id } }),
      ).toMatchObject({
        email: 'anonymise@invalid',
        motivation: '',
      });
      // La candidature devenue partenaire est conservée.
      expect(
        (await prisma.partnerApplication.findUniqueOrThrow({ where: { id: applicationId } }))
          .anonymizedAt,
      ).toBeNull();
    });
  });

  describe('CRM, parrainage et attribution', () => {
    it('pipeline : prospect avec secteur et relance, étapes historisées, recherche et filtres ; isolation', async () => {
      const created = (
        await reseller.agent
          .post(api('/partner/prospects'))
          .send({
            companyName: `École Lumière ${RUN}`,
            contactName: 'Directrice Test',
            phone: '+223 66 55 44 33',
            country: 'Mali',
            city: 'Ségou',
            sector: 'Enseignement privé',
            nextFollowUpAt: new Date(Date.now() - DAY).toISOString().slice(0, 10),
            product: 'ocall-park',
          })
          .expect(201)
      ).body;
      for (const status of ['CONTACTED', 'QUALIFIED', 'PROPOSAL']) {
        await reseller.agent
          .patch(api(`/partner/prospects/${created.id}`))
          .send({ status })
          .expect(200);
      }
      const history = (
        await reseller.agent.get(api(`/partner/prospects/${created.id}/history`)).expect(200)
      ).body as { type: string; toStatus: string | null }[];
      expect(history.map((h) => h.toStatus)).toEqual(['PROPOSAL', 'QUALIFIED', 'CONTACTED', 'NEW']);
      const search = (
        await reseller.agent
          .get(api('/partner/prospects?q=lumi&status=PROPOSAL&followUpDue=true'))
          .expect(200)
      ).body;
      expect(search).toMatchObject({ total: 1 });
      expect(search.items[0]).toMatchObject({ sector: 'Enseignement privé', status: 'PROPOSAL' });
      // « Gagné » relève de l'attribution par Ocall ; l'autre partenaire ne voit ni ne modifie rien.
      await reseller.agent
        .patch(api(`/partner/prospects/${created.id}`))
        .send({ status: 'WON' })
        .expect(400);
      expect(
        (await referrer.agent.get(api('/partner/prospects')).expect(200)).body.items,
      ).toHaveLength(0);
      await referrer.agent
        .patch(api(`/partner/prospects/${created.id}`))
        .send({ notes: 'x' })
        .expect(404);
      await referrer.agent.get(api(`/partner/prospects/${created.id}/history`)).expect(404);
      // Doublon chez un autre partenaire : refusé sans révéler lequel.
      const dup = await referrer.agent.post(api('/partner/prospects')).send({
        companyName: `Ecole Lumiere ${RUN}`,
        contactName: 'Autre',
        phone: '+223 66 55 44 33',
        country: 'Mali',
      });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('PROSPECT_ALREADY_ATTRIBUTED');
      expect(JSON.stringify(dup.body)).not.toContain(reseller.code);
    });

    it('inscription parrainée : attribution « à confirmer », aucun droit avant Ocall ; auto-parrainage ignoré', async () => {
      clientAgent = agent(app);
      const res = await clientAgent
        .post(api('/auth/signup'))
        .send({
          organizationName: `Test s3client ${RUN}`,
          businessType: 'PARK',
          countryCode: 'ML',
          establishmentName: 'Site principal',
          firstName: 'Client',
          lastName: 'Parrainé',
          email: email('s3client'),
          password: PASSWORD,
          ref: reseller.code,
        })
        .expect(201);
      clientOrgId = res.body.organization.id;
      const pending = await prisma.attribution.findFirstOrThrow({
        where: { organizationId: clientOrgId },
        include: { product: true },
      });
      expect(pending).toMatchObject({
        status: 'PENDING',
        source: 'REFERRAL',
        partnerId: reseller.partnerId,
      });
      expect(pending.product?.code).toBe('OCALL_PARK');
      // Avant confirmation : client invisible du revendeur, aucune demande possible.
      expect((await reseller.agent.get(api('/partner/clients')).expect(200)).body).toHaveLength(0);
      const plan = await prisma.subscriptionPlan.findFirstOrThrow({
        where: { product: { code: 'OCALL_PARK' }, isActive: true, includesShowcase: false },
      });
      await reseller.agent
        .post(api('/partner/subscription-requests'))
        .send({
          organizationId: clientOrgId,
          productCode: 'OCALL_PARK',
          kind: 'ACTIVATION',
          planId: plan.id,
        })
        .expect(404);
      // Code d'un partenaire inexistant : ignoré (aucune attribution).
      const other = await agent(app)
        .post(api('/auth/signup'))
        .send({
          organizationName: `Test s3client2 ${RUN}`,
          businessType: 'PARK',
          countryCode: 'ML',
          establishmentName: 'Site',
          firstName: 'Autre',
          lastName: 'Client',
          email: email('s3client2'),
          password: PASSWORD,
          ref: 'ZZZZ9999',
        })
        .expect(201);
      expect(
        await prisma.attribution.count({ where: { organizationId: other.body.organization.id } }),
      ).toBe(0);
    });

    it('confirmation : client visible par application ; revendeur prépare une activation sans pouvoir la confirmer', async () => {
      const pending = await prisma.attribution.findFirstOrThrow({
        where: { organizationId: clientOrgId },
      });
      await owner.agent.post(api(`/platform/attributions/${pending.id}/confirm`)).expect(200);
      const clients = (await reseller.agent.get(api('/partner/clients')).expect(200)).body;
      expect(clients).toHaveLength(1);
      expect(clients[0]).toMatchObject({
        organizationId: clientOrgId,
        product: { code: 'OCALL_PARK' },
        collected: 0,
        commissions: 0,
      });
      expect(clients[0].applications[0]).toMatchObject({
        code: 'OCALL_PARK',
        state: 'TRIAL_ACTIVE',
      });
      expect(clients[0].applications[0]).toHaveProperty('plan');
      const plan = await prisma.subscriptionPlan.findFirstOrThrow({
        where: { product: { code: 'OCALL_PARK' }, isActive: true, includesShowcase: false },
      });
      // L'apporteur ne prépare pas de demande ; le revendeur, oui (le client et Ocall la voient).
      await referrer.agent
        .post(api('/partner/subscription-requests'))
        .send({
          organizationId: clientOrgId,
          productCode: 'OCALL_PARK',
          kind: 'ACTIVATION',
          planId: plan.id,
        })
        .expect(403);
      const req = await reseller.agent
        .post(api('/partner/subscription-requests'))
        .send({
          organizationId: clientOrgId,
          productCode: 'OCALL_PARK',
          kind: 'ACTIVATION',
          planId: plan.id,
        })
        .expect(201);
      expect(
        await prisma.activationRequest.findUniqueOrThrow({ where: { id: req.body.id } }),
      ).toMatchObject({ partnerId: reseller.partnerId, kind: 'ACTIVATION', status: 'PENDING' });
      // Aucune route partenaire pour confirmer un paiement ou clore une demande.
      await reseller.agent
        .post(api(`/platform/suite-commercial/activation-requests/${req.body.id}/close`))
        .send({ outcome: 'HANDLED', note: 'moi-même' })
        .expect(403);
      await billing.agent
        .post(api(`/platform/suite-commercial/activation-requests/${req.body.id}/close`))
        .send({ outcome: 'CANCELLED', note: 'Essai : nettoyage' })
        .expect(200);
    });

    it('arbitrage : application déjà attribuée → conflit ; fin motivée puis attribution directe ; historique conservé', async () => {
      const conflict = await owner.agent.post(api('/platform/attributions/assign')).send({
        organizationId: clientOrgId,
        partnerId: referrer.partnerId,
        productCode: 'OCALL_PARK',
        reason: 'Essai de conflit',
      });
      expect(conflict.status).toBe(409);
      expect(conflict.body.code).toBe('ORGANIZATION_ALREADY_ATTRIBUTED');
      // Autre application de la même organisation : un partenaire différent est possible.
      const school = await owner.agent
        .post(api('/platform/attributions/assign'))
        .send({
          organizationId: clientOrgId,
          partnerId: referrer.partnerId,
          productCode: 'OCALL_SCHOOL',
          reason: 'Client School confié',
        })
        .expect(201);
      expect(school.body.status).toBe('CONFIRMED');
      // Fin de l'attribution Park du revendeur, puis attribution directe à l'apporteur.
      const parkAttr = await prisma.attribution.findFirstOrThrow({
        where: { organizationId: clientOrgId, partnerId: reseller.partnerId, status: 'CONFIRMED' },
      });
      await support.agent
        .post(api(`/platform/attributions/${parkAttr.id}/end`))
        .send({ reason: 'x' })
        .expect(403);
      await owner.agent
        .post(api(`/platform/attributions/${parkAttr.id}/end`))
        .send({ reason: 'Arbitrage test' })
        .expect(200);
      const assigned = await owner.agent
        .post(api('/platform/attributions/assign'))
        .send({
          organizationId: clientOrgId,
          partnerId: reseller.partnerId,
          productCode: 'OCALL_PARK',
          reason: 'Réattribution test',
        })
        .expect(201);
      expect(assigned.body.status).toBe('CONFIRMED');
      expect(
        await prisma.attribution.count({ where: { organizationId: clientOrgId, status: 'ENDED' } }),
      ).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: {
            action: { in: ['platform.attribution_ended', 'platform.attribution_assigned'] },
          },
        }),
      ).toBeGreaterThanOrEqual(3);
      // Attribution antérieure « toutes applications » : bloque toute nouvelle attribution de l'organisation.
      const legacyOrg = await prisma.organization.findFirstOrThrow({
        where: { name: `Test s3client2 ${RUN}` },
      });
      await prisma.attribution.create({
        data: {
          organizationId: legacyOrg.id,
          partnerId: referrer.partnerId,
          source: 'ADMIN',
          status: 'CONFIRMED',
          confirmedAt: new Date(),
        },
      });
      const blocked = await owner.agent.post(api('/platform/attributions/assign')).send({
        organizationId: legacyOrg.id,
        partnerId: reseller.partnerId,
        productCode: 'OCALL_SCHOOL',
        reason: 'Conflit avec l’historique',
      });
      expect(blocked.body.code).toBe('ORGANIZATION_ALREADY_ATTRIBUTED');
    });
  });

  describe('commissions et règlements', () => {
    let resellerRule: string;

    it('barème proposé non validé : aucune commission ; règle revendeur validée par le propriétaire', async () => {
      const inv = await invoice(clientOrgId, [{ kind: 'MONTHLY', months: 1 }]);
      expect(await commissionsOf(await paid(clientOrgId, inv))).toHaveLength(0);
      const rule = (
        await owner.agent
          .post(api('/platform/commission-rules'))
          .send({
            name: `Revendeur ${RUN}`,
            setupRateBps: 1500,
            monthlyRateBps: 1000,
            monthlyWindowMonths: null,
            partnerType: 'RESELLER',
          })
          .expect(201)
      ).body;
      expect(rule).toMatchObject({
        isActive: false,
        monthlyWindowMonths: null,
        partnerType: 'RESELLER',
      });
      resellerRule = rule.id;
      // Règle non validée : toujours aucune commission.
      const inv2 = await invoice(clientOrgId, [{ kind: 'MONTHLY', months: 1 }]);
      expect(await commissionsOf(await paid(clientOrgId, inv2))).toHaveLength(0);
      // Défense en profondeur : une règle active mais jamais validée (donnée incohérente) est ignorée.
      const forged = await prisma.commissionRule.create({
        data: {
          name: `Non validée ${RUN}`,
          setupRateBps: 5000,
          monthlyRateBps: 5000,
          monthlyWindowMonths: null,
          partnerType: 'RESELLER',
          isActive: true,
          createdById: owner.id,
        },
      });
      const inv3 = await invoice(clientOrgId, [{ kind: 'MONTHLY', months: 1 }]);
      expect(await commissionsOf(await paid(clientOrgId, inv3))).toHaveLength(0);
      await prisma.commissionRule.update({ where: { id: forged.id }, data: { isActive: false } });
      await owner.agent
        .post(api(`/platform/commission-rules/${resellerRule}/activate`))
        .expect(200);
    });

    it('setup commissionné une seule fois (même payé en deux fois) ; mensualités sans limite de durée ; règlement fin M+1', async () => {
      const inv = await invoice(clientOrgId, [{ kind: 'SETUP' }, { kind: 'MONTHLY', months: 1 }]);
      expect(inv.total).toBe(250_000);
      // Réglé en deux fois : la prime de setup totale reste 15 % de 200 000.
      const first = await paid(clientOrgId, inv, 125_000);
      const second = await paid(clientOrgId, inv, 125_000);
      const all = [...(await commissionsOf(first)), ...(await commissionsOf(second))];
      const setup = all.filter((c) => c.kind === 'SETUP').reduce((t, c) => t + c.amount, 0);
      const monthly = all.filter((c) => c.kind === 'MONTHLY').reduce((t, c) => t + c.amount, 0);
      expect(setup).toBe(30_000);
      expect(monthly).toBe(5_000);
      for (const c of all) {
        expect(c.payableFrom?.toISOString()).toBe(commissionPayableFrom(new Date()).toISOString());
        expect(c.partnerId).toBe(reseller.partnerId);
      }
      // Setup refacturé (cas exceptionnel simulé) : la prime de setup n'est jamais versée deux fois.
      const sub0 = await subscriptionOf(clientOrgId);
      await prisma.productSetupFee.update({
        where: {
          organizationId_productId: { organizationId: clientOrgId, productId: sub0.productId },
        },
        data: { status: 'DUE', invoiceId: null },
      });
      const again = await invoice(clientOrgId, [{ kind: 'SETUP' }]);
      expect(again.total).toBe(200_000);
      expect(await commissionsOf(await paid(clientOrgId, again))).toHaveLength(0);
      // Mensualités jusqu'à la fin du contrat : même 5 ans après l'activation.
      const sub = await subscriptionOf(clientOrgId);
      const original = sub.startedAt;
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { startedAt: new Date(Date.now() - 5 * 365 * DAY) },
      });
      const later = await invoice(clientOrgId, [{ kind: 'MONTHLY', months: 1 }]);
      expect((await commissionsOf(await paid(clientOrgId, later))).map((c) => c.amount)).toEqual([
        5_000,
      ]);
      await prisma.subscription.update({ where: { id: sub.id }, data: { startedAt: original } });
    });

    it('solde de primes : acquis, en attente de date, payable ; règlement impossible avant la fin du mois M+1', async () => {
      let balance = (await reseller.agent.get(api('/partner/balance')).expect(200)).body;
      expect(balance).toMatchObject({ accrued: 40_000, pending: 0, payable: 0, paid: 0 });
      const ids = (
        await prisma.commission.findMany({
          where: { partnerId: reseller.partnerId, status: 'ACCRUED' },
        })
      ).map((c) => c.id);
      await billing.agent.post(api('/platform/commissions/validate')).send({ ids }).expect(200);
      balance = (await reseller.agent.get(api('/partner/balance')).expect(200)).body;
      expect(balance).toMatchObject({ accrued: 0, pending: 40_000, payable: 0 });
      expect(new Date(balance.nextPayableAt).toISOString()).toBe(
        commissionPayableFrom(new Date()).toISOString(),
      );
      // Demande de règlement : rien de payable encore.
      expect(
        (await reseller.agent.post(api('/partner/payout-requests')).send({}).expect(409)).body.code,
      ).toBe('NOTHING_PAYABLE');
      const early = await billing.agent.post(api('/platform/commission-payouts')).send({
        partnerId: reseller.partnerId,
        commissionIds: ids,
        method: 'Virement',
        paidAt: today(),
      });
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('PAYOUT_COMMISSIONS_NOT_DUE');
      // Fin du mois suivant atteinte (simulée) : payable.
      await prisma.commission.updateMany({
        where: { id: { in: ids } },
        data: { payableFrom: new Date(Date.now() - DAY) },
      });
      balance = (await reseller.agent.get(api('/partner/balance')).expect(200)).body;
      expect(balance).toMatchObject({ pending: 0, payable: 40_000 });
      const dashboard = (await reseller.agent.get(api('/partner/dashboard')).expect(200)).body;
      expect(dashboard.kpis).toMatchObject({
        clients: 1,
        payable: 40_000,
        commissionsEarned: 40_000,
      });
    });

    it('demande de règlement unique, versement à quatre yeux, demande réglée seulement avec un versement confirmé', async () => {
      const requests = await Promise.all(
        [1, 2].map(() =>
          reseller.agent.post(api('/partner/payout-requests')).send({ note: 'Fin de mois' }),
        ),
      );
      expect(requests.filter((r) => r.status === 201)).toHaveLength(1);
      const request = requests.find((r) => r.status === 201)!.body;
      expect(request.amount).toBe(40_000);
      const ids = (
        await prisma.commission.findMany({
          where: { partnerId: reseller.partnerId, status: 'VALIDATED' },
        })
      ).map((c) => c.id);
      const payout = (
        await billing.agent
          .post(api('/platform/commission-payouts'))
          .send({
            partnerId: reseller.partnerId,
            commissionIds: ids,
            method: 'Mobile money',
            reference: `OM-${RUN}`,
            paidAt: today(),
          })
          .expect(201)
      ).body;
      // Pas « réglée » tant que le versement n'est pas confirmé par une autre personne.
      expect(
        (
          await billing.agent
            .post(api(`/platform/partner-payout-requests/${request.id}/decide`))
            .send({ outcome: 'PROCESSED', payoutId: payout.id })
        ).body.code,
      ).toBe('PAYOUT_NOT_CONFIRMED');
      await billing.agent
        .post(api(`/platform/commission-payouts/${payout.id}/confirm`))
        .expect(403);
      await billing2.agent
        .post(api(`/platform/commission-payouts/${payout.id}/confirm`))
        .expect(200);
      await billing.agent
        .post(api(`/platform/partner-payout-requests/${request.id}/decide`))
        .send({ outcome: 'PROCESSED', payoutId: payout.id })
        .expect(200);
      const balance = (await reseller.agent.get(api('/partner/balance')).expect(200)).body;
      expect(balance).toMatchObject({ payable: 0, paid: 40_000 });
      const mine = (await reseller.agent.get(api('/partner/payout-requests')).expect(200)).body;
      expect(mine[0]).toMatchObject({ status: 'PROCESSED', payout: { number: payout.number } });
      // Le partenaire ne valide ni ses commissions ni ses règlements.
      await reseller.agent.post(api('/platform/commissions/validate')).send({ ids }).expect(403);
      await reseller.agent
        .post(api(`/platform/commission-payouts/${payout.id}/confirm`))
        .expect(403);
    });

    it('audit : versement daté du futur refusé ; un versement ne règle qu’une demande ; setup remboursé puis réglé de nouveau : régularisation imputable, prime due une fois', async () => {
      const ahead = new Date(Date.now() + 40 * DAY).toISOString().slice(0, 10);
      const future = await billing.agent.post(api('/platform/commission-payouts')).send({
        partnerId: reseller.partnerId,
        commissionIds: [randomUUID()],
        method: 'Virement',
        paidAt: ahead,
      });
      expect(future.status).toBe(400);
      expect(future.body.code).toBe('PAYOUT_DATE_IN_FUTURE');

      // Ancien versement confirmé : ne peut pas déclarer réglée une nouvelle demande.
      const oldPayout = await prisma.commissionPayout.findFirstOrThrow({
        where: { partnerId: reseller.partnerId, status: 'CONFIRMED' },
      });
      const inv = await invoice(clientOrgId, [{ kind: 'MONTHLY', months: 1 }]);
      const [monthly] = await commissionsOf(await paid(clientOrgId, inv));
      expect(monthly!.amount).toBe(5_000);
      await billing.agent
        .post(api('/platform/commissions/validate'))
        .send({ ids: [monthly!.id] })
        .expect(200);
      await prisma.commission.update({
        where: { id: monthly!.id },
        data: { payableFrom: new Date(Date.now() - DAY) },
      });
      const request = (
        await reseller.agent.post(api('/partner/payout-requests')).send({}).expect(201)
      ).body;
      expect(request.amount).toBe(5_000);
      const reuse = await billing.agent
        .post(api(`/platform/partner-payout-requests/${request.id}/decide`))
        .send({ outcome: 'PROCESSED', payoutId: oldPayout.id });
      expect(reuse.status).toBe(409);
      expect(reuse.body.code).toBe('PAYOUT_NOT_MATCHING_REQUEST');
      const payout = (
        await billing.agent
          .post(api('/platform/commission-payouts'))
          .send({
            partnerId: reseller.partnerId,
            commissionIds: [monthly!.id],
            method: 'Virement',
            paidAt: today(),
          })
          .expect(201)
      ).body;
      await billing2.agent
        .post(api(`/platform/commission-payouts/${payout.id}/confirm`))
        .expect(200);
      await billing.agent
        .post(api(`/platform/partner-payout-requests/${request.id}/decide`))
        .send({ outcome: 'PROCESSED', payoutId: payout.id })
        .expect(200);

      // Le partenaire est prévenu par e-mail du règlement confirmé et de sa demande traitée.
      const sent = app
        .get(MailService)
        .outbox.filter((m) => m.to[0] === reseller.email)
        .map((m) => m.tag);
      expect(sent).toEqual(
        expect.arrayContaining(['partner-payout-confirmed', 'partner-payout-request-decided']),
      );

      // Setup déjà réglé au partenaire puis remboursé au client : régularisation imputable dès
      // maintenant ; la facture rouverte et réglée de nouveau redonne la prime de setup, une fois.
      const setupPaid = await prisma.commission.findFirstOrThrow({
        where: { partnerId: reseller.partnerId, kind: 'SETUP', status: 'PAID' },
        orderBy: { createdAt: 'asc' },
      });
      const first = await prisma.subscriptionPayment.findUniqueOrThrow({
        where: { id: setupPaid.subscriptionPaymentId! },
        select: { id: true, amount: true, invoiceId: true },
      });
      await billing.agent
        .post(api(`/platform/subscription-payments/${first.id}/refund`))
        .send({ reason: 'Remboursement fictif du setup' })
        .expect(200);
      const adjustment = await prisma.commission.findFirstOrThrow({
        where: { subscriptionPaymentId: first.id, kind: 'ADJUSTMENT' },
      });
      expect(adjustment.amount).toBeLessThan(0);
      expect(adjustment.payableFrom!.getTime()).toBeLessThanOrEqual(Date.now());
      const reopened = await prisma.invoice.findUniqueOrThrow({
        where: { id: first.invoiceId! },
        select: { id: true, total: true, status: true },
      });
      expect(reopened.status).toBe('ISSUED');
      const again = await paid(clientOrgId, reopened, first.amount);
      const setupAgain = (await commissionsOf(again)).filter((c) => c.kind === 'SETUP');
      expect(setupAgain.map((c) => c.amount)).toEqual([setupPaid.amount]);
      // Plafond toujours respecté : une seule prime de setup « vivante » au total.
      const live = await prisma.commission.aggregate({
        where: {
          organizationId: clientOrgId,
          kind: 'SETUP',
          status: { not: 'REVERSED' },
          NOT: { subscriptionPayment: { status: 'REFUNDED' } },
        },
        _sum: { amount: true },
      });
      expect(live._sum.amount).toBe(30_000);
    });

    it('collecte d’espèces : seulement les factures de l’application attribuée au partenaire', async () => {
      // Organisation cliente : Ocall Park attribué au revendeur, Ocall School à l'apporteur.
      const school = await prisma.saasProduct.findUniqueOrThrow({
        where: { code: 'OCALL_SCHOOL' },
        select: { id: true, plans: { where: { monthlyPrice: { gt: 0 } }, take: 1 } },
      });
      const schoolSub = await prisma.subscription.create({
        data: { organizationId: clientOrgId, productId: school.id, planId: school.plans[0]!.id },
      });
      const schoolInv = (
        await billing.agent
          .post(api('/platform/invoices'))
          .send({
            subscriptionId: schoolSub.id,
            lines: [{ kind: 'MONTHLY', months: 1 }],
            idempotencyKey: randomUUID(),
          })
          .expect(201)
      ).body as { id: string };
      const parkInv = await invoice(clientOrgId, [{ kind: 'MONTHLY', months: 1 }]);
      await owner.agent
        .patch(api(`/platform/partners/${reseller.partnerId}`))
        .send({ cashCollectionEnabled: true, cashCollectionLimit: 1_000_000 })
        .expect(200);
      const visible = (
        await reseller.agent.get(api('/partner/cash/invoices')).expect(200)
      ).body.map((i: { id: string }) => i.id);
      expect(visible).toContain(parkInv.id);
      expect(visible).not.toContain(schoolInv.id);
      const declared = await reseller.agent.post(api('/partner/cash/collections')).send({
        organizationId: clientOrgId,
        invoiceId: schoolInv.id,
        amount: 1_000,
        currency: 'XOF',
        method: 'CASH',
        receiptReference: `R-${RUN}-S`,
        paidAt: today(),
        periodStart: '2026-11-01',
        periodEnd: '2026-11-30',
      });
      expect(declared.status).toBe(403);
      expect(declared.body.code).toBe('CLIENT_NOT_ATTRIBUTED');
      await owner.agent
        .patch(api(`/platform/partners/${reseller.partnerId}`))
        .send({ cashCollectionEnabled: false })
        .expect(200);
    });

    it('règles : proposition antérieure « toutes applications » → règle figée ; famille Park → règle Ocall Park', async () => {
      const signup = await agent(app)
        .post(api('/auth/signup'))
        .send({
          organizationName: `Test s3resto ${RUN}`,
          businessType: 'RESTAURANT',
          countryCode: 'ML',
          establishmentName: 'Site',
          firstName: 'Resto',
          lastName: 'Client',
          email: email('s3resto'),
          password: PASSWORD,
        })
        .expect(201);
      const orgId = signup.body.organization.id as string;
      const partner = await partnerAccount(app, owner.agent, 's3restop');
      const ruleData = (name: string, monthlyRateBps: number, productId: string | null) => ({
        name: `${name} ${RUN}`,
        setupRateBps: 0,
        monthlyRateBps,
        monthlyWindowMonths: null,
        partnerType: 'REFERRER' as const,
        productId,
        isActive: true,
        validatedAt: new Date(),
        validatedById: owner.id,
        createdById: owner.id,
      });
      // Proposition 12B sans application : la règle validée applicable est figée à la confirmation.
      const general = await prisma.commissionRule.create({
        data: ruleData('Apporteurs toutes applications', 700, null),
      });
      const legacy = await prisma.attribution.create({
        data: { organizationId: orgId, partnerId: partner.partnerId, source: 'ADMIN' },
      });
      await owner.agent.post(api(`/platform/attributions/${legacy.id}/confirm`)).expect(200);
      expect(
        (await prisma.attribution.findUniqueOrThrow({ where: { id: legacy.id } })).ruleId,
      ).toBe(general.id);
      // Famille Park : la règle de l'application Ocall Park s'applique à l'ancienne offre Restaurant.
      await prisma.attribution.update({ where: { id: legacy.id }, data: { ruleId: null } });
      await prisma.commissionRule.update({ where: { id: general.id }, data: { isActive: false } });
      const [park, resto] = await Promise.all(
        ['OCALL_PARK', 'OCALL_RESTAURANT'].map((code) =>
          prisma.saasProduct.findUniqueOrThrow({
            where: { code },
            select: { id: true, plans: { take: 1, orderBy: { createdAt: 'asc' } } },
          }),
        ),
      );
      const parkRule = await prisma.commissionRule.create({
        data: ruleData('Apporteurs Ocall Park', 1234, park!.id),
      });
      const sub = await subscriptionOf(orgId);
      await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          productId: resto!.id,
          planId: resto!.plans[0]!.id,
          status: 'ACTIVE',
          startedAt: new Date(),
        },
      });
      const inv = await invoice(orgId, [{ kind: 'MONTHLY', months: 1 }]);
      const lines = await commissionsOf(await paid(orgId, inv));
      expect(lines.map((c) => [c.kind, c.rateBps])).toEqual([['MONTHLY', 1234]]);
      await prisma.commissionRule.update({ where: { id: parkRule.id }, data: { isActive: false } });
    });

    it('remboursement après règlement : régularisation négative ; isolation des soldes entre partenaires', async () => {
      const inv = await invoice(clientOrgId, [{ kind: 'MONTHLY', months: 1 }]);
      const pay = await paid(clientOrgId, inv);
      expect((await commissionsOf(pay)).map((c) => c.amount)).toEqual([5_000]);
      await billing.agent
        .post(api(`/platform/subscription-payments/${pay}/refund`))
        .send({ reason: 'Erreur de facturation fictive' })
        .expect(200);
      expect((await commissionsOf(pay))[0]!.status).toBe('REVERSED');
      const other = (await referrer.agent.get(api('/partner/balance')).expect(200)).body;
      expect(other).toMatchObject({ accrued: 0, payable: 0, paid: 0 });
      expect(
        (await referrer.agent.get(api('/partner/clients')).expect(200)).body.map(
          (c: { organizationId: string }) => c.organizationId,
        ),
      ).not.toContain(undefined);
    });

    it('profil : coordonnées modifiables, jamais le type ni le statut ; statistiques Super Admin ; résiliation', async () => {
      const updated = await reseller.agent
        .patch(api('/partner/profile'))
        .send({ phone: '+223 70 99 88 77', city: 'Kayes' })
        .expect(200);
      expect(updated.body).toMatchObject({ city: 'Kayes', type: 'RESELLER' });
      await reseller.agent.patch(api('/partner/profile')).send({ type: 'REFERRER' }).expect(400);
      await reseller.agent.patch(api('/partner/profile')).send({ status: 'ACTIVE' }).expect(400);
      const stats = (await owner.agent.get(api('/platform/partner-stats?country=Mali')).expect(200))
        .body;
      expect(stats.partners).toBeGreaterThanOrEqual(2);
      expect(stats.byCountry.find((c: { country: string }) => c.country === 'Mali')).toBeDefined();
      // Résiliation : sessions fermées, connexion refusée, commissions acquises conservées.
      await owner.agent
        .post(api(`/platform/partners/${reseller.partnerId}/terminate`))
        .send({ reason: 'Fin de contrat fictive' })
        .expect(200);
      expect((await reseller.agent.get(api('/partner/dashboard'))).status).toBe(401);
      const relogin = await login(app, reseller.email, PASSWORD);
      expect(relogin.status).toBe(403);
      expect(
        await prisma.commission.count({ where: { partnerId: reseller.partnerId, status: 'PAID' } }),
      ).toBeGreaterThan(0);
      // Plus de nouvelle commission après résiliation.
      const inv = await invoice(clientOrgId, [{ kind: 'MONTHLY', months: 1 }]);
      expect(await commissionsOf(await paid(clientOrgId, inv))).toHaveLength(0);
      await owner.agent
        .post(api(`/platform/partners/${reseller.partnerId}/reactivate`))
        .send({ reason: 'Impossible' })
        .expect(409);
      void clientAgent;
    });
  });
});
