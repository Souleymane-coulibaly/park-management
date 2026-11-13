import { Injectable } from '@nestjs/common';

/** Application qui sert des vitrines sur des domaines personnalisés (bases séparées). */
export type SiteDomainOwner = 'FACTURE' | 'STOCK';

/**
 * Registre des domaines personnalisés des vitrines à base séparée (Facture, Stock) : chaque application
 * y inscrit, au démarrage, la fonction qui dit si un nom de domaine lui est déjà déclaré. Avant de
 * déclarer un domaine, une application interroge les autres : un nom n'est jamais servi par deux
 * applications. Aucune application n'importe le code ni la base d'une autre.
 */
@Injectable()
export class SiteDomainRegistry {
  private readonly owners = new Map<SiteDomainOwner, (hostname: string) => Promise<boolean>>();

  register(owner: SiteDomainOwner, claims: (hostname: string) => Promise<boolean>) {
    this.owners.set(owner, claims);
  }

  /** Vrai si une autre application que `owner` a déjà déclaré ce domaine. */
  async takenElsewhere(owner: SiteDomainOwner, hostname: string): Promise<boolean> {
    for (const [other, claims] of this.owners) {
      if (other !== owner && (await claims(hostname))) return true;
    }
    return false;
  }
}
