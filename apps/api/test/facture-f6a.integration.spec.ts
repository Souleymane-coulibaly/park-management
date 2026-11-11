import type { INestApplication } from '@nestjs/common';
import { purgeFactureOrganizations } from '@ocall/facture-database';
import { FACTURE_PRODUCT_CODE } from '@ocall/shared';
import { FactureAiUsageStore } from '../src/modules/facture/facture-ai-usage.store';
import { FacturePrismaService } from '../src/modules/facture/facture-prisma.service';
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
 * Ocall Facture — module IA F6A (Ocall AI Core, fournisseur simulé, aucun appel payant) : rapport
 * d'intervention intelligent (saisi ou dicté, données réelles, validation du technicien avant la fin des
 * travaux) et devis intelligent (catalogue et prix réels, informations manquantes, brouillon jamais
 * émis) ; réglages et quotas sous le plafond Ocall ; traçabilité ; sécurité (chiffres inventés, injection,
 * références inconnues, prix imposés par le modèle, autre organisation, rôles). Données fictives.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const enabled = Boolean(process.env.TEST_FACTURE_DATABASE_URL);
const TOMORROW = new Date(Date.now() + DAY).toISOString().slice(0, 10);
/** Enregistrement « webm » simulé : la transcription simulée lit le texte après le marqueur. */
const audio = (text: string) =>
  Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from(`OCALL-SIM:${text}:FIN`)]);

(enabled ? describe : describe.skip)('Ocall Facture F6A — module IA (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: FacturePrismaService;
  let orgA: SignedUpOwner;
  let orgB: SignedUpOwner;
  let planId: string;
  let clientA: string;
  let clientB: string;
  let partItem: string;
  let tech: { id: string; agent: Agent };
  let sales: Agent;

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

  const aiSettings = (agent: Agent, over: Record<string, unknown> = {}) =>
    agent.put(api('/facture/ai/settings')).send({
      enabled: true,
      reportEnabled: true,
      quoteEnabled: true,
      reportMonthlyLimit: 100,
      quoteMonthlyLimit: 100,
      ...over,
    });

  /** Intervention démarrée par le technicien : 90 min et 2 filtres saisis. */
  async function started(technicianIds: string[] = [tech.id]) {
    const id = (
      await orgA.agent
        .post(api('/facture/interventions'))
        .send({
          clientId: clientA,
          title: 'Climatiseur en panne',
          scheduledStart: `${TOMORROW}T08:00:00Z`,
          scheduledEnd: `${TOMORROW}T10:00:00Z`,
          technicianIds,
        })
        .expect(201)
    ).body.id as string;
    if (technicianIds.includes(tech.id)) {
      await tech.agent.post(api(`/facture/interventions/${id}/start`)).expect(200);
      await tech.agent
        .post(api(`/facture/interventions/${id}/time`))
        .send({ workDate: new Date().toISOString().slice(0, 10), minutes: 90 })
        .expect(201);
      await tech.agent
        .post(api(`/facture/interventions/${id}/parts`))
        .send({ itemId: partItem, quantity: 2 })
        .expect(201);
    }
    return id;
  }

  const report = (agent: Agent, id: string, observations: string) =>
    agent.post(api(`/facture/interventions/${id}/ai/report`)).field('observations', observations);

  const quote = (agent: Agent, request: string, clientId = clientA) =>
    agent.post(api('/facture/ai/quote')).send({ clientId, request });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(FacturePrismaService);
    const product = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: FACTURE_PRODUCT_CODE },
    });
    planId = (
      await prisma.subscriptionPlan.create({
        data: {
          productId: product.id,
          name: `Facture F6A test ${RUN}`,
          monthlyPrice: 50_000,
          setupFee: 200_000,
          isActive: false,
        },
      })
    ).id;
    orgA = await signup(app, 'factureF6A', 'PARK');
    orgB = await signup(app, 'factureF6B', 'PARK');
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
          nif: '084123456A',
          taxRegime: 'Régime du réel normal',
          defaultVatRate: 18,
          paymentTermsDays: 30,
        })
        .expect(200);
    }
    clientA = (
      await orgA.agent.post(api('/facture/clients')).send({ name: 'Hôtel du Fleuve' }).expect(201)
    ).body.id;
    clientB = (
      await orgB.agent.post(api('/facture/clients')).send({ name: 'Clinique Lumière' }).expect(201)
    ).body.id;
    const item = async (kind: string, name: string, unitPrice: number) =>
      (
        await orgA.agent
          .post(api('/facture/items'))
          .send({ kind, name, unit: 'unité', unitPrice, vatRate: 18 })
          .expect(201)
      ).body.id as string;
    // Ordre alphabétique : i1 Déplacement, i2 Filtre, i3 Recharge.
    await item('SERVICE', 'Déplacement technicien', 10_000);
    partItem = await item('PRODUCT', 'Filtre à air', 25_000);
    await item('SERVICE', 'Recharge gaz climatiseur', 35_000);
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

  it('réglages : désactivée par défaut, gérant seul, plafonds sous le plafond Ocall', async () => {
    const initial = (await orgA.agent.get(api('/facture/ai/settings')).expect(200)).body;
    expect(initial).toMatchObject({
      enabled: false,
      ceiling: 500,
      configured: true,
      usedThisMonth: { FACTURE_REPORT: 0, FACTURE_QUOTE: 0 },
    });
    const id = await started();
    expect((await report(tech.agent, id, 'Filtre encrassé')).body.code).toBe('AI_FACTURE_DISABLED');
    await aiSettings(sales).expect(403);
    expect((await aiSettings(orgA.agent, { quoteMonthlyLimit: 501 })).body.code).toBe(
      'FACTURE_AI_LIMIT_ABOVE_CEILING',
    );
    await aiSettings(orgA.agent).expect(200);
    await sales.get(api('/facture/ai/proposals')).expect(403);
  });

  it('rapport intelligent : données réelles, dictée, validation du technicien avant la fin', async () => {
    await aiSettings(orgA.agent).expect(200);
    const id = await started();
    const proposed = (
      await report(tech.agent, id, 'Filtre encrassé, débit d’air faible.').expect(200)
    ).body;
    expect(proposed.workSummary).toContain('Filtre encrassé');
    // Temps et pièces : ligne composée par le serveur à partir des saisies réelles.
    expect(proposed.workSummary).toContain(
      'Temps passé : 1 h 30. Pièces : 2 unité × Filtre à air.',
    );
    expect(proposed.recommendations).toContain('à vérifier');
    // Proposition seulement : l'intervention n'a pas changé.
    const before = (await tech.agent.get(api(`/facture/interventions/${id}`)).expect(200)).body;
    expect(before).toMatchObject({ status: 'IN_PROGRESS', workSummary: null });
    expect(
      await db.factureAiProposal.findUniqueOrThrow({ where: { id: proposed.proposalId } }),
    ).toMatchObject({ status: 'PROPOSED', feature: 'FACTURE_REPORT', targetId: id });

    // Dictée : transcription (audio jamais conservé), ajoutée aux observations.
    const dictated = (
      await tech.agent
        .post(api(`/facture/interventions/${id}/ai/report`))
        .attach('audio', audio('Compresseur bruyant au demarrage'), {
          filename: 'note.webm',
          contentType: 'audio/webm',
        })
        .expect(200)
    ).body;
    expect(dictated.transcript).toBe('Compresseur bruyant au demarrage');
    expect(dictated.workSummary).toContain('Compresseur bruyant');
    await tech.agent
      .post(api(`/facture/interventions/${id}/ai/report`))
      .attach('audio', Buffer.from('pas un son'), { filename: 'x.webm', contentType: 'audio/webm' })
      .expect(415);

    // Validation : le technicien corrige puis termine ; la proposition est tracée « appliquée, corrigée ».
    const done = (
      await tech.agent
        .post(api(`/facture/interventions/${id}/complete`))
        .send({
          workSummary: `${proposed.workSummary}\nFiltres remplacés.`,
          recommendations: proposed.recommendations,
          aiProposalId: proposed.proposalId,
        })
        .expect(200)
    ).body;
    expect(done.status).toBe('COMPLETED');
    expect(
      await db.factureAiProposal.findUniqueOrThrow({ where: { id: proposed.proposalId } }),
    ).toMatchObject({ status: 'APPLIED', edited: true });
    // Travaux terminés : plus de proposition de rapport.
    expect((await report(tech.agent, id, 'Encore')).body.code).toBe(
      'FACTURE_INTERVENTION_NOT_IN_PROGRESS',
    );
    // La seconde proposition (dictée) n'a pas été appliquée : elle se rejette, une seule fois.
    await tech.agent.post(api(`/facture/ai/proposals/${dictated.proposalId}/reject`)).expect(204);
    expect(
      (await tech.agent.post(api(`/facture/ai/proposals/${dictated.proposalId}/reject`))).body.code,
    ).toBe('FACTURE_AI_PROPOSAL_DECIDED');
  });

  it('rapport — sécurité : chiffres inventés refusés, proposition d’une autre intervention, rôles', async () => {
    await aiSettings(orgA.agent).expect(200);
    const id = await started();
    const before = await db.factureAiProposal.count({ where: { targetId: id } });
    // Le « modèle » affirme une panne certaine avec une mesure absente des données : refusé.
    const forged = await report(
      tech.agent,
      id,
      'OCALL-SIM:{"findings":"Compresseur hors service, 220 V mesurés","workDone":"Remplacement","recommendations":""}:FIN',
    );
    expect(forged.status).toBe(502);
    expect(forged.body.code).toBe('AI_INVALID_OUTPUT');
    expect(await db.factureAiProposal.count({ where: { targetId: id } })).toBe(before);
    expect(
      await db.factureAiUsage.findFirst({
        where: { organizationId: orgA.organizationId, errorCode: 'AI_INVALID_OUTPUT' },
      }),
    ).not.toBeNull();
    // Audit V1 : une panne annoncée comme certaine (ici dans les recommandations) est refusée.
    const certain = await report(
      tech.agent,
      id,
      'OCALL-SIM:{"findings":"Filtre encrassé","workDone":"Nettoyage du filtre","recommendations":"Le compresseur lâchera à coup sûr"}:FIN',
    );
    expect([certain.status, certain.body.code]).toEqual([502, 'AI_INVALID_OUTPUT']);
    expect(await db.factureAiProposal.count({ where: { targetId: id } })).toBe(before);

    // Proposition d'une autre intervention : refusée, et la fin des travaux n'a pas lieu.
    const other = await started();
    const foreign = (await report(tech.agent, other, 'Filtre encrassé').expect(200)).body;
    const wrong = await tech.agent
      .post(api(`/facture/interventions/${id}/complete`))
      .send({ workSummary: foreign.workSummary, aiProposalId: foreign.proposalId });
    expect(wrong.body.code).toBe('FACTURE_AI_PROPOSAL_INVALID');
    expect((await tech.agent.get(api(`/facture/interventions/${id}`))).body.status).toBe(
      'IN_PROGRESS',
    );

    // Commercial : pas de rapport IA ; technicien non affecté : l'intervention n'existe pas.
    await report(sales, id, 'Filtre encrassé').expect(403);
    const notMine = await started([]);
    await orgA.agent.post(api(`/facture/interventions/${notMine}/start`)).expect(200);
    await report(tech.agent, notMine, 'Filtre encrassé').expect(404);
    // Autre organisation : rien.
    await report(orgB.agent, id, 'Filtre encrassé').expect(404);
  });

  it('devis intelligent : catalogue et prix réels, manques signalés, brouillon jamais émis', async () => {
    await aiSettings(orgA.agent).expect(200);
    const proposed = (
      await quote(
        sales,
        'Le climatiseur de la salle de réunion ne refroidit plus : recharge et filtre à remplacer.',
      ).expect(200)
    ).body;
    expect(proposed.lines.map((l: { label: string }) => l.label)).toEqual([
      'Filtre à air',
      'Recharge gaz climatiseur',
    ]);
    expect(proposed.lines.map((l: { unitPrice: number }) => l.unitPrice)).toEqual([25_000, 35_000]);
    expect(proposed).toMatchObject({ totalHt: 60_000, totalTtc: 70_800 });
    expect(proposed.missing).toEqual(['Quantités à confirmer avec le client.']);
    // Rien de créé avant la décision du commercial.
    expect(
      await db.factureDocument.count({
        where: { organizationId: orgA.organizationId, type: 'QUOTE' },
      }),
    ).toBe(0);

    const applied = (
      await sales.post(api(`/facture/ai/proposals/${proposed.proposalId}/apply`)).expect(200)
    ).body;
    const again = (
      await sales.post(api(`/facture/ai/proposals/${proposed.proposalId}/apply`)).expect(200)
    ).body;
    expect(again.documentId).toBe(applied.documentId);
    const draft = (await sales.get(api(`/facture/documents/${applied.documentId}`)).expect(200))
      .body;
    expect(draft).toMatchObject({
      type: 'QUOTE',
      status: 'DRAFT',
      number: null,
      totalHt: 60_000,
      totalTtc: 70_800,
      client: { id: clientA },
    });
    expect(
      await db.factureAiProposal.findUniqueOrThrow({ where: { id: proposed.proposalId } }),
    ).toMatchObject({ status: 'APPLIED', resultId: applied.documentId });
    expect(
      (await sales.post(api(`/facture/ai/proposals/${proposed.proposalId}/reject`))).body.code,
    ).toBe('FACTURE_AI_PROPOSAL_DECIDED');
  });

  it('devis — sécurité : article inconnu, quantité absurde et prix du modèle écartés ; rôles ; isolation', async () => {
    await aiSettings(orgA.agent).expect(200);
    const forged = (
      await quote(
        orgA.agent,
        'Demande : OCALL-SIM:{"subject":"Devis","lines":[{"ref":"i1","quantity":2,"note":"","unitPrice":1},{"ref":"i99","quantity":1,"note":""},{"ref":"i3","quantity":-3,"note":""}],"missing":[]}:FIN',
      ).expect(200)
    ).body;
    expect(forged.lines).toEqual([
      expect.objectContaining({ label: 'Déplacement technicien', quantity: 2, unitPrice: 10_000 }),
    ]);
    expect(forged.missing[0]).toMatch(/2 ligne\(s\) proposée\(s\)/);

    // Audit V1 : prix ou remise glissés dans l'objet ou une note de ligne : textes retirés et signalés.
    const smuggled = (
      await quote(
        orgA.agent,
        'Demande : OCALL-SIM:{"subject":"Devis à 5 000 FCFA","lines":[{"ref":"i1","quantity":2,"note":"prix négocié 15 000 FCFA, remise 20 %"},{"ref":"i1","quantity":1,"note":"accès par la cour"}],"missing":[]}:FIN',
      ).expect(200)
    ).body;
    expect(smuggled.subject).toBe('Devis');
    expect(smuggled.lines.map((l: { note: string | null }) => l.note)).toEqual([
      null,
      'accès par la cour',
    ]);
    expect(smuggled.lines[0]).toMatchObject({ quantity: 2, unitPrice: 10_000 });
    expect(smuggled.missing).toEqual([expect.stringMatching(/^2 texte\(s\) proposé\(s\)/)]);
    // Chiffre présent dans la demande : conservé.
    const kept = (
      await quote(
        orgA.agent,
        'Deux déplacements, bâtiment 12. OCALL-SIM:{"subject":"Bâtiment 12","lines":[{"ref":"i1","quantity":2,"note":"bâtiment 12"}],"missing":[]}:FIN',
      ).expect(200)
    ).body;
    expect([kept.subject, kept.lines[0].note, kept.missing]).toEqual([
      'Bâtiment 12',
      'bâtiment 12',
      [],
    ]);
    // Demande sans article correspondant : aucune ligne, besoin signalé, rien d'applicable.
    const empty = (
      await quote(
        orgA.agent,
        'Installation de panneaux solaires sur le toit de l’entrepôt.',
      ).expect(200)
    ).body;
    expect(empty.lines).toEqual([]);
    expect(empty.missing[0]).toMatch(/Aucun article du catalogue/);

    await quote(tech.agent, 'Recharge de climatiseur demandée.').expect(403);
    await tech.agent.post(api(`/facture/ai/proposals/${forged.proposalId}/apply`)).expect(403);
    await orgB.agent.post(api(`/facture/ai/proposals/${forged.proposalId}/apply`)).expect(404);
    expect((await quote(orgA.agent, 'Recharge de climatiseur demandée.', clientB)).body.code).toBe(
      'FACTURE_CLIENT_NOT_FOUND',
    );
    await quote(orgA.agent, 'court').expect(400);
  });

  it('quotas : plafond par fonctionnalité tenu sous concurrence ; fonctionnalité désactivée', async () => {
    const used = (await orgA.agent.get(api('/facture/ai/settings')).expect(200)).body.usedThisMonth
      .FACTURE_QUOTE as number;
    await aiSettings(orgA.agent, { quoteMonthlyLimit: used + 2 }).expect(200);
    // Huit demandes simultanées pour deux places : exactement deux passent (réservation sous verrou).
    const all = await Promise.all(
      Array.from({ length: 8 }, (_, k) =>
        quote(k % 2 ? sales : orgA.agent, 'Recharge de climatiseur demandée.'),
      ),
    );
    expect(all.filter((r) => r.status === 200)).toHaveLength(2);
    expect(all.filter((r) => r.body.code === 'AI_QUOTA_EXCEEDED')).toHaveLength(6);
    // Réservations directes du stockage, toutes lancées ensemble : le verrou de la ligne de réglages
    // sérialise comptage et insertion ; sans lui, chacune compterait le même total.
    const store = app.get(FactureAiUsageStore);
    const usedNow = (await orgA.agent.get(api('/facture/ai/settings')).expect(200)).body
      .usedThisMonth.FACTURE_QUOTE as number;
    await aiSettings(orgA.agent, { quoteMonthlyLimit: usedNow + 3 }).expect(200);
    const owner = await prisma.user.findUniqueOrThrow({ where: { loginId: orgA.loginId } });
    const reservations = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        store.reserve(
          {
            application: 'facture',
            organizationId: orgA.organizationId,
            establishmentId: null,
            actorUserId: owner.id,
            actorRef: null,
            role: 'MANAGER',
            operation: 'FACTURE_QUOTE',
            timezone: 'Africa/Bamako',
          },
          { provider: 'simulated', model: 'simulated', prompt: null },
        ),
      ),
    );
    expect(reservations.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    await aiSettings(orgA.agent, { quoteEnabled: false }).expect(200);
    expect((await quote(orgA.agent, 'Recharge de climatiseur demandée.')).body.code).toBe(
      'AI_FEATURE_DISABLED',
    );
    // Organisation B : quota et réglages propres (désactivée).
    await orgB.agent
      .post(api('/facture/items'))
      .send({
        kind: 'SERVICE',
        name: 'Recharge gaz',
        unit: 'unité',
        unitPrice: 30_000,
        vatRate: 18,
      })
      .expect(201);
    expect((await quote(orgB.agent, 'Recharge de climatiseur demandée.', clientB)).body.code).toBe(
      'AI_FACTURE_DISABLED',
    );
  });

  it('traçabilité : propositions listées pour le gérant, figées par la base', async () => {
    const list = (await orgA.agent.get(api('/facture/ai/proposals')).expect(200)).body as {
      id: string;
      status: string;
      promptId: string;
    }[];
    expect(list.length).toBeGreaterThan(3);
    expect(list.every((p) => ['facture.report', 'facture.quote'].includes(p.promptId))).toBe(true);
    expect((await orgB.agent.get(api('/facture/ai/proposals')).expect(200)).body).toEqual([]);
    const applied = list.find((p) => p.status === 'APPLIED')!;
    await expect(
      db.factureAiProposal.update({
        where: { id: applied.id },
        data: { status: 'REJECTED', edited: false, resultId: null },
      }),
    ).rejects.toThrow(/FACTURE_AI_PROPOSAL_FROZEN/);
    const pending = list.find((p) => p.status === 'PROPOSED')!;
    await expect(
      db.factureAiProposal.update({
        where: { id: pending.id },
        data: { output: { forged: true } },
      }),
    ).rejects.toThrow(/FACTURE_AI_PROPOSAL_FROZEN/);
    await expect(db.factureAiProposal.delete({ where: { id: pending.id } })).rejects.toThrow(
      /FACTURE_AI_PROPOSAL_FROZEN/,
    );
  });
});
