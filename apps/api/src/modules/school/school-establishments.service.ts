import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@ocall/school-database';
import { SCHOOL_PRODUCT_CODE, siteMatchReason } from '@ocall/shared';
import { SITE_REGISTRY, type SiteRegistry } from '../../common/integration/site-registry';
import type { SchoolContext } from './school-access';
import { SchoolPrismaService } from './school-prisma.service';
import { SchoolService } from './school.service';
import type { SchoolEstablishmentDto } from './school.dto';

/**
 * Ocall Suite Sprint 2B : rattachement d'une école à un établissement du référentiel commun des sites
 * (base Suite). Une école se rattache à un seul établissement, un établissement à une seule école ; rien
 * n'est rattaché automatiquement : les correspondances proposées ne sont que des suggestions.
 */
@Injectable()
export class SchoolEstablishmentsService implements OnModuleInit {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    @Inject(SITE_REGISTRY) private readonly registryService: SiteRegistry,
  ) {}

  onModuleInit() {
    this.registryService.registerUsage({
      product: SCHOOL_PRODUCT_CODE,
      label: 'Ocall School',
      usages: async (organizationId) =>
        (
          await this.db.school.findMany({
            where: { organizationId, isActive: true, establishmentId: { not: null } },
            select: { id: true, name: true, establishmentId: true },
          })
        ).map((s) => ({
          establishmentId: s.establishmentId!,
          appSiteId: s.id,
          appSiteName: s.name,
        })),
    });
  }

  /** Établissements actifs (avec l'école déjà rattachée) et suggestions pour les écoles non rattachées. */
  async registry(ctx: SchoolContext) {
    const [establishments, schools] = await Promise.all([
      this.registryService.list(ctx.organizationId),
      this.db.school.findMany({
        where: { organizationId: ctx.organizationId },
        select: { id: true, name: true, establishmentId: true, isActive: true },
      }),
    ]);
    const linkedTo = new Map(
      schools.filter((s) => s.establishmentId).map((s) => [s.establishmentId!, s.id]),
    );
    const free = establishments.filter((e) => e.isActive && !linkedTo.has(e.id));
    return {
      establishments: establishments
        .filter((e) => e.isActive)
        .map((e) => ({ ...e, schoolId: linkedTo.get(e.id) ?? null })),
      suggestions: schools
        .filter(
          (s) =>
            !s.establishmentId && s.isActive && (!ctx.schoolIds || ctx.schoolIds.includes(s.id)),
        )
        .flatMap((s) =>
          free.flatMap((e) => {
            const reason = siteMatchReason(s, e);
            return reason ? [{ schoolId: s.id, establishmentId: e.id, reason }] : [];
          }),
        ),
    };
  }

  async link(ctx: SchoolContext, id: string, dto: SchoolEstablishmentDto) {
    await this.school.assertSchool(ctx, id);
    const current = await this.db.school.findUniqueOrThrow({
      where: { id },
      select: { name: true, address: true, establishmentId: true },
    });
    if (dto.createEstablishment && dto.establishmentId) throw this.choice();
    let establishmentId: string | null;
    if (dto.createEstablishment) {
      establishmentId = (
        await this.registryService.createSite({
          organizationId: ctx.organizationId,
          actorUserId: ctx.userId,
          source: SCHOOL_PRODUCT_CODE,
          name: current.name,
          kind: 'SCHOOL',
          address: current.address,
        })
      ).id;
    } else if (dto.establishmentId !== undefined) {
      establishmentId = dto.establishmentId;
      if (establishmentId) await this.usable(ctx, establishmentId, id);
    } else {
      throw this.choice();
    }
    try {
      await this.db.school.updateMany({
        where: { id, organizationId: ctx.organizationId },
        data: { establishmentId },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw this.taken();
      }
      throw e;
    }
    await this.school.log(
      ctx,
      establishmentId ? 'school.establishment_linked' : 'school.establishment_unlinked',
      'School',
      id,
      { from: current.establishmentId, to: establishmentId },
    );
    return this.db.school.findUniqueOrThrow({ where: { id } });
  }

  private async usable(ctx: SchoolContext, establishmentId: string, schoolId: string) {
    const establishment = await this.registryService.get(ctx.organizationId, establishmentId);
    if (!establishment) {
      throw new NotFoundException({
        code: 'ESTABLISHMENT_NOT_FOUND',
        message: 'Établissement introuvable.',
      });
    }
    if (!establishment.isActive) {
      throw new ConflictException({
        code: 'ESTABLISHMENT_INACTIVE',
        message: 'Cet établissement est désactivé.',
      });
    }
    const taken = await this.db.school.findFirst({
      where: { organizationId: ctx.organizationId, establishmentId, NOT: { id: schoolId } },
      select: { id: true },
    });
    if (taken) throw this.taken();
  }

  private taken() {
    return new ConflictException({
      code: 'SCHOOL_ESTABLISHMENT_TAKEN',
      message: 'Cet établissement est déjà rattaché à une autre école.',
    });
  }

  private choice() {
    return new BadRequestException({
      code: 'SCHOOL_ESTABLISHMENT_CHOICE',
      message: 'Choisissez un établissement existant ou la création d’un nouveau, pas les deux.',
    });
  }
}
