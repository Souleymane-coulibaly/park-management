import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import {
  SITE_MEDIA_MAX_BYTES,
  SITE_MEDIA_MAX_DIMENSION,
  SITE_MEDIA_MIN_DIMENSION,
  SITE_LIMITS,
  type SiteContent,
  type SiteMediaKind,
  inspectImage,
  withContentDefaults,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import type { UploadedFileInMemory } from '../ai/uploaded-file';
import { STORAGE_PROVIDER, type StorageProvider } from '../../common/storage/storage-provider';
import { StorageService } from '../../common/storage/storage.service';
import { SitesService } from './sites.service';

/** Plafond de médias par site (galerie, logos et couvertures successifs). */
const MAX_MEDIA_PER_SITE = 60;
const EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

/**
 * Médias des sites : type et dimensions lus dans le contenu (jamais d'après le nom ni le type
 * annoncé), taille bornée, clé aléatoire, stockage d'objets. Les SVG, GIF et autres formats sont
 * refusés (un SVG peut contenir du script).
 */
@Injectable()
export class SiteMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sites: SitesService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly files: StorageService,
  ) {}

  async list(tenant: TenantContext, siteId: string) {
    await this.sites.findSite(tenant, siteId);
    const media = await this.prisma.publicSiteMedia.findMany({
      where: { siteId },
      select: {
        id: true,
        kind: true,
        mimeType: true,
        bytes: true,
        width: true,
        height: true,
        alt: true,
        isPublished: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return media.map((m) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
      url: `/api/v1/sites/${siteId}/media/${m.id}/file`,
    }));
  }

  async upload(
    tenant: TenantContext,
    siteId: string,
    kind: SiteMediaKind,
    alt: string,
    file: UploadedFileInMemory | undefined,
  ) {
    await this.sites.findSite(tenant, siteId);
    if (!file)
      throw new BadRequestException({ code: 'MEDIA_REQUIRED', message: 'Image manquante.' });
    if (file.size > SITE_MEDIA_MAX_BYTES) {
      throw new PayloadTooLargeException({
        code: 'MEDIA_TOO_LARGE',
        message: 'Image trop lourde (5 Mo au plus).',
      });
    }
    const image = inspectImage(new Uint8Array(file.buffer));
    if (!image) {
      throw new BadRequestException({
        code: 'MEDIA_TYPE_REFUSED',
        message: 'Format refusé : JPEG, PNG ou WebP uniquement.',
      });
    }
    if (
      image.width < SITE_MEDIA_MIN_DIMENSION ||
      image.height < SITE_MEDIA_MIN_DIMENSION ||
      image.width > SITE_MEDIA_MAX_DIMENSION ||
      image.height > SITE_MEDIA_MAX_DIMENSION
    ) {
      throw new BadRequestException({
        code: 'MEDIA_DIMENSIONS',
        message: `Dimensions refusées : entre ${SITE_MEDIA_MIN_DIMENSION} et ${SITE_MEDIA_MAX_DIMENSION} pixels.`,
      });
    }
    const count = await this.prisma.publicSiteMedia.count({ where: { siteId } });
    if (count >= MAX_MEDIA_PER_SITE) {
      throw new ConflictException({
        code: 'MEDIA_LIMIT',
        message: `${MAX_MEDIA_PER_SITE} images au plus par site : supprimez-en d’abord.`,
      });
    }
    const key = `${randomUUID()}.${EXTENSION[image.mime]}`;
    await this.storage.put(key, file.buffer, image.mime);
    // Quota de stockage de l'organisation (Sprint 11B), vérifié sous verrou ; objet supprimé si refus.
    const media = await this.prisma
      .$transaction(async (tx) => {
        await this.files.assertQuota(tx, tenant.membership.organizationId, file.size);
        const m = await tx.publicSiteMedia.create({
          data: {
            organizationId: tenant.membership.organizationId,
            siteId,
            kind,
            storageKey: key,
            mimeType: image.mime,
            bytes: file.size,
            width: image.width,
            height: image.height,
            alt: alt.trim().slice(0, SITE_LIMITS.altText),
          },
          select: {
            id: true,
            kind: true,
            mimeType: true,
            bytes: true,
            width: true,
            height: true,
            alt: true,
            isPublished: true,
            createdAt: true,
          },
        });
        await this.audit.record(
          {
            organizationId: tenant.membership.organizationId,
            actorUserId: tenant.user.id,
            action: 'site.media_uploaded',
            targetType: 'PublicSiteMedia',
            targetId: m.id,
            metadata: { siteId, kind, bytes: file.size, mime: image.mime },
          },
          tx,
        );
        return m;
      })
      .catch(async (e: unknown) => {
        await this.storage.delete(key).catch(() => undefined);
        throw e;
      });
    return {
      ...media,
      createdAt: media.createdAt.toISOString(),
      url: `/api/v1/sites/${siteId}/media/${media.id}/file`,
    };
  }

  /** Fichier d'un média pour l'éditeur et l'aperçu (authentifié, brouillon compris). */
  async file(tenant: TenantContext, siteId: string, mediaId: string) {
    await this.sites.findSite(tenant, siteId);
    const media = await this.prisma.publicSiteMedia.findFirst({
      where: { id: mediaId, siteId },
      select: { storageKey: true, mimeType: true },
    });
    const body = media ? await this.storage.get(media.storageKey) : null;
    if (!media || !body)
      throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', message: 'Image introuvable.' });
    return { body, mimeType: media.mimeType };
  }

  /** Fichier public : uniquement les images de la version publiée d'un site en ligne. */
  async publicFile(key: string) {
    const media = await this.prisma.publicSiteMedia.findFirst({
      where: { storageKey: key, isPublished: true, site: { isOnline: true } },
      select: { storageKey: true, mimeType: true },
    });
    const body = media ? await this.storage.get(media.storageKey) : null;
    if (!media || !body) return null;
    return { body, mimeType: media.mimeType };
  }

  /**
   * Suppression : refusée si l'image figure dans la version en ligne (la page publique serait
   * cassée) ; retirée du brouillon sinon.
   */
  async remove(tenant: TenantContext, siteId: string, mediaId: string) {
    const site = await this.sites.findSite(tenant, siteId);
    const media = await this.prisma.publicSiteMedia.findFirst({
      where: { id: mediaId, siteId },
      select: { id: true, storageKey: true, isPublished: true },
    });
    if (!media)
      throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', message: 'Image introuvable.' });
    if (media.isPublished && site.isOnline) {
      throw new ConflictException({
        code: 'MEDIA_PUBLISHED',
        message:
          'Image affichée sur le site en ligne : retirez-la du brouillon et publiez avant de la supprimer.',
      });
    }
    const draft = withContentDefaults(site.draft as unknown as SiteContent);
    const cleaned: SiteContent = {
      ...draft,
      // Image retirée partout : galerie, attractions, restaurant.
      attractions: draft.attractions.map((a) =>
        a.mediaId === mediaId ? { ...a, mediaId: null } : a,
      ),
      restaurant: {
        ...draft.restaurant,
        mediaIds: draft.restaurant.mediaIds.filter((m) => m !== mediaId),
      },
      media: {
        logoId: draft.media.logoId === mediaId ? null : draft.media.logoId,
        coverId: draft.media.coverId === mediaId ? null : draft.media.coverId,
        galleryIds: draft.media.galleryIds.filter((g) => g !== mediaId),
      },
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.publicSiteMedia.delete({ where: { id: mediaId } });
      await tx.publicSite.update({
        where: { id: siteId },
        data: { draft: cleaned as unknown as Prisma.InputJsonValue },
      });
      await this.audit.record(
        {
          organizationId: tenant.membership.organizationId,
          actorUserId: tenant.user.id,
          action: 'site.media_deleted',
          targetType: 'PublicSiteMedia',
          targetId: mediaId,
          metadata: { siteId },
        },
        tx,
      );
    });
    await this.storage.delete(media.storageKey);
    return { deleted: true };
  }
}
