import type { MarginAnalytics } from '@ocall/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import type { TenantContext } from '../../common/auth-context';
import { buildExportTable, exportRows, selectColumns } from './analytics-export';
import { resolveAnalyticsScope } from './analytics-scope';
import { csvCell, neutralizeFormula, toCsv } from './csv';

describe('Analyses — CSV et injection de formules', () => {
  it.each([
    ['=HYPERLINK("http://x")', `'=HYPERLINK("http://x")`],
    ['+33 6', `'+33 6`],
    ['-2+3', `'-2+3`],
    ['@SUM(A1)', `'@SUM(A1)`],
    ['\t=1', `'\t=1`],
    ['\r=1', `'\r=1`],
    ['  =1', `'  =1`],
    ['＝1', `'＝1`],
    ['Poulet braisé', 'Poulet braisé'],
    ['Jus — 50 cl', 'Jus — 50 cl'],
  ])('neutralise %j', (input, expected) => {
    expect(neutralizeFormula(input)).toBe(expected);
  });

  it('nombres conservés (négatifs compris), virgule décimale, guillemets échappés', () => {
    expect(csvCell(-1500)).toBe('-1500');
    expect(csvCell(12.5)).toBe('12,5');
    expect(csvCell(null)).toBe('');
    expect(csvCell('Riz; sauce "maison"')).toBe('"Riz; sauce ""maison"""');
    expect(csvCell('=1;2')).toBe(`"'=1;2"`);
  });

  it('fichier : BOM UTF-8, séparateur « ; », CRLF', () => {
    expect(
      toCsv([
        ['a', 1],
        ['b', null],
      ]),
    ).toBe('﻿a;1\r\nb;\r\n');
  });
});

const meta = {
  period: {
    current: {
      from: '2026-10-01T00:00',
      to: '2026-10-08T00:00',
      label: 'du 01/10/2026 au 07/10/2026',
    },
    previous: { from: '2026-09-24T00:00', to: '2026-10-01T00:00', label: 'précédente' },
    days: [],
  },
  establishments: [{ id: 'e1', name: 'Maquis Centre' }],
  activity: 'RESTAURANT' as const,
  timezone: 'Africa/Bamako',
  currency: 'XOF' as const,
  generatedAt: '2026-10-30T12:00:00.000Z',
};

const margins: MarginAnalytics = {
  meta,
  summary: {
    revenue: 12_000,
    revenueCosted: 8_000,
    revenueUncosted: 4_000,
    materialCost: 3_100,
    grossMargin: 4_900,
    marginRate: 61.3,
    complete: false,
  },
  rows: [
    {
      establishmentId: 'e1',
      establishment: 'Maquis Centre',
      variantId: 'v1',
      product: '=Poulet braisé',
      variant: 'Standard',
      category: 'Plats',
      quantity: 2,
      revenue: 8_000,
      unitPrice: 4_000,
      unitCost: 1_550,
      materialCost: 3_100,
      margin: 4_900,
      marginRate: 61.3,
      gap: null,
      missingCosts: [],
    },
    {
      establishmentId: 'e1',
      establishment: 'Maquis Centre',
      variantId: 'v2',
      product: 'Tiramisu',
      variant: 'Standard',
      category: 'Desserts',
      quantity: 2,
      revenue: 4_000,
      unitPrice: 2_000,
      unitCost: null,
      materialCost: null,
      margin: null,
      marginRate: null,
      gap: 'MISSING_COST',
      missingCosts: ['Mascarpone'],
    },
  ],
  categories: [],
  costs: [],
};

describe('Analyses — exports', () => {
  it('marges : estimation signalée, incomplétude explicite, formule neutralisée', () => {
    const table = buildExportTable({ report: 'margins', data: margins });
    const csv = toCsv(exportRows(table, meta, 'margins'));
    expect(csv).toContain('Marge brute ESTIMÉE');
    expect(csv).toContain('pas un bénéfice net');
    expect(csv).toContain('Marge INCOMPLÈTE : 4000 FCFA');
    expect(csv).toContain("'=Poulet braisé");
    expect(csv).toContain('Coût d’achat manquant pour un ingrédient (Mascarpone)');
    expect(csv).toContain('Fuseau horaire;Africa/Bamako');
    expect(csv).toContain('Devise;FCFA (XOF), montants TTC');
  });

  it('indicateurs sélectionnés : colonnes connues uniquement', () => {
    const table = buildExportTable({ report: 'margins', data: margins });
    expect(selectColumns(table, ['product', 'margin'])!.columns.map((c) => c.key)).toEqual([
      'product',
      'margin',
    ]);
    expect(selectColumns(table, ['product', 'password'])).toBeNull();
    expect(selectColumns(table, null)).toBe(table);
  });
});

describe('Analyses — périmètre résolu par le serveur', () => {
  const establishments = [
    { id: 'r1', name: 'Resto', timezone: 'Africa/Bamako', businessType: 'RESTAURANT' },
    { id: 'p1', name: 'Parc', timezone: 'Africa/Bamako', businessType: 'PARK' },
  ];
  const prisma = (rows = establishments) =>
    ({
      establishment: { findMany: jest.fn().mockResolvedValue(rows) },
    }) as unknown as PrismaService;
  const tenant = (role: 'OWNER' | 'SUPERVISOR', businessType = 'PARK_RESTAURANT') =>
    ({
      membership: {
        id: 'm1',
        role,
        organizationId: 'org-1',
        organizationName: 'Org',
        businessType,
        timezone: 'Africa/Bamako',
      },
    }) as unknown as TenantContext;
  const now = new Date('2026-10-30T12:00:00Z');

  it("l'organisation vient de la session ; un superviseur ne voit que ses affectations", async () => {
    const db = prisma();
    const scope = await resolveAnalyticsScope(db, tenant('SUPERVISOR'), {}, { now });
    expect(scope.organizationId).toBe('org-1');
    const where = (db.establishment.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where).toEqual({
      organizationId: 'org-1',
      assignments: { some: { membershipId: 'm1' } },
    });
    expect(scope.activities).toEqual(['PARK', 'RESTAURANT']);
  });

  it('établissement inaccessible ou d’une autre organisation : introuvable', async () => {
    await expect(
      resolveAnalyticsScope(prisma(), tenant('OWNER'), { establishmentId: 'autre' }, { now }),
    ).rejects.toMatchObject({ response: { code: 'ESTABLISHMENT_NOT_FOUND' } });
  });

  it('activité filtrée : établissements de cette activité uniquement ; activité hors métier refusée', async () => {
    const scope = await resolveAnalyticsScope(
      prisma(),
      tenant('OWNER'),
      {},
      {
        now,
        activity: 'PARK',
      },
    );
    expect(scope.establishmentIds).toEqual(['p1']);
    await expect(
      resolveAnalyticsScope(prisma([establishments[0]!]), tenant('OWNER', 'RESTAURANT'), {
        activity: 'PARK',
      }),
    ).rejects.toMatchObject({ response: { code: 'ACTIVITY_NOT_COVERED' } });
  });

  it('période invalide : erreur explicite, pas de période approximative', async () => {
    await expect(
      resolveAnalyticsScope(prisma(), tenant('OWNER'), {
        period: 'custom',
        from: '2024-01-01',
        to: '2026-01-01',
      }),
    ).rejects.toMatchObject({ response: { code: 'PERIOD_RANGE_TOO_LONG' } });
  });
});
