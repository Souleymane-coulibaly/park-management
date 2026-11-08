import {
  ForbiddenException,
  HttpException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AppConfig } from '../config/app-config';
import type { AiCallContext, AiUsageStore } from './ai-context';
import { loadAiConfig, modelFor } from './ai-core.config';
import { AiGatewayService } from './ai-gateway.service';
import { declaredPrompts, defineAiPrompt } from './ai-prompts';
import { type AiProvider, AiProviderError } from './ai-provider';
import { AiRateLimiter } from './ai-rate-limiter';
import { exactKeys, strictObject, toolExecutor } from './ai-tools';
import { SimulatedAiProvider, registerAiSimulation } from './providers/simulated.provider';

/** Tests unitaires d'Ocall AI Core : sans base, sans réseau, fournisseurs et stockages factices. */

const ctx = (over: Partial<AiCallContext> = {}): AiCallContext => ({
  application: 'test-app',
  organizationId: 'org-1',
  establishmentId: 'est-1',
  actorUserId: 'user-1',
  actorRef: 'member-1',
  role: 'DIRECTOR',
  operation: 'TEST_FEATURE',
  timezone: 'Africa/Dakar',
  ...over,
});

function fakeStore() {
  const calls: string[] = [];
  const store: AiUsageStore & { calls: string[]; reserveError?: Error } = {
    calls,
    async reserve(c, meta) {
      if (store.reserveError) throw store.reserveError;
      calls.push(
        `reserve:${c.application}:${c.operation}:${meta.prompt?.id ?? '-'}@${meta.prompt?.version ?? '-'}`,
      );
      return 'usage-1';
    },
    async succeed(id, result) {
      calls.push(`succeed:${id}:${result.usage.inputTokens}:${result.estimatedCostMicroUsd}`);
    },
    async fail(id, failure) {
      calls.push(
        `fail:${id}:${failure.errorCode}${failure.usage ? `:${failure.usage.inputTokens}:${failure.estimatedCostMicroUsd}` : ''}`,
      );
    },
    async releaseOrphans() {
      calls.push('orphans');
      return 2;
    },
  };
  return store;
}

function gateway(provider: AiProvider | null, env: NodeJS.ProcessEnv = {}) {
  const config = { ai: loadAiConfig({ AI_PROVIDER: 'simulated', ...env }, 'test') } as AppConfig;
  return new AiGatewayService(config, provider);
}

const USAGE = { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 };

describe('Configuration d’Ocall AI Core', () => {
  it('modèle par fonctionnalité sans liste figée ; alias historique de Park ; défaut', () => {
    const config = loadAiConfig(
      {
        AI_PROVIDER: 'simulated',
        OPENAI_MODEL_SCHOOL_TEACHING: 'gpt-5-mini',
        OPENAI_MODEL_CATALOG_IMPORT: 'gpt-5-nano',
      },
      'test',
    );
    expect(modelFor(config, 'SCHOOL_TEACHING')).toBe('gpt-5-mini');
    expect(modelFor(config, 'TICKET_IMPORT')).toBe('gpt-5-nano');
    expect(modelFor(config, 'SCHOOL_COPILOT')).toBe('gpt-5');
  });

  it('limitation de débit et délai d’orphelin configurables ; valeurs invalides refusées', () => {
    const config = loadAiConfig(
      {
        AI_RATE_LIMIT_USER_PER_MINUTE: '5',
        AI_RATE_LIMIT_ORG_PER_MINUTE: '9',
        AI_ORPHAN_AFTER_MS: '1000',
      },
      'test',
    );
    expect(config.rateLimit).toEqual({ perUserPerMinute: 5, perOrganizationPerMinute: 9 });
    expect(config.orphanAfterMs).toBe(1000);
    expect(() => loadAiConfig({ AI_RATE_LIMIT_USER_PER_MINUTE: '0' }, 'test')).toThrow(
      /entier positif/,
    );
  });
});

describe('Prompts versionnés', () => {
  it('déclaration, référence, refus d’un texte modifié sans nouvelle version', () => {
    const p = defineAiPrompt({ id: 'test.summary', version: 1, instructions: 'Résume.' });
    expect(Object.isFrozen(p)).toBe(true);
    expect(defineAiPrompt({ id: 'test.summary', version: 1, instructions: 'Résume.' })).toEqual(p);
    expect(() =>
      defineAiPrompt({ id: 'test.summary', version: 1, instructions: 'Autre.' }),
    ).toThrow(/nouvelle version/);
    expect(defineAiPrompt({ id: 'test.summary', version: 2, instructions: 'Autre.' }).version).toBe(
      2,
    );
    expect(declaredPrompts()).toEqual(
      expect.arrayContaining([
        { id: 'test.summary', version: 1 },
        { id: 'test.summary', version: 2 },
      ]),
    );
  });

  it('identifiant préfixé par l’application et version entière positive exigés', () => {
    expect(() => defineAiPrompt({ id: 'summary', version: 1, instructions: 'x' })).toThrow(
      /application/,
    );
    expect(() => defineAiPrompt({ id: 'test.x', version: 0, instructions: 'x' })).toThrow(
      /Version/,
    );
  });
});

describe('Limitation de débit', () => {
  it('par utilisateur puis par organisation, fenêtre glissante d’une minute, par application', () => {
    let now = 0;
    const limiter = new AiRateLimiter(
      { perUserPerMinute: 2, perOrganizationPerMinute: 3 },
      () => now,
    );
    const key = (actorUserId: string, application = 'park') => ({
      application,
      organizationId: 'o',
      actorUserId,
    });
    limiter.hit(key('a'));
    limiter.hit(key('a'));
    expect(() => limiter.hit(key('a'))).toThrow(HttpException);
    limiter.hit(key('b'));
    // Organisation au plafond (3), même pour un autre utilisateur.
    expect(() => limiter.hit(key('c'))).toThrow(/Trop de demandes/);
    // Autre application : compteurs distincts (isolation entre applications).
    limiter.hit(key('c', 'school'));
    now = 60_001;
    limiter.hit(key('a'));
  });
});

describe('Orchestrateur', () => {
  it('succès : réservation avec la version du prompt, consommation enregistrée (coût nul en simulé)', async () => {
    const store = fakeStore();
    const g = gateway(new SimulatedAiProvider());
    g.registerApplication('test-app', store);
    const prompt = defineAiPrompt({ id: 'test.run', version: 3, instructions: 'Réponds.' });
    const value = await g.run(ctx(), { model: 'simulated', prompt }, async () => ({
      value: 'ok',
      usage: USAGE,
    }));
    expect(value).toBe('ok');
    expect(store.calls).toEqual([
      'reserve:test-app:TEST_FEATURE:test.run@3',
      'succeed:usage-1:10:0',
    ]);
  });

  it('erreur du fournisseur : échec enregistré, journal technique sans contenu, message compréhensible', async () => {
    const store = fakeStore();
    const g = gateway(new SimulatedAiProvider());
    g.registerApplication('test-app', store);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const secret = 'Question confidentielle sur un élève';
    const error = await g
      .run(ctx(), { model: 'm', prompt: null }, async () => {
        throw new AiProviderError('AI_TIMEOUT', 'Le service IA ne répond pas.');
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(504);
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'AI_TIMEOUT' });
    expect(store.calls).toEqual(['reserve:test-app:TEST_FEATURE:-@-', 'fail:usage-1:AI_TIMEOUT']);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]![0]);
    expect(line).toContain('AI_TIMEOUT');
    expect(line).toContain('test-app/TEST_FEATURE');
    expect(line).not.toContain(secret);
    warn.mockRestore();
  });

  it('échec après des tours facturés : la consommation déjà rapportée est enregistrée', async () => {
    const store = fakeStore();
    const g = gateway(new SimulatedAiProvider());
    g.registerApplication('test-app', store);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await expect(
      g.run(ctx(), { model: 'm', prompt: null }, async () => {
        throw new AiProviderError('AI_INVALID_OUTPUT', 'Illisible.', USAGE);
      }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(store.calls).toEqual([
      'reserve:test-app:TEST_FEATURE:-@-',
      'fail:usage-1:AI_INVALID_OUTPUT:10:0',
    ]);
  });

  it('erreur d’un outil métier après un appel facturé : statut conservé, code et jetons enregistrés', async () => {
    const store = fakeStore();
    const g = gateway(new SimulatedAiProvider());
    g.registerApplication('test-app', store);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const provider = new SimulatedAiProvider();
    const error = await g
      .run(ctx(), { model: 'm', prompt: null }, () =>
        provider.runWithTools({
          instructions: '',
          question: 'OCALL-SIM:{"calls":[{"name":"rapport","arguments":{}}],"answer":""}:FIN',
          tools: [],
          execute: async () => {
            throw new UnprocessableEntityException({ code: 'REPORT_TOO_LARGE' });
          },
        }),
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(store.calls).toEqual([
      'reserve:test-app:TEST_FEATURE:-@-',
      'fail:usage-1:REPORT_TOO_LARGE:1000:0',
    ]);
  });

  it('refus de réservation (quota, fonctionnalité) : aucun appel au fournisseur', async () => {
    const store = fakeStore();
    store.reserveError = new ForbiddenException({ code: 'AI_FEATURE_DISABLED' });
    const g = gateway(new SimulatedAiProvider());
    g.registerApplication('test-app', store);
    const call = jest.fn();
    await expect(g.run(ctx(), { model: 'm', prompt: null }, call)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(call).not.toHaveBeenCalled();
  });

  it('sans fournisseur : AI_NOT_CONFIGURED ; application non inscrite : refusée', async () => {
    const g = gateway(null);
    g.registerApplication('test-app', fakeStore());
    await expect(g.run(ctx(), { model: 'm', prompt: null }, jest.fn())).rejects.toMatchObject({
      response: { code: 'AI_NOT_CONFIGURED' },
    });
    await expect(
      g.run(ctx({ application: 'inconnue' }), { model: 'm', prompt: null }, jest.fn()),
    ).rejects.toThrow(/non inscrite/);
    expect(() => g.registerApplication('test-app', fakeStore())).toThrow(/déjà inscrite/);
  });

  it('limitation de débit avant toute réservation', async () => {
    const store = fakeStore();
    const g = gateway(new SimulatedAiProvider(), { AI_RATE_LIMIT_USER_PER_MINUTE: '1' });
    g.registerApplication('test-app', store);
    const call = async () => ({ value: 1, usage: USAGE });
    await g.run(ctx(), { model: 'm', prompt: null }, call);
    await expect(g.run(ctx(), { model: 'm', prompt: null }, call)).rejects.toMatchObject({
      response: { code: 'AI_TOO_MANY_REQUESTS' },
    });
    expect(store.calls.filter((c) => c.startsWith('reserve'))).toHaveLength(1);
  });

  it('nettoyage des réservations orphelines de chaque application inscrite', async () => {
    const a = fakeStore();
    const b = fakeStore();
    const g = gateway(new SimulatedAiProvider());
    g.registerApplication('park', a);
    g.registerApplication('school', b);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    expect(await g.releaseOrphans()).toBe(4);
    expect(a.calls).toEqual(['orphans']);
    expect(b.calls).toEqual(['orphans']);
  });
});

describe('Appel d’outils sécurisé', () => {
  const tools = [
    {
      name: 'count',
      description: 'Compte',
      parameters: strictObject({ period: { type: 'string' } }),
      parse: (args: unknown) => exactKeys(args, ['period']),
      run: async (c: { org: string }, args: Record<string, unknown>) => ({
        org: c.org,
        period: args.period,
      }),
      secret: false,
    },
    {
      name: 'secret',
      description: 'Réservé',
      parameters: strictObject({}),
      parse: (args: unknown) => exactKeys(args ?? {}, []),
      run: async () => ({ org: 'x', period: null }),
      secret: true,
    },
  ];

  it('fonction inconnue, refusée, arguments en trop, plafond ; contexte serveur seulement', async () => {
    const ex = toolExecutor({
      tools,
      maxCalls: 4,
      allow: (t) => (t.secret ? 'NOT_ALLOWED' : null),
      context: () => ({ org: 'org-serveur' }),
      present: (r) => r,
    });
    expect(await ex.execute({ name: 'count', arguments: { period: 'today' } })).toEqual({
      org: 'org-serveur',
      period: 'today',
    });
    await ex.execute({ name: 'count', arguments: { period: 'today', organizationId: 'autre' } });
    await ex.execute({ name: 'secret', arguments: {} });
    await ex.execute({ name: 'DROP TABLE', arguments: {} });
    await ex.execute({ name: 'count', arguments: { period: 'today' } });
    expect(ex.rejected).toEqual([
      { name: 'count', reason: 'INVALID_ARGUMENTS' },
      { name: 'secret', reason: 'NOT_ALLOWED' },
      { name: 'DROP TABLE', reason: 'UNKNOWN_FUNCTION' },
      { name: 'count', reason: 'TOO_MANY_CALLS' },
    ]);
    expect(ex.results).toHaveLength(1);
    expect(ex.definitions([tools[0]!])).toEqual([
      { name: 'count', description: 'Compte', parameters: tools[0]!.parameters },
    ]);
  });
});

describe('Fournisseur simulé générique', () => {
  it('consigne OCALL-SIM, panne, scénario inscrit par une application, sinon illisible', async () => {
    const provider = new SimulatedAiProvider();
    await expect(
      provider.structureText({ instructions: '', text: 'OCALL-SIM:{"a":1}:FIN', schemaName: 'x' }),
    ).resolves.toMatchObject({ value: { a: 1 } });
    await expect(
      provider.structureText({ instructions: '', text: 'OCALL-SIM-DOWN', schemaName: 'x' }),
    ).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    await expect(
      provider.structureText({ instructions: '', text: 'rien', schemaName: 'test_schema' }),
    ).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' });
    registerAiSimulation({
      structureText: (r) => (r.schemaName === 'test_schema' ? { simulated: true } : undefined),
    });
    await expect(
      provider.structureText({ instructions: '', text: 'rien', schemaName: 'test_schema' }),
    ).resolves.toMatchObject({ value: { simulated: true } });
  });
});
