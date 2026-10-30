import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { SitesConfig } from './sites.config';

/**
 * Stockage des médias des sites (Sprint 10), indépendant du métier (réutilisable par la future
 * Ocall Suite). Clés générées par le serveur uniquement : jamais de nom de fichier client.
 */
export interface MediaStorage {
  readonly driver: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');

/** Clé sûre : <uuid>.<extension>, sans séparateur de chemin. */
const KEY = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;
function assertKey(key: string) {
  if (!KEY.test(key)) throw new Error('Clé de média invalide.');
}

/** Développement et tests : fichiers dans un répertoire local (volume persistant en production). */
export class LocalMediaStorage implements MediaStorage {
  readonly driver = 'local' as const;
  private readonly root: string;

  constructor(directory: string) {
    this.root = resolve(directory);
  }

  private path(key: string) {
    assertKey(key);
    return join(this.root, key);
  }

  async put(key: string, body: Buffer): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.path(key), body, { flag: 'wx' });
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
}

/** Stockage d'objets compatible S3 (Cloudflare R2, AWS S3, MinIO…), via le SDK officiel. */
export class S3MediaStorage implements MediaStorage {
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

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: `sites/${key}`,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    assertKey(key);
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: `sites/${key}` }),
      );
      return res.Body ? Buffer.from(await res.Body.transformToByteArray()) : null;
    } catch (e) {
      if (e instanceof NoSuchKey) return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: `sites/${key}` }),
    );
  }
}

export function createMediaStorage(config: SitesConfig['storage']): MediaStorage {
  return config.driver === 's3'
    ? new S3MediaStorage(config)
    : new LocalMediaStorage(config.directory);
}
