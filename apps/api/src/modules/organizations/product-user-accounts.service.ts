import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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

/** Membre existant de l'organisation qu'une application peut ajouter à son équipe (Sprint Suite 2A). */
export interface ExistingOrganizationMember {
  userId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  loginId: string;
  /** Rôle Suite (Park ou PRODUCT_USER) : affiché, il ne donne aucun droit dans l'application. */
  suiteRole: string;
}

/**
 * Lecture, par l'application qui l'enregistre, de l'état de ses membres : la base Suite ne garde ouvert un
 * compte PRODUCT_USER que tant qu'une application au moins lui donne un rôle actif.
 */
export interface ProductMemberProbe {
  product: string;
  isActiveMember(organizationId: string, userId: string): Promise<boolean>;
}

const MEMBER_NOT_FOUND = {
  code: 'ORGANIZATION_MEMBER_NOT_FOUND',
  message: 'Membre introuvable dans votre organisation.',
};

/**
 * Comptes réservés à une application à base séparée (Ocall Stock…) : identité, mot de passe et sessions
 * dans la base Suite, avec le rôle PRODUCT_USER (aucun droit Ocall Park ni School). Le rôle applicatif
 * vit dans la base de l'application. Deux bases, donc pas de transaction commune : l'application décide,
 * la base Suite recopie l'état validé.
 *
 * Sprint Suite 2A : un même compte peut avoir un rôle dans plusieurs applications (et un rôle Park). Le
 * compte PRODUCT_USER reste ouvert tant qu'une application au moins lui donne un rôle actif.
 */
@Injectable()
export class ProductUserAccountsService {
  private readonly probes = new Map<string, ProductMemberProbe>();

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

  /** Chaque application déclare sa lecture de l'état de ses membres (au démarrage). */
  registerProbe(probe: ProductMemberProbe): void {
    this.probes.set(probe.product, probe);
  }

  /**
   * Membres actifs de l'organisation qu'une application peut ajouter : tout rôle sauf propriétaire (déjà
   * administrateur de chaque application), hors comptes déjà membres de l'application (`excludeUserIds`).
   */
  async candidates(
    organizationId: string,
    excludeUserIds: readonly string[],
  ): Promise<ExistingOrganizationMember[]> {
    const rows = await this.core.organizationMembership.findMany({
      where: {
        organizationId,
        isActive: true,
        role: { not: 'OWNER' },
        userId: { notIn: [...excludeUserIds] },
        user: { isActive: true },
      },
      select: {
        role: true,
        user: {
          select: { id: true, firstName: true, lastName: true, email: true, loginId: true },
        },
      },
      orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
      take: 500,
    });
    return rows.map((r) => ({
      userId: r.user.id,
      firstName: r.user.firstName,
      lastName: r.user.lastName,
      email: r.user.email,
      loginId: r.user.loginId,
      suiteRole: r.role,
    }));
  }

  /** Membre actif de l'organisation (hors propriétaire) ; 404 sinon, y compris pour un compte d'un autre client. */
  async existingMember(
    organizationId: string,
    userId: string,
  ): Promise<ExistingOrganizationMember> {
    const row = await this.core.organizationMembership.findFirst({
      where: {
        organizationId,
        userId,
        isActive: true,
        role: { not: 'OWNER' },
        user: { isActive: true },
      },
      select: {
        role: true,
        user: {
          select: { id: true, firstName: true, lastName: true, email: true, loginId: true },
        },
      },
    });
    if (!row) throw new NotFoundException(MEMBER_NOT_FOUND);
    return {
      userId: row.user.id,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      email: row.user.email,
      loginId: row.user.loginId,
      suiteRole: row.role,
    };
  }

  /** Ferme l'accès d'un compte créé quand l'application n'a pas pu enregistrer son rôle. */
  async close(membershipId: string): Promise<void> {
    await this.core.organizationMembership.update({
      where: { id: membershipId },
      data: { isActive: false },
    });
  }

  /**
   * Recopie l'état validé par les applications (relu sous verrou) sur les adhésions PRODUCT_USER du compte :
   * ouverte si une application au moins lui donne un rôle actif. Une fermeture ferme aussi les sessions
   * ouvertes. Un rôle Park (adhésion non PRODUCT_USER) n'est jamais modifié ici.
   */
  async syncActive(organizationId: string, userId: string): Promise<void> {
    const readValidatedActive = async () => {
      for (const probe of this.probes.values()) {
        if (await probe.isActiveMember(organizationId, userId)) return true;
      }
      return false;
    };
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
