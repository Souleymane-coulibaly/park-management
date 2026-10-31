import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthContext } from '../auth-context';
import { AllowMfaPending, RequirePlatformPermission, SuperAdminOnly } from '../decorators';
import type { SessionService } from '../security/session.service';
import { AuthGuard } from './auth.guard';
import { PermissionsGuard } from './permissions.guard';

class Routes {
  @SuperAdminOnly()
  anyInternal() {}

  @RequirePlatformPermission('platform.billing.validate')
  validate() {}

  @RequirePlatformPermission('platform.users.manage')
  users() {}

  @AllowMfaPending()
  me() {}

  plain() {}
}

const auth = (
  platformRole: string | null,
  mfa = { required: false, enrolled: false, verified: false },
  membership: unknown = null,
) =>
  ({
    sessionId: 's',
    user: {
      id: 'u',
      firstName: 'A',
      lastName: 'B',
      email: null,
      loginId: 'X',
      mustChangePassword: false,
      platformRole,
    },
    membership,
    mfa,
  }) as unknown as AuthContext;

const context = (handler: () => void, a: AuthContext) =>
  ({
    getHandler: () => handler,
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => ({ auth: a, cookies: { ocp_session: 'tok' } }) }),
  }) as unknown as ExecutionContext;

describe('Gardes Ocall Suite : permissions plateforme', () => {
  const guard = new PermissionsGuard(new Reflector());
  const r = new Routes();
  const denied = (fn: () => void, a: AuthContext) => {
    try {
      guard.canActivate(context(fn, a));
      return false;
    } catch {
      return true;
    }
  };

  it('route interne : tout rôle plateforme, jamais un membre d’organisation', () => {
    expect(denied(r.anyInternal, auth('SUPPORT_AGENT'))).toBe(false);
    expect(denied(r.anyInternal, auth(null, undefined, { role: 'OWNER' }))).toBe(true);
  });

  it('permission précise : facturation, et comptes internes réservés au propriétaire', () => {
    expect(denied(r.validate, auth('BILLING_MANAGER'))).toBe(false);
    expect(denied(r.validate, auth('READ_ONLY_AUDITOR'))).toBe(true);
    expect(denied(r.users, auth('SUPER_ADMIN'))).toBe(false);
    expect(denied(r.users, auth('PLATFORM_ADMIN'))).toBe(true);
  });
});

describe('Garde d’authentification : second facteur', () => {
  const sessions = (a: AuthContext) => ({ resolve: async () => a }) as unknown as SessionService;
  const r = new Routes();
  const run = async (fn: () => void, a: AuthContext) => {
    try {
      await new AuthGuard(new Reflector(), sessions(a)).canActivate(context(fn, a));
      return 'ok';
    } catch (e) {
      return (e as { response?: { code?: string } }).response?.code ?? 'error';
    }
  };

  it('MFA requise et non validée : routes bloquées, sauf profil / enrôlement', async () => {
    expect(
      await run(
        r.plain,
        auth('PLATFORM_ADMIN', { required: true, enrolled: false, verified: false }),
      ),
    ).toBe('MFA_ENROLLMENT_REQUIRED');
    expect(
      await run(
        r.plain,
        auth('PLATFORM_ADMIN', { required: true, enrolled: true, verified: false }),
      ),
    ).toBe('MFA_REQUIRED');
    expect(
      await run(r.me, auth('PLATFORM_ADMIN', { required: true, enrolled: true, verified: false })),
    ).toBe('ok');
  });

  it('MFA validée, ou non requise : accès', async () => {
    expect(
      await run(
        r.plain,
        auth('PLATFORM_ADMIN', { required: true, enrolled: true, verified: true }),
      ),
    ).toBe('ok');
    expect(
      await run(
        r.plain,
        auth('SUPPORT_AGENT', { required: false, enrolled: false, verified: false }),
      ),
    ).toBe('ok');
  });
});
