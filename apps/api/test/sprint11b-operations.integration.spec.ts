import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  type InternalAccount,
  RUN,
  type SignedUpOwner,
  cleanup,
  createTestApp,
  internalAccount,
  signup,
} from './helpers';

/**
 * Sprint 11B — exploitation Ocall Suite : support (isolation, notes internes, pièces jointes
 * privées), liens temporaires signés, quotas de stockage et d'IA par offre et dérogation,
 * paramètres sans secret, sonde de disponibilité, purge de conservation.
 * Fournisseur IA SIMULÉ, stockage LOCAL temporaire. Exécuté uniquement sur la base de test.
 */
describe('Sprint 11B — support, stockage, quotas, exploitation (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let park: SignedUpOwner;
  let other: SignedUpOwner;
  let estPark: string;
  let owner: InternalAccount;
  let support: InternalAccount;
  let billing: InternalAccount;
  let auditor: InternalAccount;
  let ticketId: string;

  const api = (path: string) => `/api/v1${path}`;
  const PDF = Buffer.from('%PDF-1.4\n% Ocall test\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
  const PNG = (() => {
    const b = Buffer.alloc(64);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    b.set([0, 0, 0x04, 0x00, 0, 0, 0x03, 0x00], 16);
    return b;
  })();

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    park = await signup(app, 's11bpark', 'PARK');
    other = await signup(app, 's11bother', 'RESTAURANT');
    estPark = (await park.agent.get(api('/establishments')).expect(200)).body[0].id;
    owner = await internalAccount(app, prisma, 's11bowner', 'PLATFORM_OWNER');
    support = await internalAccount(app, prisma, 's11bsupport', 'SUPPORT_AGENT');
    billing = await internalAccount(app, prisma, 's11bbilling', 'BILLING_MANAGER');
    auditor = await internalAccount(app, prisma, 's11bauditor', 'READ_ONLY_AUDITOR');
  }, 300_000);

  afterAll(async () => {
    try {
      if (prisma) await cleanup(prisma);
    } finally {
      await app?.close();
    }
  });

  describe('support', () => {
    it('le client crée une demande avec pièce jointe privée ; isolée des autres organisations', async () => {
      const created = (
        await park.agent
          .post(api('/support/tickets'))
          .field('subject', 'Imprimante de caisse muette')
          .field('category', 'HARDWARE')
          .field('priority', 'HIGH')
          .field('establishmentId', estPark)
          .field('body', 'Plus aucun ticket ne sort depuis ce matin.')
          .attach('files', PDF, { filename: '../rapport <1>.pdf', contentType: 'application/pdf' })
          .expect(201)
      ).body;
      ticketId = created.id;
      expect(created.number).toMatch(/^SUP-\d{4}-\d{5}$/);
      expect(created.status).toBe('OPEN');
      expect(created.product.code).toBe('OCALL_PARK');
      const attachment = created.messages[0].attachments[0];
      // Chemin retiré à la réception, caractères dangereux remplacés.
      expect(attachment.name).toBe('rapport _1_.pdf');
      expect(attachment.url).toMatch(/^\/api\/v1\/files\/[\w-]+\.[\w-]+$/);

      const stored = await prisma.storedFile.findFirstOrThrow({ where: { id: attachment.id } });
      expect(stored.storageKey.startsWith(`org/${park.organizationId}/${estPark}/`)).toBe(true);
      expect(stored.storageKey).not.toContain('rapport');

      // Type vérifié par signature : un faux PDF est refusé.
      await park.agent
        .post(api('/support/tickets'))
        .field('subject', 'Test format')
        .field('category', 'OTHER')
        .field('body', 'Pièce jointe invalide envoyée.')
        .attach('files', Buffer.from('<html>'), {
          filename: 'x.pdf',
          contentType: 'application/pdf',
        })
        .expect(400);

      await other.agent.get(api(`/support/tickets/${ticketId}`)).expect(404);
      expect((await other.agent.get(api('/support/tickets')).expect(200)).body).toHaveLength(0);
    });

    it('Ocall répond, ajoute une note interne invisible du client ; statuts suivis', async () => {
      await billing.agent.get(api('/platform/support/tickets')).expect(403);
      const list = (await support.agent.get(api('/platform/support/tickets')).expect(200)).body as {
        id: string;
      }[];
      expect(list.map((t) => t.id)).toContain(ticketId);

      await support.agent
        .post(api(`/platform/support/tickets/${ticketId}/messages`))
        .field('body', 'Note : client prioritaire, vérifier le câble USB.')
        .field('internal', 'true')
        .expect(201);
      const replied = (
        await support.agent
          .post(api(`/platform/support/tickets/${ticketId}/messages`))
          .send({ body: 'Pouvez-vous redémarrer l’imprimante et nous dire ce qui s’affiche ?' })
          .expect(201)
      ).body;
      expect(replied.status).toBe('WAITING_CUSTOMER');
      expect(replied.assignedTo.id).toBe(support.id);
      expect(replied.messages).toHaveLength(3);

      const seen = (await park.agent.get(api(`/support/tickets/${ticketId}`)).expect(200)).body;
      expect(seen.messages).toHaveLength(2);
      expect(JSON.stringify(seen)).not.toContain('câble USB');

      const back = (
        await park.agent
          .post(api(`/support/tickets/${ticketId}/messages`))
          .send({ body: 'Redémarrée : voyant rouge fixe.' })
          .expect(201)
      ).body;
      expect(back.status).toBe('IN_PROGRESS');

      await support.agent
        .patch(api(`/platform/support/tickets/${ticketId}`))
        .send({ status: 'RESOLVED', priority: 'URGENT' })
        .expect(200);
      const audit = await prisma.auditLog.findMany({
        where: { targetId: ticketId },
        select: { action: true },
      });
      expect(audit.map((a) => a.action)).toEqual(
        expect.arrayContaining([
          'support.ticket_created',
          'platform.support_note_added',
          'platform.support_replied',
          'platform.support_updated',
        ]),
      );
    });
  });

  describe('fichiers privés et liens temporaires', () => {
    it('téléchargement par lien signé : pièce jointe, jamais en cache ; accès journalisé', async () => {
      const seen = (await park.agent.get(api(`/support/tickets/${ticketId}`)).expect(200)).body;
      const link = seen.messages[0].attachments[0];
      // Lien utilisable sans session (partageable quelques minutes), jamais mis en cache.
      const res = await request(app.getHttpServer()).get(link.url).expect(200);
      expect(
        Buffer.from(res.body as Buffer)
          .subarray(0, 5)
          .toString(),
      ).toBe('%PDF-');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['content-disposition']).toMatch(/^attachment;/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');

      const [payload, sig] = (link.url as string).replace('/api/v1/files/', '').split('.');
      const forged = Buffer.from(
        JSON.stringify({
          ...JSON.parse(Buffer.from(payload!, 'base64url').toString()),
          o: other.organizationId,
        }),
      ).toString('base64url');
      await request(app.getHttpServer())
        .get(api(`/files/${forged}.${sig}`))
        .expect(404);

      const logged = await prisma.auditLog.count({
        where: { action: 'storage.file_downloaded', targetId: link.id },
      });
      expect(logged).toBe(1);
    });

    it('purge de fin de conservation : objet supprimé, lien refusé, trace conservée', async () => {
      const seen = (await park.agent.get(api(`/support/tickets/${ticketId}`)).expect(200)).body;
      const link = seen.messages[0].attachments[0];
      await prisma.storedFile.update({
        where: { id: link.id },
        data: { retentionUntil: new Date(Date.now() - 1000) },
      });
      await support.agent.post(api('/platform/storage/purge')).expect(403);
      const purged = (await owner.agent.post(api('/platform/storage/purge')).expect(200)).body;
      expect(purged.purged).toBeGreaterThanOrEqual(1);
      await request(app.getHttpServer()).get(link.url).expect(404);
      expect(
        (await prisma.storedFile.findUniqueOrThrow({ where: { id: link.id } })).deletedAt,
      ).not.toBeNull();
    });
  });

  describe('quotas par offre et dérogations', () => {
    it('stockage : quota dépassé → refus (aucun message ni fichier orphelin) ; médias des sites aussi', async () => {
      await support.agent
        .patch(api(`/platform/organizations/${park.organizationId}/quotas`))
        .send({ storageMb: 0 })
        .expect(403);
      const quotas = (
        await owner.agent
          .patch(api(`/platform/organizations/${park.organizationId}/quotas`))
          .send({ storageMb: 0 })
          .expect(200)
      ).body;
      expect(quotas).toMatchObject({ storageMb: 0, storageSource: 'override' });
      const before = await prisma.supportMessage.count({ where: { ticketId } });
      const refused = await park.agent
        .post(api(`/support/tickets/${ticketId}/messages`))
        .field('body', 'Photo du voyant jointe.')
        .attach('files', PNG, { filename: 'voyant.png', contentType: 'image/png' })
        .expect(507);
      expect(refused.body.code).toBe('STORAGE_QUOTA_EXCEEDED');
      expect(await prisma.supportMessage.count({ where: { ticketId } })).toBe(before);

      const site = (
        await park.agent
          .post(api('/sites'))
          .send({ establishmentId: estPark, slug: `s11b-${RUN}` })
          .expect(201)
      ).body;
      await park.agent
        .post(api(`/sites/${site.id}/media`))
        .field('kind', 'COVER')
        .attach('file', PNG, { filename: 'cover.png', contentType: 'image/png' })
        .expect(507);
      expect(await prisma.publicSiteMedia.count({ where: { siteId: site.id } })).toBe(0);

      const storage = (await auditor.agent.get(api('/platform/storage')).expect(200)).body;
      const row = storage.rows.find(
        (r: { organization: { id: string } }) => r.organization.id === park.organizationId,
      );
      expect(row).toMatchObject({ quotaMb: 0, quotaSource: 'override' });
      expect(storage.driver).toBe('local');

      await owner.agent
        .patch(api(`/platform/organizations/${park.organizationId}/quotas`))
        .send({ storageMb: null })
        .expect(200);
    });

    it('IA : plafond Ocall (offre, puis dérogation) — l’organisation ne peut que le restreindre', async () => {
      const plan = await prisma.subscription.findFirstOrThrow({
        where: { organizationId: park.organizationId, product: { code: 'OCALL_PARK' } },
        select: { planId: true, plan: { select: { aiMonthlyCallQuota: true } } },
      });
      const settings = (await park.agent.get(api('/ai/settings')).expect(200)).body;
      expect(settings.platformLimit).toBe(plan.plan.aiMonthlyCallQuota);
      const above = await park.agent
        .put(api('/ai/settings'))
        .send({ monthlyCallLimit: plan.plan.aiMonthlyCallQuota + 1 });
      expect(above.body.code).toBe('AI_LIMIT_ABOVE_PLAN');

      await owner.agent
        .patch(api(`/platform/organizations/${park.organizationId}/quotas`))
        .send({ aiMonthlyCalls: 0 })
        .expect(200);
      const status = (await park.agent.get(api('/ai/status')).expect(200)).body;
      expect(status.usage).toMatchObject({ limit: 0, exceeded: true });
      const ask = await park.agent
        .post(api('/ai/copilot/ask'))
        .send({ establishmentId: estPark, question: 'Combien de billets aujourd’hui ?' })
        .expect(429);
      expect(ask.body.code).toBe('AI_QUOTA_EXCEEDED');

      const usage = (await auditor.agent.get(api('/platform/ai-usage')).expect(200)).body;
      const row = usage.rows.find(
        (r: { organization: { id: string } }) => r.organization.id === park.organizationId,
      );
      expect(row).toMatchObject({ monthQuota: 0, quotaSource: 'override' });
      expect(usage.provider).toBe('simulated');

      // Retour au quota de l'offre, modifiable par le Super Admin.
      await owner.agent
        .patch(api(`/platform/organizations/${park.organizationId}/quotas`))
        .send({ aiMonthlyCalls: null })
        .expect(200);
      await owner.agent
        .patch(api(`/platform/plans/${plan.planId}`))
        .send({ aiMonthlyCallQuota: plan.plan.aiMonthlyCallQuota })
        .expect(200);
      expect((await park.agent.get(api('/ai/status')).expect(200)).body.usage.exceeded).toBe(false);
      const changes = await prisma.auditLog.count({
        where: { action: 'platform.quotas_changed', targetId: park.organizationId },
      });
      expect(changes).toBe(4);
    });
  });

  describe('exploitation', () => {
    it('paramètres en lecture seule, sans aucun secret ; réservés aux rôles autorisés', async () => {
      await billing.agent.get(api('/platform/settings')).expect(403);
      const settings = (await auditor.agent.get(api('/platform/settings')).expect(200)).body;
      expect(settings).toMatchObject({ environment: 'test', storage: { driver: 'local' } });
      const text = JSON.stringify(settings);
      for (const leak of ['postgres', 'secretAccessKey', 'openaiApiKey', 'MFA_ENCRYPTION_KEY']) {
        expect(text).not.toContain(leak);
      }
      await park.agent.get(api('/platform/settings')).expect(403);
    });

    it('sonde de disponibilité : base et stockage vérifiés, sans détail sensible', async () => {
      const ready = (await request(app.getHttpServer()).get(api('/health/ready')).expect(200)).body;
      expect(ready).toMatchObject({
        status: 'ok',
        checks: { database: { ok: true }, storage: { ok: true, driver: 'local' } },
      });
    });
  });
});
