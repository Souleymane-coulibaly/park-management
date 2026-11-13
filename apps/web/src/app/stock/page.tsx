'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AlertTriangle, Banknote, Boxes, ShoppingCart } from 'lucide-react';
import { formatStockQuantity, formatXof } from '@ocall/shared';
import { BarChart, Section, formatPct, shortDate } from '@/components/analytics/charts';
import { ScanField, type ScanFeedback } from '@/components/scan/scan-field';
import { StockPage } from '@/components/stock/stock-page';
import { type StockLookup, type StockSiteView, asApiError } from '@/components/stock/stock-types';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { KpiCard } from '@/components/ui/kpi-card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface DashboardView {
  period: { from: string; to: string };
  sales: {
    count: number;
    revenue: number;
    revenueHt: number;
    refunds: number;
    netRevenue: number;
    averageBasket: number;
    byDay: { day: string; count: number; revenue: number }[];
    top: { variantId: string; label: string; sku: string; quantity: number; revenue: number }[];
    margins: {
      revenueHt: number;
      estimated: number | null;
      estimatedRate: number | null;
      estimatedExcluded: number;
      gross: number | null;
      grossRate: number | null;
      grossExcluded: number;
      netProfit: null;
    } | null;
  } | null;
  stock: {
    value: number | null;
    valuedFromProduct: number | null;
    unvalued: number | null;
    variants: number;
  } | null;
  alerts: { outOfStock: number; low: number; slowMoving: number } | null;
  purchases: { orders: number; receipts: number; receivedValue: number | null } | null;
  variances: {
    adjustments: number;
    surplus: number;
    shortage: number;
    value: number | null;
  } | null;
  sites: {
    id: string;
    code: string;
    name: string;
    revenue: number | null;
    salesCount: number | null;
    stockValue: number | null;
  }[];
  methods: Record<string, string>;
}

const PRESETS = [
  { value: '7', label: '7 derniers jours' },
  { value: '30', label: '30 derniers jours' },
  { value: '90', label: '90 derniers jours' },
  { value: 'custom', label: 'Période choisie' },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const money = (n: number | null) => (n === null ? '—' : formatXof(n));

/** Jours de la période, ventes nulles comprises (une barre par jour). */
function everyDay(from: string, to: string, byDay: { day: string; revenue: number }[]) {
  const values = new Map(byDay.map((d) => [d.day, d.revenue]));
  const out: { key: string; label: string; value: number }[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86_400_000) {
    const day = iso(new Date(t));
    out.push({ key: day, label: shortDate(day), value: values.get(day) ?? 0 });
  }
  return out;
}

/**
 * Tableau de bord Ocall Stock (S6) : ventes, marges (méthodes affichées), valeur du stock, alertes, achats,
 * écarts d'inventaire et performance par site ; accès rapide par scan.
 */
export default function StockHomePage() {
  return (
    <StockPage title="Tableau de bord" description="Ventes, marges, stock, alertes et achats.">
      {({ context, canWrite }) => (
        <Home role={context.roleLabel} canCreate={canWrite('stock.catalog.manage')} />
      )}
    </StockPage>
  );
}

function Home({ role, canCreate }: { role: string; canCreate: boolean }) {
  const [preset, setPreset] = useState('30');
  const today = useMemo(() => iso(new Date()), []);
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86_400_000)));
  const [to, setTo] = useState(today);
  const [siteId, setSiteId] = useState('');
  const sites = useApi<StockSiteView[]>('/ocall-stock/sites');
  const range =
    preset === 'custom'
      ? { from, to }
      : { from: iso(new Date(Date.now() - (Number(preset) - 1) * 86_400_000)), to: today };
  const dashboard = useApi<DashboardView>(
    `/ocall-stock/reports/dashboard?${new URLSearchParams({ ...range, ...(siteId ? { siteId } : {}) })}`,
  );

  return (
    <>
      <Card>
        <CardBody className="grid gap-3 sm:grid-cols-4 sm:items-end">
          <SelectField
            label="Période"
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            options={PRESETS}
          />
          {preset === 'custom' && (
            <>
              <InputField
                label="Du"
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
              />
              <InputField
                label="Au"
                type="date"
                value={to}
                min={from}
                max={today}
                onChange={(e) => setTo(e.target.value)}
              />
            </>
          )}
          <SelectField
            label="Site"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            options={[
              { value: '', label: 'Tous les sites' },
              ...(sites.state === 'success' ? sites.data : [])
                .filter((s) => !s.isArchived)
                .map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` })),
            ]}
          />
        </CardBody>
      </Card>
      {dashboard.state === 'loading' && <LoadingState />}
      {dashboard.state === 'error' && (
        <ErrorState error={dashboard.error} onRetry={dashboard.reload} />
      )}
      {dashboard.state === 'success' && <Dashboard d={dashboard.data} />}
      <QuickAccess role={role} canCreate={canCreate} />
    </>
  );
}

function Dashboard({ d }: { d: DashboardView }) {
  const s = d.sales;
  const days = s ? everyDay(d.period.from, d.period.to, s.byDay) : [];
  return (
    <div className="space-y-6" data-testid="stock-dashboard">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {s && (
          <KpiCard
            label="Chiffre d’affaires net"
            icon={<Banknote className="h-5 w-5" aria-hidden />}
            value={formatXof(s.netRevenue)}
            hint={`${s.count} vente(s) · panier moyen ${formatXof(s.averageBasket)}${s.refunds ? ` · remboursé ${formatXof(s.refunds)}` : ''}`}
          />
        )}
        {s?.margins && (
          <KpiCard
            label="Marge brute"
            icon={<ShoppingCart className="h-5 w-5" aria-hidden />}
            value={money(s.margins.gross)}
            hint={`Taux ${formatPct(s.margins.grossRate)} · estimée ${money(s.margins.estimated)}`}
          />
        )}
        {d.stock && d.stock.value !== null && (
          <KpiCard
            label="Valeur du stock"
            icon={<Boxes className="h-5 w-5" aria-hidden />}
            value={formatXof(d.stock.value)}
            hint={`${d.stock.variants} article(s) en stock${d.stock.unvalued ? ` · ${d.stock.unvalued} non valorisé(s)` : ''}`}
          />
        )}
        {d.alerts && (
          <KpiCard
            label="Alertes"
            accent="terracotta"
            icon={<AlertTriangle className="h-5 w-5" aria-hidden />}
            value={
              <Link href="/stock/alertes" className="underline">
                {d.alerts.outOfStock + d.alerts.low}
              </Link>
            }
            hint={`${d.alerts.outOfStock} rupture(s) · ${d.alerts.low} sous le seuil · ${d.alerts.slowMoving} à faible rotation`}
          />
        )}
      </div>

      {s && (
        <Section
          title="Ventes par jour"
          description={`Ventes encaissées en caisse, TTC, du ${shortDate(d.period.from)} au ${shortDate(d.period.to)}.`}
        >
          <BarChart
            label="Chiffre d’affaires par jour"
            data={days}
            format={formatXof}
            labelEvery={Math.max(1, Math.ceil(days.length / 10))}
          />
        </Section>
      )}

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        {s && (
          <Section
            title="Meilleures ventes"
            description="Par chiffre d’affaires TTC, retours déduits."
          >
            {s.top.length === 0 ? (
              <p className="text-sm text-muted">Aucune vente sur la période.</p>
            ) : (
              <div data-testid="stock-dashboard-top">
                <Table head={['Article', 'Quantité', 'CA TTC']}>
                  {s.top.map((t) => (
                    <tr key={t.variantId}>
                      <Td>
                        <span className="block font-semibold">{t.label}</span>
                        <span className="text-xs text-muted">{t.sku}</span>
                      </Td>
                      <Td>{formatStockQuantity(t.quantity)}</Td>
                      <Td>{formatXof(t.revenue)}</Td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}
          </Section>
        )}
        {s?.margins && (
          <Section title="Marges" description="Chaque chiffre avec sa méthode de calcul.">
            <dl className="space-y-3 text-sm" data-testid="stock-dashboard-margins">
              <Metric
                label="CA hors taxe"
                value={formatXof(s.margins.revenueHt)}
                method={d.methods.revenue ?? ''}
              />
              <Metric
                label="Marge estimée"
                value={`${money(s.margins.estimated)} (${formatPct(s.margins.estimatedRate)})`}
                method={`${d.methods.estimatedMargin ?? ''}${s.margins.estimatedExcluded ? ` Exclus : ${s.margins.estimatedExcluded}.` : ''}`}
              />
              <Metric
                label="Marge brute"
                value={`${money(s.margins.gross)} (${formatPct(s.margins.grossRate)})`}
                method={`${d.methods.grossMargin ?? ''}${s.margins.grossExcluded ? ` Exclus : ${s.margins.grossExcluded}.` : ''}`}
              />
              <Metric label="Bénéfice net" value="Non calculé" method={d.methods.netProfit ?? ''} />
            </dl>
          </Section>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        {d.stock && d.stock.value !== null && (
          <Section title="Valeur du stock" description={d.methods.stockValue}>
            <p className="text-2xl font-bold">{formatXof(d.stock.value)}</p>
            {!!d.stock.valuedFromProduct && (
              <p className="text-sm text-muted">
                {d.stock.valuedFromProduct} ligne(s) valorisée(s) au prix d’achat de la fiche, faute
                de réception.
              </p>
            )}
          </Section>
        )}
        {(d.purchases || d.variances) && (
          <Section title="Achats et inventaires">
            <dl className="space-y-2 text-sm" data-testid="stock-dashboard-purchases">
              {d.purchases && (
                <>
                  <Row label="Commandes fournisseurs passées" value={String(d.purchases.orders)} />
                  <Row
                    label="Réceptions"
                    value={`${d.purchases.receipts}${d.purchases.receivedValue !== null ? ` · ${formatXof(d.purchases.receivedValue)} HT` : ''}`}
                  />
                </>
              )}
              {d.variances && (
                <>
                  <Row
                    label="Écarts d’inventaire"
                    value={`${d.variances.adjustments} ligne(s) · +${formatStockQuantity(d.variances.surplus)} / −${formatStockQuantity(d.variances.shortage)}`}
                  />
                  {d.variances.value !== null && (
                    <Row label="Valeur nette des écarts" value={formatXof(d.variances.value)} />
                  )}
                </>
              )}
            </dl>
          </Section>
        )}
      </div>

      {d.sites.length > 1 && (
        <Section title="Performance par site">
          <div data-testid="stock-dashboard-sites">
            <Table head={['Site', 'Ventes', 'CA TTC', 'Valeur du stock']}>
              {d.sites.map((site) => (
                <tr key={site.id}>
                  <Td>
                    {site.code} · {site.name}
                  </Td>
                  <Td>{site.salesCount ?? '—'}</Td>
                  <Td>{money(site.revenue)}</Td>
                  <Td>{money(site.stockValue)}</Td>
                </tr>
              ))}
            </Table>
          </div>
        </Section>
      )}
    </div>
  );
}

function Metric({ label, value, method }: { label: string; value: string; method: string }) {
  return (
    <div>
      <dt className="flex flex-wrap justify-between gap-2">
        <span className="font-semibold">{label}</span>
        <span>{value}</span>
      </dt>
      <dd className="text-xs text-muted">{method}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function QuickAccess({ role, canCreate }: { role: string; canCreate: boolean }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<ScanFeedback>(null);

  async function onScan(code: string) {
    try {
      const found = await api<StockLookup>(`/ocall-stock/lookup?code=${encodeURIComponent(code)}`);
      if (found.found) {
        setFeedback({ tone: 'ok', message: `${found.product.name} (${found.variant.sku})` });
        router.push(`/stock/articles/${found.product.id}`);
      } else {
        setFeedback({ tone: 'warn', message: `Code inconnu : ${code}` });
      }
    } catch (e) {
      setFeedback({ tone: 'error', message: asApiError(e).message });
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
      <Card>
        <CardHeader title="Retrouver un article" />
        <CardBody>
          <ScanField onScan={onScan} feedback={feedback} testId="stock-home-scan" />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Raccourcis" description={`Votre rôle : ${role}`} />
        <CardBody className="flex flex-wrap gap-3">
          {canCreate && <ButtonLink href="/stock/articles?nouveau=1">Nouvel article</ButtonLink>}
          <ButtonLink href="/stock/articles" variant="secondary">
            Catalogue
          </ButtonLink>
          <ButtonLink href="/stock/alertes" variant="secondary">
            Alertes
          </ButtonLink>
          <ButtonLink href="/stock/etiquettes" variant="secondary">
            Imprimer des étiquettes
          </ButtonLink>
        </CardBody>
      </Card>
    </div>
  );
}
