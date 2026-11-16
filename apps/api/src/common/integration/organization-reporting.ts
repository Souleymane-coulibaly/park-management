import { Injectable, Logger } from '@nestjs/common';
import type {
  OrgReportBlock,
  OrgReportDays,
  OrgReportMetric,
  OrgReportSiteRow,
  ResolvedAnalyticsPeriod,
} from '@ocall/shared';
import type { TenantContext } from '../auth-context';

/**
 * Ocall Suite — étape 5 : connecteurs analytiques du tableau de bord de l'organisation.
 *
 * Chaque application (Park, Restaurant, Facture, Stock, School, et toute application future : Ocall
 * Print, Sabatii…) inscrit au démarrage un connecteur qui calcule SON bloc avec ses propres services et
 * SES propres droits. Le tableau de bord n'importe ni le code ni la base d'une application.
 *
 * Règles d'un connecteur :
 * - renvoyer `null` si l'application n'est pas ouverte pour l'organisation ou si l'utilisateur n'y a pas
 *   le droit de consulter les indicateurs : le bloc n'apparaît pas (aucune indication de ce qui manque) ;
 * - ne jamais élargir ce que l'utilisateur voit dans l'application (établissements, boutiques, écoles) ;
 * - filtrer par établissement du référentiel ; ce qui n'est rattaché à aucun établissement ne sort que
 *   dans « Non rattaché » (`unassigned`), jamais attribué automatiquement ;
 * - lever une erreur seulement en cas de panne : le bloc devient « indisponible », les autres restent.
 */
export interface OrgReportQuery {
  auth: TenantContext;
  /** Période résolue dans le fuseau de l'organisation (heure locale, fin exclue). */
  period: ResolvedAnalyticsPeriod;
  /** Jours locaux entiers de la période et de la précédente (applications comptées au jour). */
  days: OrgReportDays;
  previousDays: OrgReportDays | null;
  timezone: string;
  /** Devise de l'organisation. */
  currency: string;
  /** Établissements retenus : null = tous ; [] = aucun (filtre « Non rattaché » seul). */
  establishmentIds: string[] | null;
  /** Inclure ce qui n'est rattaché à aucun établissement. */
  unassigned: boolean;
  now: Date;
}

/** Contenu d'un bloc calculé par l'application. */
export interface OrgReportBlockData {
  metrics: OrgReportMetric[];
  siteMetrics: string[];
  bySite: OrgReportSiteRow[];
  notes?: string[];
  message?: string | null;
  /**
   * Paramètres du lien vers le rapport détaillé, ajoutés à ceux de la période et du filtre (`null`
   * retire un paramètre que l'écran de l'application ne connaît pas).
   */
  detailParams?: Record<string, string | null>;
}

export interface OrgReportConnector {
  /** Code produit (ex. OCALL_FACTURE) ; unique. */
  product: string;
  label: string;
  /** Ordre d'affichage. */
  order: number;
  /** Rapport détaillé de l'application. */
  href: string;
  report(query: OrgReportQuery): Promise<OrgReportBlockData | null>;
}

/** Délai maximal d'un bloc : au-delà, il est « indisponible » sans retenir la page. */
export const ORG_REPORT_CONNECTOR_TIMEOUT_MS = 20_000;

const UNAVAILABLE = 'Indicateurs momentanément indisponibles pour cette application.';

/**
 * Registre des connecteurs (module commun, global). Une application désactivée par configuration
 * n'inscrit pas de connecteur ; une application ouverte mais en panne rend un bloc « indisponible ».
 */
@Injectable()
export class OrganizationReportingRegistry {
  private readonly logger = new Logger('OrganizationReporting');
  private readonly connectors = new Map<string, OrgReportConnector>();

  register(connector: OrgReportConnector): void {
    this.connectors.set(connector.product, connector);
  }

  list(): OrgReportConnector[] {
    return [...this.connectors.values()].sort((a, b) => a.order - b.order);
  }

  /** Blocs de tous les connecteurs, calculés en parallèle ; jamais d'échec global. */
  async collect(
    query: OrgReportQuery,
    timeoutMs = ORG_REPORT_CONNECTOR_TIMEOUT_MS,
  ): Promise<OrgReportBlock[]> {
    const connectors = this.list();
    const results = await Promise.all(
      connectors.map((c) => this.run(c, query, timeoutMs).catch((error: unknown) => ({ error }))),
    );
    const blocks: OrgReportBlock[] = [];
    results.forEach((result, i) => {
      const c = connectors[i]!;
      const base = { product: c.product, label: c.label, href: c.href };
      if (result && 'error' in result) {
        this.logger.warn(
          `Bloc ${c.product} indisponible : ${String((result.error as Error)?.message ?? result.error).slice(0, 200)}`,
        );
        blocks.push({
          ...base,
          status: 'unavailable',
          message: UNAVAILABLE,
          metrics: [],
          siteMetrics: [],
          bySite: [],
          notes: [],
        });
        return;
      }
      if (!result) return;
      blocks.push({
        ...base,
        href: detailHref(c.href, query, result.detailParams),
        status: 'ok',
        message: result.message ?? null,
        metrics: result.metrics,
        siteMetrics: result.siteMetrics,
        bySite: result.bySite,
        notes: result.notes ?? [],
      });
    });
    return blocks;
  }

  private run(
    connector: OrgReportConnector,
    query: OrgReportQuery,
    timeoutMs: number,
  ): Promise<OrgReportBlockData | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`délai de ${timeoutMs} ms dépassé`)), timeoutMs);
    });
    return Promise.race([connector.report(query), timeout]).finally(() => clearTimeout(timer));
  }
}

/**
 * Lien vers le rapport détaillé d'une application : même période (jours explicites, fuseau de
 * l'organisation) et même établissement que le tableau de bord.
 */
export function detailHref(
  href: string,
  query: OrgReportQuery,
  overrides: Record<string, string | null> = {},
): string {
  const filter =
    query.establishmentIds === null
      ? null
      : query.establishmentIds.length === 0
        ? 'none'
        : query.establishmentIds[0]!;
  const params: Record<string, string | null> = {
    period: 'custom',
    from: query.days.from,
    to: query.days.to,
    establishmentId: filter,
    ...overrides,
  };
  const search = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => e[1] !== null),
  ).toString();
  return search ? `${href}?${search}` : href;
}

/** Indicateur d'un bloc (valeurs par défaut : pas de comparaison, pas de précision). */
export function orgMetric(
  metric: Omit<OrgReportMetric, 'previous' | 'hint' | 'currency'> &
    Partial<Pick<OrgReportMetric, 'previous' | 'hint' | 'currency'>>,
): OrgReportMetric {
  return { previous: null, hint: null, currency: null, ...metric };
}

/** Établissement retenu par le filtre (null = « Non rattaché »). */
export function orgReportKeeps(query: OrgReportQuery, establishmentId: string | null): boolean {
  if (establishmentId === null) return query.unassigned;
  return query.establishmentIds === null || query.establishmentIds.includes(establishmentId);
}
