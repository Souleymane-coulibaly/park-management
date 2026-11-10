import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth-context';
import type { RequestMeta } from '../../common/request-meta';
import { PasswordService } from '../../common/security/password.service';
import { PortalAccounts } from '../../common/security/portal-accounts';
import { SessionService } from '../../common/security/session.service';
import { generateToken, hashToken } from '../../common/security/tokens';
import { PARK_PRODUCT_CODE } from '@ocall/shared';
import { OrganizationProvisioningService } from '../organizations/organization-provisioning.service';
import type {
  ChangePasswordDto,
  LoginDto,
  PasswordResetConfirmDto,
  SignupDto,
  UpdateProfileDto,
} from './auth.dto';
import { PASSWORD_RESET_NOTIFIER, type PasswordResetNotifier } from './password-reset-notifier';

const INVALID_CREDENTIALS = {
  code: 'INVALID_CREDENTIALS',
  message: 'Identifiant ou mot de passe incorrect.',
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly provisioning: OrganizationProvisioningService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PASSWORD_RESET_NOTIFIER) private readonly notifier: PasswordResetNotifier,
    private readonly portals: PortalAccounts,
  ) {}

  /** Inscription publique : crée l'organisation, son propriétaire et ouvre une session. */
  async signup(dto: SignupDto, meta: RequestMeta): Promise<string> {
    this.passwords.assertPolicy(dto.password);
    const passwordHash = await this.passwords.hash(dto.password);
    return this.prisma.$transaction(async (tx) => {
      const created = await this.provisioning.provision(tx, {
        organizationName: dto.organizationName,
        businessType: dto.businessType,
        countryCode: dto.countryCode,
        establishmentName: dto.establishmentName,
        owner: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          passwordHash,
          mustChangePassword: false,
        },
      });
      // Lien parrainé (Sprint S3) : attribution Ocall Park « à confirmer » au partenaire ACTIF du code.
      // Aucun droit pour le partenaire avant la confirmation d'Ocall ; un code inconnu est ignoré.
      const partner = dto.ref
        ? await tx.partner.findFirst({
            where: { code: dto.ref, status: 'ACTIVE' },
            select: { id: true, user: { select: { email: true } } },
          })
        : null;
      if (partner && partner.user.email !== dto.email) {
        const park = await tx.saasProduct.findUniqueOrThrow({
          where: { code: PARK_PRODUCT_CODE },
          select: { id: true },
        });
        await tx.attribution.create({
          data: {
            organizationId: created.organizationId,
            partnerId: partner.id,
            productId: park.id,
            source: 'REFERRAL',
          },
        });
      }
      await this.audit.record(
        {
          organizationId: created.organizationId,
          actorUserId: created.userId,
          action: 'organization.created',
          targetType: 'Organization',
          targetId: created.organizationId,
          metadata: { businessType: dto.businessType, via: 'signup', referral: !!partner },
          ipAddress: meta.ipAddress,
        },
        tx,
      );
      return this.sessions.create(created.userId, created.membershipId, meta, tx);
    });
  }

  async login(dto: LoginDto, meta: RequestMeta): Promise<string> {
    const identifier = dto.identifier.includes('@')
      ? dto.identifier.toLowerCase()
      : dto.identifier.toUpperCase();
    const user = await this.prisma.user.findFirst({
      where: identifier.includes('@')
        ? { OR: [{ email: identifier }, { loginId: identifier }] }
        : { loginId: identifier },
    });
    if (!user) {
      await this.passwords.verifyAgainstDummy(dto.password);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException(
        { code: 'ACCOUNT_LOCKED', message: 'Trop de tentatives. Réessayez dans quelques minutes.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const valid = await this.passwords.verify(user.passwordHash, dto.password);
    if (!valid || !user.isActive) {
      if (!valid) await this.registerFailure(user.id, user.failedLoginCount, meta);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    let membershipId: string | null = null;
    let organizationId: string | null = null;
    // Compte partenaire (Sprint 12B) : aucune adhésion ; refusé s'il est suspendu.
    const partner = user.platformRole
      ? null
      : await this.prisma.partner.findUnique({
          where: { userId: user.id },
          select: { status: true },
        });
    if (partner?.status === 'SUSPENDED' || partner?.status === 'TERMINATED') {
      throw new ForbiddenException({
        code: partner.status === 'SUSPENDED' ? 'PARTNER_SUSPENDED' : 'PARTNER_TERMINATED',
        message:
          partner.status === 'SUSPENDED'
            ? 'Ce compte partenaire est suspendu.'
            : 'Ce partenariat est résilié.',
      });
    }
    if (!user.platformRole && !partner) {
      const membership = await this.prisma.organizationMembership.findFirst({
        where: { userId: user.id, isActive: true },
        include: { organization: { select: { status: true } } },
        orderBy: { createdAt: 'asc' },
      });
      // Sans adhésion : seul un compte de portail actif (parents, Sprint 6) peut ouvrir une session.
      if (!membership && !(await this.portals.kindOf(user.id)))
        throw new ForbiddenException({
          code: 'ACCOUNT_DISABLED',
          message: 'Ce compte est désactivé.',
        });
      if (membership && membership.organization.status !== 'ACTIVE') {
        throw new ForbiddenException({
          code: 'ORGANIZATION_SUSPENDED',
          message: 'Cette organisation est suspendue.',
        });
      }
      membershipId = membership?.id ?? null;
      organizationId = membership?.organizationId ?? null;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const token = await this.sessions.create(user.id, membershipId, meta);
    await this.audit.record({
      organizationId,
      actorUserId: user.id,
      action: 'auth.login',
      targetType: 'User',
      targetId: user.id,
      ipAddress: meta.ipAddress,
    });
    return token;
  }

  async logout(auth: AuthContext): Promise<void> {
    await this.sessions.revoke(auth.sessionId);
    await this.audit.record({
      organizationId: auth.membership?.organizationId ?? null,
      actorUserId: auth.user.id,
      action: 'auth.logout',
      targetType: 'User',
      targetId: auth.user.id,
    });
  }

  /** Change le mot de passe et révoque toutes les autres sessions du compte. */
  async changePassword(auth: AuthContext, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!(await this.passwords.verify(user.passwordHash, dto.currentPassword))) {
      throw new UnauthorizedException({
        code: 'INVALID_CURRENT_PASSWORD',
        message: 'Mot de passe actuel incorrect.',
      });
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new ForbiddenException({
        code: 'PASSWORD_UNCHANGED',
        message: "Le nouveau mot de passe doit être différent de l'actuel.",
      });
    }
    this.passwords.assertPolicy(dto.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await this.passwords.hash(dto.newPassword),
          mustChangePassword: false,
          passwordChangedAt: new Date(),
        },
      });
      await this.sessions.revokeAllForUser(user.id, auth.sessionId, tx);
      await this.audit.record(
        {
          organizationId: auth.membership?.organizationId ?? null,
          actorUserId: user.id,
          action: 'auth.password_changed',
          targetType: 'User',
          targetId: user.id,
        },
        tx,
      );
    });
  }

  async updateProfile(auth: AuthContext, dto: UpdateProfileDto): Promise<void> {
    await this.prisma.user.update({
      where: { id: auth.user.id },
      data: { firstName: dto.firstName, lastName: dto.lastName },
    });
  }

  /**
   * Demande de réinitialisation. La réponse est identique que le compte existe ou non
   * (pas d'énumération). Seuls les comptes actifs avec e-mail reçoivent un lien ;
   * les employés sans e-mail passent par la réinitialisation par leur administrateur.
   */
  async requestPasswordReset(identifier: string, meta: RequestMeta): Promise<void> {
    const normalized = identifier.includes('@')
      ? identifier.toLowerCase()
      : identifier.toUpperCase();
    const user = await this.prisma.user.findFirst({
      where: normalized.includes('@') ? { email: normalized } : { loginId: normalized },
    });
    if (!user || !user.isActive || !user.email) return;

    const token = generateToken();
    await this.prisma.$transaction([
      // Un seul lien valide à la fois.
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + this.config.passwordResetTtlMinutes * 60_000),
        },
      }),
    ]);
    await this.audit.record({
      organizationId: null,
      actorUserId: user.id,
      action: 'auth.password_reset_requested',
      targetType: 'User',
      targetId: user.id,
      ipAddress: meta.ipAddress,
    });
    await this.notifier.send(
      { userId: user.id, email: user.email, firstName: user.firstName },
      `/reinitialiser-mot-de-passe?token=${token}`,
    );
  }

  async confirmPasswordReset(dto: PasswordResetConfirmDto, meta: RequestMeta): Promise<void> {
    this.passwords.assertPolicy(dto.newPassword);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(dto.token) },
    });
    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw new ForbiddenException({
        code: 'INVALID_RESET_TOKEN',
        message: 'Lien de réinitialisation invalide ou expiré.',
      });
    }
    const passwordHash = await this.passwords.hash(dto.newPassword);
    await this.prisma.$transaction(async (tx) => {
      // Consommation atomique : un jeton ne peut servir qu'une fois, même en concurrence.
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new ForbiddenException({
          code: 'INVALID_RESET_TOKEN',
          message: 'Lien de réinitialisation invalide ou expiré.',
        });
      }
      await tx.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await this.sessions.revokeAllForUser(record.userId, undefined, tx);
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: record.userId,
          action: 'auth.password_reset_completed',
          targetType: 'User',
          targetId: record.userId,
          ipAddress: meta.ipAddress,
        },
        tx,
      );
    });
  }

  private async registerFailure(
    userId: string,
    previousFailures: number,
    meta: RequestMeta,
  ): Promise<void> {
    const failures = previousFailures + 1;
    const lock = failures >= this.config.accountLockThreshold;
    await this.prisma.user.update({
      where: { id: userId },
      data: lock
        ? {
            failedLoginCount: 0,
            lockedUntil: new Date(Date.now() + this.config.accountLockMinutes * 60_000),
          }
        : { failedLoginCount: failures },
    });
    await this.audit.record({
      organizationId: null,
      actorUserId: userId,
      action: lock ? 'auth.account_locked' : 'auth.login_failed',
      targetType: 'User',
      targetId: userId,
      ipAddress: meta.ipAddress,
    });
  }
}
