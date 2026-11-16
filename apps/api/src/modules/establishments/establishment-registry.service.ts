import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@ocall/database';
import {
  type EstablishmentKind,
  ORGANIZATION_SITE_KEY,
  SITE_SOURCE_PARK,
  SITE_SOURCE_RESTAURANT,
  type SiteUsage,
  activitiesOf,
  isEstablishmentKind,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import type {
  BillableSite,
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

  async findByName(organizationId: string, name: string): Promise<RegistrySite | null> {
    const row = await this.prisma.establishment.findFirst({
      where: { organizationId, name: name.trim() },
      select: SITE_SELECT,
    });
    return row ? toSite(row) : null;
  }

  async discardNewSite(input: {
    organizationId: string;
    actorUserId: string;
    source: string;
    id: string;
  }): Promise<boolean> {
    const used = (await this.usages(input.organizationId)).get(input.id) ?? [];
    if (used.length > 0) return false;
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.establishment.deleteMany({
        where: {
          id: input.id,
          organizationId: input.organizationId,
          businessType: 'NONE',
          createdAt: { gt: new Date(Date.now() - 10 * 60_000) },
          assignments: { none: {} },
        },
      });
      if (count !== 1) return false;
      await this.audit.record(
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'establishment.creation_rolled_back',
          targetType: 'Establishment',
          targetId: input.id,
          metadata: { source: input.source },
        },
        tx,
      );
      return true;
    });
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

  /**
   * Étape 6 : sites facturables d'une application source. Parc et Restaurant : établissements actifs avec
   * l'activité correspondante (comptés séparément ; un établissement « parc et restaurant » apparaît dans
   * les deux). Facture : toujours un site. Applications à base séparée : leurs fiches facturables, une
   * fiche rattachée à un établissement actif de l'organisation comptant pour cet établissement.
   */
  async billableSites(organizationId: string, source: string): Promise<BillableSite[]> {
    if (source === 'OCALL_FACTURE') {
      return [
        {
          siteKey: ORGANIZATION_SITE_KEY,
          unitKey: ORGANIZATION_SITE_KEY,
          establishmentId: null,
          label: 'Organisation',
        },
      ];
    }
    const establishments = await this.prisma.establishment.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, name: true, businessType: true },
      orderBy: { name: 'asc' },
    });
    if (source === SITE_SOURCE_PARK || source === SITE_SOURCE_RESTAURANT) {
      const activity = source === SITE_SOURCE_PARK ? 'PARK' : 'RESTAURANT';
      return establishments
        .filter((e) => activitiesOf(e.businessType).includes(activity))
        .map((e) => ({ siteKey: e.id, unitKey: e.id, establishmentId: e.id, label: e.name }));
    }
    const provider = this.providers.get(source);
    // Application non chargée (module désactivé) : erreur, jamais « aucun site » (sous-facturation).
    if (!provider) throw new Error(`Sites de ${source} illisibles : application non chargée.`);
    const active = new Map(establishments.map((e) => [e.id, e.name]));
    const out = new Map<string, BillableSite>();
    for (const site of await provider.billableSites(organizationId)) {
      // Rattachée à un établissement actif de l'organisation : un seul site pour cet établissement.
      const linked = site.establishmentId !== null && active.has(site.establishmentId);
      const siteKey = linked ? site.establishmentId! : `${source}:${site.appSiteId}`;
      if (out.has(siteKey)) continue;
      out.set(siteKey, {
        siteKey,
        unitKey: `${source}:${site.appSiteId}`,
        establishmentId: linked ? site.establishmentId : null,
        label: linked ? active.get(site.establishmentId!)! : site.appSiteName,
      });
    }
    return [...out.values()];
  }
}
