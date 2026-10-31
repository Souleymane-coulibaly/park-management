import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import {
  SUPPORT_ATTACHMENTS_PER_MESSAGE,
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_ATTACHMENT_RETENTION_DAYS,
  type SupportTicketCategory,
  type SupportTicketPriority,
  type SupportTicketStatus,
  detectImportMimeType,
  formatSupportNumber,
  hasOrganizationWideScope,
  safeDisplayName,
  statusAfterMessage,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext, TenantContext } from '../../common/auth-context';
import { parkSubscriptionWhere } from '../../common/park-subscription';
import { nextPlatformSequence } from '../../common/platform-counter';
import { StorageService } from '../../common/storage/storage.service';
import { establishmentScope } from '../../common/tenant-scope';
import { PrismaService } from '../../prisma/prisma.service';
import type { UploadedFileInMemory } from '../ai/uploaded-file';

type Tx = Prisma.TransactionClient;

const attachmentBytes = (files: UploadedFileInMemory[]) => files.reduce((s, f) => s + f.size, 0);

const TICKET_SELECT = {
  id: true,
  number: true,
  organizationId: true,
  subject: true,
  category: true,
  priority: true,
  status: true,
  lastMessageAt: true,
  resolvedAt: true,
  createdAt: true,
  establishment: { select: { id: true, name: true } },
  product: { select: { code: true, name: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.SupportTicketSelect;

const MESSAGE_SELECT = {
  id: true,
  fromOcall: true,
  internal: true,
  body: true,
  createdAt: true,
  author: { select: { firstName: true, lastName: true } },
  attachments: {
    where: { deletedAt: null },
    select: { id: true, organizationId: true, displayName: true, mimeType: true, bytes: true },
  },
} satisfies Prisma.SupportMessageSelect;

/**
 * Support Ocall (Sprint 11B). Les clients créent et suivent leurs demandes ; l'équipe Ocall répond,
 * attribue, change le statut, ajoute des notes internes (jamais visibles du client). Pièces
 * jointes PRIVÉES (images, PDF), servies par lien temporaire signé après contrôle d'accès.
 * Isolation : un client ne voit que les demandes de son organisation (et, hors propriétaire /
 * administrateur, seulement les siennes). Aucun envoi d'e-mail : suivi dans l'application.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  // ─── Pièces jointes ───

  private validateAttachments(files: UploadedFileInMemory[]) {
    if (files.length > SUPPORT_ATTACHMENTS_PER_MESSAGE) {
      throw new BadRequestException({
        code: 'ATTACHMENT_LIMIT',
        message: `${SUPPORT_ATTACHMENTS_PER_MESSAGE} pièces jointes au plus par message.`,
      });
    }
    return files.map((f) => {
      if (f.size > SUPPORT_ATTACHMENT_MAX_BYTES) {
        throw new PayloadTooLargeException({
          code: 'ATTACHMENT_TOO_LARGE',
          message: 'Pièce jointe trop lourde (5 Mo au plus).',
        });
      }
      const mimeType = detectImportMimeType(new Uint8Array(f.buffer));
      if (!mimeType) {
        throw new BadRequestException({
          code: 'ATTACHMENT_TYPE_REFUSED',
          message: 'Format refusé : JPEG, PNG, WebP ou PDF uniquement.',
        });
      }
      return { file: f, mimeType };
    });
  }

  private async storeAttachments(
    ticket: { organizationId: string; establishmentId: string | null },
    messageId: string,
    userId: string,
    files: ReturnType<SupportService['validateAttachments']>,
  ) {
    for (const { file, mimeType } of files) {
      await this.storage.storePrivate({
        organizationId: ticket.organizationId,
        establishmentId: ticket.establishmentId,
        kind: 'SUPPORT_ATTACHMENT',
        body: file.buffer,
        mimeType,
        displayName: safeDisplayName(file.originalname),
        createdById: userId,
        retentionDays: SUPPORT_ATTACHMENT_RETENTION_DAYS,
        link: async (tx: Tx, fileId: string) => {
          await tx.storedFile.update({
            where: { id: fileId },
            data: { supportMessageId: messageId },
          });
        },
      });
    }
  }

  /** Fil de messages avec liens temporaires (internes masqués pour le client). */
  private async thread(ticketId: string, viewerId: string, includeInternal: boolean) {
    const messages = await this.prisma.supportMessage.findMany({
      where: { ticketId, ...(includeInternal ? {} : { internal: false }) },
      select: MESSAGE_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return messages.map((m) => ({
      id: m.id,
      fromOcall: m.fromOcall,
      internal: m.internal,
      body: m.body,
      createdAt: m.createdAt,
      author: `${m.author.firstName} ${m.author.lastName}`,
      attachments: m.attachments.map((a) => ({
        id: a.id,
        name: a.displayName,
        mimeType: a.mimeType,
        bytes: a.bytes,
        ...this.storage.temporaryUrl(a, viewerId),
      })),
    }));
  }

  // ─── Côté client ───

  private clientWhere(auth: TenantContext): Prisma.SupportTicketWhereInput {
    return {
      organizationId: auth.membership.organizationId,
      ...(hasOrganizationWideScope(auth.membership.role) ? {} : { createdById: auth.user.id }),
    };
  }

  async listForClient(auth: TenantContext) {
    return this.prisma.supportTicket.findMany({
      where: this.clientWhere(auth),
      select: TICKET_SELECT,
      orderBy: { lastMessageAt: 'desc' },
      take: 200,
    });
  }

  private async clientTicket(auth: TenantContext, id: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, ...this.clientWhere(auth) },
      select: { ...TICKET_SELECT, establishmentId: true },
    });
    // Demande d'une autre organisation : introuvable (aucune information divulguée).
    if (!ticket)
      throw new NotFoundException({ code: 'TICKET_NOT_FOUND', message: 'Demande introuvable.' });
    return ticket;
  }

  async getForClient(auth: TenantContext, id: string) {
    const ticket = await this.clientTicket(auth, id);
    return { ...ticket, messages: await this.thread(id, auth.user.id, false) };
  }

  async create(
    auth: TenantContext,
    dto: {
      subject: string;
      category: SupportTicketCategory;
      priority?: SupportTicketPriority;
      establishmentId?: string;
      body: string;
    },
    files: UploadedFileInMemory[],
  ) {
    const attachments = this.validateAttachments(files);
    const organizationId = auth.membership.organizationId;
    await this.storage.assertRoom(organizationId, attachmentBytes(files));
    if (dto.establishmentId) {
      const visible = await this.prisma.establishment.findFirst({
        where: { id: dto.establishmentId, ...establishmentScope(auth) },
        select: { id: true },
      });
      if (!visible) {
        throw new NotFoundException({
          code: 'ESTABLISHMENT_NOT_FOUND',
          message: 'Établissement introuvable.',
        });
      }
    }
    const park = await this.prisma.subscription.findFirst({
      where: parkSubscriptionWhere(organizationId),
      select: { productId: true },
    });
    const { ticket, messageId } = await this.prisma.$transaction(async (tx) => {
      const { year, sequence } = await nextPlatformSequence(tx, 'support');
      const t = await tx.supportTicket.create({
        data: {
          number: formatSupportNumber(year, sequence),
          organizationId,
          establishmentId: dto.establishmentId ?? null,
          productId: park?.productId ?? null,
          subject: dto.subject,
          category: dto.category,
          priority: dto.priority ?? 'NORMAL',
          createdById: auth.user.id,
        },
        select: { id: true, number: true, organizationId: true, establishmentId: true },
      });
      const m = await tx.supportMessage.create({
        data: { ticketId: t.id, authorId: auth.user.id, fromOcall: false, body: dto.body },
        select: { id: true },
      });
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'support.ticket_created',
          targetType: 'SupportTicket',
          targetId: t.id,
          metadata: {
            number: t.number,
            category: dto.category,
            priority: dto.priority ?? 'NORMAL',
          },
        },
        tx,
      );
      return { ticket: t, messageId: m.id };
    });
    await this.storeAttachments(ticket, messageId, auth.user.id, attachments);
    return this.getForClient(auth, ticket.id);
  }

  async replyAsClient(
    auth: TenantContext,
    id: string,
    body: string,
    files: UploadedFileInMemory[],
  ) {
    const attachments = this.validateAttachments(files);
    const ticket = await this.clientTicket(auth, id);
    await this.storage.assertRoom(ticket.organizationId, attachmentBytes(files));
    if (ticket.status === 'CLOSED') {
      throw new ConflictException({
        code: 'TICKET_CLOSED',
        message: 'Demande fermée : créez une nouvelle demande.',
      });
    }
    const messageId = await this.prisma.$transaction(async (tx) => {
      const m = await tx.supportMessage.create({
        data: { ticketId: id, authorId: auth.user.id, fromOcall: false, body },
        select: { id: true },
      });
      await tx.supportTicket.update({
        where: { id },
        data: {
          lastMessageAt: new Date(),
          status: statusAfterMessage(ticket.status, 'customer'),
          resolvedAt: null,
        },
      });
      return m.id;
    });
    await this.storeAttachments(ticket, messageId, auth.user.id, attachments);
    return this.getForClient(auth, id);
  }

  // ─── Côté Ocall ───

  async listForOcall(filters: {
    status?: SupportTicketStatus;
    organizationId?: string;
    product?: string;
    assignedToMe?: boolean;
    userId: string;
  }) {
    return this.prisma.supportTicket.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
        ...(filters.product ? { product: { code: filters.product } } : {}),
        ...(filters.assignedToMe ? { assignedToId: filters.userId } : {}),
      },
      select: { ...TICKET_SELECT, organization: { select: { id: true, name: true } } },
      orderBy: [{ lastMessageAt: 'desc' }],
      take: 300,
    });
  }

  private async ocallTicket(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: {
        ...TICKET_SELECT,
        establishmentId: true,
        organization: { select: { id: true, name: true } },
      },
    });
    if (!ticket)
      throw new NotFoundException({ code: 'TICKET_NOT_FOUND', message: 'Demande introuvable.' });
    return ticket;
  }

  async getForOcall(auth: AuthContext, id: string) {
    const ticket = await this.ocallTicket(id);
    return { ...ticket, messages: await this.thread(id, auth.user.id, true) };
  }

  async replyAsOcall(
    auth: AuthContext,
    id: string,
    dto: { body: string; internal?: boolean; status?: SupportTicketStatus },
    files: UploadedFileInMemory[],
  ) {
    const attachments = this.validateAttachments(files);
    const ticket = await this.ocallTicket(id);
    await this.storage.assertRoom(ticket.organizationId, attachmentBytes(files));
    const internal = dto.internal === true;
    const messageId = await this.prisma.$transaction(async (tx) => {
      const m = await tx.supportMessage.create({
        data: { ticketId: id, authorId: auth.user.id, fromOcall: true, internal, body: dto.body },
        select: { id: true },
      });
      const status =
        dto.status ?? (internal ? ticket.status : statusAfterMessage(ticket.status, 'ocall'));
      await tx.supportTicket.update({
        where: { id },
        data: {
          ...(internal ? {} : { lastMessageAt: new Date() }),
          status,
          resolvedAt: status === 'RESOLVED' ? new Date() : null,
          assignedToId: ticket.assignedTo?.id ?? auth.user.id,
        },
      });
      await this.audit.record(
        {
          organizationId: ticket.organizationId,
          actorUserId: auth.user.id,
          action: internal ? 'platform.support_note_added' : 'platform.support_replied',
          targetType: 'SupportTicket',
          targetId: id,
          metadata: { number: ticket.number, status },
        },
        tx,
      );
      return m.id;
    });
    await this.storeAttachments(ticket, messageId, auth.user.id, attachments);
    return this.getForOcall(auth, id);
  }

  async updateForOcall(
    auth: AuthContext,
    id: string,
    dto: {
      status?: SupportTicketStatus;
      priority?: SupportTicketPriority;
      assignedToId?: string | null;
    },
  ) {
    const ticket = await this.ocallTicket(id);
    if (dto.assignedToId) {
      const agent = await this.prisma.user.findFirst({
        where: { id: dto.assignedToId, platformRole: { not: null }, isActive: true },
        select: { id: true },
      });
      if (!agent)
        throw new BadRequestException({
          code: 'ASSIGNEE_INVALID',
          message: 'Compte interne introuvable.',
        });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.supportTicket.update({
        where: { id },
        data: {
          ...(dto.status
            ? { status: dto.status, resolvedAt: dto.status === 'RESOLVED' ? new Date() : null }
            : {}),
          ...(dto.priority ? { priority: dto.priority } : {}),
          ...(dto.assignedToId !== undefined ? { assignedToId: dto.assignedToId } : {}),
        },
      });
      await this.audit.record(
        {
          organizationId: ticket.organizationId,
          actorUserId: auth.user.id,
          action: 'platform.support_updated',
          targetType: 'SupportTicket',
          targetId: id,
          metadata: {
            number: ticket.number,
            before: {
              status: ticket.status,
              priority: ticket.priority,
              assignedTo: ticket.assignedTo?.id ?? null,
            },
            after: dto,
          },
        },
        tx,
      );
    });
    return this.getForOcall(auth, id);
  }

  /** Comptes internes pouvant recevoir une demande (affectation). */
  async agents() {
    return this.prisma.user.findMany({
      where: {
        platformRole: { in: ['SUPER_ADMIN', 'PLATFORM_OWNER', 'PLATFORM_ADMIN', 'SUPPORT_AGENT'] },
        isActive: true,
      },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: 'asc' },
    });
  }
}
