import { Injectable } from '@nestjs/common';

/**
 * Comptes de portail externes à une organisation (Sprint 6 : portail parents d'Ocall School). Un compte
 * Suite sans adhésion, sans rôle interne et sans profil partenaire n'est accepté que si un module l'a
 * déclaré actif ici. Le module concerné s'enregistre au démarrage : le cœur de l'authentification ne
 * dépend d'aucun module métier.
 */
export interface PortalAccountSource {
  /** Type de portail renvoyé au client (`/me`). */
  readonly kind: 'guardian';
  /** Compte actif sur ce portail (relu à chaque requête : la révocation est immédiate). */
  isActive(userId: string): Promise<boolean>;
}

@Injectable()
export class PortalAccounts {
  private readonly sources: PortalAccountSource[] = [];

  register(source: PortalAccountSource): void {
    if (!this.sources.includes(source)) this.sources.push(source);
  }

  /** Premier portail sur lequel le compte est actif, ou null. */
  async kindOf(userId: string): Promise<PortalAccountSource['kind'] | null> {
    for (const source of this.sources) {
      if (await source.isActive(userId)) return source.kind;
    }
    return null;
  }
}
