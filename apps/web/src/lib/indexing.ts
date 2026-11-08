/**
 * Indexation par les moteurs de recherche, décidée par l'environnement de DÉPLOIEMENT.
 *
 * Le site est indexable par défaut : la production publique ne doit jamais être désindexée par
 * accident. L'indexation n'est bloquée que :
 * - sur un déploiement Vercel « Preview » (`VERCEL_ENV=preview`, positionné par Vercel lui-même),
 *   ce qui couvre la préproduction actuelle ; une production Vercel (`VERCEL_ENV=production`) ou un
 *   hébergement hors Vercel (Railway) n'est pas concerné ;
 * - ou sur demande explicite (`SITE_NOINDEX=1`), pour une préproduction hébergée ailleurs.
 *
 * Évalué au build (en-têtes de next.config) et au rendu (métadonnées) : les deux voient les mêmes
 * variables sur Vercel. La protection d'accès Vercel reste la barrière principale de la préproduction.
 */
export function isIndexingBlocked(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SITE_NOINDEX === '1' || env.VERCEL_ENV === 'preview';
}

/** Valeur de l'en-tête `X-Robots-Tag` et de la balise `robots` hors production. */
export const NOINDEX_DIRECTIVE = 'noindex, nofollow';
