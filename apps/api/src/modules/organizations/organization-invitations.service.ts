import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type MemberRole, Prisma } from '@ocall/database';
import {
  INVITATION_TTL_DAYS,
  activitiesOf,
  invitableRolesFor,
  invitationNeedsEstablishments,
  invitationState,
  isRoleAvailableFor,
  normalizeInvitationIdentifier,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateInvitationDto } from './organizations.dto';

const NOT_FOUND = { code: 'INVITATION_NOT_FOUND', message: 'Invitation introuvable.' };

const SELECT = {
  id: true,
  identifier: true,
  role: true,
  establishmentIds: true,
  status: true,
  expiresAt: true,
  decidedAt: true,
  createdAt: true,
} as const;

/**
 * Ocall Suite Sprint 2C : invitations envoyées par une organisation à une personne qui a peut-être déjà un
 * compte. La réponse est la même que le compte existe ou non : aucune information sur les comptes des
 * autres organisations. Rien n'est créé avant l'acceptation par la personne elle-même.
 */
@Injectable()
export class OrganizationInvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: TenantContext) {
    const rows = await this.prisma.organizationInvitation.findMany({
      where: { organizationId: auth.membership.organizationId },
      select: SELECT,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const now = new Date();
    return rows.map((r) => ({ ...r, state: invitationState(r.status, r.expiresAt, now) }));
  }

  async create(auth: TenantContext, dto: CreateInvitationDto) {
    const organizationId = auth.membership.organizationId;
    const role = dto.role as MemberRole;
    if (!invitableRolesFor(auth.membership.role).includes(role)) {
      throw new ForbiddenException({
        code: 'ROLE_NOT_ASSIGNABLE',
        message: 'Vous ne pouvez pas proposer ce rôle.',
      });
    }
    if (role !== 'PRODUCT_USER' && !isRoleAvailableFor(role, auth.membership.businessType)) {
      throw new BadRequestException({
        code: 'ROLE_NOT_AVAILABLE',
        message: 'Ce rôle ne correspond pas à l’activité de votre organisation.',
      });
    }
    const identifier = normalizeInvitationIdentifier(dto.identifier);
    if (!identifier) {
      throw new BadRequestException({
        code: 'INVITATION_IDENTIFIER_INVALID',
        message: 'Indiquez l’e-mail ou l’identifiant de la personne.',
      });
    }
    const establishmentIds = invitationNeedsEstablishments(role)
      ? await this.establishments(organizationId, dto.establishmentIds ?? [])
      : [];
    // Déjà membre de cette organisation : seule information révélée, et elle ne concerne qu'elle.
    const member = await this.prisma.organizationMembership.findFirst({
      where: {
        organizationId,
        user: identifier.includes('@') ? { email: identifier } : { loginId: identifier },
      },
      select: { id: true },
    });
    if (member) {
      throw new ConflictException({
        code: 'ALREADY_MEMBER',
        message: 'Cette personne fait déjà partie de votre organisation.',
      });
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const invitation = await tx.organizationInvitation.create({
          data: {
            organizationId,
            identifier,
            role,
            establishmentIds,
            invitedByUserId: auth.user.id,
            expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
          },
          select: SELECT,
        });
        await this.audit.record(
          {
            organizationId,
            actorUserId: auth.user.id,
            action: 'organization.invitation_created',
            targetType: 'OrganizationInvitation',
            targetId: invitation.id,
            metadata: { role, establishments: establishmentIds.length },
          },
          tx,
        );
        return { ...invitation, state: 'PENDING' as const };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'INVITATION_PENDING',
          message: 'Une invitation est déjà en attente pour cette personne.',
        });
      }
      throw error;
    }
  }

  async revoke(auth: TenantContext, id: string) {
    const organizationId = auth.membership.organizationId;
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.organizationInvitation.updateMany({
        where: { id, organizationId, status: 'PENDING' },
        data: { status: 'REVOKED', decidedByUserId: auth.user.id, decidedAt: new Date() },
      });
      if (result.count !== 1) throw new NotFoundException(NOT_FOUND);
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'organization.invitation_revoked',
          targetType: 'OrganizationInvitation',
          targetId: id,
        },
        tx,
      );
      return { id, status: 'REVOKED' as const };
    });
  }

  /** Établissements actifs de l'organisation, avec une activité Park (au moins un). */
  private async establishments(organizationId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) {
      throw new BadRequestException({
        code: 'ESTABLISHMENT_REQUIRED',
        message: 'Choisissez au moins un établissement pour ce rôle.',
      });
    }
    const found = await this.prisma.establishment.findMany({
      where: { organizationId, id: { in: unique }, isActive: true },
      select: { id: true, businessType: true },
    });
    if (found.length !== unique.length || found.some((e) => !activitiesOf(e.businessType).length)) {
      throw new NotFoundException({
        code: 'ESTABLISHMENT_NOT_FOUND',
        message: 'Établissement introuvable.',
      });
    }
    return unique;
  }
}
