import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { type Observable, Subject, filter } from 'rxjs';

/** Flux d'abonnement : « orders » pour la salle et la caisse, « kitchen » pour l'écran cuisine. */
export type RestaurantTopic = 'orders' | 'kitchen';

/**
 * Évènement temps réel. Il ne transporte que des identifiants : l'écran qui le reçoit recharge les
 * données par l'API REST, soumise aux mêmes contrôles d'accès que d'habitude.
 */
export interface RestaurantEvent {
  organizationId: string;
  establishmentId: string;
  topics: readonly RestaurantTopic[];
  /** order.created, order.updated, order.sent, order.started, order.ready, order.served,
   *  order.paid, order.cancelled, qr.requested, qr.decided */
  type: string;
  saleId?: string;
  requestId?: string;
  at: string;
}

/**
 * Bus d'évènements du restaurant, en mémoire. Il suffit pour une instance d'API (déploiement
 * Railway actuel). Avec plusieurs instances, ce service devra s'appuyer sur un canal partagé
 * (PostgreSQL LISTEN/NOTIFY sur une connexion directe, ou Redis) : limite documentée.
 *
 * Les évènements sont publiés APRÈS la validation de la transaction : un écran ne voit jamais
 * une modification annulée.
 */
@Injectable()
export class RestaurantEventsService implements OnModuleDestroy {
  private readonly subject = new Subject<RestaurantEvent>();
  private readonly shutdownSubject = new Subject<void>();

  /**
   * Émis à l'arrêt de l'application : les flux SSE se terminent, sinon les connexions ouvertes
   * empêcheraient le serveur HTTP de s'arrêter (redéploiement, fin des tests).
   */
  readonly shutdown$: Observable<void> = this.shutdownSubject.asObservable();

  publish(event: Omit<RestaurantEvent, 'at'>): void {
    this.subject.next({ ...event, at: new Date().toISOString() });
  }

  /** Évènements d'un seul établissement d'une seule organisation, pour un flux donné. */
  stream(
    organizationId: string,
    establishmentId: string,
    topic: RestaurantTopic,
  ): Observable<RestaurantEvent> {
    return this.subject.pipe(
      filter(
        (e) =>
          e.organizationId === organizationId &&
          e.establishmentId === establishmentId &&
          e.topics.includes(topic),
      ),
    );
  }

  onModuleDestroy(): void {
    this.shutdownSubject.next();
    this.shutdownSubject.complete();
    this.subject.complete();
  }
}
