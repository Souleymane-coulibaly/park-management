import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import { type BusinessType, isCompatibleBusinessType } from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { establishmentScope } from '../../common/tenant-scope';
import { EstablishmentRegistryService } from './establishment-registry.service';
import type {
  CreateBrandDto,
  CreateEstablishmentDto,
  UpdateBrandDto,
  UpdateEstablishmentDto,
} from './establishments.dto';

const BRAND_NOT_FOUND = { code: 'BRAND_NOT_FOUND', message: 'Enseigne introuvable.' };

const SELECT = {
  id: true,
  name: true,
  businessType: true,
  city: true,
  address: true,
  phone: true,
  timezone: true,
  isActive: true,
  kind: true,
  brandId: true,
  brand: { select: { name: true } },
  createdAt: true,
  _count: { select: { assignments: true } },
} as const;

@Injectable()
export class EstablishmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly registryService: EstablishmentRegistryService,
  ) {}

  /**
   * Sprint Suite 2B : sites visibles du membre (même périmètre que la liste) et, pour chacun, les
   * applications qui l'utilisent ; un site partagé n'apparaît qu'une fois.
   */
  async registry(auth: TenantContext) {
    const [sites, usages] = await Promise.all([
      this.list(auth),
      this.registryService.usages(auth.membership.organizationId),
    ]);
    return sites.map((s) => ({ ...s, applications: usages.get(s.id) ?? [] }));
  }

  brands(auth: TenantContext) {
    return this.prisma.brand.findMany({
      where: { organizationId: auth.membership.organizationId },
      select: {
        id: true,
        name: true,
        isActive: true,
        _count: { select: { establishments: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createBrand(auth: TenantContext, dto: CreateBrandDto) {
    const organizationId = auth.membership.organizationId;
    return this.brandConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const brand = await tx.brand.create({
          data: { organizationId, name: dto.name },
          select: { id: true, name: true, isActive: true },
        });
        await this.audit.record(
          {
            organizationId,
            actorUserId: auth.user.id,
            action: 'brand.created',
            targetType: 'Brand',
            targetId: brand.id,
            metadata: { name: brand.name },
          },
          tx,
        );
        return brand;
      }),
    );
  }

  /** Une enseigne n'est jamais supprimée : elle est renommée ou désactivée. */
  async updateBrand(auth: TenantContext, id: string, dto: UpdateBrandDto) {
    const organizationId = auth.membership.organizationId;
    return this.brandConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const result = await tx.brand.updateMany({ where: { id, organizationId }, data: dto });
        if (result.count !== 1) throw new NotFoundException(BRAND_NOT_FOUND);
        await this.audit.record(
          {
            organizationId,
            actorUserId: auth.user.id,
            action: 'brand.updated',
            targetType: 'Brand',
            targetId: id,
            metadata: { ...dto },
          },
          tx,
        );
        return tx.brand.findUniqueOrThrow({
          where: { id },
          select: { id: true, name: true, isActive: true },
        });
      }),
    );
  }

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
    if (dto.brandId) await this.assertBrand(organizationId, dto.brandId);
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
    if (dto.brandId) await this.assertBrand(organizationId, dto.brandId);
    if (dto.isActive === false) await this.assertNotUsedElsewhere(organizationId, id);
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

  /**
   * Ocall Suite Sprint 2C : un lieu encore utilisé par une autre application (site Stock, école…) ne se
   * désactive pas : il faut d'abord retirer le rattachement dans l'application, pour ne pas laisser de
   * fiche rattachée à un lieu fermé. L'usage Park (activité du lieu) reste géré comme avant.
   */
  private async assertNotUsedElsewhere(organizationId: string, id: string) {
    const usages = (await this.registryService.usages(organizationId)).get(id) ?? [];
    const others = usages.filter((u) => u.appSiteId !== null);
    if (others.length > 0) {
      throw new ConflictException({
        code: 'ESTABLISHMENT_IN_USE',
        message: `Ce lieu est encore utilisé par ${[...new Set(others.map((u) => u.label))].join(', ')} : retirez d'abord le rattachement dans l'application.`,
        applications: [...new Set(others.map((u) => u.product))],
      });
    }
  }

  /** Enseigne active de l'organisation ; une enseigne d'un autre client est introuvable. */
  private async assertBrand(organizationId: string, brandId: string) {
    const brand = await this.prisma.brand.findFirst({
      where: { id: brandId, organizationId, isActive: true },
      select: { id: true },
    });
    if (!brand) throw new NotFoundException(BRAND_NOT_FOUND);
  }

  private async brandConflict<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'BRAND_NAME_TAKEN',
          message: 'Une enseigne de ce nom existe déjà.',
        });
      }
      throw error;
    }
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
