import { createHash, randomUUID } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import { SIGNED_URL_TTL_SECONDS, bytesToMb } from '@ocall/shared';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { organizationQuotas } from '../quotas';
import type { RequestMeta } from '../request-meta';
import { signFileToken, verifyFileToken } from './signed-url';
import { STORAGE_PROVIDER, type StorageProvider, privateKey } from './storage-provider';

type Tx = Prisma.TransactionClient;

const EXTENSION = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
} as const;
export type PrivateMimeType = keyof typeof EXTENSION;

export interface StorageUsage {
  usedBytes: number;
  usedMb: number;
  quotaMb: number;
  /** Détail : médias des sites vitrines, fichiers privés. */
  siteMediaBytes: number;
  privateBytes: number;
  files: number;
}

/**
 * Fichiers de la plateforme (Sprint 11B) : quota de stockage par organisation (médias des sites
 * et fichiers privés), dépôt de fichiers privés isolés par organisation et établissement, liens
 * temporaires signés, téléchargements journalisés, conservation bornée puis purge.
 */
@Injectable()
export class StorageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly provider: StorageProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get driver() {
    return this.provider.driver;
  }

  check() {
    return this.provider.check();
  }

  async usage(organizationId: string, db: PrismaService | Tx = this.prisma): Promise<StorageUsage> {
    const [media, files, quotas] = await Promise.all([
      db.publicSiteMedia.aggregate({ where: { organizationId }, _sum: { bytes: true } }),
      db.storedFile.aggregate({
        where: { organizationId, deletedAt: null },
        _sum: { bytes: true },
        _count: true,
      }),
      organizationQuotas(db, organizationId),
    ]);
    const siteMediaBytes = media._sum.bytes ?? 0;
    const privateBytes = files._sum.bytes ?? 0;
    const usedBytes = siteMediaBytes + privateBytes;
    return {
      usedBytes,
      usedMb: bytesToMb(usedBytes),
      quotaMb: quotas.storageMb,
      siteMediaBytes,
      privateBytes,
      files: files._count,
    };
  }

  /**
   * Contrôle préalable (sans verrou) avant une opération qui déposera des fichiers : évite
   * d'enregistrer un message puis de refuser ses pièces jointes. Le contrôle sous verrou de
   * storePrivate reste la garantie.
   */
  async assertRoom(organizationId: string, bytes: number): Promise<void> {
    if (bytes === 0) return;
    await this.prisma.$transaction(async (tx) => {
      const usage = await this.usage(organizationId, tx);
      if (usage.usedBytes + bytes > usage.quotaMb * 1024 * 1024) {
        throw new HttpException(
          {
            code: 'STORAGE_QUOTA_EXCEEDED',
            message: `Espace de stockage insuffisant (${usage.usedMb} Mo utilisés sur ${usage.quotaMb} Mo). Supprimez des fichiers ou contactez Ocall.`,
          },
          HttpStatus.INSUFFICIENT_STORAGE,
        );
      }
    });
  }

  /**
   * Vérifie le quota avant un ajout, sous verrou de l'organisation : deux dépôts simultanés ne
   * peuvent pas le dépasser ensemble. À appeler dans la transaction qui enregistre le fichier.
   */
  async assertQuota(tx: Tx, organizationId: string, additionalBytes: number): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId}::uuid FOR UPDATE`;
    const usage = await this.usage(organizationId, tx);
    if (usage.usedBytes + additionalBytes > usage.quotaMb * 1024 * 1024) {
      throw new HttpException(
        {
          code: 'STORAGE_QUOTA_EXCEEDED',
          message: `Espace de stockage insuffisant (${usage.usedMb} Mo utilisés sur ${usage.quotaMb} Mo). Supprimez des fichiers ou contactez Ocall.`,
        },
        HttpStatus.INSUFFICIENT_STORAGE,
      );
    }
  }

  /**
   * Dépose un fichier PRIVÉ. L'objet est écrit d'abord, puis enregistré (quota vérifié sous
   * verrou) ; en cas d'échec, l'objet est supprimé : jamais de fichier orphelin compté ou servi.
   */
  async storePrivate(params: {
    organizationId: string;
    establishmentId: string | null;
    kind: 'SUPPORT_ATTACHMENT';
    body: Buffer;
    mimeType: PrivateMimeType;
    displayName: string;
    createdById: string;
    retentionDays: number;
    /** Rattachement réalisé dans la même transaction que l'enregistrement. */
    link?: (tx: Tx, fileId: string) => Promise<void>;
  }) {
    const id = randomUUID();
    const key = privateKey(
      params.organizationId,
      params.establishmentId,
      id,
      EXTENSION[params.mimeType],
    );
    await this.provider.put(key, params.body, params.mimeType);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertQuota(tx, params.organizationId, params.body.length);
        const file = await tx.storedFile.create({
          data: {
            id,
            organizationId: params.organizationId,
            establishmentId: params.establishmentId,
            kind: params.kind,
            storageKey: key,
            mimeType: params.mimeType,
            bytes: params.body.length,
            sha256: createHash('sha256').update(params.body).digest('hex'),
            displayName: params.displayName,
            createdById: params.createdById,
            retentionUntil: new Date(Date.now() + params.retentionDays * 86_400_000),
          },
          select: { id: true, displayName: true, mimeType: true, bytes: true },
        });
        await params.link?.(tx, file.id);
        return file;
      });
    } catch (e) {
      await this.provider.delete(key).catch(() => undefined);
      throw e;
    }
  }

  /** Lien temporaire (quelques minutes) vers un fichier privé, après contrôle d'accès de l'appelant. */
  temporaryUrl(file: { id: string; organizationId: string }, userId: string) {
    const expires = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
    const token = signFileToken(
      { f: file.id, o: file.organizationId, u: userId, e: expires },
      this.config.storageSigningKey,
    );
    return { url: `/api/v1/files/${token}`, expiresAt: new Date(expires * 1000).toISOString() };
  }

  /** Téléchargement par lien signé : jeton valide, fichier non supprimé ; accès journalisé. */
  async download(token: string, meta: RequestMeta) {
    const claims = verifyFileToken(token, this.config.storageSigningKey);
    const file = claims
      ? await this.prisma.storedFile.findFirst({
          where: { id: claims.f, organizationId: claims.o, deletedAt: null },
          select: {
            id: true,
            organizationId: true,
            storageKey: true,
            mimeType: true,
            displayName: true,
          },
        })
      : null;
    const body = file ? await this.provider.get(file.storageKey) : null;
    if (!claims || !file || !body) {
      throw new NotFoundException({
        code: 'FILE_NOT_FOUND',
        message: 'Lien expiré ou fichier introuvable.',
      });
    }
    await this.audit.record({
      organizationId: file.organizationId,
      actorUserId: claims.u,
      action: 'storage.file_downloaded',
      targetType: 'StoredFile',
      targetId: file.id,
      metadata: { name: file.displayName },
      ipAddress: meta.ipAddress,
    });
    return { body, mimeType: file.mimeType, displayName: file.displayName };
  }

  /**
   * Purge des fichiers arrivés en fin de conservation : objet supprimé, enregistrement marqué
   * supprimé (trace conservée). Idempotente.
   */
  async purgeExpired(actorUserId: string | null): Promise<{ purged: number }> {
    const expired = await this.prisma.storedFile.findMany({
      where: { deletedAt: null, retentionUntil: { lt: new Date() } },
      select: { id: true, organizationId: true, storageKey: true },
      take: 500,
    });
    for (const f of expired) {
      await this.provider.delete(f.storageKey);
      await this.prisma.storedFile.update({ where: { id: f.id }, data: { deletedAt: new Date() } });
    }
    if (expired.length > 0) {
      await this.audit.record({
        organizationId: null,
        actorUserId,
        action: 'platform.storage_purged',
        targetType: 'StoredFile',
        metadata: { purged: expired.length },
      });
    }
    return { purged: expired.length };
  }
}
