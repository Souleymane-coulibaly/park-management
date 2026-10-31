import { mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { SitesConfig } from '../../modules/public-sites/sites.config';

/**
 * Stockage de fichiers de la plateforme (Sprint 10, généralisé au Sprint 11B), compatible S3
 * (Cloudflare R2, AWS S3, MinIO…) ou local. Clés générées par le serveur uniquement :
 * - médias publics des sites : `<uuid>.<jpg|png|webp>` (préfixe `sites/`) ;
 * - fichiers PRIVÉS : `org/<organisation>/<établissement|_>/<uuid>.<ext>` (préfixe `private/`),
 *   jamais servis directement : uniquement par l'API, après contrôle d'accès ou lien signé.
 * Le bucket reste privé : aucun accès public n'est nécessaire.
 */
export interface StorageProvider {
  readonly driver: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  /** Sonde de disponibilité (lecture/écriture possible), sans détail d'erreur. */
  check(): Promise<boolean>;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const MEDIA_KEY = new RegExp(`^${UUID}\\.(jpg|png|webp)$`);
const PRIVATE_KEY = new RegExp(`^org/${UUID}/(${UUID}|_)/${UUID}\\.(jpg|png|webp|pdf)$`);

export const isPrivateKey = (key: string) => PRIVATE_KEY.test(key);

/** Rejette toute clé non générée par le serveur (chemin, extension inattendue, traversée). */
export function assertStorageKey(key: string): void {
  if (!MEDIA_KEY.test(key) && !PRIVATE_KEY.test(key)) throw new Error('Clé de média invalide.');
}

/** Clé d'un fichier privé, isolée par organisation et établissement. */
export function privateKey(
  organizationId: string,
  establishmentId: string | null,
  fileId: string,
  extension: 'jpg' | 'png' | 'webp' | 'pdf',
): string {
  const key = `org/${organizationId}/${establishmentId ?? '_'}/${fileId}.${extension}`;
  assertStorageKey(key);
  return key;
}

/** Développement et tests : fichiers dans un répertoire local (volume persistant en production). */
export class LocalStorageProvider implements StorageProvider {
  readonly driver = 'local' as const;
  private readonly root: string;

  constructor(directory: string) {
    this.root = resolve(directory);
  }

  private path(key: string) {
    assertStorageKey(key);
    return join(this.root, ...key.split('/'));
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, { flag: 'wx' });
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async check(): Promise<boolean> {
    try {
      await mkdir(this.root, { recursive: true });
      await access(this.root, constants.R_OK | constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}

/** Stockage d'objets compatible S3, via le SDK officiel. */
export class S3StorageProvider implements StorageProvider {
  readonly driver = 's3' as const;
  private readonly client: S3Client;

  constructor(private readonly config: Extract<SitesConfig['storage'], { driver: 's3' }>) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint ?? undefined,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  private objectKey(key: string) {
    assertStorageKey(key);
    return isPrivateKey(key) ? `private/${key}` : `sites/${key}`;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: this.objectKey(key),
        Body: body,
        ContentType: contentType,
        CacheControl: isPrivateKey(key)
          ? 'private, no-store'
          : 'public, max-age=31536000, immutable',
      }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: this.objectKey(key) }),
      );
      return res.Body ? Buffer.from(await res.Body.transformToByteArray()) : null;
    } catch (e) {
      if (e instanceof NoSuchKey) return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: this.objectKey(key) }),
    );
  }

  async check(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}

export function createStorageProvider(config: SitesConfig['storage']): StorageProvider {
  return config.driver === 's3'
    ? new S3StorageProvider(config)
    : new LocalStorageProvider(config.directory);
}
