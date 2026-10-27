import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, RequirePermission } from '../../common/decorators';

@ApiTags("Journal d'audit")
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  /** Journal de l'organisation courante uniquement. */
  @RequirePermission('audit.read')
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    const { membership } = requireTenant(auth);
    const logs = await this.prisma.auditLog.findMany({
      where: { organizationId: membership.organizationId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    const actorIds = [
      ...new Set(logs.map((l) => l.actorUserId).filter((id): id is string => id !== null)),
    ];
    // Seuls les acteurs membres de l'organisation sont nommés.
    const actors = await this.prisma.user.findMany({
      where: {
        id: { in: actorIds },
        memberships: { some: { organizationId: membership.organizationId } },
      },
      select: { id: true, firstName: true, lastName: true },
    });
    const names = new Map(actors.map((a) => [a.id, `${a.firstName} ${a.lastName}`]));
    return logs.map((l) => ({
      id: l.id,
      action: l.action,
      targetType: l.targetType,
      targetId: l.targetId,
      actor: l.actorUserId ? (names.get(l.actorUserId) ?? 'Plateforme') : 'Système',
      createdAt: l.createdAt,
    }));
  }
}
