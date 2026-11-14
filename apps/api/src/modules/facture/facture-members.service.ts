import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import { Prisma as FacturePrisma } from '@ocall/facture-database';
import { FACTURE_PRODUCT_CODE, type FactureRole, assignableFactureRoles } from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PasswordService } from '../../common/security/password.service';
import { generateTemporaryPassword } from '../../common/security/tokens';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationProvisioningService } from '../organizations/organization-provisioning.service';
import { ProductUserAccountsService } from '../organizations/product-user-accounts.service';
import type { FactureContext } from './facture-access';
import { FacturePrismaService } from './facture-prisma.service';
import type {
  AttachFactureMemberDto,
  CreateFactureMemberDto,
  UpdateFactureMemberDto,
} from './facture.dto';

const NOT_FOUND = { code: 'FACTURE_MEMBER_NOT_FOUND', message: 'Utilisateur introuvable.' };

/**
 * Équipe Ocall Facture. L'identité (compte, mot de passe, sessions) reste dans la base Ocall Suite, avec
 * le rôle PRODUCT_USER, sans aucun droit Ocall Park ni School ; le rôle Facture est dans la base Facture.
 * Deux bases, donc pas de transaction commune : Facture décide d'abord, Suite recopie l'état validé.
 */
@Injectable()
export class FactureMembersService implements OnModuleInit {
  constructor(
    private readonly db: FacturePrismaService,
    private readonly core: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly provisioning: OrganizationProvisioningService,
    private readonly accounts: ProductUserAccountsService,
  ) {}

  /** Suite garde un compte PRODUCT_USER ouvert tant qu'une application lui donne un rôle actif. */
  onModuleInit() {
    this.accounts.registerProbe({
      product: FACTURE_PRODUCT_CODE,
      isActiveMember: async (organizationId, userId) =>
        (await this.db.factureMember.count({
          where: { organizationId, userId, isActive: true },
        })) > 0,
    });
  }

  /** Membres de l'organisation (Park, autres applications) qui ne sont pas encore dans l'équipe Facture. */
  async candidates(ctx: FactureContext) {
    const members = await this.db.factureMember.findMany({
      where: { organizationId: ctx.organizationId },
      select: { userId: true },
    });
    return this.accounts.candidates(
      ctx.organizationId,
      members.map((m) => m.userId),
    );
  }

  /**
   * Ajoute un membre existant de l'organisation avec un rôle Facture, sans nouveau compte (Sprint Suite
   * 2A) : son rôle Park ou dans une autre application reste inchangé.
   */
  async attach(ctx: FactureContext, dto: AttachFactureMemberDto) {
    this.assertCanAssign(ctx, dto.role);
    const user = await this.accounts.existingMember(ctx.organizationId, dto.userId);
    try {
      const member = await this.db.factureMember.create({
        data: {
          organizationId: ctx.organizationId,
          userId: user.userId,
          firstName: user.firstName,
          lastName: user.lastName,
          loginId: user.loginId,
          role: dto.role,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          loginId: true,
          role: true,
          isActive: true,
        },
      });
      await this.audit.record({
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: 'facture.member_attached',
        targetType: 'FactureMember',
        targetId: member.id,
        metadata: { userId: user.userId, role: dto.role, suiteRole: user.suiteRole },
      });
      return { member };
    } catch (error) {
      if (error instanceof FacturePrisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'FACTURE_MEMBER_EXISTS',
          message: 'Cette personne fait déjà partie de l’équipe Facture.',
        });
      }
      throw error;
    }
  }

  list(ctx: FactureContext) {
    return this.db.factureMember.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: [{ isActive: 'desc' }, { lastName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        loginId: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
  }

  async create(ctx: FactureContext, dto: CreateFactureMemberDto) {
    this.assertCanAssign(ctx, dto.role);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const account = await this.emailConflict(() =>
      this.core.$transaction(async (tx) => {
        const loginId = await this.provisioning.allocateLoginId(tx, ctx.organizationId);
        const user = await tx.user.create({
          data: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            email: dto.email ?? null,
            loginId,
            passwordHash,
            mustChangePassword: true,
          },
        });
        const membership = await tx.organizationMembership.create({
          data: { organizationId: ctx.organizationId, userId: user.id, role: 'PRODUCT_USER' },
        });
        await this.audit.record(
          {
            organizationId: ctx.organizationId,
            actorUserId: ctx.userId,
            action: 'facture.member_created',
            targetType: 'User',
            targetId: user.id,
            metadata: { loginId, role: dto.role },
          },
          tx,
        );
        return { userId: user.id, membershipId: membership.id, loginId };
      }),
    );
    // En cas d'échec côté Facture, le compte Suite créé est fermé : jamais d'accès sans rôle Facture.
    try {
      const member = await this.db.factureMember.create({
        data: {
          organizationId: ctx.organizationId,
          userId: account.userId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          loginId: account.loginId,
          role: dto.role,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          loginId: true,
          role: true,
          isActive: true,
        },
      });
      return { member, temporaryPassword };
    } catch (error) {
      await this.core.organizationMembership.update({
        where: { id: account.membershipId },
        data: { isActive: false },
      });
      throw error;
    }
  }

  async update(ctx: FactureContext, id: string, dto: UpdateFactureMemberDto) {
    if (dto.role) this.assertCanAssign(ctx, dto.role);
    const target = await this.db.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "FactureMember"
        WHERE id = ${id}::uuid AND "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`;
      if (!locked) throw new NotFoundException(NOT_FOUND);
      const current = await tx.factureMember.findUniqueOrThrow({ where: { id } });
      if (current.userId === ctx.userId) {
        throw new ForbiddenException({
          code: 'SELF_CHANGE_REFUSED',
          message: 'Vous ne pouvez pas modifier votre propre accès.',
        });
      }
      return tx.factureMember.update({
        where: { id },
        data: { role: dto.role, isActive: dto.isActive },
        select: { id: true, userId: true, role: true, isActive: true },
      });
    });
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'facture.member_updated',
      targetType: 'FactureMember',
      targetId: id,
      metadata: {
        fields: Object.keys(dto),
        role: target.role,
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    // Après la validation Facture : Suite recopie l'état validé (fermeture effective aussitôt).
    if (dto.isActive !== undefined) {
      await this.accounts.syncActive(ctx.organizationId, target.userId);
    }
    return { id: target.id, role: target.role, isActive: target.isActive };
  }

  private assertCanAssign(ctx: FactureContext, role: FactureRole) {
    if (!assignableFactureRoles(ctx.role).includes(role)) {
      throw new ForbiddenException({
        code: 'FACTURE_ROLE_NOT_ASSIGNABLE',
        message: 'Vous ne pouvez pas gérer ce rôle.',
      });
    }
  }

  private async emailConflict<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
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
}
