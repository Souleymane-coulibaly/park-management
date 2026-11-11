import type { INestApplication } from '@nestjs/common';
import { purgeFactureOrganizations } from '@ocall/facture-database';
import { FACTURE_PRODUCT_CODE } from '@ocall/shared';
import type { FactureContext } from '../src/modules/facture/facture-access';
import { FactureAiPlanningService } from '../src/modules/facture/facture-ai-planning.service';
import { FactureInterventionsService } from '../src/modules/facture/facture-interventions.service';
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
 * Ocall Facture — module IA F6B (fournisseur simulé) : compétences et indisponibilités ; planification
 * intelligente (candidats calculés par le serveur, conflits, urgence, indisponibilités, affectation après
 * validation revérifiée) ; maintenance préventive (historique réel, signaux, aucune panne certaine,
 * interventions citées vérifiées, suggestion appliquée par la planification) ; sécurité, rôles,
 * isolation, quotas. Données fictives, bases locales jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const enabled = Boolean(process.env.TEST_FACTURE_DATABASE_URL);
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const TOMORROW = day(1);

(enabled ? describe : describe.skip)('Ocall Facture F6B — planification et maintenance IA', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: FacturePrismaService;
  let interventions: FactureInterventionsService;
  let orgA: SignedUpOwner;
  let orgB: SignedUpOwner;
  let planId: string;
  let clientA: string;
  let clientB: string;
  let techA: { id: string; agent: Agent };
  let techB: string;
  let sales: Agent;
  let clim: string;
  let elec: string;
  let owner: FactureContext;

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

  async function member(role: string, lastName: string, withLogin = true) {
    const res = await orgA.agent
      .post(api('/facture/members'))
      .send({ firstName: 'Membre', lastName, role })
      .expect(201);
    if (!withLogin) return { id: res.body.member.id as string, agent: null as unknown as Agent };
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
      planningEnabled: true,
      maintenanceEnabled: true,
      reportMonthlyLimit: 100,
      quoteMonthlyLimit: 100,
      planningMonthlyLimit: 100,
      maintenanceMonthlyLimit: 100,
      ...over,
    });

  const plan = (
    agent: Agent,
    date: string,
    from: string,
    to: string,
    extra: Record<string, unknown> = {},
  ) =>
    agent.post(api('/facture/interventions')).send({
      clientId: clientA,
      title: 'Climatiseur en panne',
      scheduledStart: `${date}T${from}:00Z`,
      scheduledEnd: `${date}T${to}:00Z`,
      technicianIds: [],
      ...extra,
    });

  const suggest = (agent: Agent, id: string) =>
    agent.post(api(`/facture/interventions/${id}/ai/planning`));

  const overlaps = (a: { start: string; end: string }, s: Date, e: Date) =>
    new Date(a.start).getTime() < e.getTime() && s.getTime() < new Date(a.end).getTime();

  /** Équipement du client A ; interventions réalisées à des dates passées (service, pas d'API). */
  async function equipment(name: string, extra: Record<string, unknown> = {}) {
    return (
      await orgA.agent
        .post(api('/facture/equipment'))
        .send({ clientId: clientA, name, ...extra })
        .expect(201)
    ).body.id as string;
  }
  async function serviced(equipmentId: string, daysAgo: number) {
    const id = (
      await plan(orgA.agent, TOMORROW, '15:00', '16:00', {
        equipmentId,
        title: 'Entretien',
      }).expect(201)
    ).body.id as string;
    const when = new Date(Date.now() - daysAgo * DAY);
    await interventions.start(owner, id, when);
    await interventions.complete(owner, id, { workSummary: 'Entretien réalisé.' }, when);
    return (await db.factureIntervention.findUniqueOrThrow({ where: { id } })).number;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(FacturePrismaService);
    interventions = app.get(FactureInterventionsService);
    const product = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: FACTURE_PRODUCT_CODE },
    });
    planId = (
      await prisma.subscriptionPlan.create({
        data: {
          productId: product.id,
          name: `Facture F6B test ${RUN}`,
          monthlyPrice: 50_000,
          setupFee: 200_000,
          isActive: false,
        },
      })
    ).id;
    orgA = await signup(app, 'factureF6BA', 'PARK');
    orgB = await signup(app, 'factureF6BB', 'PARK');
    await startTrial(orgA.organizationId);
    await startTrial(orgB.organizationId);
    for (const [o, name] of [
      [orgA, 'Froid Services'],
      [orgB, 'Kati Clim'],
    ] as const) {
      await o.agent
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
    // Quatre connexions en tout (inscriptions comprises) : sous la limite du compartiment « auth ».
    techA = await member('TECHNICIAN', 'Awa');
    techB = (await member('TECHNICIAN', 'Bakary', false)).id;
    sales = (await member('SALES', 'Commercial')).agent;
    const user = await prisma.user.findUniqueOrThrow({ where: { loginId: orgA.loginId } });
    owner = {
      organizationId: orgA.organizationId,
      userId: user.id,
      access: 'full',
      role: 'MANAGER',
      memberId: null,
      isOwner: true,
    } as FactureContext;
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

  it('compétences (liste libre) et indisponibilités : gérant seul, propres à l’organisation', async () => {
    clim = (
      await orgA.agent.post(api('/facture/skills')).send({ name: 'Climatisation' }).expect(201)
    ).body.id;
    elec = (await orgA.agent.post(api('/facture/skills')).send({ name: 'Électricité' }).expect(201))
      .body.id;
    expect(
      (await orgA.agent.post(api('/facture/skills')).send({ name: 'Climatisation' })).body.code,
    ).toBe('FACTURE_SKILL_TAKEN');
    await sales.post(api('/facture/skills')).send({ name: 'Plomberie' }).expect(403);
    await orgA.agent
      .put(api(`/facture/members/${techA.id}/skills`))
      .send({ skillIds: [clim, elec] })
      .expect(200);
    await orgA.agent
      .put(api(`/facture/members/${techB}/skills`))
      .send({ skillIds: [clim] })
      .expect(200);
    const orgBSkill = (
      await orgB.agent.post(api('/facture/skills')).send({ name: 'Plomberie' }).expect(201)
    ).body.id;
    expect(
      (
        await orgA.agent
          .put(api(`/facture/members/${techA.id}/skills`))
          .send({ skillIds: [orgBSkill] })
      ).body.code,
    ).toBe('FACTURE_SKILL_INVALID');
    expect(
      (await plan(orgA.agent, TOMORROW, '08:00', '09:00', { requiredSkillIds: [orgBSkill] })).body
        .code,
    ).toBe('FACTURE_SKILL_INVALID');
    expect((await orgA.agent.get(api('/facture/member-skills')).expect(200)).body).toMatchObject({
      [techA.id]: expect.arrayContaining([clim, elec]),
      [techB]: [clim],
    });
    await orgA.agent
      .post(api('/facture/unavailabilities'))
      .send({ memberId: techB, startsAt: `${TOMORROW}T10:00:00Z`, endsAt: `${TOMORROW}T09:00:00Z` })
      .expect(400);
    await techA.agent
      .post(api('/facture/unavailabilities'))
      .send({
        memberId: techA.id,
        startsAt: `${TOMORROW}T08:00:00Z`,
        endsAt: `${TOMORROW}T09:00:00Z`,
      })
      .expect(403);
  });

  it('planification : candidats du serveur, conflit évité, affectation après validation', async () => {
    await aiSettings(orgA.agent).expect(200);
    // Awa est déjà prise demain de 8 h à 10 h.
    await plan(orgA.agent, TOMORROW, '08:00', '10:00', { technicianIds: [techA.id] }).expect(201);
    const target = (
      await plan(orgA.agent, TOMORROW, '08:00', '10:00', { requiredSkillIds: [clim, elec] }).expect(
        201,
      )
    ).body;
    expect(target).toMatchObject({ priority: 'NORMAL', technicians: [] });
    expect(target.requiredSkills.map((s: { name: string }) => s.name).sort()).toEqual([
      'Climatisation',
      'Électricité',
    ]);
    const proposal = (await suggest(orgA.agent, target.id).expect(200)).body;
    expect(proposal.candidates.map((c: { memberId: string }) => c.memberId)).toEqual([
      techA.id,
      techB,
    ]);
    // Awa a toutes les compétences mais est occupée : décalée à 10 h ; Bakary garde le créneau demandé.
    expect(proposal.candidates[0]).toMatchObject({
      start: `${TOMORROW}T10:00:00.000Z`,
      requestedSlot: false,
      skillsMatched: 2,
      conflicts: [expect.stringMatching(/^INT-/)],
    });
    expect(proposal.candidates[1]).toMatchObject({
      start: `${TOMORROW}T08:00:00.000Z`,
      requestedSlot: true,
      skillsMatched: 1,
    });
    expect(proposal.candidates[0].reason).toBeTruthy();
    // Rien n'est affecté avant la validation.
    expect(
      (await orgA.agent.get(api(`/facture/interventions/${target.id}`))).body.technicians,
    ).toEqual([]);

    const assigned = (
      await orgA.agent
        .post(api(`/facture/ai/proposals/${proposal.proposalId}/assign`))
        .send({ choice: 0 })
        .expect(200)
    ).body;
    expect(assigned.technicians.map((t: { memberId: string }) => t.memberId)).toEqual([techA.id]);
    expect(assigned.scheduledStart).toBe(`${TOMORROW}T10:00:00.000Z`);
    expect(
      await db.factureAiProposal.findUniqueOrThrow({ where: { id: proposal.proposalId } }),
    ).toMatchObject({ status: 'APPLIED', resultId: target.id, edited: false });
    await orgA.agent
      .post(api(`/facture/ai/proposals/${proposal.proposalId}/assign`))
      .send({ choice: 1 })
      .expect(200);
    expect(
      (await orgA.agent.get(api(`/facture/interventions/${target.id}`))).body.technicians,
    ).toHaveLength(1);

    // Urgence : au plus tôt, jamais avant maintenant.
    const urgent = (
      await plan(orgA.agent, day(5), '08:00', '09:00', { priority: 'URGENT' }).expect(201)
    ).body;
    const fast = (await suggest(orgA.agent, urgent.id).expect(200)).body;
    const first = new Date(fast.candidates[0].start).getTime();
    expect(first).toBeLessThan(new Date(`${day(5)}T08:00:00Z`).getTime());
    expect(first).toBeGreaterThanOrEqual(Date.now() - 60_000);
  });

  it('indisponibilités respectées ; créneau pris entre-temps refusé ; intervention commencée', async () => {
    await aiSettings(orgA.agent).expect(200);
    const off = { start: new Date(`${TOMORROW}T00:00:00Z`), end: new Date(`${day(2)}T00:00:00Z`) };
    await orgA.agent
      .post(api('/facture/unavailabilities'))
      .send({
        memberId: techB,
        startsAt: off.start.toISOString(),
        endsAt: off.end.toISOString(),
        reason: 'Congé',
      })
      .expect(201);
    const job = (
      await plan(orgA.agent, TOMORROW, '08:00', '10:00', { requiredSkillIds: [clim] }).expect(201)
    ).body;
    const proposal = (await suggest(orgA.agent, job.id).expect(200)).body;
    const bakary = proposal.candidates.find((c: { memberId: string }) => c.memberId === techB);
    expect(bakary.requestedSlot).toBe(false);
    expect(overlaps(bakary, off.start, off.end)).toBe(false);

    // Compétence que seule Awa détient : Bakary (sans aucune compétence requise) n'est jamais proposé.
    const elecOnly = (
      await plan(orgA.agent, day(3), '14:00', '15:00', { requiredSkillIds: [elec] }).expect(201)
    ).body;
    expect(
      (await suggest(orgA.agent, elecOnly.id).expect(200)).body.candidates.map(
        (c: { memberId: string }) => c.memberId,
      ),
    ).toEqual([techA.id]);

    // Le créneau proposé est pris par une autre affectation avant la validation : refus, rien d'appliqué.
    const top = proposal.candidates[0];
    await orgA.agent
      .post(api('/facture/interventions'))
      .send({
        clientId: clientA,
        title: 'Autre urgence',
        scheduledStart: top.start,
        scheduledEnd: top.end,
        technicianIds: [top.memberId],
      })
      .expect(201);
    expect(
      (
        await orgA.agent
          .post(api(`/facture/ai/proposals/${proposal.proposalId}/assign`))
          .send({ choice: 0 })
      ).body.code,
    ).toBe('FACTURE_AI_SLOT_TAKEN');
    expect(
      (await db.factureAiProposal.findUniqueOrThrow({ where: { id: proposal.proposalId } })).status,
    ).toBe('PROPOSED');
    expect(
      (
        await orgA.agent
          .post(api(`/facture/ai/proposals/${proposal.proposalId}/assign`))
          .send({ choice: 7 })
      ).body.code,
    ).toBe('FACTURE_AI_CHOICE_INVALID');

    const started = (
      await plan(orgA.agent, TOMORROW, '16:00', '17:00', { technicianIds: [techA.id] }).expect(201)
    ).body;
    await techA.agent.post(api(`/facture/interventions/${started.id}/start`)).expect(200);
    expect((await suggest(orgA.agent, started.id)).body.code).toBe('FACTURE_AI_PLANNING_CLOSED');
  });

  it('audit V1 : proposition périmée refusée (intervention commencée, durée changée, créneau passé)', async () => {
    await aiSettings(orgA.agent).expect(200);
    const stale = async (proposalId: string) => {
      const res = await orgA.agent
        .post(api(`/facture/ai/proposals/${proposalId}/assign`))
        .send({ choice: 0 });
      expect([res.status, res.body.code]).toEqual([409, 'FACTURE_AI_PROPOSAL_STALE']);
      expect(
        (await db.factureAiProposal.findUniqueOrThrow({ where: { id: proposalId } })).status,
      ).toBe('PROPOSED');
    };

    // Intervention commencée entre la proposition et la validation : ni déplacée ni réaffectée.
    const started = (
      await plan(orgA.agent, day(4), '08:00', '09:00', { technicianIds: [techA.id] }).expect(201)
    ).body;
    const p1 = (await suggest(orgA.agent, started.id).expect(200)).body;
    await techA.agent.post(api(`/facture/interventions/${started.id}/start`)).expect(200);
    await stale(p1.proposalId);
    expect(
      (await orgA.agent.get(api(`/facture/interventions/${started.id}`)).expect(200)).body,
    ).toMatchObject({
      status: 'IN_PROGRESS',
      scheduledStart: `${day(4)}T08:00:00.000Z`,
      technicians: [expect.objectContaining({ memberId: techA.id })],
    });

    // Durée modifiée depuis la proposition : nouvelle proposition demandée.
    const resized = (await plan(orgA.agent, day(4), '14:00', '15:00').expect(201)).body;
    const p2 = (await suggest(orgA.agent, resized.id).expect(200)).body;
    await orgA.agent
      .patch(api(`/facture/interventions/${resized.id}`))
      .send({
        scheduledStart: `${day(4)}T14:00:00.000Z`,
        scheduledEnd: `${day(4)}T17:00:00.000Z`,
      })
      .expect(200);
    await stale(p2.proposalId);

    // Créneau proposé désormais passé : refusé (validation tardive).
    const late = (await plan(orgA.agent, day(5), '10:00', '11:00').expect(201)).body;
    const p3 = (await suggest(orgA.agent, late.id).expect(200)).body;
    await expect(
      app
        .get(FactureAiPlanningService)
        .assign(owner, p3.proposalId, 0, new Date(Date.now() + 30 * DAY)),
    ).rejects.toMatchObject({ response: { code: 'FACTURE_AI_PROPOSAL_STALE' } });
    // À temps : appliquée.
    await orgA.agent
      .post(api(`/facture/ai/proposals/${p3.proposalId}/assign`))
      .send({ choice: 0 })
      .expect(200);
  });

  it('planification — sécurité : candidat inventé écarté, classement vide refusé, rôles, isolation', async () => {
    await aiSettings(orgA.agent).expect(200);
    const forged = (
      await plan(orgA.agent, day(3), '08:00', '09:00', {
        title: `Urgent OCALL-SIM:{"summary":"ok","ranking":[{"ref":"c9","reason":"inventé"},{"ref":"c1","reason":"Disponible."}]}:FIN`,
      }).expect(201)
    ).body;
    const proposal = (await suggest(orgA.agent, forged.id).expect(200)).body;
    // Seuls les candidats calculés par le serveur, aucun inventé ; aucun créneau modifié par le modèle.
    const ids = proposal.candidates.map((c: { memberId: string }) => c.memberId);
    expect(new Set(ids)).toEqual(new Set([techA.id, techB]));
    expect(proposal.candidates.map((c: { reason: string | null }) => c.reason)).toEqual([
      'Disponible.',
      null,
    ]);

    const empty = (
      await plan(orgA.agent, day(3), '10:00', '11:00', {
        title: 'Vide OCALL-SIM:{"summary":"","ranking":[{"ref":"c42","reason":"x"}]}:FIN',
      }).expect(201)
    ).body;
    const refused = await suggest(orgA.agent, empty.id);
    expect(refused.status).toBe(502);
    expect(refused.body.code).toBe('AI_INVALID_OUTPUT');

    await suggest(techA.agent, forged.id).expect(403);
    await suggest(orgB.agent, forged.id).expect(404);
    await techA.agent
      .post(api(`/facture/ai/proposals/${proposal.proposalId}/assign`))
      .send({})
      .expect(403);
    await orgB.agent
      .post(api(`/facture/ai/proposals/${proposal.proposalId}/assign`))
      .send({})
      .expect(404);
  });

  it('maintenance préventive : historique réel, signaux, suggestions sans doublon, appliquée en planifiant', async () => {
    await aiSettings(orgA.agent).expect(200);
    const due = await equipment('Climatiseur salle 1', {
      maintenanceIntervalMonths: 6,
      installedAt: day(-800),
    });
    const dueRef = await serviced(due, 240);
    const never = await equipment('Groupe électrogène', { installedAt: day(-800) });
    const repeated = await equipment('Onduleur bureau');
    const r1 = await serviced(repeated, 60);
    const r2 = await serviced(repeated, 20);
    const fine = await equipment('Climatiseur salle 2', { maintenanceIntervalMonths: 12 });
    await serviced(fine, 10);

    const list = (await orgA.agent.post(api('/facture/ai/maintenance')).expect(200)).body as {
      proposalId: string;
      equipmentId: string;
      reasons: string[];
      evidence: string[];
      explanation: string;
    }[];
    const by = (id: string) => list.find((s) => s.equipmentId === id)!;
    expect(list.map((s) => s.equipmentId).sort()).toEqual([due, never, repeated].sort());
    expect(by(due)).toMatchObject({ reasons: ['DUE'], evidence: [dueRef] });
    expect(by(never).reasons).toEqual(['NEVER_SERVICED']);
    expect(by(repeated)).toMatchObject({ reasons: ['REPEATED'] });
    expect(by(repeated).evidence.sort()).toEqual([r1, r2].sort());
    expect(by(due).explanation).toContain('recommandée');

    // Nouvelle analyse : aucun doublon, aucun appel IA (consommation inchangée).
    const usedBefore = await db.factureAiUsage.count({
      where: { organizationId: orgA.organizationId, feature: 'FACTURE_MAINTENANCE' },
    });
    const again = (await orgA.agent.post(api('/facture/ai/maintenance')).expect(200)).body;
    expect(again.map((s: { proposalId: string }) => s.proposalId).sort()).toEqual(
      list.map((s) => s.proposalId).sort(),
    );
    expect(
      await db.factureAiUsage.count({
        where: { organizationId: orgA.organizationId, feature: 'FACTURE_MAINTENANCE' },
      }),
    ).toBe(usedBefore);

    // Appliquée seulement en planifiant l'intervention de CET équipement.
    const before = await db.factureIntervention.count({
      where: { organizationId: orgA.organizationId },
    });
    expect(
      (
        await plan(orgA.agent, day(4), '08:00', '09:00', {
          equipmentId: never,
          aiProposalId: by(due).proposalId,
        })
      ).body.code,
    ).toBe('FACTURE_AI_PROPOSAL_INVALID');
    expect(
      await db.factureIntervention.count({ where: { organizationId: orgA.organizationId } }),
    ).toBe(before);
    const created = (
      await plan(orgA.agent, day(4), '08:00', '09:00', {
        equipmentId: due,
        title: 'Entretien préventif',
        aiProposalId: by(due).proposalId,
      }).expect(201)
    ).body;
    expect(
      await db.factureAiProposal.findUniqueOrThrow({ where: { id: by(due).proposalId } }),
    ).toMatchObject({ status: 'APPLIED', resultId: created.id });
    await orgA.agent.post(api(`/facture/ai/proposals/${by(never).proposalId}/reject`)).expect(204);
    const remaining = (await orgA.agent.get(api('/facture/ai/maintenance')).expect(200)).body;
    expect(remaining.map((s: { equipmentId: string }) => s.equipmentId)).toEqual([repeated]);
  });

  it('maintenance — sécurité : panne certaine refusée, intervention étrangère refusée, rôles, isolation', async () => {
    await aiSettings(orgA.agent).expect(200);
    const id = await equipment(
      'C OCALL-SIM:{"suggestions":[{"ref":"e1","title":"V","explanation":"Il tombera en panne."}]}:FIN',
      { installedAt: day(-800) },
    );
    const certain = await orgA.agent.post(api('/facture/ai/maintenance'));
    expect(certain.status).toBe(502);
    expect(certain.body.code).toBe('AI_INVALID_OUTPUT');
    await orgA.agent
      .patch(api(`/facture/equipment/${id}`))
      .send({
        name: 'C OCALL-SIM:{"suggestions":[{"ref":"e1","title":"V","explanation":"Vu INT-2020-99999."}]}:FIN',
      })
      .expect(200);
    expect((await orgA.agent.post(api('/facture/ai/maintenance'))).body.code).toBe(
      'AI_INVALID_OUTPUT',
    );
    expect(
      await db.factureAiProposal.count({ where: { targetId: id, feature: 'FACTURE_MAINTENANCE' } }),
    ).toBe(0);
    await orgA.agent
      .patch(api(`/facture/equipment/${id}`))
      .send({ name: 'Compresseur atelier' })
      .expect(200);
    expect(
      (
        (await orgA.agent.post(api('/facture/ai/maintenance')).expect(200)).body as {
          equipmentId: string;
        }[]
      ).some((s) => s.equipmentId === id),
    ).toBe(true);

    await techA.agent.post(api('/facture/ai/maintenance')).expect(403);
    await aiSettings(orgB.agent).expect(200);
    expect((await orgB.agent.post(api('/facture/ai/maintenance')).expect(200)).body).toEqual([]);
    void clientB;
  });

  it('réglages : plafond Ocall, fonctionnalité désactivée', async () => {
    expect((await aiSettings(orgA.agent, { planningMonthlyLimit: 501 })).body.code).toBe(
      'FACTURE_AI_LIMIT_ABOVE_CEILING',
    );
    await aiSettings(orgA.agent, { planningEnabled: false }).expect(200);
    const id = (await plan(orgA.agent, day(6), '08:00', '09:00').expect(201)).body.id;
    expect((await suggest(orgA.agent, id)).body.code).toBe('AI_FEATURE_DISABLED');
  });
});
