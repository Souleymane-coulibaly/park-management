import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthContext } from '../auth-context';
import type { RequestMeta } from '../request-meta';
import { platformRoleRequiresMfa } from '@ocall/shared';
import { generateToken, hashToken } from './tokens';

/** Intervalle minimal entre deux mises à jour de lastSeenAt, pour limiter les écritures. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get ttlMs(): number {
    return this.config.sessionTtlHours * 3600 * 1000;
  }

  /** Crée une session et retourne le jeton en clair (à placer dans le cookie, jamais stocké). */
  async create(
    userId: string,
    membershipId: string | null,
    meta: RequestMeta,
    db: Db = this.prisma,
  ): Promise<string> {
    const token = generateToken();
    await db.session.create({
      data: {
        tokenHash: hashToken(token),
        userId,
        membershipId,
        expiresAt: new Date(Date.now() + this.ttlMs),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });
    return token;
  }

  /**
   * Résout un jeton en contexte d'authentification. Retourne null si la session est
   * expirée ou révoquée, si le compte est désactivé, ou si l'adhésion ou l'organisation
   * ne sont plus actives : la révocation prend effet à la requête suivante.
   */
  async resolve(token: string): Promise<AuthContext | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true, membership: { include: { organization: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
    const { user, membership } = session;
    if (!user.isActive) return null;

    if (membership) {
      if (!membership.isActive || membership.organization.status !== 'ACTIVE') return null;
    } else if (!user.platformRole) {
      return null;
    }

    if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
    }

    return {
      sessionId: session.id,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        loginId: user.loginId,
        mustChangePassword: user.mustChangePassword,
        platformRole: user.platformRole,
      },
      mfa: {
        // Obligatoire pour les rôles sensibles ; pour les autres comptes internes, exigée dès
        // qu'elle a été activée volontairement.
        required:
          !membership &&
          !!user.platformRole &&
          (platformRoleRequiresMfa(user.platformRole) || user.mfaEnabledAt !== null),
        enrolled: user.mfaEnabledAt !== null,
        verified: session.mfaVerifiedAt !== null,
      },
      membership: membership
        ? {
            id: membership.id,
            role: membership.role,
            organizationId: membership.organizationId,
            organizationName: membership.organization.name,
            businessType: membership.organization.businessType,
            timezone: membership.organization.timezone,
          }
        : null,
    };
  }

  /** Second facteur validé pour cette session. */
  async markMfaVerified(sessionId: string, db: Db = this.prisma): Promise<void> {
    await db.session.update({ where: { id: sessionId }, data: { mfaVerifiedAt: new Date() } });
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(
    userId: string,
    exceptSessionId?: string,
    db: Db = this.prisma,
  ): Promise<void> {
    await db.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }
}
