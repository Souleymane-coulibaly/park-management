import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@ocall/stock-database';
import {
  STOCK_PRODUCT_CODE,
  type StockRole,
  assignableStockRoles,
  stockEffectivePermissions,
  stockRolePermissions,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import { ProductUserAccountsService } from '../organizations/product-user-accounts.service';
import type { StockContext } from './ocall-stock-access';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';
import type {
  AttachStockMemberDto,
  CreateStockMemberDto,
  StockMemberPermissionsDto,
  UpdateStockMemberDto,
} from './ocall-stock.dto';

const NOT_FOUND = { code: 'STOCK_MEMBER_NOT_FOUND', message: 'Utilisateur introuvable.' };

const MEMBER_SELECT = {
  id: true,
  userId: true,
  firstName: true,
  lastName: true,
  loginId: true,
  role: true,
  isActive: true,
  createdAt: true,
  permissions: { select: { permission: true, granted: true } },
  sites: { select: { siteId: true, role: true } },
} as const;

/**
 * Équipe Ocall Stock : comptes Suite réservés (PRODUCT_USER), rôle et ajustements de permissions dans la
 * base Stock. Seul un administrateur gère l'équipe ; personne ne modifie son propre accès.
 */
@Injectable()
export class OcallStockMembersService implements OnModuleInit {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly accounts: ProductUserAccountsService,
    private readonly audit: AuditService,
  ) {}

  /** Suite garde un compte PRODUCT_USER ouvert tant qu'une application lui donne un rôle actif. */
  onModuleInit() {
    this.accounts.registerProbe({
      product: STOCK_PRODUCT_CODE,
      isActiveMember: async (organizationId, userId) =>
        (await this.db.stockMember.count({
          where: { organizationId, userId, isActive: true },
        })) > 0,
    });
  }

  /** Membres de l'organisation (Park, autres applications) qui ne sont pas encore dans l'équipe Stock. */
  async candidates(ctx: StockContext) {
    const members = await this.db.stockMember.findMany({
      where: { organizationId: ctx.organizationId },
      select: { userId: true },
    });
    return this.accounts.candidates(
      ctx.organizationId,
      members.map((m) => m.userId),
    );
  }

  /**
   * Ajoute un membre existant de l'organisation avec un rôle Stock, sans nouveau compte (Sprint Suite 2A) :
   * son rôle Park ou dans une autre application reste inchangé.
   */
  async attach(ctx: StockContext, dto: AttachStockMemberDto) {
    this.assertCanAssign(ctx, dto.role);
    const user = await this.accounts.existingMember(ctx.organizationId, dto.userId);
    try {
      const member = await this.db.stockMember.create({
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
        action: 'stock.member_attached',
        targetType: 'StockMember',
        targetId: member.id,
        metadata: { userId: user.userId, role: dto.role, suiteRole: user.suiteRole },
      });
      return { member };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'STOCK_MEMBER_EXISTS',
          message: 'Cette personne fait déjà partie de l’équipe Stock.',
        });
      }
      throw error;
    }
  }

  async list(ctx: StockContext) {
    const members = await this.db.stockMember.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: [{ isActive: 'desc' }, { lastName: 'asc' }],
      select: MEMBER_SELECT,
    });
    return members.map(({ userId: _u, sites, ...m }) => ({
      ...m,
      siteIds: sites.map((x) => x.siteId),
      siteRoles: sites.flatMap((x) => (x.role ? [{ siteId: x.siteId, role: x.role }] : [])),
      effectivePermissions: stockEffectivePermissions(m.role, m.permissions),
    }));
  }

  async create(ctx: StockContext, dto: CreateStockMemberDto) {
    this.assertCanAssign(ctx, dto.role);
    const account = await this.accounts.create({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email ?? null,
      auditAction: 'stock.member_created',
      auditMetadata: { role: dto.role },
    });
    // En cas d'échec côté Stock, le compte Suite créé est fermé : jamais d'accès sans rôle Stock.
    try {
      const member = await this.db.stockMember.create({
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
      return { member, temporaryPassword: account.temporaryPassword };
    } catch (error) {
      await this.accounts.close(account.membershipId);
      throw error;
    }
  }

  async update(ctx: StockContext, id: string, dto: UpdateStockMemberDto) {
    if (dto.role) this.assertCanAssign(ctx, dto.role);
    const target = await this.db.$transaction(async (tx) => {
      await this.lockOther(tx, ctx, id);
      return tx.stockMember.update({
        where: { id },
        data: { role: dto.role, isActive: dto.isActive },
        select: { id: true, userId: true, role: true, isActive: true },
      });
    });
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'stock.member_updated',
      targetType: 'StockMember',
      targetId: id,
      metadata: {
        fields: Object.keys(dto),
        role: target.role,
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    // Après la validation Stock : Suite recopie l'état validé (fermeture effective aussitôt).
    if (dto.isActive !== undefined) {
      await this.accounts.syncActive(ctx.organizationId, target.userId);
    }
    return { id: target.id, role: target.role, isActive: target.isActive };
  }

  /** Remplace les ajustements du membre ; un ajustement identique au rôle est inutile et ignoré. */
  async setPermissions(ctx: StockContext, id: string, dto: StockMemberPermissionsDto) {
    this.assertCanAssign(ctx, 'ADMIN');
    const seen = new Set<string>();
    for (const o of dto.overrides) {
      if (seen.has(o.permission)) {
        throw new BadRequestException({
          code: 'STOCK_PERMISSION_DUPLICATE',
          message: 'Une permission ne peut être ajustée qu’une fois.',
        });
      }
      seen.add(o.permission);
    }
    const result = await this.db.$transaction(async (tx) => {
      const member = await this.lockOther(tx, ctx, id);
      const fromRole = new Set<string>(stockRolePermissions(member.role));
      const kept = dto.overrides.filter((o) => fromRole.has(o.permission) !== o.granted);
      await tx.stockMemberPermission.deleteMany({
        where: { organizationId: ctx.organizationId, memberId: id },
      });
      if (kept.length > 0) {
        await tx.stockMemberPermission.createMany({
          data: kept.map((o) => ({
            organizationId: ctx.organizationId,
            memberId: id,
            permission: o.permission,
            granted: o.granted,
            updatedByUserId: ctx.userId,
          })),
        });
      }
      return { role: member.role, kept };
    });
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'stock.member_permissions_updated',
      targetType: 'StockMember',
      targetId: id,
      metadata: { overrides: result.kept.map((o) => `${o.granted ? '+' : '-'}${o.permission}`) },
    });
    return {
      id,
      permissions: result.kept,
      effectivePermissions: stockEffectivePermissions(result.role, result.kept),
    };
  }

  /** Verrouille un membre de l'organisation qui n'est pas l'auteur de la requête. */
  private async lockOther(
    tx: Parameters<Parameters<OcallStockPrismaService['$transaction']>[0]>[0],
    ctx: StockContext,
    id: string,
  ) {
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "StockMember"
      WHERE id = ${id}::uuid AND "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`;
    if (!locked) throw new NotFoundException(NOT_FOUND);
    const current = await tx.stockMember.findUniqueOrThrow({ where: { id } });
    if (current.userId === ctx.userId) {
      throw new ForbiddenException({
        code: 'SELF_CHANGE_REFUSED',
        message: 'Vous ne pouvez pas modifier votre propre accès.',
      });
    }
    return current;
  }

  private assertCanAssign(ctx: StockContext, role: StockRole) {
    if (!assignableStockRoles(ctx.role).includes(role)) {
      throw new ForbiddenException({
        code: 'STOCK_ROLE_NOT_ASSIGNABLE',
        message: 'Vous ne pouvez pas gérer ce rôle.',
      });
    }
  }
}
