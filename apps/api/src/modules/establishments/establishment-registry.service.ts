import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@ocall/database';
import {
  type EstablishmentKind,
  type SiteUsage,
  activitiesOf,
  isEstablishmentKind,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import type {
  RegistrySite,
  SiteRegistry,
  SiteUsageProvider,
} from '../../common/integration/site-registry';
import { PrismaService } from '../../prisma/prisma.service';

const SITE_SELECT = {
  id: true,
  name: true,
  kind: true,
  city: true,
  address: true,
  phone: true,
  isActive: true,
  brandId: true,
  brand: { select: { name: true } },
} as const;

type SiteRow = Prisma.EstablishmentGetPayload<{ select: typeof SITE_SELECT }>;

const toSite = ({ brand, ...row }: SiteRow): RegistrySite => ({
  ...row,
  brandName: brand?.name ?? null,
});

/**
 * Référentiel commun des sites (Sprint Suite 2B) : les établissements de la base Suite, lus et créés par
 * les applications à base séparée, et la liste des applications qui utilisent chaque site.
 */
@Injectable()
export class EstablishmentRegistryService implements SiteRegistry {
  private readonly providers = new Map<string, SiteUsageProvider>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  registerUsage(provider: SiteUsageProvider): void {
    this.providers.set(provider.product, provider);
  }

  async get(organizationId: string, id: string): Promise<RegistrySite | null> {
    const row = await this.prisma.establishment.findFirst({
      where: { organizationId, id },
      select: SITE_SELECT,
    });
    return row ? toSite(row) : null;
  }

  async list(organizationId: string): Promise<RegistrySite[]> {
    const rows = await this.prisma.establishment.findMany({
      where: { organizationId },
      select: SITE_SELECT,
      orderBy: { name: 'asc' },
    });
    return rows.map(toSite);
  }

  async createSite(input: {
    organizationId: string;
    actorUserId: string;
    source: string;
    name: string;
    kind: string | null;
    city?: string | null;
    address?: string | null;
    phone?: string | null;
  }): Promise<RegistrySite> {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: input.organizationId },
      select: { timezone: true },
    });
    const kind: EstablishmentKind | null = isEstablishmentKind(input.kind) ? input.kind : null;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.establishment.create({
          data: {
            organizationId: input.organizationId,
            name: input.name.trim(),
            // Lieu sans activité Park : il n'apparaît dans aucune vente Park ni Restaurant.
            businessType: 'NONE',
            kind,
            city: input.city ?? null,
            address: input.address ?? null,
            phone: input.phone ?? null,
            timezone: organization.timezone,
          },
          select: SITE_SELECT,
        });
        await this.audit.record(
          {
            organizationId: input.organizationId,
            actorUserId: input.actorUserId,
            action: 'establishment.created',
            targetType: 'Establishment',
            targetId: created.id,
            metadata: { name: created.name, source: input.source, kind },
          },
          tx,
        );
        return toSite(created);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'ESTABLISHMENT_NAME_TAKEN',
          message:
            'Un site de ce nom existe déjà dans votre organisation : rattachez-le plutôt que d’en créer un second.',
        });
      }
      throw error;
    }
  }

  /**
   * Applications qui utilisent chaque établissement : Park ou Restaurant selon l'activité de
   * l'établissement, puis les fiches rattachées des applications à base séparée.
   */
  async usages(organizationId: string): Promise<Map<string, SiteUsage[]>> {
    const out = new Map<string, SiteUsage[]>();
    const push = (id: string, usage: SiteUsage) => out.set(id, [...(out.get(id) ?? []), usage]);
    const establishments = await this.prisma.establishment.findMany({
      where: { organizationId },
      select: { id: true, name: true, businessType: true },
    });
    for (const e of establishments) {
      for (const activity of activitiesOf(e.businessType)) {
        push(e.id, {
          product: activity === 'PARK' ? 'OCALL_PARK' : 'OCALL_RESTAURANT',
          label: activity === 'PARK' ? 'Ocall Park' : 'Ocall Restaurant',
          appSiteId: null,
          appSiteName: e.name,
        });
      }
    }
    const known = new Set(establishments.map((e) => e.id));
    for (const provider of this.providers.values()) {
      for (const u of await provider.usages(organizationId)) {
        // Défense en profondeur : un rattachement vers un établissement d'une autre organisation
        // (impossible par les contrôles d'écriture) n'est jamais affiché.
        if (!known.has(u.establishmentId)) continue;
        push(u.establishmentId, {
          product: provider.product,
          label: provider.label,
          appSiteId: u.appSiteId,
          appSiteName: u.appSiteName,
        });
      }
    }
    return out;
  }
}
