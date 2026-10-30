import { Resolver } from 'node:dns/promises';

/**
 * Vérifications techniques d'un domaine personnalisé (Sprint 10) :
 * - propriété : enregistrement TXT `_ocallpark-verify.<domaine>` portant le jeton du site ;
 * - mise en service : la page de contrôle `https://<domaine>/.well-known/ocall-site` répond, en
 *   HTTPS avec un certificat valide, l'identifiant du site attendu.
 *
 * Deux implémentations : réelle (DNS publics, requête HTTPS) et SIMULÉE pour les tests automatisés
 * (enregistrements fournis par le test). Les tests simulés ne prouvent rien sur la production :
 * la procédure réelle est décrite dans docs/SITES-VITRINES.md.
 */
export interface DomainVerifier {
  readonly mode: 'real' | 'simulated';
  resolveTxt(name: string): Promise<string[]>;
  checkHttps(
    hostname: string,
    expectedSiteId: string,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
}

export const DOMAIN_VERIFIER = Symbol('DOMAIN_VERIFIER');

export class RealDomainVerifier implements DomainVerifier {
  readonly mode = 'real' as const;
  private readonly resolver = new Resolver({ timeout: 5_000, tries: 2 });

  constructor() {
    // Résolveurs publics : la vérification ne dépend pas d'un cache DNS local.
    this.resolver.setServers(['1.1.1.1', '8.8.8.8']);
  }

  async resolveTxt(name: string): Promise<string[]> {
    try {
      return (await this.resolver.resolveTxt(name)).map((chunks) => chunks.join(''));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENODATA' || code === 'ENOTFOUND') return [];
      throw e;
    }
  }

  async checkHttps(hostname: string, expectedSiteId: string) {
    try {
      // Pas de redirection suivie : la réponse doit venir du domaine lui-même, en HTTPS.
      const res = await fetch(`https://${hostname}/.well-known/ocall-site`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
        headers: { accept: 'application/json' },
      });
      if (res.status !== 200) return { ok: false as const, error: `Réponse HTTPS ${res.status}.` };
      const body = (await res.json().catch(() => null)) as { siteId?: unknown } | null;
      if (body?.siteId !== expectedSiteId) {
        return { ok: false as const, error: 'Le domaine ne sert pas ce site.' };
      }
      return { ok: true as const };
    } catch (e) {
      return {
        ok: false as const,
        error: `HTTPS injoignable ou certificat invalide (${(e as Error).name}).`,
      };
    }
  }
}

/** Vérificateur simulé : enregistrements DNS et réponses HTTPS fournis par les tests. */
export class SimulatedDomainVerifier implements DomainVerifier {
  readonly mode = 'simulated' as const;
  private readonly txt = new Map<string, string[]>();
  private readonly https = new Map<string, string>();

  setTxt(name: string, values: string[]) {
    this.txt.set(name.toLowerCase(), values);
  }

  /** Le domaine sert ce site en HTTPS (certificat valide simulé). */
  setHttps(hostname: string, siteId: string) {
    this.https.set(hostname.toLowerCase(), siteId);
  }

  async resolveTxt(name: string) {
    return this.txt.get(name.toLowerCase()) ?? [];
  }

  async checkHttps(hostname: string, expectedSiteId: string) {
    const served = this.https.get(hostname.toLowerCase());
    if (!served) return { ok: false as const, error: 'HTTPS injoignable (simulé).' };
    if (served !== expectedSiteId)
      return { ok: false as const, error: 'Le domaine ne sert pas ce site.' };
    return { ok: true as const };
  }
}

export function createDomainVerifier(env: NodeJS.ProcessEnv, nodeEnv: string): DomainVerifier {
  if (env.SITES_DOMAIN_VERIFIER === 'simulated') {
    if (nodeEnv === 'production') {
      throw new Error('SITES_DOMAIN_VERIFIER=simulated est interdit en production.');
    }
    return new SimulatedDomainVerifier();
  }
  return new RealDomainVerifier();
}
