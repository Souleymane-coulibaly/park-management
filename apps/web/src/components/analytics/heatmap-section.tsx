'use client';

import { useState } from 'react';
import { type Heatmap, formatXof } from '@ocall/shared';
import { HeatmapGrid, Section, formatInt } from './charts';
import { AnalyticsData, ExportLink } from './filters';
import { SelectField } from '@/components/ui/field';

/**
 * Carte thermique jour × heure d'une métrique (commandes, quantités, CA ou entrées). Chaque
 * métrique a sa propre source : commandes et visiteurs physiques ne sont jamais additionnés.
 */
export function HeatmapSection({
  metric,
  onMetric,
  metrics,
}: {
  metric: string;
  onMetric: (m: string) => void;
  metrics: Record<string, string>;
}) {
  const [average, setAverage] = useState(false);
  return (
    <Section
      title="Carte thermique de l’affluence"
      description="Par jour de la semaine et heure locale : repérez les périodes de forte et de faible activité."
      action={<ExportLink report="heatmap" extra={{ metric }} />}
    >
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        {Object.keys(metrics).length > 1 && (
          <SelectField
            label="Indicateur"
            value={metric}
            onChange={(e) => onMetric(e.target.value)}
            options={Object.entries(metrics).map(([value, label]) => ({ value, label }))}
          />
        )}
        <SelectField
          label="Valeurs"
          value={average ? 'avg' : 'total'}
          onChange={(e) => setAverage(e.target.value === 'avg')}
          options={[
            { value: 'total', label: 'Total sur la période' },
            { value: 'avg', label: 'Moyenne par jour' },
          ]}
        />
      </div>
      <AnalyticsData<Heatmap> path="/analytics/heatmap" extra={{ metric }}>
        {(d) => (
          <HeatmapGrid
            cells={d.cells}
            weekdayCount={d.weekdayCount}
            average={average}
            format={metric === 'revenue' ? formatXof : formatInt}
            label={metrics[metric] ?? metric}
          />
        )}
      </AnalyticsData>
    </Section>
  );
}
