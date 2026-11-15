import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import { activitiesOf, invitationNeedsEstablishments } from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext, TenantContext } from '../../common/auth-context';
import type { RequestMeta } from '../../common/request-meta';
import { SessionService } from '../../common/security/session.service';
import { PrismaService } from '../../prisma/prisma.service';

const NOT_FOUND = { code: 'INVITATION_NOT_FOUND', message: 'Invitation introuvable.' };

/**
 * Ocall Suite Sprint 2C : un même compte dans plusieurs organisations. La personne voit les invitations
 * adressées à son e-mail ou à son identifiant, les accepte ou les refuse, puis passe d'une organisation à
 * l'autre. Chaque changement ouvre une nouvelle session liée à la seule adhésion choisie et ferme la
 * précédente : les droits et les données suivent toujours l'organisation de la session.
 */
@Injectable()
export class OrganizationAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /** Organisations où le compte a une adhésion active, dans une organisation active. */
  async organizations(auth: TenantContext) {
    const rows = await this.prisma.organizationMembership.findMany({
      where: { userId: auth.user.id, isActive: true, organization: { status: 'ACTIVE' } },
      select: { id: true, role: true, organization: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      organizationId: r.organization.id,
      name: r.organization.name,
      role: r.role,
      current: r.id === auth.membership.id,
    }));
  }

  /**
   * Nouvelle session sur l'adhésion du compte dans `organizationId` ; la session courante est révoquée.
   * Une organisation où le compte n'a pas d'adhésion active (ou suspendue) est introuvable.
   */
  async switch(auth: TenantContext, organizationId: string, meta: RequestMeta): Promise<string> {
    if (organizationId === auth.membership.organizationId) {
      throw new BadRequestException({
        code: 'ALREADY_CURRENT_ORGANIZATION',
        message: 'Vous êtes déjà dans cette organisation.',
      });
    }
    const target = await this.prisma.organizationMembership.findFirst({
      where: {
        userId: auth.user.id,
        organizationId,
        isActive: true,
        organization: { status: 'ACTIVE' },
        user: { isActive: true },
      },
      select: { id: true },
    });
    if (!target) {
      throw new NotFoundException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organisation introuvable.',
      });
    }
    const token = await this.prisma.$transaction(async (tx) => {
      const created = await this.sessions.create(auth.user.id, target.id, meta, tx);
      await tx.session.updateMany({
        where: { id: auth.sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'auth.organization_switched',
          targetType: 'User',
          targetId: auth.user.id,
          ipAddress: meta.ipAddress,
          metadata: { from: auth.membership.organizationId },
        },
        tx,
      );
      return created;
    });
    return token;
  }

  /** Invitations en attente adressées à ce compte (e-mail ou identifiant), non échues. */
  async invitations(auth: AuthContext) {
    const rows = await this.prisma.organizationInvitation.findMany({
      where: {
        identifier: { in: this.identifiers(auth) },
        status: 'PENDING',
        expiresAt: { gt: new Date() },
        organization: {
          status: 'ACTIVE',
          memberships: { none: { userId: auth.user.id } },
        },
      },
      select: {
        id: true,
        role: true,
        expiresAt: true,
        organization: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      organizationName: r.organization.name,
      role: r.role,
      expiresAt: r.expiresAt,
    }));
  }

  /**
   * Acceptation : l'invitation doit être en attente, non échue, adressée à ce compte, dans une organisation
   * active où il n'est pas déjà membre. Crée l'adhésion (et ses établissements encore actifs).
   */
  async accept(auth: TenantContext, id: string) {
    const ids = this.identifiers(auth);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const [locked] = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "OrganizationInvitation" WHERE id = ${id}::uuid FOR UPDATE`;
        const invitation = locked
          ? await tx.organizationInvitation.findUnique({
              where: { id },
              include: { organization: { select: { status: true, businessType: true } } },
            })
          : null;
        if (
          !invitation ||
          !ids.includes(invitation.identifier) ||
          invitation.status !== 'PENDING' ||
          invitation.expiresAt <= new Date() ||
          invitation.organization.status !== 'ACTIVE'
        ) {
          throw new NotFoundException(NOT_FOUND);
        }
        const establishments = invitationNeedsEstablishments(invitation.role)
          ? (
              await tx.establishment.findMany({
                where: {
                  organizationId: invitation.organizationId,
                  id: { in: invitation.establishmentIds },
                  isActive: true,
                },
                select: { id: true, businessType: true },
              })
            ).filter((e) => activitiesOf(e.businessType).length > 0)
          : [];
        if (invitationNeedsEstablishments(invitation.role) && establishments.length === 0) {
          throw new ConflictException({
            code: 'INVITATION_ESTABLISHMENTS_GONE',
            message:
              'Les établissements de cette invitation ne sont plus actifs : demandez-en une nouvelle.',
          });
        }
        const membership = await tx.organizationMembership.create({
          data: {
            organizationId: invitation.organizationId,
            userId: auth.user.id,
            role: invitation.role,
          },
          select: { id: true },
        });
        if (establishments.length) {
          await tx.establishmentAssignment.createMany({
            data: establishments.map((e) => ({
              organizationId: invitation.organizationId,
              membershipId: membership.id,
              establishmentId: e.id,
            })),
          });
        }
        await tx.organizationInvitation.update({
          where: { id },
          data: { status: 'ACCEPTED', decidedByUserId: auth.user.id, decidedAt: new Date() },
        });
        await this.audit.record(
          {
            organizationId: invitation.organizationId,
            actorUserId: auth.user.id,
            action: 'organization.invitation_accepted',
            targetType: 'OrganizationInvitation',
            targetId: id,
            metadata: { role: invitation.role, establishments: establishments.length },
          },
          tx,
        );
        return { organizationId: invitation.organizationId, role: invitation.role };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'ALREADY_MEMBER',
          message: 'Vous faites déjà partie de cette organisation.',
        });
      }
      throw error;
    }
  }

  async decline(auth: TenantContext, id: string) {
    const result = await this.prisma.organizationInvitation.updateMany({
      where: {
        id,
        identifier: { in: this.identifiers(auth) },
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      data: { status: 'DECLINED', decidedByUserId: auth.user.id, decidedAt: new Date() },
    });
    if (result.count !== 1) throw new NotFoundException(NOT_FOUND);
    const invitation = await this.prisma.organizationInvitation.findUniqueOrThrow({
      where: { id },
      select: { organizationId: true },
    });
    await this.audit.record({
      organizationId: invitation.organizationId,
      actorUserId: auth.user.id,
      action: 'organization.invitation_declined',
      targetType: 'OrganizationInvitation',
      targetId: id,
    });
    return { id, status: 'DECLINED' as const };
  }

  /** Identités du compte : e-mail (minuscules) et identifiant (majuscules). */
  private identifiers(auth: AuthContext): string[] {
    const out = [auth.user.loginId.toUpperCase()];
    if (auth.user.email) out.push(auth.user.email.toLowerCase());
    if (!auth.membership) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: "Vous n'avez pas les droits nécessaires.",
      });
    }
    return out;
  }
}
