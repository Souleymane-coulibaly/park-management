import type { INestApplication } from '@nestjs/common';
import { AiGatewayService } from '../src/ai-core/ai-gateway.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { type SignedUpOwner, cleanup, createTestApp, signup } from './helpers';

/**
 * Ocall AI Core (Sprint 8 School, phase 2) appliqué à Ocall Park, sur base jetable et fournisseur
 * SIMULÉ : version du prompt tracée avec chaque appel, limitation de débit par utilisateur, nettoyage
 * des réservations orphelines, isolation entre organisations. Les parcours Park (copilote, imports,
 * commande vocale, quotas) restent couverts par sprint8-ia, sprint9b-copilot-saas et
 * sprint11b-operations, inchangés.
 */
describe('Ocall AI Core — consolidation sur Ocall Park (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: SignedUpOwner;
  let other: SignedUpOwner;
  let est: string;
  const api = (path: string) => `/api/v1${path}`;
  const ask = (o: SignedUpOwner, establishmentId: string, question: string) =>
    o.agent.post(api('/ai/copilot/ask')).send({ establishmentId, question });

  beforeAll(async () => {
    // Limite basse pour ce fichier seulement : la limitation se vérifie sans multiplier les appels.
    process.env.AI_RATE_LIMIT_USER_PER_MINUTE = '4';
    ({ app, prisma } = await createTestApp());
    owner = await signup(app, 'aicore', 'RESTAURANT');
    other = await signup(app, 'aicoreb', 'RESTAURANT');
    est = (await owner.agent.get(api('/establishments')).expect(200)).body[0].id;
  });

  afterAll(async () => {
    delete process.env.AI_RATE_LIMIT_USER_PER_MINUTE;
    try {
      if (prisma) await cleanup(prisma);
    } finally {
      await app?.close();
    }
  });

  it('chaque appel enregistre le prompt versionné utilisé ; le contrat de réponse est inchangé', async () => {
    const res = await ask(owner, est, 'Quel est mon chiffre d’affaires aujourd’hui ?').expect(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ['answer', 'establishment', 'grounded', 'question', 'rejected', 'results'].sort(),
    );
    expect(res.body.results[0].tool).toBe('revenue_summary');
    const usage = await prisma.aiUsage.findFirstOrThrow({
      where: { organizationId: owner.organizationId, feature: 'COPILOT' },
      orderBy: { createdAt: 'desc' },
    });
    expect(usage).toMatchObject({
      status: 'SUCCEEDED',
      promptId: 'park.copilot',
      promptVersion: 1,
      provider: 'simulated',
      establishmentId: est,
    });
  });

  it('limitation de débit par utilisateur : refus 429 avant toute réservation, sans toucher l’autre client', async () => {
    const before = await prisma.aiUsage.count({ where: { organizationId: owner.organizationId } });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await ask(owner, est, 'Quels produits sont proches de la rupture ?')).status);
    }
    // 1 appel au test précédent + 3 ici = 4 : le 4e de cette boucle dépasse la limite.
    expect(statuses).toEqual([200, 200, 200, 429]);
    const refused = await ask(owner, est, 'Mes ventes aujourd’hui ?').expect(429);
    expect(refused.body.code).toBe('AI_TOO_MANY_REQUESTS');
    const after = await prisma.aiUsage.count({ where: { organizationId: owner.organizationId } });
    expect(after - before).toBe(3);
    const otherEst = (await other.agent.get(api('/establishments')).expect(200)).body[0].id;
    await ask(other, otherEst, 'Mes ventes aujourd’hui ?').expect(200);
  });

  it('réservation orpheline (processus interrompu) libérée ; réservation récente intacte', async () => {
    const old = await prisma.aiUsage.create({
      data: {
        organizationId: owner.organizationId,
        feature: 'COPILOT',
        provider: 'simulated',
        model: 'simulated',
        createdAt: new Date(Date.now() - 24 * 3600_000),
      },
    });
    const recent = await prisma.aiUsage.create({
      data: {
        organizationId: owner.organizationId,
        feature: 'COPILOT',
        provider: 'simulated',
        model: 'simulated',
      },
    });
    expect(await app.get(AiGatewayService).releaseOrphans()).toBeGreaterThanOrEqual(1);
    expect(await prisma.aiUsage.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({
      status: 'FAILED',
      errorCode: 'AI_ABANDONED',
    });
    expect(await prisma.aiUsage.findUniqueOrThrow({ where: { id: recent.id } })).toMatchObject({
      status: 'PENDING',
      errorCode: null,
    });
  });
});
