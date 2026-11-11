import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@ocall/database';
import { AuditService } from '../../common/audit/audit.service';
import { PasswordService } from '../../common/security/password.service';
import { generateTemporaryPassword } from '../../common/security/tokens';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationProvisioningService } from './organization-provisioning.service';

export interface ProductUserAccount {
  userId: string;
  membershipId: string;
  loginId: string;
  temporaryPassword: string;
}

/**
 * Comptes réservés à une application à base séparée (Ocall Stock…) : identité, mot de passe et sessions
 * dans la base Suite, avec le rôle PRODUCT_USER (aucun droit Ocall Park ni School). Le rôle applicatif
 * vit dans la base de l'application. Deux bases, donc pas de transaction commune : l'application décide,
 * la base Suite recopie l'état validé.
 */
@Injectable()
export class ProductUserAccountsService {
  constructor(
    private readonly core: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly provisioning: OrganizationProvisioningService,
  ) {}

  /** Crée le compte (mot de passe temporaire, changement exigé) et journalise `auditAction`. */
  async create(input: {
    organizationId: string;
    actorUserId: string;
    firstName: string;
    lastName: string;
    email: string | null;
    auditAction: string;
    auditMetadata: Record<string, unknown>;
  }): Promise<ProductUserAccount> {
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    try {
      const account = await this.core.$transaction(async (tx) => {
        const loginId = await this.provisioning.allocateLoginId(tx, input.organizationId);
        const user = await tx.user.create({
          data: {
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email,
            loginId,
            passwordHash,
            mustChangePassword: true,
          },
        });
        const membership = await tx.organizationMembership.create({
          data: { organizationId: input.organizationId, userId: user.id, role: 'PRODUCT_USER' },
        });
        await this.audit.record(
          {
            organizationId: input.organizationId,
            actorUserId: input.actorUserId,
            action: input.auditAction,
            targetType: 'User',
            targetId: user.id,
            metadata: { loginId, ...input.auditMetadata } as Prisma.InputJsonValue,
          },
          tx,
        );
        return { userId: user.id, membershipId: membership.id, loginId };
      });
      return { ...account, temporaryPassword };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        String(error.meta?.target ?? '').includes('email')
      ) {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_USED',
          message: 'Cet e-mail est déjà utilisé.',
        });
      }
      throw error;
    }
  }

  /** Ferme l'accès d'un compte créé quand l'application n'a pas pu enregistrer son rôle. */
  async close(membershipId: string): Promise<void> {
    await this.core.organizationMembership.update({
      where: { id: membershipId },
      data: { isActive: false },
    });
  }

  /**
   * Recopie l'état validé par l'application (`readValidatedActive`, relu sous verrou) sur les adhésions
   * PRODUCT_USER du compte. Une désactivation ferme aussi les sessions ouvertes.
   */
  async syncActive(
    organizationId: string,
    userId: string,
    readValidatedActive: () => Promise<boolean>,
  ): Promise<void> {
    await this.core.$transaction(async (tx) => {
      const memberships = await tx.organizationMembership.findMany({
        where: { organizationId, userId, role: 'PRODUCT_USER' },
        select: { id: true },
      });
      const ids = memberships.map((m) => m.id);
      await tx.$queryRaw`
        SELECT id FROM "OrganizationMembership" WHERE id = ANY(${ids}::uuid[]) FOR UPDATE`;
      const isActive = await readValidatedActive();
      await tx.organizationMembership.updateMany({
        where: { id: { in: ids } },
        data: { isActive },
      });
      if (!isActive) {
        await tx.session.updateMany({
          where: { membershipId: { in: ids }, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    });
  }
}
