import { loadAiConfig } from './ai.config';
import { ANALYTICS_TOOLS } from './copilot/analytics-tools';
import { normalizeCatalog, normalizeTickets } from './imports/import-extraction';
import { numbersAreGrounded } from '@ocall/shared';
import { SimulatedAiProvider, stripSimulationDirectives } from './providers/simulated.provider';

/**
 * Tests unitaires (sans base) des règles IA du serveur. Les parcours complets sont couverts par
 * test/sprint8-ia.integration.spec.ts, avec le fournisseur SIMULÉ.
 */
describe('Configuration IA : aucun appel réel par oubli', () => {
  it('sans configuration : IA désactivée', () => {
    expect(loadAiConfig({}, 'development').provider).toBe('none');
  });

  it('OpenAI exige la clé ET l’autorisation explicite des appels réels', () => {
    expect(() => loadAiConfig({ AI_PROVIDER: 'openai' }, 'development')).toThrow(/OPENAI_API_KEY/);
    expect(() =>
      loadAiConfig({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' }, 'development'),
    ).toThrow(/AI_REAL_CALLS_ENABLED/);
    const config = loadAiConfig(
      { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test', AI_REAL_CALLS_ENABLED: 'true' },
      'development',
    );
    expect(config.models.COPILOT).toBe('gpt-5');
    expect(config.transcribeModel).toBe('gpt-transcribe');
  });

  it('modèle réglable par fonctionnalité ; simulé interdit en production', () => {
    const config = loadAiConfig(
      { AI_PROVIDER: 'simulated', OPENAI_MODEL_COPILOT: 'gpt-5-mini' },
      'development',
    );
    expect(config.models).toMatchObject({ COPILOT: 'gpt-5-mini', CATALOG_IMPORT: 'gpt-5' });
    expect(() => loadAiConfig({ AI_PROVIDER: 'simulated' }, 'production')).toThrow(/production/);
  });
});

describe('Import IA : la réponse du modèle est revalidée par le serveur', () => {
  const item = (over: Record<string, unknown>) => ({
    name: 'Poulet braisé',
    description: null,
    category: 'Plats',
    price: 4000,
    priceText: '4.000 F',
    priceUncertain: false,
    variants: [],
    availability: null,
    sourceText: 'Poulet braisé ...... 4.000 F',
    uncertain: false,
    ...over,
  });
  const doc = (...items: unknown[]) => ({ readable: true, currency: 'FCFA', warnings: [], items });

  it('reprend un prix lu dans le texte', () => {
    const { lines, readable } = normalizeCatalog(doc(item({})), []);
    expect(readable).toBe(true);
    expect(lines[0]).toMatchObject({ name: 'Poulet braisé', category: 'Plats', issues: [] });
    expect(lines[0]!.variants).toEqual([{ name: 'Standard', price: 4000, priceText: '4.000 F' }]);
  });

  it('prix absent : null, jamais inventé', () => {
    const { lines } = normalizeCatalog(doc(item({ price: null, priceText: null })), []);
    expect(lines[0]!.variants[0]!.price).toBeNull();
    expect(lines[0]!.issues).toContain('PRICE_MISSING');
  });

  it('prix annoncé mais absent du texte lu : retiré', () => {
    const { lines } = normalizeCatalog(doc(item({ price: 500, priceText: '1 500 F' })), []);
    expect(lines[0]!.variants[0]!.price).toBeNull();
    expect(lines[0]!.issues).toContain('PRICE_WITHOUT_SOURCE');
  });

  it('prix ambigu : conservé mais signalé ; prix hors limites : retiré', () => {
    const ambiguous = normalizeCatalog(doc(item({ priceUncertain: true })), []).lines[0]!;
    expect(ambiguous.variants[0]!.price).toBe(4000);
    expect(ambiguous.issues).toContain('PRICE_UNCERTAIN');
    const invalid = normalizeCatalog(doc(item({ price: -5, priceText: '-5' })), []).lines[0]!;
    expect(invalid.variants[0]!.price).toBeNull();
    expect(invalid.issues).toContain('PRICE_INVALID');
  });

  it('doublons : avec le catalogue existant et dans le document', () => {
    const { lines } = normalizeCatalog(doc(item({}), item({ name: 'POULET BRAISE' })), [
      { id: 'p1', name: 'Poulet braisé' },
    ]);
    expect(lines[0]!.duplicateOf).toEqual({ id: 'p1', name: 'Poulet braisé' });
    expect(lines[0]!.issues).toEqual(
      expect.arrayContaining(['DUPLICATE_EXISTING', 'DUPLICATE_IN_IMPORT']),
    );
  });

  it('document illisible ou réponse malformée : aucune ligne', () => {
    expect(normalizeCatalog({ readable: false, items: [] }, [])).toMatchObject({
      readable: false,
      lines: [],
    });
    expect(normalizeCatalog('n’importe quoi', []).lines).toEqual([]);
    expect(normalizeCatalog({ readable: true, items: [{ name: '' }, 42] }, []).lines).toEqual([]);
  });

  it('devise inattendue signalée ; type de billet inconnu → Personnalisée', () => {
    const catalog = normalizeCatalog({ ...doc(item({})), currency: 'EUR' }, []);
    expect(catalog.lines[0]!.issues).toContain('CURRENCY_UNEXPECTED');
    const tickets = normalizeTickets(
      {
        readable: true,
        currency: 'FCFA',
        warnings: [],
        items: [
          {
            name: 'Pass VIP',
            kind: 'VIP',
            price: 10000,
            priceText: '10 000 F',
            priceUncertain: false,
            peopleIncluded: 999,
            conditions: null,
            sourceText: 'Pass VIP 10 000 F',
            uncertain: false,
          },
        ],
      },
      [],
    );
    expect(tickets.lines[0]).toMatchObject({ kind: 'CUSTOM', price: 10000, peopleIncluded: 50 });
    expect(tickets.lines[0]!.issues).toContain('KIND_UNKNOWN');
  });
});

describe('Copilote : arguments stricts, aucun établissement fourni par le modèle', () => {
  const tool = (name: string) => ANALYTICS_TOOLS.find((t) => t.name === name)!;

  it('accepte les paramètres prévus', () => {
    expect(tool('revenue_summary').parse({ period: 'today', activity: 'ALL' })).toEqual({
      period: 'today',
      activity: 'ALL',
    });
    expect(tool('top_products').parse({ period: 'this_week', limit: 5 })).toEqual({
      period: 'this_week',
      limit: 5,
    });
    expect(tool('low_stock').parse({})).toEqual({});
  });

  it('refuse un établissement, une période libre ou une limite hors bornes', () => {
    expect(
      tool('revenue_summary').parse({ period: 'today', activity: 'ALL', establishmentId: 'x' }),
    ).toBeNull();
    expect(tool('park_entries').parse({ period: '2020-01-01' })).toBeNull();
    expect(tool('top_products').parse({ period: 'today', limit: 1000 })).toBeNull();
    expect(tool('low_stock').parse({ sql: 'DROP TABLE' })).toBeNull();
  });

  it('aucune fonction d’écriture dans le registre', () => {
    const names = ANALYTICS_TOOLS.map((t) => t.name);
    expect(names).toEqual([
      'revenue_summary',
      'top_products',
      'low_stock',
      'park_entries',
      'best_day',
      'prepared_orders',
      'ticket_sales',
      'product_hourly_sales',
      'top_products_revenue',
      'busiest_hours',
      'busiest_park_day',
      'category_margins',
    ]);
    for (const t of ANALYTICS_TOOLS)
      expect(t.parameters).toMatchObject({ additionalProperties: false });
  });
});

describe('Copilote enrichi (Sprint 9B) : analyses du Sprint 9, lecture seule', () => {
  const tool = (name: string) => ANALYTICS_TOOLS.find((t) => t.name === name)!;
  const ctx = (
    analytics: Record<string, jest.Mock>,
    products: { id: string; name: string }[] = [],
  ) =>
    ({
      prisma: { product: { findMany: jest.fn().mockResolvedValue(products) } },
      organizationId: 'org-1',
      establishment: { id: 'est-1', name: 'Maquis', timezone: 'Africa/Bamako' },
      now: new Date('2026-10-30T15:00:00Z'),
      analytics,
    }) as never;

  it('arguments stricts : plage horaire bornée et ordonnée, produit borné, aucune clé en plus', () => {
    const t = tool('product_hourly_sales');
    expect(
      t.parse({ period: 'this_week', product: 'poulets braisés', hour_from: 12, hour_to: 14 }),
    ).toEqual({ period: 'this_week', product: 'poulets braisés', hourFrom: 12, hourTo: 14 });
    expect(t.parse({ period: 'today', product: '', hour_from: 14, hour_to: 12 })).toBeNull();
    expect(t.parse({ period: 'today', product: '', hour_from: 0, hour_to: 25 })).toBeNull();
    expect(
      t.parse({ period: 'today', product: 'x'.repeat(81), hour_from: 1, hour_to: 2 }),
    ).toBeNull();
    expect(
      t.parse({ period: 'today', product: '', hour_from: 1, hour_to: 2, establishmentId: 'x' }),
    ).toBeNull();
    expect(tool('top_products_revenue').parse({ period: 'today', limit: 11 })).toBeNull();
    expect(tool('category_margins').permission).toBe('analytics.margins');
  });

  it('produit retrouvé par le serveur (pluriel, accents) puis analyse du Sprint 9 avec son identifiant', async () => {
    const restaurantHourly = jest.fn().mockResolvedValue({
      rows: [
        {
          productId: 'p1',
          product: 'Poulet braisé',
          category: 'Plats',
          hour: 12,
          quantity: 5,
          revenue: 20000,
        },
      ],
      hours: [
        { hour: 12, orders: 2, quantity: 5, revenue: 20000 },
        { hour: 13, orders: 0, quantity: 0, revenue: 0 },
      ],
    });
    const result = await tool('product_hourly_sales').run(
      ctx({ restaurantHourly }, [
        { id: 'p1', name: 'Poulet braisé' },
        { id: 'p2', name: 'Jus de bissap' },
      ]),
      { period: 'this_week', product: 'poulets braises', hourFrom: 12, hourTo: 14 },
    );
    const [scope, filters] = restaurantHourly.mock.calls[0];
    expect(scope).toMatchObject({
      organizationId: 'org-1',
      establishmentIds: ['est-1'],
      activities: ['RESTAURANT'],
    });
    expect(filters).toEqual({ hourFrom: 12, hourTo: 14, weekday: null, productId: 'p1' });
    expect(result.data).toMatchObject({ product: 'Poulet braisé', quantity: 5, amountXof: 20000 });
  });

  it('produit introuvable ou ambigu : signalé, aucune analyse lancée, rien d’inventé', async () => {
    const restaurantHourly = jest.fn();
    const ambiguous = await tool('product_hourly_sales').run(
      ctx({ restaurantHourly }, [
        { id: 'p1', name: 'Poulet braisé' },
        { id: 'p2', name: 'Poulet yassa' },
      ]),
      { period: 'today', product: 'poulet', hourFrom: 12, hourTo: 13 },
    );
    expect(ambiguous.missing[0]).toContain('précisez');
    expect(ambiguous.data).toMatchObject({
      product: null,
      candidates: ['Poulet braisé', 'Poulet yassa'],
    });
    const unknown = await tool('product_hourly_sales').run(ctx({ restaurantHourly }, []), {
      period: 'today',
      product: 'pizza',
      hourFrom: 12,
      hourTo: 13,
    });
    expect(unknown.missing[0]).toContain('Aucun produit');
    expect(restaurantHourly).not.toHaveBeenCalled();
  });

  it('marges : estimation signalée, catégorie la plus rentable parmi les coûts complets seulement', async () => {
    const margins = jest.fn().mockResolvedValue({
      categories: [
        {
          category: 'Desserts',
          revenue: 9000,
          materialCost: 0,
          margin: 0,
          marginRate: null,
          complete: false,
        },
        {
          category: 'Plats',
          revenue: 8000,
          materialCost: 3100,
          margin: 4900,
          marginRate: 61.3,
          complete: true,
        },
      ],
    });
    const r = await tool('category_margins').run(ctx({ margins }), { period: 'this_month' });
    expect(r.data).toMatchObject({ mostProfitable: 'Plats' });
    expect(String(r.data.note)).toContain('estimée');
    expect(r.missing.join(' ')).toContain('Desserts');
  });
});

describe('Copilote : la consigne simulée ne compte pas parmi les données autorisées', () => {
  it('retire la consigne, garde le reste de la question', () => {
    const question = 'Combien hier ? OCALL-SIM:{"answer":"Vous avez vendu 999 poulets."}:FIN merci';
    const cleaned = stripSimulationDirectives(question);
    expect(cleaned).not.toContain('999');
    expect(cleaned).toContain('Combien hier ?');
    expect(cleaned).toContain('merci');
    expect(numbersAreGrounded('Vous avez vendu 999 poulets.', `${cleaned} [{"quantity":2}]`)).toBe(
      false,
    );
  });

  it('consigne non terminée : retirée jusqu’à la fin', () => {
    expect(stripSimulationDirectives('Q OCALL-SIM:{"answer":"42"}')).not.toContain('42');
  });
});

describe('Fournisseur simulé (tests déterministes)', () => {
  const provider = new SimulatedAiProvider();

  it('commande vocale : quantités, produits du catalogue, table, quantité incertaine', async () => {
    const text = [
      'CATALOGUE (JSON) :',
      JSON.stringify([
        { ref: 'p1', name: 'Poulet braisé' },
        { ref: 'p2', name: 'Jus de bissap' },
      ]),
      'TABLES (JSON) :',
      JSON.stringify([{ ref: 't1', name: 'Table 5' }]),
      'TRANSCRIPTION : Deux poulets braisés, quelques jus de bissap et un tiramisu pour la table 5.',
    ].join('\n');
    const { value } = await provider.structureText<{
      lines: Array<{ ref: string | null; quantity: number | null }>;
      tableRef: string | null;
    }>({ text, schemaName: 'voice_order' });
    expect(value.tableRef).toBe('t1');
    expect(value.lines).toEqual([
      expect.objectContaining({ ref: 'p1', quantity: 2 }),
      expect.objectContaining({ ref: 'p2', quantity: null }),
      expect.objectContaining({ ref: null, quantity: 1 }),
    ]);
  });

  it('panne simulée', async () => {
    await expect(
      provider.transcribe({ audio: Buffer.from('OCALL-SIM-DOWN') }),
    ).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
  });
});

describe('Fournisseur simulé — questions du Sprint 9B', () => {
  const provider = new SimulatedAiProvider();
  const callFor = async (question: string) => {
    const calls: unknown[] = [];
    await provider.runWithTools({
      question,
      tools: [],
      execute: async (c) => {
        calls.push(c);
        return {};
      },
    });
    return calls[0];
  };

  it.each([
    [
      'Combien de poulets braisés ont été vendus entre 12 h et 14 h cette semaine ?',
      {
        name: 'product_hourly_sales',
        arguments: { period: 'this_week', product: 'poulets braises', hour_from: 12, hour_to: 14 },
      },
    ],
    [
      'Quel produit rapporte le plus à 19 h aujourd’hui ?',
      {
        name: 'product_hourly_sales',
        arguments: { period: 'today', product: '', hour_from: 19, hour_to: 20 },
      },
    ],
    [
      'Quel produit a généré le plus de revenus cette semaine ?',
      { name: 'top_products_revenue', arguments: { period: 'this_week', limit: 5 } },
    ],
    [
      'Quelles heures génèrent le plus de commandes ce mois-ci ?',
      { name: 'busiest_hours', arguments: { period: 'this_month' } },
    ],
    [
      'Quel est le jour le plus fréquenté du parc ces 30 derniers jours ?',
      { name: 'busiest_park_day', arguments: { period: 'last_30_days' } },
    ],
    [
      'Quelle catégorie est la plus rentable ce mois-ci ?',
      { name: 'category_margins', arguments: { period: 'this_month' } },
    ],
  ])('%s', async (question, expected) => {
    expect(await callFor(question)).toEqual(expected);
  });
});
