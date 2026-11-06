import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Prisma } from '@ocall/school-database';
import {
  SCHOOL_SITE_LIMITS,
  type SchoolSiteContent,
  type SchoolSitePublished,
  type SchoolSitePublishedMedia,
} from '@ocall/shared';
import { STORAGE_PROVIDER, type StorageProvider } from '../../common/storage/storage-provider';
import type { SchoolContext } from './school-access';
import type { SchoolUpload } from './school-documents.service';
import { SchoolPrismaService } from './school-prisma.service';
import { processSchoolSiteImage } from './school-site-image';
import { SchoolSitesService } from './school-sites.service';
import { SchoolService } from './school.service';

export const SCHOOL_SITE_MEDIA_KINDS = ['LOGO', 'COVER', 'GALLERY', 'NEWS'] as const;
export type SchoolSiteMediaKind = (typeof SCHOOL_SITE_MEDIA_KINDS)[number];

/** Plafond d'images actives par site (logos, couvertures, galerie, actualités). */
const MAX_MEDIA_PER_SITE = 120;
const NOT_FOUND = { code: 'SCHOOL_SITE_MEDIA_NOT_FOUND', message: 'Image introuvable.' };

const MEDIA_VIEW = {
  id: true,
  kind: true,
  storageKey: true,
  thumbKey: true,
  bytes: true,
  width: true,
  height: true,
  alt: true,
  altAr: true,
  isPublished: true,
  containsMinors: true,
  consentReference: true,
  consentAttestedAt: true,
  withdrawnAt: true,
  withdrawalReason: true,
  createdAt: true,
} as const;

/**
 * Médias des sites School. Chaque image est réencodée (métadonnées EXIF/GPS supprimées) avant d'être
 * stockée ; l'original n'est jamais conservé. Photo où figurent des mineurs : attestation enregistrée
 * (référence de l'autorisation, auteur, date) — simple déclaration, qui ne dispense pas l'établissement
 * de détenir les autorisations écrites. Retrait : immédiat, partout (brouillon, version publiée,
 * actualités), fichiers supprimés du stockage et pages publiques régénérées.
 */
@Injectable()
export class SchoolSiteMediaService {
  private readonly logger = new Logger(SchoolSiteMediaService.name);

  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    private readonly sites: SchoolSitesService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private view(siteId: string, m: Prisma.SchoolSiteMediaGetPayload<{ select: typeof MEDIA_VIEW }>) {
    const url = (key: string | null) =>
      key ? `/api/v1/school/sites/${siteId}/media-file/${key}` : null;
    return {
      id: m.id,
      kind: m.kind,
      bytes: m.bytes,
      width: m.width,
      height: m.height,
      alt: m.alt,
      altAr: m.altAr,
      isPublished: m.isPublished,
      containsMinors: m.containsMinors,
      consentReference: m.consentReference,
      consentAttestedAt: m.consentAttestedAt?.toISOString() ?? null,
      withdrawnAt: m.withdrawnAt?.toISOString() ?? null,
      withdrawalReason: m.withdrawalReason,
      createdAt: m.createdAt.toISOString(),
      url: url(m.storageKey),
      thumbUrl: url(m.thumbKey),
    };
  }

  async list(ctx: SchoolContext, siteId: string) {
    const site = await this.sites.findSite(ctx, siteId);
    const rows = await this.db.schoolSiteMedia.findMany({
      where: { organizationId: site.organizationId, siteId: site.id },
      orderBy: { createdAt: 'desc' },
      select: MEDIA_VIEW,
    });
    return rows.map((m) => this.view(site.id, m));
  }

  async upload(
    ctx: SchoolContext,
    siteId: string,
    dto: {
      kind: SchoolSiteMediaKind;
      alt?: string;
      altAr?: string;
      containsMinors: boolean;
      consentReference?: string;
    },
    file: SchoolUpload | undefined,
  ) {
    const site = await this.sites.findSite(ctx, siteId);
    if (!file)
      throw new BadRequestException({ code: 'MEDIA_REQUIRED', message: 'Image manquante.' });
    const consent = (dto.consentReference ?? '').trim();
    if (dto.containsMinors && !consent) {
      throw new BadRequestException({
        code: 'MEDIA_CONSENT_REQUIRED',
        message:
          'Photo avec des mineurs : indiquez la référence de l’autorisation parentale détenue par l’établissement.',
      });
    }
    if (consent.length > SCHOOL_SITE_LIMITS.consentReference) {
      throw new BadRequestException({
        code: 'MEDIA_CONSENT_TOO_LONG',
        message: 'Référence trop longue.',
      });
    }
    const processed = await processSchoolSiteImage(file.buffer);
    if ('code' in processed) {
      if (processed.code === 'MEDIA_TOO_LARGE') throw new PayloadTooLargeException(processed);
      throw new BadRequestException(processed);
    }
    const storageKey = `${randomUUID()}.webp`;
    const thumbKey = `${randomUUID()}.webp`;
    await this.storage.put(storageKey, processed.full.body, 'image/webp');
    await this.storage.put(thumbKey, processed.thumb.body, 'image/webp');
    try {
      const media = await this.db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM "SchoolSite" WHERE "id" = ${site.id}::uuid FOR UPDATE`;
        const count = await tx.schoolSiteMedia.count({
          where: { siteId: site.id, withdrawnAt: null },
        });
        if (count >= MAX_MEDIA_PER_SITE) {
          throw new ConflictException({
            code: 'MEDIA_LIMIT',
            message: `${MAX_MEDIA_PER_SITE} images au plus par site : retirez-en d’abord.`,
          });
        }
        return tx.schoolSiteMedia.create({
          data: {
            organizationId: site.organizationId,
            siteId: site.id,
            kind: dto.kind,
            storageKey,
            thumbKey,
            mimeType: 'image/webp',
            bytes: processed.full.body.length + processed.thumb.body.length,
            width: processed.full.width,
            height: processed.full.height,
            alt: (dto.alt ?? '').trim().slice(0, SCHOOL_SITE_LIMITS.altText),
            altAr: (dto.altAr ?? '').trim().slice(0, SCHOOL_SITE_LIMITS.altText),
            containsMinors: dto.containsMinors,
            ...(dto.containsMinors
              ? {
                  consentReference: consent,
                  consentAttestedByUserId: ctx.userId,
                  consentAttestedAt: new Date(),
                }
              : {}),
            createdByUserId: ctx.userId,
          },
          select: MEDIA_VIEW,
        });
      });
      await this.school.log(ctx, 'school.site_media_uploaded', 'SchoolSiteMedia', media.id, {
        kind: dto.kind,
        containsMinors: dto.containsMinors ? 'oui' : 'non',
      });
      if (dto.containsMinors) {
        await this.school.log(
          ctx,
          'school.site_media_consent_attested',
          'SchoolSiteMedia',
          media.id,
          {
            reference: consent,
          },
        );
      }
      return this.view(site.id, media);
    } catch (error) {
      // Refus après stockage (plafond) : aucun fichier orphelin.
      await this.deleteObjects([storageKey, thumbKey]);
      throw error;
    }
  }

  /** Fichier d'un média du site (aperçu de l'administration, export), jamais mis en cache public. */
  async file(ctx: SchoolContext, siteId: string, key: string) {
    const site = await this.sites.findSite(ctx, siteId);
    const media = await this.db.schoolSiteMedia.findFirst({
      where: {
        organizationId: site.organizationId,
        siteId: site.id,
        withdrawnAt: null,
        OR: [{ storageKey: key }, { thumbKey: key }],
      },
      select: { id: true },
    });
    const body = media ? await this.storage.get(key) : null;
    if (!media || !body) throw new NotFoundException(NOT_FOUND);
    return { body, mimeType: 'image/webp' };
  }

  /**
   * Retrait immédiat d'une image, publiée ou non : retirée du brouillon, de la version publiée (sans
   * attendre une nouvelle publication) et des actualités ; fichiers supprimés du stockage ; pages
   * publiques régénérées. La ligne reste, sans fichier, pour la traçabilité (qui, quand, pourquoi).
   */
  async withdraw(ctx: SchoolContext, siteId: string, mediaId: string, reason: string) {
    const site = await this.sites.findSite(ctx, siteId);
    const keys = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "SchoolSite" WHERE "id" = ${site.id}::uuid FOR UPDATE`;
      const media = await tx.schoolSiteMedia.findFirst({
        where: { id: mediaId, organizationId: site.organizationId, siteId: site.id },
        select: { id: true, storageKey: true, thumbKey: true, withdrawnAt: true },
      });
      if (!media) throw new NotFoundException(NOT_FOUND);
      if (media.withdrawnAt) return [];
      const fresh = await this.sites.findSite(ctx, siteId, tx);
      const draft = fresh.draft as unknown as SchoolSiteContent;
      const cleanedDraft: SchoolSiteContent = {
        ...draft,
        media: {
          logoId: draft.media.logoId === media.id ? null : draft.media.logoId,
          coverId: draft.media.coverId === media.id ? null : draft.media.coverId,
          gallery: draft.media.gallery.filter((g) => g.mediaId !== media.id),
        },
      };
      const gone = new Set([media.storageKey, media.thumbKey].filter(Boolean));
      const keep = (m: SchoolSitePublishedMedia | null) =>
        m && !gone.has(m.url.split('/').pop()!) ? m : null;
      const published = fresh.published as unknown as SchoolSitePublished | null;
      const cleanedPublished = published
        ? {
            ...published,
            logo: keep(published.logo),
            cover: keep(published.cover),
            gallery: published.gallery.filter((g) => keep(g) !== null),
          }
        : null;
      const row = await tx.schoolSite.update({
        where: { id: site.id },
        data: {
          draft: cleanedDraft as unknown as Prisma.InputJsonValue,
          ...(cleanedPublished
            ? { published: cleanedPublished as unknown as Prisma.InputJsonValue }
            : {}),
        },
        select: { id: true, organizationId: true, isOnline: true, published: true },
      });
      await tx.schoolSiteNews.updateMany({
        where: { organizationId: site.organizationId, siteId: site.id, mediaId: media.id },
        data: { mediaId: null },
      });
      await tx.schoolSiteMedia.update({
        where: { id: media.id },
        data: {
          storageKey: null,
          thumbKey: null,
          isPublished: false,
          withdrawnAt: new Date(),
          withdrawnByUserId: ctx.userId,
          withdrawalReason: reason.trim().slice(0, 300) || null,
        },
      });
      await this.sites.syncPublishedMedia(tx, row);
      return [media.storageKey, media.thumbKey].filter((k): k is string => !!k);
    });
    if (keys.length === 0) return { withdrawn: true };
    // Fichiers supprimés après la validation : l'image n'est plus servie (lien public → 404).
    await this.deleteObjects(keys);
    await this.school.log(ctx, 'school.site_media_withdrawn', 'SchoolSiteMedia', mediaId, {
      reason: reason.trim().slice(0, 300) || null,
    });
    // Purge du cache des pages publiques (ISR Next.js) : la page ne cite plus l'image.
    await this.sites.revalidate([site.slug]);
    return { withdrawn: true };
  }

  /** Image publique : publiée, non retirée, d'un site en ligne et disponible ; null sinon. */
  async publicFile(key: string): Promise<{ body: Buffer } | null> {
    const allowed = await this.sites.publicMediaKey(key);
    const body = allowed ? await this.storage.get(allowed.storageKey) : null;
    return body ? { body } : null;
  }

  private async deleteObjects(keys: string[]) {
    for (const key of keys) {
      try {
        await this.storage.delete(key);
      } catch (e) {
        this.logger.warn(`Suppression d'un fichier de site impossible : ${(e as Error).message}`);
      }
    }
  }
}
