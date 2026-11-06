import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Limitation de débit IA, en mémoire, par fenêtre glissante d'une minute : par utilisateur et par
 * organisation, au sein d'une application. Elle protège le fournisseur (et la facture) d'une rafale
 * avant même la réservation du quota mensuel. Limite connue : compteurs propres à chaque instance de
 * l'API (sur plusieurs instances, la limite effective est multipliée par leur nombre) ; le quota
 * mensuel, lui, reste exact car il est compté en base sous verrou.
 */
export class AiRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limits: { perUserPerMinute: number; perOrganizationPerMinute: number },
    private readonly now: () => number = Date.now,
  ) {}

  /** Compte une requête ; refuse (429) si l'utilisateur ou l'organisation dépasse sa limite. */
  hit(key: { application: string; organizationId: string; actorUserId: string }) {
    const at = this.now();
    const user = `${key.application}:${key.organizationId}:${key.actorUserId}`;
    const org = `${key.application}:${key.organizationId}`;
    const userHits = this.window(user, at);
    const orgHits = this.window(org, at);
    if (
      userHits.length >= this.limits.perUserPerMinute ||
      orgHits.length >= this.limits.perOrganizationPerMinute
    ) {
      throw new HttpException(
        {
          code: 'AI_TOO_MANY_REQUESTS',
          message:
            'Trop de demandes IA en peu de temps : patientez une minute. Vous pouvez continuer sans IA.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    userHits.push(at);
    orgHits.push(at);
    if (this.hits.size > 10_000) this.prune(at);
  }

  private window(key: string, at: number): number[] {
    const list = (this.hits.get(key) ?? []).filter((t) => at - t < 60_000);
    this.hits.set(key, list);
    return list;
  }

  /** Mémoire bornée : oublie les clés sans requête récente. */
  private prune(at: number) {
    for (const [key, list] of this.hits) {
      if (list.every((t) => at - t >= 60_000)) this.hits.delete(key);
    }
  }
}
