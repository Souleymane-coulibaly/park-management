import type { MessageEvent } from '@nestjs/common';
import { type Permission, hasPermission } from '@ocall/shared';
import {
  type Observable,
  concatMap,
  filter,
  from,
  interval,
  map,
  merge,
  of,
  share,
  takeUntil,
} from 'rxjs';
import type { PrismaService } from '../../prisma/prisma.service';
import type { TenantContext } from '../../common/auth-context';
import type { SessionService } from '../../common/security/session.service';
import { establishmentScope } from '../../common/tenant-scope';
import type {
  RestaurantEventsService,
  RestaurantTopic,
} from '../realtime/restaurant-events.service';

export interface StreamParams {
  prisma: PrismaService;
  events: RestaurantEventsService;
  sessions: SessionService;
  heartbeatMs: number;
  auth: TenantContext;
  /** Jeton du cookie de session, revérifié à chaque battement. */
  token: string;
  establishmentId: string;
  topic: RestaurantTopic;
  permission: Permission;
}

/**
 * Flux SSE (Server-Sent Events) d'un établissement. La connexion est authentifiée par le cookie de
 * session (garde globale) ; l'établissement a été contrôlé par l'appelant. Ensuite, à chaque battement :
 * la session, le rôle et l'affectation à l'établissement sont revérifiés ; une révocation ferme le flux.
 *
 * Les évènements ne contiennent que des identifiants : l'écran recharge les données par l'API REST.
 * Le premier message (« ready ») sert de point de resynchronisation : à chaque (re)connexion, l'écran
 * recharge sa liste complète, si bien qu'aucun évènement manqué pendant une coupure n'est perdu.
 */
export function restaurantStream(p: StreamParams): Observable<MessageEvent> {
  const stillAuthorized = async (): Promise<boolean> => {
    const current = await p.sessions.resolve(p.token).catch(() => null);
    const membership = current?.membership;
    if (!current || !membership || membership.id !== p.auth.membership.id) return false;
    if (!hasPermission(membership.role, p.permission)) return false;
    const assigned = await p.prisma.establishment.count({
      where: {
        ...establishmentScope(current as TenantContext),
        id: p.establishmentId,
        isActive: true,
      },
    });
    return assigned === 1;
  };

  const checks$ = interval(p.heartbeatMs).pipe(
    concatMap(() => from(stillAuthorized())),
    share(),
  );
  const revoked$ = checks$.pipe(filter((ok) => !ok));
  const heartbeat$ = checks$.pipe(
    filter((ok) => ok),
    map((): MessageEvent => ({ type: 'ping', data: { at: new Date().toISOString() } })),
  );
  const events$ = p.events
    .stream(p.auth.membership.organizationId, p.establishmentId, p.topic)
    .pipe(
      map((e): MessageEvent => ({
        type: e.type,
        data: { type: e.type, saleId: e.saleId ?? null, requestId: e.requestId ?? null, at: e.at },
      })),
    );
  const ready$ = of<MessageEvent>({
    type: 'ready',
    // Délai de reconnexion conseillé au navigateur après une coupure.
    retry: 3000,
    data: { establishmentId: p.establishmentId, topic: p.topic, at: new Date().toISOString() },
  });
  return merge(ready$, events$, heartbeat$).pipe(takeUntil(merge(revoked$, p.events.shutdown$)));
}
