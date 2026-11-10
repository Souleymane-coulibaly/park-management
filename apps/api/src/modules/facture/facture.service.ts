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
import { type FactureLetterheadIdentity, renderLetterheadPreview } from './facture-pdf';
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
      address: '',
      city: '',
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
    };
    return { ...draft, hasLogo: false, saved: false, legalMissing: factureLegalMissing(draft) };
  }

  async updateSettings(ctx: FactureContext, dto: FactureSettingsDto) {
    const data = {
      legalName: dto.legalName,
      tradeName: dto.tradeName ?? null,
      address: dto.address,
      city: dto.city,
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      nif: dto.nif ?? null,
      rccm: dto.rccm ?? null,
      taxRegime: dto.taxRegime ?? null,
      bankDetails: dto.bankDetails ?? null,
      legalFooter: dto.legalFooter ?? null,
      defaultVatRate: dto.defaultVatRate,
      paymentTermsDays: dto.paymentTermsDays,
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
    if (!file || !LOGO_TYPES.has(file.mimetype) || file.size > FACTURE_LOGO_MAX_BYTES) {
      throw new BadRequestException({
        code: 'LOGO_REFUSED',
        message: 'Logo refusé : image PNG, JPEG ou WebP de 1 Mo au plus.',
      });
    }
    let png: Buffer;
    try {
      png = await sharp(file.buffer, { failOn: 'error', limitInputPixels: 4096 * 4096 })
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
    return renderLetterheadPreview(identity, await this.logoBody(ctx.organizationId));
  }

  private async logoBody(organizationId: string): Promise<Buffer | null> {
    const settings = await this.db.factureSettings.findUnique({
      where: { organizationId },
      select: { logoKey: true },
    });
    return settings?.logoKey ? this.storage.get(settings.logoKey) : null;
  }
}
