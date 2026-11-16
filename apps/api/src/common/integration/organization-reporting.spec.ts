import { resolveAnalyticsPeriod } from '@ocall/shared';
import type { TenantContext } from '../auth-context';
import {
  type OrgReportConnector,
  type OrgReportQuery,
  OrganizationReportingRegistry,
  detailHref,
  orgMetric,
  orgReportKeeps,
} from './organization-reporting';

const now = new Date('2026-11-15T10:00:00Z');
const period = resolveAnalyticsPeriod({ period: 'this_month' }, now, 'Africa/Bamako');
if ('error' in period) throw new Error('période');

const query = (overrides: Partial<OrgReportQuery> = {}): OrgReportQuery => ({
  auth: {} as TenantContext,
  period,
  days: { from: '2026-11-01', to: '2026-11-15' },
  previousDays: { from: '2026-10-01', to: '2026-10-15' },
  timezone: 'Africa/Bamako',
  currency: 'XOF',
  establishmentIds: null,
  unassigned: true,
  now,
  ...overrides,
});

const connector = (
  product: string,
  order: number,
  report: OrgReportConnector['report'],
): OrgReportConnector => ({ product, label: product, order, href: `/${product}`, report });

describe('Ocall Suite étape 5 — registre des connecteurs analytiques', () => {
  it('blocs dans l’ordre, application sans droit absente, panne et délai « indisponibles »', async () => {
    const registry = new OrganizationReportingRegistry();
    const ok = {
      metrics: [orgMetric({ id: 'n', label: 'N', nature: 'count', value: 3 })],
      siteMetrics: [],
      bySite: [],
    };
    registry.register(connector('LENT', 40, () => new Promise(() => undefined)));
    registry.register(connector('PANNE', 30, async () => Promise.reject(new Error('base'))));
    registry.register(connector('SANS_DROIT', 20, async () => null));
    registry.register(connector('OK', 10, async () => ok));
    const blocks = await registry.collect(query(), 50);
    expect(blocks.map((b) => [b.product, b.status])).toEqual([
      ['OK', 'ok'],
      ['PANNE', 'unavailable'],
      ['LENT', 'unavailable'],
    ]);
    expect(blocks[0]!.metrics[0]).toMatchObject({ value: 3, previous: null, currency: null });
    expect(blocks[1]).toMatchObject({
      metrics: [],
      bySite: [],
      message: expect.stringContaining('indisponibles'),
    });
  });

  it('un connecteur futur (Ocall Print, Sabatii…) s’inscrit sans toucher au tableau de bord', async () => {
    const registry = new OrganizationReportingRegistry();
    registry.register(
      connector('OCALL_PRINT', 60, async (q) => ({
        metrics: [
          orgMetric({ id: 'jobs', label: 'Travaux', nature: 'count', value: q.days.from.length }),
        ],
        siteMetrics: ['jobs'],
        bySite: [{ establishmentId: null, values: { jobs: 1 } }],
      })),
    );
    const [block] = await registry.collect(query());
    expect(block).toMatchObject({ product: 'OCALL_PRINT', status: 'ok', siteMetrics: ['jobs'] });
  });

  it('filtre : un établissement, « Non rattaché », tous', () => {
    const one = query({ establishmentIds: ['e1'], unassigned: false });
    expect(orgReportKeeps(one, 'e1')).toBe(true);
    expect(orgReportKeeps(one, 'e2')).toBe(false);
    expect(orgReportKeeps(one, null)).toBe(false);
    const none = query({ establishmentIds: [], unassigned: true });
    expect(orgReportKeeps(none, 'e1')).toBe(false);
    expect(orgReportKeeps(none, null)).toBe(true);
    const all = query();
    expect(orgReportKeeps(all, 'e1')).toBe(true);
    expect(orgReportKeeps(all, null)).toBe(true);
  });

  it('lien du détail : même période et même établissement, paramètres retirés à la demande', () => {
    expect(detailHref('/facture', query({ establishmentIds: ['e1'], unassigned: false }))).toBe(
      '/facture?period=custom&from=2026-11-01&to=2026-11-15&establishmentId=e1',
    );
    expect(detailHref('/stock', query({ establishmentIds: [], unassigned: true }))).toBe(
      '/stock?period=custom&from=2026-11-01&to=2026-11-15&establishmentId=none',
    );
    expect(detailHref('/school/rapports', query(), { period: null, from: null, to: null })).toBe(
      '/school/rapports',
    );
  });
});
