import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerOptions } from '@nestjs/throttler';
import { loadConfig } from '../config/app-config';
import { PublicOrderRoute, PublicSiteRoute, SensitiveRoute, throttlerOptions } from './throttling';

class Routes {
  @PublicOrderRoute()
  publicOrder() {}

  @SensitiveRoute()
  login() {}

  other() {}
}

@PublicSiteRoute()
class PublicSiteRoutes {
  page() {}
}

const contextFor = (handler: () => void, cls: object = Routes) =>
  ({ getHandler: () => handler, getClass: () => cls }) as unknown as ExecutionContext;

describe('limites de requêtes par IP', () => {
  const config = loadConfig({ DATABASE_URL: 'postgres://test', PUBLIC_ORDER_THROTTLE_LIMIT: '7' });
  const throttlers = (throttlerOptions(config) as { throttlers: ThrottlerOptions[] }).throttlers;
  const byName = (name: string) => throttlers.find((t) => t.name === name)!;
  const routes = new Routes();

  it('limite dédiée aux demandes de commande publiques (QR), configurable', () => {
    const publicOrder = byName('publicOrder');
    expect(publicOrder).toMatchObject({ limit: 7, ttl: 10 * 60_000 });
    const skip = publicOrder.skipIf as (c: ExecutionContext) => boolean;
    expect(skip(contextFor(routes.publicOrder))).toBe(false);
    expect(skip(contextFor(routes.other))).toBe(true);
    expect(skip(contextFor(routes.login))).toBe(true);
  });

  it('la limite stricte de connexion ne s’applique pas aux commandes publiques', () => {
    const skip = byName('sensitive').skipIf as (c: ExecutionContext) => boolean;
    expect(skip(contextFor(routes.login))).toBe(false);
    expect(skip(contextFor(routes.publicOrder))).toBe(true);
  });

  it('API publique des sites : limite dédiée, marqueur posé sur la classe', () => {
    const skip = byName('publicSite').skipIf as (c: ExecutionContext) => boolean;
    expect(skip(contextFor(new PublicSiteRoutes().page, PublicSiteRoutes))).toBe(false);
    expect(skip(contextFor(routes.other))).toBe(true);
  });

  it('valeur par défaut : 30 demandes par IP sur 10 minutes', () => {
    const defaults = loadConfig({ DATABASE_URL: 'postgres://test' });
    expect(defaults.publicOrderThrottleLimit).toBe(30);
    expect(defaults.realtimeHeartbeatMs).toBe(25_000);
  });
});
