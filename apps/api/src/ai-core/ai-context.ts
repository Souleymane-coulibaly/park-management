import type { AiPromptRef } from './ai-prompts';
import type { AiUsageReport } from './ai-provider';

/**
 * Contexte obligatoire de toute requête IA : application, organisation et établissement, utilisateur
 * authentifié, rôle, opération autorisée. Il est construit par l'application à partir de SA session
 * (jamais à partir de ce que propose le modèle) ; le cœur ne connaît aucun domaine métier.
 */
export interface AiCallContext {
  /** Application métier : `park`, `school`… */
  application: string;
  organizationId: string;
  /** Établissement concerné (null pour une opération à l'échelle de l'organisation). */
  establishmentId: string | null;
  /** Utilisateur authentifié. */
  actorUserId: string;
  /** Identité de l'utilisateur dans l'application (adhésion Park, membre School…), si elle existe. */
  actorRef: string | null;
  /** Rôle de l'utilisateur dans l'application (déjà contrôlé par l'application). */
  role: string;
  /** Opération IA autorisée (fonctionnalité) : `COPILOT`, `SCHOOL_TEACHING`… */
  operation: string;
  /** Fuseau de l'organisation ou de l'établissement : période de quota (mois civil). */
  timezone: string;
  /**
   * Plafond mensuel imposé par le contrat (ex. offre Ocall School Free : 20 par établissement), en plus
   * du réglage de l'application ; le plus restrictif s'applique. Absent = aucun plafond contractuel.
   */
  contractMonthlyLimit?: number | null;
}

export interface AiCallMeta {
  provider: string;
  model: string;
  prompt: AiPromptRef | null;
}

export interface AiCallSucceeded {
  usage: AiUsageReport;
  /** null = coût non estimable (modèle sans tarif connu), jamais présenté comme nul. */
  estimatedCostMicroUsd: number | null;
  latencyMs: number;
}

export interface AiCallFailed {
  errorCode: string;
  latencyMs: number;
  /** null : aucune consommation rapportée avant l'échec. */
  usage: AiUsageReport | null;
  /** null : coût non estimable (jamais présenté comme nul). */
  estimatedCostMicroUsd: number | null;
}

/**
 * Stockage de la consommation, propre à chaque application (sa base, ses réglages). Le cœur ne fait
 * que l'appeler : une application future fournit son implémentation sans modifier le cœur.
 */
export interface AiUsageStore {
  /**
   * Vérifie que l'opération est activée et réserve un appel sur le quota de la période, de façon
   * atomique (sous verrou). Lève une HttpException compréhensible en cas de refus. Renvoie l'identifiant
   * de la réservation.
   */
  reserve(ctx: AiCallContext, meta: AiCallMeta): Promise<string>;
  succeed(reservationId: string, result: AiCallSucceeded): Promise<void>;
  /** Échec : code, durée et consommation déjà rapportée par le fournisseur (jetons facturés). */
  fail(reservationId: string, failure: AiCallFailed): Promise<void>;
  /**
   * Libère les réservations restées « en cours » depuis avant `olderThan` (processus interrompu
   * pendant l'appel) : elles passent en échec `AI_ABANDONED`. Renvoie leur nombre.
   */
  releaseOrphans(olderThan: Date): Promise<number>;
}
