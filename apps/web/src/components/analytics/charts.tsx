'use client';

import { type ReactNode, useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { type Compared, ISO_WEEKDAY_LABELS, formatXof } from '@ocall/shared';

/**
 * Graphiques des analyses, sans bibliothèque : HTML/SVG légers, une seule échelle par graphique,
 * libellés en encre de texte (jamais la couleur de la série), survol et clavier pour lire chaque
 * valeur, et tableau de données disponible à côté de chaque graphique.
 *
 * Couleurs : vert forêt = période / restaurant, terre cuite = parc, gris = période précédente ;
 * carte thermique = une seule teinte (vert), du clair au foncé.
 */

export const formatInt = (n: number) => n.toLocaleString('fr-FR');
export const formatPct = (n: number | null) =>
  n === null ? '—' : `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
export const hourLabel = (h: number) => `${String(h).padStart(2, '0')} h`;
export const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Variation par rapport à la période précédente : flèche + texte, jamais la couleur seule. */
export function Delta({ change }: { change: number | null }) {
  if (change === null) return <span className="text-muted">pas de base de comparaison</span>;
  const Icon = change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : ArrowRight;
  const tone = change > 0 ? 'text-forest' : change < 0 ? 'text-terracotta-dark' : 'text-muted';
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${tone}`}>
      <Icon className="h-4 w-4" aria-hidden />
      {change > 0 ? '+' : ''}
      {formatPct(change)}
    </span>
  );
}

/** Indicateur clé : valeur de la période, précédente et variation. */
export function StatTile({
  label,
  value,
  compared,
  format = formatInt,
  hint,
  testId,
}: {
  label: string;
  value: number | null;
  compared?: Compared;
  format?: (n: number) => string;
  hint?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="rounded-2xl border border-line/80 bg-surface p-4 shadow-card sm:p-5">
      <p className="text-sm font-medium text-muted">{label}</p>
      <p
        className="mt-1.5 font-display text-2xl font-bold text-charcoal sm:text-[28px]"
        data-testid={testId}
      >
        {value === null ? '—' : format(value)}
      </p>
      {compared && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm">
          <Delta change={compared.change} />
          <span className="text-muted">vs {format(compared.previous)}</span>
        </p>
      )}
      {hint && <div className="mt-2 text-sm text-muted">{hint}</div>}
    </div>
  );
}

const SERIES = {
  forest: 'bg-forest',
  terracotta: 'bg-terracotta',
  neutral: 'bg-charcoal-soft/35',
} as const;
type SeriesColor = keyof typeof SERIES;

export interface BarDatum {
  key: string | number;
  label: string;
  value: number;
}

/**
 * Histogramme vertical (heures, jours) : une barre par valeur, lecture au survol ou au clavier.
 * Les étiquettes de l'axe sont espacées pour rester lisibles sur mobile.
 */
export function BarChart({
  data,
  color = 'forest',
  format = formatInt,
  height = 160,
  label,
  labelEvery = 1,
}: {
  data: BarDatum[];
  color?: SeriesColor;
  format?: (n: number) => string;
  height?: number;
  label: string;
  labelEvery?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(0, ...data.map((d) => d.value));
  const shown = active === null ? null : data[active];
  return (
    <figure className="space-y-2" aria-label={label}>
      <p className="min-h-5 text-sm text-charcoal" aria-live="polite">
        {shown ? (
          <>
            <span className="font-semibold">{shown.label}</span> : {format(shown.value)}
          </>
        ) : (
          <span className="text-muted">Survolez une barre pour lire sa valeur.</span>
        )}
      </p>
      <div
        className="flex items-end gap-[2px] border-b border-line"
        style={{ height }}
        onMouseLeave={() => setActive(null)}
      >
        {data.map((d, i) => (
          <button
            key={d.key}
            type="button"
            aria-label={`${d.label} : ${format(d.value)}`}
            className="group relative flex h-full min-w-0 flex-1 items-end focus:outline-none"
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          >
            <span
              className={`block w-full rounded-t-[4px] ${SERIES[color]} ${active === i ? 'opacity-100' : 'opacity-85'} group-focus-visible:ring-2 group-focus-visible:ring-charcoal`}
              style={{
                height: max > 0 && d.value > 0 ? `${Math.max(2, (d.value / max) * 100)}%` : 0,
              }}
            />
          </button>
        ))}
      </div>
      <div className="flex gap-[2px] text-[11px] text-muted" aria-hidden>
        {data.map((d, i) => (
          <span key={d.key} className="min-w-0 flex-1 truncate text-center">
            {i % labelEvery === 0 ? d.label : ''}
          </span>
        ))}
      </div>
    </figure>
  );
}

/**
 * Courbe de la période comparée à la période précédente (même rang de jour). Une seule échelle,
 * traits fins, légende toujours présente.
 */
export function CompareLineChart({
  current,
  previous,
  format = formatXof,
  label,
}: {
  current: { date: string; value: number }[];
  previous: { date: string; value: number }[];
  format?: (n: number) => string;
  label: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const n = Math.max(current.length, 1);
  const max = Math.max(1, ...current.map((p) => p.value), ...previous.map((p) => p.value));
  const W = 600;
  const H = 180;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => H - (v / max) * (H - 8) - 2;
  const path = (pts: { value: number }[]) =>
    pts
      .slice(0, n)
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
      .join(' ');
  const cur = active === null ? null : current[active];
  const prev = active === null ? null : previous[active];
  return (
    <figure className="space-y-2" aria-label={label}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-5 rounded bg-forest" aria-hidden /> Période
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-5 rounded bg-charcoal-soft/50" aria-hidden /> Période précédente
        </span>
        <span className="min-h-5 text-charcoal" aria-live="polite">
          {cur ? (
            <>
              <span className="font-semibold">{shortDate(cur.date)}</span> : {format(cur.value)}
              {prev && <span className="text-muted"> · précédente {format(prev.value)}</span>}
            </>
          ) : null}
        </span>
      </div>
      <div className="relative" onMouseLeave={() => setActive(null)}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-44 w-full overflow-visible"
          role="img"
          aria-label={label}
        >
          <line
            x1="0"
            y1={H}
            x2={W}
            y2={H}
            className="stroke-line"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          {previous.length > 0 && (
            <path
              d={path(previous)}
              fill="none"
              className="stroke-charcoal-soft/50"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path
            d={path(current)}
            fill="none"
            className="stroke-forest"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          {active !== null && (
            <line
              x1={x(active)}
              y1="0"
              x2={x(active)}
              y2={H}
              className="stroke-charcoal/30"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex">
          {current.map((p, i) => (
            <button
              key={p.date}
              type="button"
              aria-label={`${shortDate(p.date)} : ${format(p.value)}`}
              className="h-full flex-1 focus:outline-none focus-visible:bg-forest/10"
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            />
          ))}
        </div>
      </div>
      <div className="flex justify-between text-[11px] text-muted" aria-hidden>
        <span>{current[0] ? shortDate(current[0].date) : ''}</span>
        <span>{current.length > 1 ? shortDate(current.at(-1)!.date) : ''}</span>
      </div>
    </figure>
  );
}

/** Rampe séquentielle d'une seule teinte (vert), du clair au foncé ; 0 = case vide. */
const HEAT_STEPS = ['bg-forest/10', 'bg-forest/25', 'bg-forest/45', 'bg-forest/70', 'bg-forest'];

/**
 * Carte thermique jour × heure. Le mode « moyenne » divise par le nombre de jours de la semaine
 * présents dans la période (périodes de forte et faible activité comparables).
 */
export function HeatmapGrid({
  cells,
  weekdayCount,
  average,
  format = formatInt,
  label,
}: {
  cells: number[][];
  weekdayCount: number[];
  average: boolean;
  format?: (n: number) => string;
  label: string;
}) {
  const [active, setActive] = useState<{ d: number; h: number } | null>(null);
  const valueOf = (d: number, h: number) => {
    const raw = cells[d]?.[h] ?? 0;
    return average ? (weekdayCount[d] ? raw / weekdayCount[d]! : 0) : raw;
  };
  const max = Math.max(0, ...cells.flatMap((row, d) => row.map((_, h) => valueOf(d, h))));
  const step = (v: number) =>
    v <= 0 || max === 0
      ? 'bg-ivory-dark/50'
      : HEAT_STEPS[Math.min(4, Math.floor((v / max) * 4.999))];
  const fmt = (v: number) => (average ? format(Math.round(v * 10) / 10) : format(v));
  return (
    <figure className="space-y-2" aria-label={label}>
      <p className="min-h-5 text-sm" aria-live="polite">
        {active ? (
          <>
            <span className="font-semibold">
              {ISO_WEEKDAY_LABELS[active.d]} {hourLabel(active.h)}–{hourLabel(active.h + 1)}
            </span>{' '}
            : {fmt(valueOf(active.d, active.h))}
            {average ? ' en moyenne' : ' au total'}
          </>
        ) : (
          <span className="text-muted">Survolez une case pour lire sa valeur.</span>
        )}
      </p>
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[560px] grid-cols-[3rem_repeat(24,minmax(0,1fr))] gap-[2px]"
          onMouseLeave={() => setActive(null)}
        >
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="text-center text-[10px] text-muted" aria-hidden>
              {h % 3 === 0 ? h : ''}
            </span>
          ))}
          {cells.map((row, d) => (
            <div key={d} className="contents">
              <span className="pr-1 text-xs leading-6 text-muted">
                {ISO_WEEKDAY_LABELS[d]!.slice(0, 3)}
              </span>
              {row.map((_, h) => (
                <button
                  key={h}
                  type="button"
                  aria-label={`${ISO_WEEKDAY_LABELS[d]} ${h} h : ${fmt(valueOf(d, h))}`}
                  className={`h-6 rounded-[3px] ${step(valueOf(d, h))} focus:outline-none focus-visible:ring-2 focus-visible:ring-charcoal`}
                  onMouseEnter={() => setActive({ d, h })}
                  onFocus={() => setActive({ d, h })}
                  onBlur={() => setActive(null)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted" aria-hidden>
        Faible
        {HEAT_STEPS.map((s) => (
          <span key={s} className={`h-3 w-5 rounded-[3px] ${s}`} />
        ))}
        Forte
      </div>
    </figure>
  );
}

/** Carte titrée d'une section d'analyse, avec action (export, bascule) à droite. */
export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line/80 bg-surface p-4 shadow-card sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold text-charcoal">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
