import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { MFA_RECOVERY_CODES } from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth-context';
import type { RequestMeta } from '../../common/request-meta';
import { SessionService } from '../../common/security/session.service';
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUri,
  verifyTotp,
} from '../../common/security/totp';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';

/**
 * Double authentification des comptes internes Ocall (Sprint 11A). Obligatoire pour le
 * propriétaire, les administrateurs délégués et la gestion de la facturation ; disponible pour les
 * autres rôles internes. Récupération : codes de secours à usage unique, puis réinitialisation par
 * le propriétaire ou procédure serveur (`pnpm db:reset-mfa`).
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private key(): Buffer {
    if (!this.config.mfaEncryptionKey) {
      throw new ServiceUnavailableException({
        code: 'MFA_NOT_CONFIGURED',
        message: 'Double authentification non configurée sur ce serveur (MFA_ENCRYPTION_KEY).',
      });
    }
    return this.config.mfaEncryptionKey;
  }

  private assertInternal(auth: AuthContext) {
    // Comptes internes Ocall et partenaires commerciaux (Sprint 12B) ; jamais les membres clients.
    if (auth.membership || (!auth.user.platformRole && !auth.partner)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message:
          'La double authentification concerne les comptes internes Ocall et les partenaires.',
      });
    }
  }

  /** Nouveau secret (en attente de confirmation par un premier code). */
  async setup(auth: AuthContext) {
    this.assertInternal(auth);
    if (auth.mfa.enrolled) {
      throw new ConflictException({
        code: 'MFA_ALREADY_ENABLED',
        message: 'Double authentification déjà activée.',
      });
    }
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: auth.user.id },
      data: { mfaPendingSecret: encryptSecret(secret, this.key()) },
    });
    return { secret, otpauthUri: otpauthUri(secret, auth.user.email ?? auth.user.loginId) };
  }

  /** Activation : le premier code valide confirme le secret ; codes de secours renvoyés une fois. */
  async enable(auth: AuthContext, code: string, meta: RequestMeta) {
    this.assertInternal(auth);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (user.mfaEnabledAt) {
      throw new ConflictException({
        code: 'MFA_ALREADY_ENABLED',
        message: 'Double authentification déjà activée.',
      });
    }
    if (!user.mfaPendingSecret) {
      throw new BadRequestException({
        code: 'MFA_SETUP_REQUIRED',
        message: 'Commencez par générer un secret.',
      });
    }
    const secret = decryptSecret(user.mfaPendingSecret, this.key());
    const step = verifyTotp(secret, code, null);
    if (step === null) {
      throw new UnauthorizedException({ code: 'MFA_INVALID_CODE', message: 'Code incorrect.' });
    }
    const recoveryCodes = generateRecoveryCodes(MFA_RECOVERY_CODES);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          mfaSecret: user.mfaPendingSecret,
          mfaPendingSecret: null,
          mfaEnabledAt: new Date(),
          mfaLastStep: step,
          mfaRecoveryCodes: recoveryCodes.map(hashRecoveryCode),
        },
      });
      await this.sessions.markMfaVerified(auth.sessionId, tx);
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: user.id,
          action: 'auth.mfa_enabled',
          targetType: 'User',
          targetId: user.id,
          ipAddress: meta.ipAddress,
        },
        tx,
      );
    });
    return { recoveryCodes };
  }

  /** Validation du second facteur pour la session : code TOTP ou code de secours (usage unique). */
  async verify(
    auth: AuthContext,
    input: { code?: string; recoveryCode?: string },
    meta: RequestMeta,
  ) {
    this.assertInternal(auth);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!user.mfaEnabledAt || !user.mfaSecret) {
      throw new BadRequestException({
        code: 'MFA_NOT_ENABLED',
        message: 'Double authentification non activée.',
      });
    }
    let data: { mfaLastStep?: number; mfaRecoveryCodes?: string[] } | null = null;
    if (input.code) {
      const step = verifyTotp(
        decryptSecret(user.mfaSecret, this.key()),
        input.code,
        user.mfaLastStep,
      );
      if (step !== null) data = { mfaLastStep: step };
    } else if (input.recoveryCode) {
      const hash = hashRecoveryCode(input.recoveryCode);
      if (user.mfaRecoveryCodes.includes(hash)) {
        data = { mfaRecoveryCodes: user.mfaRecoveryCodes.filter((h) => h !== hash) };
      }
    }
    if (!data) {
      await this.audit.record({
        organizationId: null,
        actorUserId: user.id,
        action: 'auth.mfa_failed',
        targetType: 'User',
        targetId: user.id,
        ipAddress: meta.ipAddress,
      });
      throw new UnauthorizedException({
        code: 'MFA_INVALID_CODE',
        message: 'Code incorrect ou déjà utilisé.',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data });
      await this.sessions.markMfaVerified(auth.sessionId, tx);
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: user.id,
          action: input.recoveryCode ? 'auth.mfa_recovery_code_used' : 'auth.mfa_verified',
          targetType: 'User',
          targetId: user.id,
          ipAddress: meta.ipAddress,
        },
        tx,
      );
    });
    return {
      verified: true,
      recoveryCodesLeft: data.mfaRecoveryCodes?.length ?? user.mfaRecoveryCodes.length,
    };
  }
}
