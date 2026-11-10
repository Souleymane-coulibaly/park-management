import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FACTURE_DEFAULT_VAT_RATE,
  FACTURE_LOGO_LIMITS,
  FACTURE_MAX_FOOTER_LOGOS,
  FACTURE_MAX_HEADER_LOGOS,
  type FactureLogoPlacement,
  FACTURE_ROLE_LABELS,
  factureLegalMissing,
  facturePermissionsOf,
} from '@ocall/shared';
import sharp from 'sharp';
import { AuditService } from '../../common/audit/audit.service';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
  privateKey,
} from '../../common/storage/storage-provider';
import { PrismaService } from '../../prisma/prisma.service';
import type { FactureContext } from './facture-access';
import { FacturePrismaService } from './facture-prisma.service';
import {
  type FactureLetterheadIdentity,
  loadFactureLogos,
  renderLetterheadPreview,
} from './facture-pdf';
import type { FactureSettingsDto } from './facture.dto';

/** Logo : 1 Mo au plus à l'envoi ; réencodé en PNG sans métadonnées, 600 × 300 pixels au plus. */
export const FACTURE_LOGO_MAX_BYTES = 1_000_000;
const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface FactureUpload {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/**
 * Socle d'Ocall Facture (F0) : contexte de l'utilisateur, identité légale et réglages de facturation,
 * logo, aperçu de l'en-tête des documents. Aucune donnée d'Ocall Park ni d'Ocall School.
 */
@Injectable()
export class FactureService {
  constructor(
    private readonly db: FacturePrismaService,
    private readonly core: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async context(ctx: FactureContext) {
    const [organization, settings] = await Promise.all([
      this.core.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
        select: { name: true },
      }),
      this.db.factureSettings.findUnique({ where: { organizationId: ctx.organizationId } }),
    ]);
    return {
      organization: { id: ctx.organizationId, name: organization.name },
      access: ctx.access,
      role: ctx.role,
      roleLabel: ctx.isOwner ? 'Propriétaire (gérant)' : FACTURE_ROLE_LABELS[ctx.role],
      permissions: facturePermissionsOf(ctx.role),
      settingsReady: Boolean(settings),
      legalMissing: factureLegalMissing(settings ?? {}),
    };
  }

  /** Réglages enregistrés, ou valeurs proposées (nom de l'organisation, TVA 18 %) s'il n'y en a pas. */
  async settings(ctx: FactureContext) {
    const settings = await this.db.factureSettings.findUnique({
      where: { organizationId: ctx.organizationId },
    });
    if (settings) {
      const { logoKey, updatedByUserId: _by, ...rest } = settings;
      return {
        ...rest,
        hasLogo: Boolean(logoKey),
        saved: true,
        legalMissing: factureLegalMissing(settings),
      };
    }
    const organization = await this.core.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { name: true },
    });
    const draft = {
      organizationId: ctx.organizationId,
      legalName: organization.name,
      tradeName: null,
      description: null,
      address: null,
      city: null,
      country: 'ML',
      phone: null,
      email: null,
      nif: null,
      rccm: null,
      taxRegime: null,
      bankDetails: null,
      legalFooter: null,
      defaultVatRate: FACTURE_DEFAULT_VAT_RATE,
      currency: 'XOF',
      paymentTermsDays: 30,
      accentColor: '#1f6f4a',
      quoteValidityDays: 30,
      defaultTerms: null,
    };
    return { ...draft, hasLogo: false, saved: false, legalMissing: factureLegalMissing(draft) };
  }

  async updateSettings(ctx: FactureContext, dto: FactureSettingsDto) {
    const data = {
      legalName: dto.legalName,
      tradeName: dto.tradeName ?? null,
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      address: dto.address ?? null,
      city: dto.city ?? null,
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      nif: dto.nif ?? null,
      rccm: dto.rccm ?? null,
      taxRegime: dto.taxRegime ?? null,
      bankDetails: dto.bankDetails ?? null,
      legalFooter: dto.legalFooter ?? null,
      defaultVatRate: dto.defaultVatRate,
      paymentTermsDays: dto.paymentTermsDays,
      ...(dto.accentColor !== undefined ? { accentColor: dto.accentColor.toLowerCase() } : {}),
      ...(dto.quoteValidityDays !== undefined ? { quoteValidityDays: dto.quoteValidityDays } : {}),
      ...(dto.defaultTerms !== undefined ? { defaultTerms: dto.defaultTerms } : {}),
      updatedByUserId: ctx.userId,
    };
    await this.db.factureSettings.upsert({
      where: { organizationId: ctx.organizationId },
      create: { organizationId: ctx.organizationId, ...data },
      update: data,
    });
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'facture.settings_updated',
      targetType: 'FactureSettings',
      targetId: ctx.organizationId,
      metadata: { fields: Object.keys(dto), defaultVatRate: dto.defaultVatRate },
    });
    return this.settings(ctx);
  }

  /** Logo : image vérifiée et réencodée (aucune métadonnée), stockée en privé, l'ancien supprimé. */
  async uploadLogo(ctx: FactureContext, file: FactureUpload | undefined) {
    const png = await normalizeLogo(file);
    const key = privateKey(ctx.organizationId, null, randomUUID(), 'png');
    await this.storage.put(key, png, 'image/png');
    let previous: string | null = null;
    try {
      previous = await this.db.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<{ logoKey: string | null }[]>`
          SELECT "logoKey" FROM "FactureSettings"
          WHERE "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`;
        if (!row) {
          throw new ConflictException({
            code: 'SETTINGS_REQUIRED',
            message: 'Enregistrez d’abord l’identité de l’entreprise.',
          });
        }
        // Premier logo principal : il prend l'une des trois places de l'en-tête.
        if (!row.logoKey) {
          const header = await tx.factureLogo.count({
            where: { organizationId: ctx.organizationId, placement: 'HEADER' },
          });
          if (header >= FACTURE_MAX_HEADER_LOGOS) throw logosLimit('HEADER');
        }
        await tx.factureSettings.update({
          where: { organizationId: ctx.organizationId },
          data: { logoKey: key, updatedByUserId: ctx.userId },
        });
        return row.logoKey;
      });
    } catch (e) {
      await this.storage.delete(key).catch(() => undefined);
      throw e;
    }
    if (previous) await this.storage.delete(previous).catch(() => undefined);
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'facture.logo_updated',
      targetType: 'FactureSettings',
      targetId: ctx.organizationId,
      metadata: { bytes: png.length },
    });
    return { hasLogo: true };
  }

  // ─── Logos supplémentaires (bandeau de tous les documents) ───

  listLogos(ctx: FactureContext) {
    return this.db.factureLogo.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: [{ placement: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, placement: true, label: true, position: true, createdAt: true },
    });
  }

  /**
   * Ajoute un logo au bandeau (6 au plus). Le plafond est tenu sous verrou de la ligne des réglages :
   * deux envois simultanés ne dépassent jamais la limite.
   */
  async addLogo(
    ctx: FactureContext,
    file: FactureUpload | undefined,
    placement: FactureLogoPlacement,
    label: string | null,
  ) {
    const png = await normalizeLogo(file);
    const key = privateKey(ctx.organizationId, null, randomUUID(), 'png');
    await this.storage.put(key, png, 'image/png');
    let id: string;
    try {
      id = await this.db.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<{ logoKey: string | null }[]>`
          SELECT "logoKey" FROM "FactureSettings"
          WHERE "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`;
        if (!row) {
          throw new ConflictException({
            code: 'SETTINGS_REQUIRED',
            message: 'Enregistrez d’abord l’identité de l’entreprise.',
          });
        }
        const existing = await tx.factureLogo.findMany({
          where: { organizationId: ctx.organizationId, placement },
          select: { position: true },
        });
        // En-tête : le logo principal des réglages compte parmi les trois.
        const used = existing.length + (placement === 'HEADER' && row.logoKey ? 1 : 0);
        if (used >= FACTURE_LOGO_LIMITS[placement]) throw logosLimit(placement);
        const logo = await tx.factureLogo.create({
          data: {
            organizationId: ctx.organizationId,
            storageKey: key,
            placement,
            label,
            position: Math.max(-1, ...existing.map((l) => l.position)) + 1,
            createdByUserId: ctx.userId,
          },
          select: { id: true },
        });
        return logo.id;
      });
    } catch (e) {
      await this.storage.delete(key).catch(() => undefined);
      throw e;
    }
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'facture.extra_logo_added',
      targetType: 'FactureLogo',
      targetId: id,
      metadata: { bytes: png.length, placement },
    });
    return { id, placement, label };
  }

  async removeLogo(ctx: FactureContext, id: string) {
    const where = { organizationId_id: { organizationId: ctx.organizationId, id } };
    const logo = await this.db.factureLogo.findUnique({ where, select: { storageKey: true } });
    if (!logo) throw new NotFoundException({ code: 'LOGO_NOT_FOUND', message: 'Aucun logo.' });
    await this.db.factureLogo.delete({ where });
    await this.storage.delete(logo.storageKey).catch(() => undefined);
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'facture.extra_logo_removed',
      targetType: 'FactureLogo',
      targetId: id,
    });
  }

  async extraLogo(ctx: FactureContext, id: string): Promise<Buffer> {
    const logo = await this.db.factureLogo.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      select: { storageKey: true },
    });
    const body = logo ? await this.storage.get(logo.storageKey) : null;
    if (!body) throw new NotFoundException({ code: 'LOGO_NOT_FOUND', message: 'Aucun logo.' });
    return body;
  }

  async logo(ctx: FactureContext): Promise<Buffer> {
    const body = await this.logoBody(ctx.organizationId);
    if (!body) throw new NotFoundException({ code: 'LOGO_NOT_FOUND', message: 'Aucun logo.' });
    return body;
  }

  /** Aperçu PDF de l'en-tête des documents, avec les mentions manquantes pour facturer. */
  async letterheadPreview(ctx: FactureContext): Promise<Buffer> {
    const settings = await this.db.factureSettings.findUnique({
      where: { organizationId: ctx.organizationId },
    });
    if (!settings) {
      throw new ConflictException({
        code: 'SETTINGS_REQUIRED',
        message: 'Enregistrez d’abord l’identité de l’entreprise.',
      });
    }
    const identity: FactureLetterheadIdentity = settings;
    return renderLetterheadPreview(
      identity,
      await loadFactureLogos(this.db, this.storage, ctx.organizationId),
    );
  }

  private async logoBody(organizationId: string): Promise<Buffer | null> {
    const settings = await this.db.factureSettings.findUnique({
      where: { organizationId },
      select: { logoKey: true },
    });
    return settings?.logoKey ? this.storage.get(settings.logoKey) : null;
  }
}

const logosLimit = (placement: FactureLogoPlacement) =>
  new ConflictException({
    code: 'FACTURE_LOGOS_LIMIT',
    message: {
      HEADER: `${FACTURE_MAX_HEADER_LOGOS} logos au plus en en-tête (logo principal compris) : retirez-en un d’abord.`,
      FOOTER: `${FACTURE_MAX_FOOTER_LOGOS} logos au plus en bas de page : retirez-en un d’abord.`,
      STAMP: 'Un seul cachet : retirez l’actuel d’abord.',
    }[placement],
  });

/** Image de logo vérifiée et réencodée en PNG (sans métadonnées), 600 × 300 pixels au plus. */
async function normalizeLogo(file: FactureUpload | undefined): Promise<Buffer> {
  if (!file || !LOGO_TYPES.has(file.mimetype) || file.size > FACTURE_LOGO_MAX_BYTES) {
    throw new BadRequestException({
      code: 'LOGO_REFUSED',
      message: 'Logo refusé : image PNG, JPEG ou WebP de 1 Mo au plus.',
    });
  }
  try {
    return await sharp(file.buffer, { failOn: 'error', limitInputPixels: 4096 * 4096 })
      .rotate()
      .resize({ width: 600, height: 300, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    throw new BadRequestException({
      code: 'LOGO_REFUSED',
      message: 'Image illisible ou corrompue.',
    });
  }
}
