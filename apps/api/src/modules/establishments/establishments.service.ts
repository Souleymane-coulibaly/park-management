import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type BusinessType, isCompatibleBusinessType } from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { establishmentScope } from '../../common/tenant-scope';
import type { CreateEstablishmentDto, UpdateEstablishmentDto } from './establishments.dto';

const SELECT = {
  id: true,
  name: true,
  businessType: true,
  city: true,
  address: true,
  phone: true,
  timezone: true,
  isActive: true,
  createdAt: true,
  _count: { select: { assignments: true } },
} as const;

@Injectable()
export class EstablishmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(auth: TenantContext) {
    return this.prisma.establishment.findMany({
      where: establishmentScope(auth),
      select: SELECT,
      orderBy: { name: 'asc' },
    });
  }

  /** Un établissement d'une autre organisation renvoie 404, sans révéler son existence. */
  async get(auth: TenantContext, id: string) {
    const establishment = await this.prisma.establishment.findFirst({
      where: { ...establishmentScope(auth), id },
      select: SELECT,
    });
    if (!establishment)
      throw new NotFoundException({
        code: 'ESTABLISHMENT_NOT_FOUND',
        message: 'Établissement introuvable.',
      });
    return establishment;
  }

  async create(auth: TenantContext, dto: CreateEstablishmentDto) {
    const organizationId = auth.membership.organizationId;
    this.assertCompatible(auth.membership.businessType, dto.businessType);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.establishment.create({
        data: { ...dto, organizationId, timezone: dto.timezone ?? auth.membership.timezone },
        select: SELECT,
      });
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'establishment.created',
          targetType: 'Establishment',
          targetId: created.id,
          metadata: { name: created.name },
        },
        tx,
      );
      return created;
    });
  }

  async update(auth: TenantContext, id: string, dto: UpdateEstablishmentDto) {
    const organizationId = auth.membership.organizationId;
    await this.get(auth, id);
    if (dto.businessType) this.assertCompatible(auth.membership.businessType, dto.businessType);
    return this.prisma.$transaction(async (tx) => {
      // Le filtre organizationId est répété dans l'écriture : défense en profondeur.
      const result = await tx.establishment.updateMany({
        where: { id, organizationId },
        data: dto,
      });
      if (result.count !== 1)
        throw new NotFoundException({
          code: 'ESTABLISHMENT_NOT_FOUND',
          message: 'Établissement introuvable.',
        });
      const action =
        dto.isActive === false
          ? 'establishment.deactivated'
          : dto.isActive === true
            ? 'establishment.reactivated'
            : 'establishment.updated';
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action,
          targetType: 'Establishment',
          targetId: id,
          metadata: { ...dto },
        },
        tx,
      );
      return tx.establishment.findUniqueOrThrow({ where: { id }, select: SELECT });
    });
  }

  private assertCompatible(organizationType: BusinessType, establishmentType: BusinessType): void {
    if (!isCompatibleBusinessType(organizationType, establishmentType)) {
      throw new BadRequestException({
        code: 'INCOMPATIBLE_BUSINESS_TYPE',
        message:
          "L'activité de l'établissement n'est pas couverte par le métier de l'organisation.",
      });
    }
  }
}
