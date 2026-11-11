/**
 * Ocall Facture — planification et maintenance préventive (F6B) : calculs DÉTERMINISTES du serveur
 * (disponibilités, conflits, créneaux libres, équipements à entretenir). L'IA ne fait que classer et
 * expliquer les candidats calculés ici ; elle ne peut ni en inventer, ni modifier un créneau.
 */

export const FACTURE_INTERVENTION_PRIORITIES = ['NORMAL', 'URGENT'] as const;
export type FactureInterventionPriority = (typeof FACTURE_INTERVENTION_PRIORITIES)[number];

export const FACTURE_INTERVENTION_PRIORITY_LABELS: Record<FactureInterventionPriority, string> = {
  NORMAL: 'Normale',
  URGENT: 'Urgente',
};

/** Journée de travail (heure du Mali = UTC) et horizon de recherche des créneaux. */
export const FACTURE_WORKDAY = { startHour: 8, endHour: 18 } as const;
export const FACTURE_PLANNING_HORIZON_DAYS = 14;
const STEP_MS = 30 * 60_000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface PlanningMember {
  id: string;
  name: string;
  skillIds: string[];
}

export interface BusyPeriod {
  memberId: string;
  start: Date;
  end: Date;
  /** Intervention (référence) ou indisponibilité. */
  label: string;
}

export interface PlanningCandidate {
  memberId: string;
  name: string;
  start: Date;
  end: Date;
  /** Le créneau demandé est conservé. */
  requestedSlot: boolean;
  /** Compétences requises détenues / requises. */
  skillsMatched: number;
  skillsRequired: number;
  /** Interventions déjà prévues sur l'horizon (charge). */
  load: number;
  /** Conflits sur le créneau demandé (vide s'il est libre). */
  conflicts: string[];
}

const overlaps = (a: { start: Date; end: Date }, b: { start: Date; end: Date }) =>
  a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();

/** Le créneau [start, end[ tient dans une journée de travail. */
function inWorkday(start: Date, end: Date): boolean {
  const day = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  return (
    start.getTime() >= day + FACTURE_WORKDAY.startHour * HOUR_MS &&
    end.getTime() <= day + FACTURE_WORKDAY.endHour * HOUR_MS
  );
}

/**
 * Premier créneau libre d'un technicien, de même durée, à partir de `from` (arrondi à la demi-heure),
 * dans les journées de travail de l'horizon. null si aucun.
 */
export function firstFreeSlot(
  busy: BusyPeriod[],
  from: Date,
  durationMs: number,
  horizonEnd: Date,
): { start: Date; end: Date } | null {
  let t = Math.ceil(from.getTime() / STEP_MS) * STEP_MS;
  while (t + durationMs <= horizonEnd.getTime()) {
    const slot = { start: new Date(t), end: new Date(t + durationMs) };
    if (inWorkday(slot.start, slot.end) && !busy.some((b) => overlaps(b, slot))) return slot;
    t += STEP_MS;
  }
  return null;
}

/**
 * Candidats d'affectation d'une intervention : pour chaque technicien, le créneau demandé s'il est libre
 * (intervention normale), sinon son premier créneau libre (à partir de maintenant pour une urgence, du
 * début demandé sinon). Tri : compétences requises toutes détenues, puis créneau le plus tôt (urgence)
 * ou le plus proche du créneau demandé, puis charge la plus faible. Un technicien sans aucune des
 * compétences requises est écarté ; aucun candidat n'est jamais en conflit.
 */
export function facturePlanningCandidates(input: {
  start: Date;
  end: Date;
  priority: FactureInterventionPriority;
  requiredSkillIds: string[];
  members: PlanningMember[];
  busy: BusyPeriod[];
  now: Date;
  limit?: number;
}): PlanningCandidate[] {
  const duration = input.end.getTime() - input.start.getTime();
  const horizonEnd = new Date(input.now.getTime() + FACTURE_PLANNING_HORIZON_DAYS * DAY_MS);
  const requested = { start: input.start, end: input.end };
  const out: PlanningCandidate[] = [];
  for (const m of input.members) {
    const matched = input.requiredSkillIds.filter((s) => m.skillIds.includes(s)).length;
    if (input.requiredSkillIds.length > 0 && matched === 0) continue;
    const busy = input.busy.filter((b) => b.memberId === m.id);
    const conflicts = busy.filter((b) => overlaps(b, requested)).map((b) => b.label);
    const keep =
      input.priority === 'NORMAL' &&
      conflicts.length === 0 &&
      input.start.getTime() >= input.now.getTime();
    const slot = keep
      ? requested
      : firstFreeSlot(
          busy,
          input.priority === 'URGENT'
            ? input.now
            : new Date(Math.max(input.start.getTime(), input.now.getTime())),
          duration,
          horizonEnd,
        );
    if (!slot) continue;
    out.push({
      memberId: m.id,
      name: m.name,
      start: slot.start,
      end: slot.end,
      requestedSlot: keep,
      skillsMatched: matched,
      skillsRequired: input.requiredSkillIds.length,
      load: busy.filter((b) => b.start.getTime() >= input.now.getTime() && b.start < horizonEnd)
        .length,
      conflicts,
    });
  }
  const full = (c: PlanningCandidate) => (c.skillsMatched === c.skillsRequired ? 0 : 1);
  const gap = (c: PlanningCandidate) =>
    input.priority === 'URGENT'
      ? c.start.getTime()
      : Math.abs(c.start.getTime() - input.start.getTime());
  return out
    .sort((a, b) => full(a) - full(b) || gap(a) - gap(b) || a.load - b.load)
    .slice(0, input.limit ?? 5);
}

// ─── Maintenance préventive ───

export const FACTURE_MAINTENANCE_REASONS = ['DUE', 'NEVER_SERVICED', 'REPEATED'] as const;
export type FactureMaintenanceReason = (typeof FACTURE_MAINTENANCE_REASONS)[number];

export const FACTURE_MAINTENANCE_REASON_LABELS: Record<FactureMaintenanceReason, string> = {
  DUE: 'Entretien périodique à prévoir',
  NEVER_SERVICED: 'Aucun entretien enregistré',
  REPEATED: 'Interventions répétées : vérification recommandée',
};

export interface MaintenanceEquipment {
  id: string;
  installedAt: Date | null;
  maintenanceIntervalMonths: number | null;
  /** Interventions réalisées sur l'équipement (date de fin des travaux). */
  history: { number: string; completedAt: Date }[];
}

export interface MaintenanceCandidate {
  equipmentId: string;
  reasons: FactureMaintenanceReason[];
  lastServiceAt: Date | null;
  /** Échéance du prochain entretien périodique (null : périodicité non renseignée). */
  dueDate: Date | null;
  /** Interventions citées comme justificatifs. */
  evidence: string[];
}

const addMonths = (d: Date, months: number) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));

/**
 * Équipements à entretenir ou à vérifier, d'après leur historique RÉEL : entretien périodique échu ou
 * dans les 30 jours (périodicité renseignée), aucun entretien depuis plus d'un an de service, ou au moins
 * deux interventions en six mois. Ce sont des signaux à vérifier, jamais une prédiction de panne.
 */
export function factureMaintenanceCandidates(
  equipment: MaintenanceEquipment[],
  now: Date,
): MaintenanceCandidate[] {
  const soon = new Date(now.getTime() + 30 * DAY_MS);
  const sixMonthsAgo = addMonths(now, -6);
  const yearAgo = addMonths(now, -12);
  const out: MaintenanceCandidate[] = [];
  for (const e of equipment) {
    const history = [...e.history].sort(
      (a, b) => b.completedAt.getTime() - a.completedAt.getTime(),
    );
    const last = history[0]?.completedAt ?? null;
    const base = last ?? e.installedAt;
    const dueDate =
      e.maintenanceIntervalMonths && base ? addMonths(base, e.maintenanceIntervalMonths) : null;
    const reasons: FactureMaintenanceReason[] = [];
    const evidence: string[] = [];
    if (dueDate && dueDate.getTime() <= soon.getTime()) {
      reasons.push('DUE');
      if (history[0]) evidence.push(history[0].number);
    }
    if (!last && e.installedAt && e.installedAt.getTime() <= yearAgo.getTime()) {
      reasons.push('NEVER_SERVICED');
    }
    const recent = history.filter((h) => h.completedAt.getTime() >= sixMonthsAgo.getTime());
    if (recent.length >= 2) {
      reasons.push('REPEATED');
      evidence.push(...recent.map((h) => h.number));
    }
    if (reasons.length > 0) {
      out.push({
        equipmentId: e.id,
        reasons,
        lastServiceAt: last,
        dueDate,
        evidence: [...new Set(evidence)],
      });
    }
  }
  return out;
}

/**
 * Formulations interdites : une panne n'est jamais annoncée comme certaine. Frontières de mot Unicode
 * (« à coup sûr », « forcément » sont reconnus). « certain(e) » n'est retenu qu'après une panne (« panne
 * certaine »), en fin de groupe (« échec certain. ») ou devant « que » : « un certain temps », « certains
 * équipements », « une certaine usure » restent permis.
 */
const CERTAINTY =
  /(?<![\p{L}\p{N}])(certainement|certaine?s?\s+que|(?:panne|échec|défaillance|rupture|casse|fuite|arrêt)s?\s+certaine?s?|certaine?(?=\s*(?:[^\p{L}\s]|$))|à coup sûr|sans aucun doute|sans faute|inévitabl\p{L}*|inéluctabl\p{L}*|immanquablement|assurément|forcément|sûrement|va (?:tomber|lâcher|casser)|vont (?:tomber|lâcher|casser)|tombera|tomberont|lâchera|lâcheront|cassera|casseront)(?![\p{L}\p{N}])/iu;

export function factureAiClaimsCertainty(text: string): boolean {
  return CERTAINTY.test(text.normalize('NFC'));
}
