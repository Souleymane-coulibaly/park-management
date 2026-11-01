import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  SCHOOL_DOCUMENTS_PER_STUDENT,
  SCHOOL_DOCUMENT_MAX_BYTES,
  SIGNED_URL_TTL_SECONDS,
  detectImportMimeType,
  isDocumentTypeAllowed,
  pdfHasActiveContent,
  type SchoolDocumentCategory,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { RequestMeta } from '../../common/request-meta';
import { signFileToken, verifyFileToken } from '../../common/storage/signed-url';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
  privateKey,
} from '../../common/storage/storage-provider';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import type { SchoolContext } from './school-access';
import { SchoolPrismaService } from './school-prisma.service';
import { SchoolStudentsService } from './school-students.service';
import { SchoolService } from './school.service';

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };
const EXTENSION = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
} as const;

/** Fichier reçu en multipart, gardé en mémoire. */
export interface SchoolUpload {
  buffer: Buffer;
  originalname: string;
  size: number;
}

const VIEW = {
  id: true,
  category: true,
  displayName: true,
  mimeType: true,
  bytes: true,
  createdAt: true,
} as const;

/**
 * Pièces du dossier : type réel vérifié d'après le contenu, fichier dans le stockage privé, servi par lien
 * temporaire signé et en pièce jointe. Chaque téléchargement est journalisé.
 */
@Injectable()
export class SchoolDocumentsService {
  private readonly logger = new Logger(SchoolDocumentsService.name);

  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    private readonly students: SchoolStudentsService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(ctx: SchoolContext, studentId: string) {
    await this.students.findStudent(ctx, studentId);
    return this.db.schoolStudentDocument.findMany({
      where: { organizationId: ctx.organizationId, studentId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: VIEW,
    });
  }

  async upload(
    ctx: SchoolContext,
    studentId: string,
    category: SchoolDocumentCategory,
    file: SchoolUpload | undefined,
  ) {
    const student = await this.students.findStudent(ctx, studentId);
    if (!file) {
      throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Choisissez un fichier.' });
    }
    if (file.size > SCHOOL_DOCUMENT_MAX_BYTES) {
      throw new PayloadTooLargeException({
        code: 'FILE_TOO_LARGE',
        message: 'Fichier trop lourd : 5 Mo au plus.',
      });
    }
    const bytes = new Uint8Array(file.buffer);
    const mimeType = detectImportMimeType(bytes);
    if (!mimeType || !isDocumentTypeAllowed(category, mimeType)) {
      throw new BadRequestException({
        code: 'FILE_TYPE_REFUSED',
        message:
          category === 'PHOTO'
            ? 'Format refusé : JPEG, PNG ou WebP uniquement.'
            : 'Format refusé : JPEG, PNG, WebP ou PDF uniquement.',
      });
    }
    if (mimeType === 'application/pdf' && pdfHasActiveContent(bytes)) {
      throw new BadRequestException({
        code: 'FILE_ACTIVE_CONTENT',
        message: 'Ce PDF contient du contenu actif : enregistrez-le de nouveau sous forme simple.',
      });
    }
    const count = await this.db.schoolStudentDocument.count({
      where: { organizationId: ctx.organizationId, studentId, deletedAt: null },
    });
    if (count >= SCHOOL_DOCUMENTS_PER_STUDENT) {
      throw new ConflictException({
        code: 'DOCUMENT_LIMIT',
        message: `${SCHOOL_DOCUMENTS_PER_STUDENT} pièces au plus par dossier.`,
      });
    }
    const id = randomUUID();
    const storageKey = privateKey(
      ctx.organizationId,
      student.schoolId,
      id,
      EXTENSION[mimeType as keyof typeof EXTENSION],
    );
    await this.storage.put(storageKey, file.buffer, mimeType);
    try {
      const document = await this.db.$transaction(async (tx) => {
        const created = await tx.schoolStudentDocument.create({
          data: {
            id,
            organizationId: ctx.organizationId,
            studentId,
            category,
            displayName: safeDisplayName(file.originalname),
            mimeType,
            bytes: file.size,
            sha256: createHash('sha256').update(file.buffer).digest('hex'),
            storageKey,
            createdByUserId: ctx.userId,
          },
          select: VIEW,
        });
        await this.students.event(tx, ctx, studentId, 'DOCUMENT_ADDED', {
          documentId: id,
          category,
        });
        return created;
      });
      await this.school.log(ctx, 'school.document_added', 'SchoolStudentDocument', id, {
        category,
      });
      return document;
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  /** Lien de quelques minutes, délivré après contrôle du périmètre et du droit de l'appelant. */
  async link(ctx: SchoolContext, studentId: string, id: string) {
    await this.students.findStudent(ctx, studentId);
    const document = await this.find(ctx, studentId, id);
    const expires = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
    const token = signFileToken(
      { f: document.id, o: ctx.organizationId, u: ctx.userId, e: expires },
      this.config.storageSigningKey,
    );
    return {
      url: `/api/v1/school/files/${token}`,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  /** Téléchargement par lien signé : relit le document en base, un document supprimé est refusé. */
  async download(token: string, meta: RequestMeta) {
    const gone = new NotFoundException({
      code: 'FILE_NOT_FOUND',
      message: 'Lien expiré ou fichier introuvable.',
    });
    if (!this.config.school.enabled) throw gone;
    const claims = verifyFileToken(token, this.config.storageSigningKey);
    if (!claims) throw gone;
    const document = await this.db.schoolStudentDocument.findFirst({
      where: { id: claims.f, organizationId: claims.o, deletedAt: null },
      select: { id: true, storageKey: true, mimeType: true, displayName: true, category: true },
    });
    const body = document ? await this.storage.get(document.storageKey) : null;
    if (!document || !body) throw gone;
    await this.audit.record({
      organizationId: claims.o,
      actorUserId: claims.u,
      action: 'school.document_downloaded',
      targetType: 'SchoolStudentDocument',
      targetId: document.id,
      metadata: { category: document.category },
      ipAddress: meta.ipAddress,
    });
    return { body, mimeType: document.mimeType, displayName: document.displayName };
  }

  /**
   * Suppression par la direction : la ligne reste pour la trace, le fichier disparaît. Aucune purge
   * automatique tant que les durées légales de conservation ne sont pas fixées par pays.
   */
  async remove(ctx: SchoolContext, studentId: string, id: string) {
    await this.students.findStudent(ctx, studentId);
    const document = await this.find(ctx, studentId, id);
    await this.db.$transaction(async (tx) => {
      await tx.schoolStudentDocument.update({
        where: { id },
        data: { deletedAt: new Date(), deletedByUserId: ctx.userId },
      });
      await this.students.event(tx, ctx, studentId, 'DOCUMENT_DELETED', {
        documentId: id,
        category: document.category,
      });
    });
    // Le document n'est déjà plus accessible ; un fichier restant doit se voir dans les journaux.
    await this.storage.delete(document.storageKey).catch((error: unknown) => {
      this.logger.error(`Fichier de document non supprimé (${id}) : ${String(error)}`);
    });
    await this.school.log(ctx, 'school.document_deleted', 'SchoolStudentDocument', id, {
      category: document.category,
    });
  }

  private async find(ctx: SchoolContext, studentId: string, id: string) {
    const document = await this.db.schoolStudentDocument.findFirst({
      where: { id, organizationId: ctx.organizationId, studentId, deletedAt: null },
      select: { id: true, storageKey: true, category: true },
    });
    if (!document) throw new NotFoundException(NOT_FOUND);
    return document;
  }
}

/** Nom affiché seulement : jamais utilisé comme chemin de stockage. */
function safeDisplayName(name: string): string {
  const base = (name.split(/[/\\]/).pop() ?? '').replace(/[\p{Cc}"]/gu, '').trim();
  return (base || 'document').slice(0, 120);
}
