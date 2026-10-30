'use client';

import { type ReactNode, createContext, useContext, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import {
  ANALYTICS_PERIOD_LABELS,
  ANALYTICS_PERIODS,
  type AnalyticsActivity,
  type AnalyticsExportReport,
  type AnalyticsPeriod,
  type AnalyticsScopeInfo,
} from '@ocall/shared';
import { buttonClass } from '@/components/ui/button';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

export interface AnalyticsFilterState {
  period: AnalyticsPeriod;
  from: string;
  to: string;
  establishmentId: string;
  activity: AnalyticsActivity;
}

interface AnalyticsContextValue {
  scope: AnalyticsScopeInfo;
  filters: AnalyticsFilterState;
  setFilters: (next: Partial<AnalyticsFilterState>) => void;
  /** Paramètres de requête des filtres (sans « ? »). */
  query: (extra?: Record<string, string | number | null | undefined>) => string;
}

const AnalyticsContext = createContext<AnalyticsContextValue | null>(null);

export function useAnalytics(): AnalyticsContextValue {
  const ctx = useContext(AnalyticsContext);
  if (!ctx) throw new Error('useAnalytics hors de AnalyticsProvider');
  return ctx;
}

/** Filtres communs aux onglets d'analyse : conservés quand on passe d'un onglet à l'autre. */
export function AnalyticsProvider({
  scope,
  children,
}: {
  scope: AnalyticsScopeInfo;
  children: ReactNode;
}) {
  const [filters, set] = useState<AnalyticsFilterState>({
    period: 'last_7_days',
    from: '',
    to: '',
    establishmentId: '',
    activity: 'ALL',
  });
  const value = useMemo<AnalyticsContextValue>(
    () => ({
      scope,
      filters,
      setFilters: (next) => set((prev) => ({ ...prev, ...next })),
      query: (extra = {}) => {
        const params = new URLSearchParams({ period: filters.period });
        if (filters.period === 'custom') {
          if (filters.from) params.set('from', filters.from);
          if (filters.to) params.set('to', filters.to);
        }
        if (filters.establishmentId) params.set('establishmentId', filters.establishmentId);
        if (filters.activity !== 'ALL') params.set('activity', filters.activity);
        for (const [k, v] of Object.entries(extra)) {
          if (v !== null && v !== undefined && v !== '') params.set(k, String(v));
        }
        return params.toString();
      },
    }),
    [scope, filters],
  );
  return <AnalyticsContext.Provider value={value}>{children}</AnalyticsContext.Provider>;
}

/** Une période personnalisée incomplète n'est pas envoyée à l'API. */
export function filtersReady(f: AnalyticsFilterState): boolean {
  return f.period !== 'custom' || (Boolean(f.from) && Boolean(f.to));
}

/**
 * Chargement d'une analyse avec les filtres courants, puis rendu. Une période personnalisée
 * incomplète n'est pas envoyée : un message invite à compléter les dates.
 */
export function AnalyticsData<T>({
  path,
  extra,
  children,
}: {
  path: string;
  extra?: Record<string, string | number | null | undefined>;
  children: (data: T) => ReactNode;
}) {
  const { filters, query } = useAnalytics();
  const ready = filtersReady(filters);
  const result = useApi<T>(ready ? `${path}?${query(extra)}` : null);
  if (!ready) {
    return <Alert tone="info">Choisissez la date de début et la date de fin.</Alert>;
  }
  if (result.state === 'loading') return <LoadingState />;
  if (result.state === 'error') return <ErrorState error={result.error} onRetry={result.reload} />;
  return <>{children(result.data)}</>;
}

/** Barre de filtres : période, dates, établissement, activité — sur une ligne au-dessus des graphiques. */
export function AnalyticsFilters({ showActivity = true }: { showActivity?: boolean }) {
  const { scope, filters, setFilters } = useAnalytics();
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="analytics-filters">
      <SelectField
        label="Période"
        value={filters.period}
        onChange={(e) => setFilters({ period: e.target.value as AnalyticsPeriod })}
        options={ANALYTICS_PERIODS.map((p) => ({ value: p, label: ANALYTICS_PERIOD_LABELS[p] }))}
      />
      {filters.period === 'custom' && (
        <>
          <InputField
            label="Du"
            type="date"
            value={filters.from}
            onChange={(e) => setFilters({ from: e.target.value })}
          />
          <InputField
            label="Au"
            type="date"
            value={filters.to}
            onChange={(e) => setFilters({ to: e.target.value })}
          />
        </>
      )}
      {scope.establishments.length > 1 && (
        <SelectField
          label="Établissement"
          value={filters.establishmentId}
          onChange={(e) => setFilters({ establishmentId: e.target.value })}
          options={[
            { value: '', label: 'Tous les établissements' },
            ...scope.establishments.map((e) => ({ value: e.id, label: e.name })),
          ]}
        />
      )}
      {showActivity && scope.activities.length > 1 && (
        <SelectField
          label="Activité"
          value={filters.activity}
          onChange={(e) => setFilters({ activity: e.target.value as AnalyticsActivity })}
          options={[
            { value: 'ALL', label: 'Parc et restaurant' },
            { value: 'RESTAURANT', label: 'Restaurant' },
            { value: 'PARK', label: 'Parc' },
          ]}
        />
      )}
    </div>
  );
}

/**
 * Lien de téléchargement CSV : même filtres que l'écran, mêmes calculs côté serveur. Affiché
 * uniquement aux rôles autorisés (le serveur le vérifie de toute façon).
 */
export function ExportLink({
  report,
  extra,
  label = 'Exporter (CSV)',
}: {
  report: AnalyticsExportReport;
  extra?: Record<string, string | number | null | undefined>;
  label?: string;
}) {
  const { scope, filters, query } = useAnalytics();
  if (!scope.canExport || !filtersReady(filters)) return null;
  return (
    <a
      href={`/api/v1/analytics/export?${query({ report, ...extra })}`}
      className={buttonClass('secondary', 'sm')}
      download
    >
      <Download className="h-4 w-4" aria-hidden /> {label}
    </a>
  );
}
