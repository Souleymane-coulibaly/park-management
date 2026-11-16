import type { AnalyticsRange } from './analytics';
import { addDays } from './park';
import { formatXof } from './subscription';

/**
 * Ocall Suite — étape 5 : tableau de bord de l'organisation (reporting multi-établissements).
 *
 * Chaque application ouverte fournit un **bloc** par un connecteur (Park, Restaurant, Facture, Stock,
 * School… et demain toute nouvelle application) ; le tableau de bord ne fait que les juxtaposer :
 * - **aucun total entre applications** : un encaissement Park, un montant facturé et une valeur de stock
 *   ne s'additionnent pas (et une vente Stock facturée serait comptée deux fois) ;
 * - chaque montant porte sa **nature** (encaissé, facturé, reste dû…) et sa **devise** ;
 * - chaque bloc applique les droits réels de l'utilisateur dans son application ;
 * - les données sans établissement restent dans « Non rattaché », jamais attribuées automatiquement.
 */

/** Valeur du filtre « Non rattaché » : données d'aucun établissement du référentiel. */
export const ORG_REPORT_UNASSIGNED = 'none';
export const ORG_REPORT_UNASSIGNED_LABEL = 'Non rattaché';

/** Nature d'un indicateur. Deux natures différentes ne s'additionnent jamais. */
export const ORG_REPORT_NATURES = [
  'collected',
  'invoiced',
  'outstanding',
  'overdue',
  'stock_value',
  'count',
] as const;
export type OrgReportNature = (typeof ORG_REPORT_NATURES)[number];

export const ORG_REPORT_NATURE_LABELS: Record<OrgReportNature, string> = {
  collected: 'Encaissé',
  invoiced: 'Facturé',
  outstanding: 'Reste à encaisser',
  overdue: 'En retard',
  stock_value: 'Valeur du stock',
  count: 'Nombre',
};

export interface OrgReportMetric {
  /** Identifiant unique dans le bloc (ex. « collected », « collected.XOF »). */
  id: string;
  label: string;
  nature: OrgReportNature;
  /** Devise d'un montant ; null pour un nombre. */
  currency: string | null;
  value: number;
  /** Même indicateur sur la période précédente ; null si l'application ne le compare pas. */
  previous: number | null;
  /** Précision affichée sous la valeur (ex. « dont ventes Stock »). */
  hint: string | null;
}

/** Valeurs d'un bloc pour un établissement ; `establishmentId` null = « Non rattaché ». */
export interface OrgReportSiteRow {
  establishmentId: string | null;
  values: Record<string, number>;
}

export type OrgReportBlockStatus = 'ok' | 'unavailable';

export interface OrgReportBlock {
  /** Code produit de l'application (ex. OCALL_FACTURE). */
  product: string;
  label: string;
  status: OrgReportBlockStatus;
  /** Raison d'un bloc indisponible, ou précision sur le périmètre. */
  message: string | null;
  /** Rapport détaillé de l'application (même période et même établissement). */
  href: string;
  metrics: OrgReportMetric[];
  /** Indicateurs repris dans le tableau comparatif par établissement. */
  siteMetrics: string[];
  bySite: OrgReportSiteRow[];
  notes: string[];
}

export interface OrgReportEstablishment {
  id: string;
  name: string;
  city: string | null;
  isActive: boolean;
}

export interface OrganizationReport {
  meta: {
    period: { current: AnalyticsRange; previous: AnalyticsRange; days: string[] };
    /** Fuseau de l'organisation : bornes de la période. */
    timezone: string;
    /** Devise de l'organisation (un montant d'une autre devise est présenté à part). */
    currency: string;
    /** Filtre appliqué : null = tous, « none » = non rattaché, sinon l'établissement. */
    establishment: string | null;
    establishments: OrgReportEstablishment[];
    generatedAt: string;
  };
  blocks: OrgReportBlock[];
}

/** Jours locaux d'une période (AAAA-MM-JJ, bornes incluses), pour les applications comptées au jour. */
export interface OrgReportDays {
  from: string;
  to: string;
}

/**
 * Jours entiers couverts par un intervalle local (borne de fin exclue). Une fin en cours de journée
 * (« Aujourd'hui » comparé à hier jusqu'à la même heure) n'est pas un jour entier : null, l'application
 * comptée au jour ne compare pas plutôt que de comparer une journée partielle à une journée entière.
 */
export function orgReportDays(range: AnalyticsRange): OrgReportDays | null {
  if (range.from.slice(11) !== '00:00' || range.to.slice(11) !== '00:00') return null;
  const from = range.from.slice(0, 10);
  const to = addDays(range.to.slice(0, 10), -1);
  return to < from ? null : { from, to };
}

/** Variation en % ; null sans base de comparaison. */
export function orgReportChange(
  metric: Pick<OrgReportMetric, 'value' | 'previous'>,
): number | null {
  if (metric.previous === null || metric.previous === 0) return null;
  return Math.round(((metric.value - metric.previous) / Math.abs(metric.previous)) * 1000) / 10;
}

/** Montant lisible dans un libellé : « 12 500 FCFA » (formatXof) ; une autre devise en code ISO. */
export function formatMoneyLabel(amount: number, currency: string): string {
  return currency === 'XOF' ? formatXof(amount) : `${formatXof(amount).slice(0, -5)} ${currency}`;
}
