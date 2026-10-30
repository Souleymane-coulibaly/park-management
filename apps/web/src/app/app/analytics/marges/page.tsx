'use client';

import { MARGIN_GAP_LABELS, type MarginAnalytics, formatXof } from '@ocall/shared';
import { Section, formatInt, formatPct } from '@/components/analytics/charts';
import { AnalyticsData, ExportLink, useAnalytics } from '@/components/analytics/filters';
import { AccessDenied } from '@/components/app/access-denied';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';

/**
 * Coûts matière et marges ESTIMÉS, à partir des recettes et des coûts d'achat saisis en stock.
 * Jamais présentés comme un bénéfice : les charges non intégrées sont rappelées en toutes lettres.
 */
export default function MarginsPage() {
  const { scope } = useAnalytics();
  if (!scope.canSeeMargins) return <AccessDenied />;
  return (
    <AnalyticsData<MarginAnalytics> path="/analytics/margins">
      {(d) => <Margins data={d} />}
    </AnalyticsData>
  );
}

function Margins({ data: d }: { data: MarginAnalytics }) {
  const s = d.summary;
  return (
    <>
      <Alert tone="info" title="Marge brute estimée, pas un bénéfice">
        Calculée au coût d’achat actuel des ingrédients de chaque recette. Personnel, loyer,
        énergie, taxes et autres charges ne sont pas intégrés.
      </Alert>
      {!s.complete && (
        <Alert tone="error" title="Marge incomplète">
          {formatXof(s.revenueUncosted)} de CA concernent des articles sans recette ou avec un coût
          d’achat manquant : leur marge n’est pas calculée.
        </Alert>
      )}

      <Section
        title="Synthèse"
        description={d.meta.period.current.label}
        action={<ExportLink report="margins" />}
      >
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="margin-summary">
          <Line label="Chiffre d’affaires (lignes vendues)" value={formatXof(s.revenue)} />
          <Line
            label="Coût matière estimé"
            value={formatXof(s.materialCost)}
            hint={`sur ${formatXof(s.revenueCosted)} de CA dont le coût est connu`}
          />
          <Line
            label="Marge brute estimée"
            value={formatXof(s.grossMargin)}
            hint={`taux ${formatPct(s.marginRate)}`}
            testId="gross-margin"
          />
          <Line
            label="Charges non intégrées"
            value="Non calculées"
            hint="personnel, loyer, énergie, taxes…"
          />
        </dl>
      </Section>

      <Section title="Marge par catégorie">
        <Table head={['Catégorie', 'CA', 'Coût matière', 'Marge estimée', 'Taux', 'Statut']}>
          {d.categories.map((c) => (
            <tr key={c.category}>
              <Td className="font-medium">{c.category}</Td>
              <Td className="tabular-nums">{formatXof(c.revenue)}</Td>
              <Td className="tabular-nums">{formatXof(c.materialCost)}</Td>
              <Td className="tabular-nums">{formatXof(c.margin)}</Td>
              <Td className="tabular-nums">{formatPct(c.marginRate)}</Td>
              <Td>
                {c.complete ? (
                  <Badge tone="forest">Complète</Badge>
                ) : (
                  <Badge tone="terracotta">Incomplète</Badge>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section
        title="Marge par produit"
        description="Par établissement : chaque établissement a ses propres recettes et coûts."
      >
        <Table
          head={[
            'Produit',
            'Établissement',
            'Qté',
            'Prix moyen',
            'Coût unitaire',
            'Marge estimée',
            'Taux',
          ]}
        >
          {d.rows.map((r) => (
            <tr key={`${r.establishmentId}-${r.variantId}`} data-testid="margin-row">
              <Td className="font-medium">
                {r.product}
                {r.variant !== 'Standard' && <span className="text-muted"> · {r.variant}</span>}
                <span className="block text-xs text-muted">{r.category}</span>
              </Td>
              <Td>{r.establishment}</Td>
              <Td className="tabular-nums">{formatInt(r.quantity)}</Td>
              <Td className="tabular-nums">
                {r.unitPrice === null ? '—' : formatXof(r.unitPrice)}
              </Td>
              <Td className="tabular-nums">{r.unitCost === null ? '—' : formatXof(r.unitCost)}</Td>
              <Td className="tabular-nums">
                {r.margin === null ? (
                  <span className="text-terracotta-dark">
                    {MARGIN_GAP_LABELS[r.gap!]}
                    {r.missingCosts.length > 0 && ` : ${r.missingCosts.join(', ')}`}
                  </span>
                ) : (
                  formatXof(r.margin)
                )}
              </Td>
              <Td className="tabular-nums">{formatPct(r.marginRate)}</Td>
            </tr>
          ))}
        </Table>
        {d.rows.length === 0 && (
          <p className="px-2 py-4 text-sm text-muted">Aucune vente encaissée sur la période.</p>
        )}
      </Section>

      <Section
        title="Évolution des coûts d’achat"
        description="Coûts saisis sur les entrées de stock de la période."
      >
        {d.costs.length === 0 ? (
          <p className="text-sm text-muted">Aucune entrée de stock avec coût sur la période.</p>
        ) : (
          <Table
            head={[
              'Ingrédient',
              'Établissement',
              'Premier coût',
              'Dernier coût',
              'Variation',
              'Coût actuel',
            ]}
          >
            {d.costs.map((c) => (
              <tr key={c.stockItemId}>
                <Td className="font-medium">{c.stockItem}</Td>
                <Td>{c.establishment}</Td>
                <Td className="tabular-nums">
                  {formatXof(c.points[0]!.unitCost)} / {c.unit}
                </Td>
                <Td className="tabular-nums">
                  {formatXof(c.points.at(-1)!.unitCost)} / {c.unit}
                </Td>
                <Td className="tabular-nums">{formatPct(c.change)}</Td>
                <Td className="tabular-nums">
                  {c.currentUnitCost === null
                    ? 'inconnu'
                    : `${formatXof(c.currentUnitCost)} / ${c.unit}`}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </>
  );
}

function Line({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  testId?: string;
}) {
  return (
    <div className="rounded-xl bg-ivory/60 p-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 font-display text-xl font-bold" data-testid={testId}>
        {value}
      </dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}
