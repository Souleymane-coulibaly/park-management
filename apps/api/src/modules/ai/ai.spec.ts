import { loadAiConfig } from './ai.config';
import { ANALYTICS_TOOLS } from './copilot/analytics-tools';
import { normalizeCatalog, normalizeTickets } from './imports/import-extraction';
import { SimulatedAiProvider } from './providers/simulated.provider';

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
    ]);
    for (const t of ANALYTICS_TOOLS)
      expect(t.parameters).toMatchObject({ additionalProperties: false });
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
