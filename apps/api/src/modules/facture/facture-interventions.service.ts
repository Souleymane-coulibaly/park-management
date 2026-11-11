import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/facture-database';
import {
  FACTURE_INTERVENTION_STATUS_LABELS,
  FACTURE_MAX_INTERVENTION_PHOTOS,
  FACTURE_MAX_INTERVENTION_SPAN_MS,
  FACTURE_MAX_LINES,
  type FactureInterventionStatus,
  canMoveFactureIntervention,
  canWorkOnFactureIntervention,
  factureHoursOf,
  factureInterventionScope,
  formatFactureInterventionNumber,
  formatFactureMinutes,
  hasFacturePermission,
  isFactureInterventionPlanningOpen,
  maskPhone,
  isFactureInterventionWorkOpen,
} from '@ocall/shared';
import sharp from 'sharp';
import { AuditService } from '../../common/audit/audit.service';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
  privateKey,
} from '../../common/storage/storage-provider';
import type { FactureContext } from './facture-access';
import type { FactureLineDto } from './facture-commercial.dto';
import { FactureDocumentsService, todayUtc } from './facture-documents.service';
import {
  type FactureInterventionReport,
  renderFactureInterventionReport,
} from './facture-intervention-pdf';
import {
  applyFactureMaintenanceProposal,
  applyFactureReportProposal,
} from './facture-ai-proposals';
import { FactureSkillsService } from './facture-skills.service';
import { FactureNotificationsService } from './facture-notifications.service';
import { loadFactureLogos } from './facture-pdf';
import { FacturePrismaService } from './facture-prisma.service';
import type {
  CompleteFactureInterventionDto,
  CreateFactureInterventionDto,
  FactureEquipmentDto,
  FactureEquipmentQueryDto,
  FactureInterventionQueryDto,
  FacturePartUsageDto,
  FactureTimeEntryDto,
  InvoiceFactureInterventionDto,
  UpdateFactureEquipmentDto,
  UpdateFactureInterventionDto,
} from './facture-interventions.dto';
import type { FactureUpload } from './facture.service';

type Tx = Prisma.TransactionClient;

const NOT_FOUND = { code: 'FACTURE_INTERVENTION_NOT_FOUND', message: 'Intervention introuvable.' };
const EQUIPMENT_NOT_FOUND = {
  code: 'FACTURE_EQUIPMENT_NOT_FOUND',
  message: 'Équipement introuvable.',
};
const LIST_LIMIT = 300;
const DAY = 86_400_000;

/** Photo : 8 Mo au plus à l'envoi (appareil d'un téléphone) ; réencodée en JPEG, 1 600 px au plus. */
export const FACTURE_PHOTO_MAX_BYTES = 8_000_000;
/** Signature dessinée sur l'écran : PNG de 300 Ko au plus. */
export const FACTURE_SIGNATURE_MAX_BYTES = 300_000;
const PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const conflict = (code: string, message: string) => new ConflictException({ code, message });

const INCLUDE = {
  client: { select: { id: true, name: true, phone: true, address: true, city: true } },
  equipment: {
    select: { id: true, name: true, brand: true, model: true, serialNumber: true, location: true },
  },
  technicians: {
    select: {
      memberId: true,
      member: { select: { firstName: true, lastName: true, role: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
  timeEntries: {
    include: { member: { select: { firstName: true, lastName: true } } },
    orderBy: [{ workDate: 'asc' }, { createdAt: 'asc' }],
  },
  parts: { orderBy: { createdAt: 'asc' } },
  photos: {
    select: { id: true, caption: true, storageKey: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  },
  invoice: { select: { id: true, number: true, status: true } },
  requiredSkills: { select: { skill: { select: { id: true, name: true } } } },
  notifications: {
    select: {
      id: true,
      kind: true,
      channel: true,
      recipient: true,
      status: true,
      sendAt: true,
      sentAt: true,
      attempts: true,
      lastError: true,
      createdAt: true,
    },
    orderBy: [{ sendAt: 'asc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.FactureInterventionInclude;

type InterventionRow = Prisma.FactureInterventionGetPayload<{ include: typeof INCLUDE }>;

const fullName = (m: { firstName: string; lastName: string }) =>
  `${m.firstName} ${m.lastName}`.trim();

/**
 * Ocall Facture — interventions (F3) : parc d'équipements des clients, planning et techniciens, travaux
 * (temps, pièces du catalogue, photos), rapport, signature du client sur mobile, facturation.
 *
 * Un technicien ne voit et ne réalise que les interventions où il est affecté. Une fois les travaux
 * terminés, plus rien ne change ; une fois le rapport signé, l'empreinte SHA-256 de son contenu est
 * conservée. Toutes les écritures d'une intervention se font sous verrou de sa ligne ; la base tient
 * aussi les transitions et le gel (déclencheurs de la migration `facture_v1_interventions`).
 */
@Injectable()
export class FactureInterventionsService {
  constructor(
    private readonly db: FacturePrismaService,
    private readonly audit: AuditService,
    private readonly documents: FactureDocumentsService,
    private readonly notifications: FactureNotificationsService,
    private readonly skills: FactureSkillsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  // ─── Équipements ───

  listEquipment(ctx: FactureContext, query: FactureEquipmentQueryDto) {
    return this.db.factureEquipment.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.archived ? {} : { isArchived: false }),
      },
      include: { client: { select: { id: true, name: true } } },
      orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
      take: LIST_LIMIT,
    });
  }

  async createEquipment(ctx: FactureContext, dto: FactureEquipmentDto) {
    await this.assertClient(this.db, ctx.organizationId, dto.clientId);
    const equipment = await this.db.factureEquipment.create({
      data: {
        organizationId: ctx.organizationId,
        ...dto,
        installedAt: dto.installedAt ? new Date(dto.installedAt) : null,
      },
    });
    await this.record(ctx, 'facture.equipment_created', 'FactureEquipment', equipment.id);
    return equipment;
  }

  async updateEquipment(ctx: FactureContext, id: string, dto: UpdateFactureEquipmentDto) {
    const where = { organizationId_id: { organizationId: ctx.organizationId, id } };
    if (!(await this.db.factureEquipment.findUnique({ where, select: { id: true } }))) {
      throw new NotFoundException(EQUIPMENT_NOT_FOUND);
    }
    const { installedAt, ...rest } = dto;
    const equipment = await this.db.factureEquipment.update({
      where,
      data: {
        ...rest,
        ...(installedAt !== undefined
          ? { installedAt: installedAt ? new Date(installedAt) : null }
          : {}),
      },
    });
    await this.record(ctx, 'facture.equipment_updated', 'FactureEquipment', id);
    return equipment;
  }

  /** Membres affectables : techniciens et gérants actifs (le propriétaire n'a pas de ligne membre). */
  technicians(ctx: FactureContext) {
    return this.db.factureMember.findMany({
      where: {
        organizationId: ctx.organizationId,
        isActive: true,
        role: { in: ['TECHNICIAN', 'MANAGER'] },
      },
      select: { id: true, firstName: true, lastName: true, role: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  // ─── Planning ───

  async list(ctx: FactureContext, query: FactureInterventionQueryDto) {
    const scope = this.scope(ctx);
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(new Date(query.to).getTime() + DAY) : null;
    const rows = await this.db.factureIntervention.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(from || to
          ? { scheduledStart: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
          : {}),
        ...(scope === 'assigned'
          ? { technicians: { some: { memberId: ctx.memberId! } } }
          : query.memberId
            ? { technicians: { some: { memberId: query.memberId } } }
            : {}),
      },
      select: {
        id: true,
        number: true,
        status: true,
        priority: true,
        title: true,
        siteAddress: true,
        scheduledStart: true,
        scheduledEnd: true,
        client: { select: { id: true, name: true } },
        equipment: { select: { id: true, name: true } },
        technicians: {
          select: { memberId: true, member: { select: { firstName: true, lastName: true } } },
        },
      },
      orderBy: [{ scheduledStart: 'asc' }, { number: 'asc' }],
      take: LIST_LIMIT,
    });
    return rows.map(({ technicians, ...r }) => ({
      ...r,
      technicians: technicians.map((t) => ({ memberId: t.memberId, name: fullName(t.member) })),
    }));
  }

  async get(ctx: FactureContext, id: string) {
    const row = await this.read(this.db, ctx, id);
    return this.view(ctx, row);
  }

  async create(ctx: FactureContext, dto: CreateFactureInterventionDto, now = new Date()) {
    const { start, end } = this.slot(dto.scheduledStart, dto.scheduledEnd);
    const id = await this.db.$transaction(async (tx) => {
      const client = await this.assertClient(tx, ctx.organizationId, dto.clientId);
      if (dto.equipmentId)
        await this.assertEquipment(tx, ctx.organizationId, dto.clientId, dto.equipmentId);
      await this.assertTechnicians(tx, ctx.organizationId, dto.technicianIds);
      await this.skills.assertSkills(tx, ctx.organizationId, dto.requiredSkillIds ?? []);
      const year = now.getUTCFullYear();
      const [counter] = await tx.$queryRaw<{ value: number }[]>`
        INSERT INTO "FactureInterventionCounter" ("organizationId", "year", "value", "updatedAt")
        VALUES (${ctx.organizationId}::uuid, ${year}, 1, now())
        ON CONFLICT ("organizationId", "year")
        DO UPDATE SET "value" = "FactureInterventionCounter"."value" + 1, "updatedAt" = now()
        RETURNING "value"`;
      const sequence = Number(counter!.value);
      const intervention = await tx.factureIntervention.create({
        data: {
          organizationId: ctx.organizationId,
          number: formatFactureInterventionNumber(year, sequence),
          year,
          sequence,
          clientId: dto.clientId,
          equipmentId: dto.equipmentId ?? null,
          title: dto.title,
          description: dto.description ?? null,
          siteAddress:
            dto.siteAddress ?? ([client.address, client.city].filter(Boolean).join(', ') || null),
          contactName: dto.contactName ?? null,
          contactPhone: dto.contactPhone ?? client.phone ?? null,
          scheduledStart: start,
          scheduledEnd: end,
          priority: dto.priority ?? 'NORMAL',
          createdByUserId: ctx.userId,
        },
        select: { id: true },
      });
      if (dto.requiredSkillIds?.length) {
        await tx.factureInterventionSkill.createMany({
          data: dto.requiredSkillIds.map((skillId) => ({
            organizationId: ctx.organizationId,
            interventionId: intervention.id,
            skillId,
          })),
        });
      }
      // Suggestion de maintenance préventive acceptée (F6B) : tracée comme appliquée, même transaction.
      if (dto.aiProposalId) {
        await applyFactureMaintenanceProposal(
          tx,
          ctx,
          dto.aiProposalId,
          { equipmentId: dto.equipmentId ?? null, interventionId: intervention.id },
          now,
        );
      }
      if (dto.technicianIds.length > 0) {
        await tx.factureInterventionTechnician.createMany({
          data: dto.technicianIds.map((memberId) => ({
            organizationId: ctx.organizationId,
            interventionId: intervention.id,
            memberId,
          })),
        });
      }
      await this.notifications.onPlanned(tx, ctx.organizationId, intervention.id, now);
      return intervention.id;
    });
    await this.record(ctx, 'facture.intervention_created', 'FactureIntervention', id);
    return this.get(ctx, id);
  }

  /** Planning : créneau, techniciens, équipement, demande ; avant la fin des travaux. */
  async update(
    ctx: FactureContext,
    id: string,
    dto: UpdateFactureInterventionDto,
    now = new Date(),
  ) {
    await this.db.$transaction((tx) => this.updateInTx(tx, ctx, id, dto, now));
    await this.record(ctx, 'facture.intervention_updated', 'FactureIntervention', id);
    return this.get(ctx, id);
  }

  /**
   * Modification du planning dans la transaction de l'appelant (modification directe, affectation
   * proposée par la planification intelligente) : verrou, contrôles, notifications de report.
   */
  async updateInTx(
    tx: Tx,
    ctx: FactureContext,
    id: string,
    dto: UpdateFactureInterventionDto,
    now: Date,
  ) {
    {
      const row = await this.lock(tx, ctx, id);
      if (!isFactureInterventionPlanningOpen(row.status)) {
        throw conflict(
          'FACTURE_INTERVENTION_CLOSED',
          'Les travaux sont terminés : le planning ne se modifie plus.',
        );
      }
      const start = dto.scheduledStart ?? row.scheduledStart.toISOString();
      const end = dto.scheduledEnd ?? row.scheduledEnd.toISOString();
      const slot = this.slot(start, end);
      if (dto.equipmentId) {
        await this.assertEquipment(tx, ctx.organizationId, row.clientId, dto.equipmentId);
      }
      if (dto.technicianIds) {
        await this.assertTechnicians(tx, ctx.organizationId, dto.technicianIds);
        const next = new Set(dto.technicianIds);
        const removed = row.technicians.map((t) => t.memberId).filter((m) => !next.has(m));
        const added = dto.technicianIds.filter(
          (m) => !row.technicians.some((t) => t.memberId === m),
        );
        // Un technicien qui a déjà saisi du temps reste affecté (son temps compte au rapport).
        if (removed.some((m) => row.timeEntries.some((e) => e.memberId === m))) {
          throw conflict(
            'FACTURE_TECHNICIAN_HAS_TIME',
            'Ce technicien a déjà saisi du temps : supprimez d’abord ses saisies.',
          );
        }
        if (removed.length > 0) {
          await tx.factureInterventionTechnician.deleteMany({
            where: {
              organizationId: ctx.organizationId,
              interventionId: id,
              memberId: { in: removed },
            },
          });
        }
        if (added.length > 0) {
          await tx.factureInterventionTechnician.createMany({
            data: added.map((memberId) => ({
              organizationId: ctx.organizationId,
              interventionId: id,
              memberId,
            })),
          });
        }
      }
      await tx.factureIntervention.update({
        where: { organizationId_id: { organizationId: ctx.organizationId, id } },
        data: {
          scheduledStart: slot.start,
          scheduledEnd: slot.end,
          ...(dto.equipmentId !== undefined ? { equipmentId: dto.equipmentId } : {}),
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.siteAddress !== undefined ? { siteAddress: dto.siteAddress } : {}),
          ...(dto.contactName !== undefined ? { contactName: dto.contactName } : {}),
          ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone } : {}),
          ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        },
      });
      if (dto.requiredSkillIds) {
        await this.skills.assertSkills(tx, ctx.organizationId, dto.requiredSkillIds);
        await tx.factureInterventionSkill.deleteMany({
          where: { organizationId: ctx.organizationId, interventionId: id },
        });
        if (dto.requiredSkillIds.length > 0) {
          await tx.factureInterventionSkill.createMany({
            data: dto.requiredSkillIds.map((skillId) => ({
              organizationId: ctx.organizationId,
              interventionId: id,
              skillId,
            })),
          });
        }
      }
      // Rendez-vous déplacé avant son début : rappels obsolètes annulés, client prévenu du report.
      if (row.status === 'PLANNED' && slot.start.getTime() !== row.scheduledStart.getTime()) {
        await this.notifications.onRescheduled(tx, ctx.organizationId, id, now);
      } else if (
        row.status === 'PLANNED' &&
        ((dto.contactPhone !== undefined && dto.contactPhone !== row.contactPhone) ||
          (dto.contactName !== undefined && dto.contactName !== row.contactName) ||
          (dto.siteAddress !== undefined && dto.siteAddress !== row.siteAddress) ||
          (dto.title !== undefined && dto.title !== row.title))
      ) {
        // Contact, lieu ou objet corrigé : notifications en attente refaites avec les bonnes données.
        await this.notifications.onDetailsChanged(tx, ctx.organizationId, id, now);
      }
    }
  }

  async cancel(ctx: FactureContext, id: string, reason: string, now = new Date()) {
    await this.transition(
      ctx,
      id,
      'CANCELLED',
      { cancelledAt: now, cancelReason: reason },
      'manage',
      undefined,
      (tx) => this.notifications.onCancelled(tx, ctx.organizationId, id, now),
    );
    await this.record(ctx, 'facture.intervention_cancelled', 'FactureIntervention', id);
    return this.get(ctx, id);
  }

  // ─── Travaux ───

  async start(ctx: FactureContext, id: string, now = new Date()) {
    await this.transition(ctx, id, 'IN_PROGRESS', { startedAt: now }, 'work', 'PLANNED', (tx) =>
      this.notifications.onStarted(tx, ctx.organizationId, id),
    );
    await this.record(ctx, 'facture.intervention_started', 'FactureIntervention', id);
    return this.get(ctx, id);
  }

  async addTime(ctx: FactureContext, id: string, dto: FactureTimeEntryDto, now = new Date()) {
    const entryId = await this.db.$transaction(async (tx) => {
      const row = await this.lockForWork(tx, ctx, id);
      const memberId = dto.memberId ?? ctx.memberId;
      if (!memberId) {
        throw new BadRequestException({
          code: 'FACTURE_TECHNICIAN_REQUIRED',
          message: 'Choisissez le technicien.',
        });
      }
      // Un technicien saisit son propre temps ; celui qui planifie, le temps de tout technicien affecté.
      if (!this.canManage(ctx) && memberId !== ctx.memberId) throw this.denied();
      if (!row.technicians.some((t) => t.memberId === memberId)) {
        throw conflict(
          'FACTURE_TECHNICIAN_NOT_ASSIGNED',
          'Ce technicien n’est pas affecté à l’intervention.',
        );
      }
      const workDate = new Date(dto.workDate);
      if (workDate.getTime() > todayUtc(now).getTime()) {
        throw new BadRequestException({
          code: 'FACTURE_TIME_IN_FUTURE',
          message: 'Le temps se saisit au plus tard le jour même.',
        });
      }
      const entry = await tx.factureTimeEntry.create({
        data: {
          organizationId: ctx.organizationId,
          interventionId: id,
          memberId,
          workDate,
          minutes: dto.minutes,
          note: dto.note ?? null,
          createdByUserId: ctx.userId,
        },
        select: { id: true },
      });
      return entry.id;
    });
    await this.record(ctx, 'facture.intervention_time_added', 'FactureIntervention', id, {
      minutes: dto.minutes,
    });
    return { id: entryId };
  }

  async removeTime(ctx: FactureContext, id: string, entryId: string) {
    await this.db.$transaction(async (tx) => {
      const row = await this.lockForWork(tx, ctx, id);
      const entry = row.timeEntries.find((e) => e.id === entryId);
      if (!entry) {
        throw new NotFoundException({
          code: 'FACTURE_TIME_NOT_FOUND',
          message: 'Saisie introuvable.',
        });
      }
      if (!this.canManage(ctx) && entry.memberId !== ctx.memberId) throw this.denied();
      await tx.factureTimeEntry.delete({
        where: { organizationId_id: { organizationId: ctx.organizationId, id: entryId } },
      });
    });
    await this.record(ctx, 'facture.intervention_time_removed', 'FactureIntervention', id);
  }

  async addPart(ctx: FactureContext, id: string, dto: FacturePartUsageDto) {
    const partId = await this.db.$transaction(async (tx) => {
      const row = await this.lockForWork(tx, ctx, id);
      if (row.parts.length >= FACTURE_MAX_LINES - 1) {
        throw conflict('FACTURE_PARTS_LIMIT', 'Trop de pièces sur une seule intervention.');
      }
      const item = await tx.factureItem.findUnique({
        where: { organizationId_id: { organizationId: ctx.organizationId, id: dto.itemId } },
      });
      if (!item || item.isArchived) {
        throw new NotFoundException({
          code: 'FACTURE_ITEM_NOT_FOUND',
          message: 'Article introuvable.',
        });
      }
      const part = await tx.facturePartUsage.create({
        data: {
          organizationId: ctx.organizationId,
          interventionId: id,
          itemId: item.id,
          reference: item.reference,
          label: item.name,
          unit: item.unit,
          quantity: new Prisma.Decimal(dto.quantity),
          unitPrice: item.unitPrice,
          vatRate: item.vatRate,
          createdByUserId: ctx.userId,
        },
        select: { id: true },
      });
      return part.id;
    });
    await this.record(ctx, 'facture.intervention_part_added', 'FactureIntervention', id);
    return { id: partId };
  }

  async removePart(ctx: FactureContext, id: string, partId: string) {
    await this.db.$transaction(async (tx) => {
      const row = await this.lockForWork(tx, ctx, id);
      if (!row.parts.some((p) => p.id === partId)) {
        throw new NotFoundException({
          code: 'FACTURE_PART_NOT_FOUND',
          message: 'Pièce introuvable.',
        });
      }
      await tx.facturePartUsage.delete({
        where: { organizationId_id: { organizationId: ctx.organizationId, id: partId } },
      });
    });
    await this.record(ctx, 'facture.intervention_part_removed', 'FactureIntervention', id);
  }

  /** Photo réencodée (sans métadonnées ni position GPS), stockée en privé ; 12 au plus. */
  async addPhoto(
    ctx: FactureContext,
    id: string,
    file: FactureUpload | undefined,
    caption: string | null,
  ) {
    const jpeg = await normalizePhoto(file);
    const key = privateKey(ctx.organizationId, null, randomUUID(), 'jpg');
    await this.storage.put(key, jpeg, 'image/jpeg');
    let photoId: string;
    try {
      photoId = await this.db.$transaction(async (tx) => {
        const row = await this.lockForWork(tx, ctx, id);
        if (row.photos.length >= FACTURE_MAX_INTERVENTION_PHOTOS) {
          throw conflict(
            'FACTURE_PHOTOS_LIMIT',
            `${FACTURE_MAX_INTERVENTION_PHOTOS} photos au plus par intervention.`,
          );
        }
        const photo = await tx.factureInterventionPhoto.create({
          data: {
            organizationId: ctx.organizationId,
            interventionId: id,
            storageKey: key,
            caption,
            createdByUserId: ctx.userId,
          },
          select: { id: true },
        });
        return photo.id;
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
    await this.record(ctx, 'facture.intervention_photo_added', 'FactureIntervention', id);
    return { id: photoId };
  }

  async photo(ctx: FactureContext, id: string, photoId: string): Promise<Buffer> {
    const row = await this.read(this.db, ctx, id);
    const photo = row.photos.find((p) => p.id === photoId);
    const body = photo ? await this.storage.get(photo.storageKey) : null;
    if (!body) {
      throw new NotFoundException({
        code: 'FACTURE_PHOTO_NOT_FOUND',
        message: 'Photo introuvable.',
      });
    }
    return body;
  }

  async removePhoto(ctx: FactureContext, id: string, photoId: string) {
    const key = await this.db.$transaction(async (tx) => {
      const row = await this.lockForWork(tx, ctx, id);
      const photo = row.photos.find((p) => p.id === photoId);
      if (!photo) {
        throw new NotFoundException({
          code: 'FACTURE_PHOTO_NOT_FOUND',
          message: 'Photo introuvable.',
        });
      }
      await tx.factureInterventionPhoto.delete({
        where: { organizationId_id: { organizationId: ctx.organizationId, id: photoId } },
      });
      return photo.storageKey;
    });
    await this.storage.delete(key).catch(() => undefined);
    await this.record(ctx, 'facture.intervention_photo_removed', 'FactureIntervention', id);
  }

  /** Fin des travaux : rapport rédigé ; temps, pièces et photos figés. */
  async complete(
    ctx: FactureContext,
    id: string,
    dto: CompleteFactureInterventionDto,
    now = new Date(),
  ) {
    await this.transition(
      ctx,
      id,
      'COMPLETED',
      {
        completedAt: now,
        completedByUserId: ctx.userId,
        workSummary: dto.workSummary,
        recommendations: dto.recommendations ?? null,
      },
      'work',
      undefined,
      // Rapport proposé par l'IA (F6A) : appliqué seulement ici, après relecture du technicien.
      dto.aiProposalId
        ? (tx) =>
            applyFactureReportProposal(
              tx,
              ctx,
              dto.aiProposalId!,
              id,
              { workSummary: dto.workSummary, recommendations: dto.recommendations ?? null },
              now,
            )
        : undefined,
    );
    await this.record(ctx, 'facture.intervention_completed', 'FactureIntervention', id);
    return this.get(ctx, id);
  }

  /** Réouverture d'une intervention réalisée, tant que le client n'a pas signé. */
  async reopen(ctx: FactureContext, id: string) {
    await this.transition(
      ctx,
      id,
      'IN_PROGRESS',
      { completedAt: null, completedByUserId: null },
      'manage',
      'COMPLETED',
    );
    await this.record(ctx, 'facture.intervention_reopened', 'FactureIntervention', id);
    return this.get(ctx, id);
  }

  /**
   * Signature du client sur l'écran du technicien : image vérifiée (jamais vide), nom du signataire, date ;
   * l'empreinte SHA-256 du rapport signé (contenu complet, image de la signature comprise) est conservée.
   */
  async sign(
    ctx: FactureContext,
    id: string,
    signerName: string,
    file: FactureUpload | undefined,
    now = new Date(),
  ) {
    const png = await normalizeSignature(file);
    const key = privateKey(ctx.organizationId, null, randomUUID(), 'png');
    await this.storage.put(key, png, 'image/png');
    try {
      await this.db.$transaction(async (tx) => {
        const row = await this.lockFor(tx, ctx, id, 'work');
        if (!canMoveFactureIntervention(row.status, 'SIGNED')) {
          throw this.badTransition(row.status, 'SIGNED');
        }
        // Données imprimées figées avec la signature : le rapport signé ne change plus.
        const reportSnapshot = snapshotOf(row);
        const reportHash = hashReport(row, reportSnapshot, signerName, now, png);
        await tx.factureIntervention.update({
          where: { organizationId_id: { organizationId: ctx.organizationId, id } },
          data: {
            status: 'SIGNED',
            signerName,
            signedAt: now,
            signatureKey: key,
            reportHash,
            reportSnapshot: reportSnapshot as unknown as Prisma.InputJsonValue,
          },
        });
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
    await this.record(ctx, 'facture.intervention_signed', 'FactureIntervention', id);
    return this.get(ctx, id);
  }

  async signature(ctx: FactureContext, id: string): Promise<Buffer> {
    const row = await this.read(this.db, ctx, id);
    const body = row.signatureKey ? await this.storage.get(row.signatureKey) : null;
    if (!body) {
      throw new NotFoundException({
        code: 'FACTURE_SIGNATURE_NOT_FOUND',
        message: 'Aucune signature.',
      });
    }
    return body;
  }

  /** Rapport d'intervention PDF (charte Facture) : travaux, temps, pièces, photos, signature. */
  async report(ctx: FactureContext, id: string): Promise<{ body: Buffer; filename: string }> {
    const row = await this.read(this.db, ctx, id);
    const printed = this.printedData(row);
    const settings = await this.db.factureSettings.findUnique({
      where: { organizationId: ctx.organizationId },
    });
    if (!settings) {
      throw conflict('SETTINGS_REQUIRED', 'Enregistrez d’abord l’identité de l’entreprise.');
    }
    const read = (key: string) => this.storage.get(key).catch(() => null);
    const [photos, signature, logos] = await Promise.all([
      Promise.all(
        row.photos.map(async (p) => ({ caption: p.caption, image: await read(p.storageKey) })),
      ),
      row.signatureKey ? read(row.signatureKey) : null,
      loadFactureLogos(this.db, this.storage, ctx.organizationId),
    ]);
    const report: FactureInterventionReport = {
      number: row.number,
      statusLabel: FACTURE_INTERVENTION_STATUS_LABELS[row.status],
      title: row.title,
      description: row.description,
      ...printed,
      scheduledStart: row.scheduledStart,
      scheduledEnd: row.scheduledEnd,
      startedAt: row.startedAt,
      completedAt: row.completedAt,

      time: row.timeEntries.map((e) => ({
        date: e.workDate,
        technician: fullName(e.member),
        minutes: e.minutes,
        note: e.note,
      })),
      parts: row.parts.map((p) => ({
        reference: p.reference,
        label: p.label,
        unit: p.unit,
        quantity: Number(p.quantity.toString()),
      })),
      workSummary: row.workSummary,
      recommendations: row.recommendations,
      photos: photos.filter((p): p is { caption: string | null; image: Buffer } =>
        Boolean(p.image),
      ),
      signature:
        row.signedAt && row.signerName && row.reportHash
          ? { name: row.signerName, at: row.signedAt, image: signature, hash: row.reportHash }
          : null,
    };
    const body = await renderFactureInterventionReport(settings, report, logos);
    return { body, filename: `rapport-${row.number}.pdf` };
  }

  /**
   * Données imprimées d'un rapport : celles figées à la signature pour un rapport signé (jamais modifiées
   * ensuite, même si la fiche du client ou de l'équipement change), les données actuelles sinon.
   */
  printedData(row: InterventionRow): ReportSnapshot {
    return (row.reportSnapshot as unknown as ReportSnapshot | null) ?? snapshotOf(row);
  }

  // ─── Facturation ───

  /**
   * Facture brouillon d'une intervention signée : temps passé (prestation horaire choisie) et pièces
   * posées, aux prix copiés. Une seule facture par intervention : un second appel renvoie la même.
   */
  async invoice(ctx: FactureContext, id: string, dto: InvoiceFactureInterventionDto) {
    const result = await this.db.$transaction(async (tx) => {
      const row = await this.lock(tx, ctx, id);
      if (row.invoiceId) return { invoiceId: row.invoiceId, created: false };
      if (!canMoveFactureIntervention(row.status, 'INVOICED')) {
        throw conflict(
          'FACTURE_INTERVENTION_NOT_SIGNED',
          'Seule une intervention signée par le client se facture.',
        );
      }
      const lines: FactureLineDto[] = [];
      const minutes = row.timeEntries.reduce((sum, e) => sum + e.minutes, 0);
      if (dto.laborItemId) {
        const labor = await tx.factureItem.findUnique({
          where: { organizationId_id: { organizationId: ctx.organizationId, id: dto.laborItemId } },
        });
        if (!labor || labor.isArchived) {
          throw new NotFoundException({
            code: 'FACTURE_ITEM_NOT_FOUND',
            message: 'Prestation introuvable.',
          });
        }
        if (minutes > 0) {
          lines.push({
            itemId: labor.id,
            reference: labor.reference,
            label: labor.name,
            description: `Main-d’œuvre : ${formatFactureMinutes(minutes)} (intervention ${row.number})`,
            unit: 'heure',
            quantity: factureHoursOf(minutes),
            unitPrice: labor.unitPrice,
            vatRate: labor.vatRate,
          });
        }
      }
      for (const part of row.parts) {
        lines.push({
          itemId: part.itemId,
          reference: part.reference,
          label: part.label,
          unit: part.unit,
          quantity: Number(part.quantity.toString()),
          unitPrice: part.unitPrice,
          vatRate: part.vatRate,
        });
      }
      const invoiceId = await this.documents.createDraft(tx, ctx, {
        type: 'INVOICE',
        clientId: row.clientId,
        subject: `Intervention ${row.number} — ${row.title}`.slice(0, 200),
        lines,
      });
      await tx.factureIntervention.update({
        where: { organizationId_id: { organizationId: ctx.organizationId, id } },
        data: { status: 'INVOICED', invoiceId },
      });
      return { invoiceId, created: true };
    });
    if (result.created) {
      await this.record(ctx, 'facture.intervention_invoiced', 'FactureIntervention', id);
      await this.documents.record(ctx, 'facture.document_created', result.invoiceId, {
        type: 'INVOICE',
        intervention: id,
      });
    }
    return result;
  }

  // ─── Outils ───

  private scope(ctx: FactureContext) {
    const scope = factureInterventionScope(ctx.role);
    // Le propriétaire n'a pas de ligne membre : il a toujours la portée complète (gérant d'office).
    if (scope === 'none' || (scope === 'assigned' && !ctx.memberId)) throw this.denied();
    return scope;
  }

  private canManage(ctx: FactureContext) {
    return hasFacturePermission(ctx.role, 'facture.interventions.manage');
  }

  /** Lecture d'une intervention visible de l'utilisateur ; une intervention hors portée n'existe pas. */
  private async read(db: Tx | FacturePrismaService, ctx: FactureContext, id: string) {
    const scope = this.scope(ctx);
    const row = await db.factureIntervention.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    if (scope === 'assigned' && !row.technicians.some((t) => t.memberId === ctx.memberId)) {
      throw new NotFoundException(NOT_FOUND);
    }
    return row;
  }

  /** Verrouille l'intervention (jusqu'à la fin de la transaction) puis la lit. */
  private async lock(tx: Tx, ctx: FactureContext, id: string): Promise<InterventionRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "FactureIntervention"
      WHERE "organizationId" = ${ctx.organizationId}::uuid AND "id" = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundException(NOT_FOUND);
    return this.read(tx, ctx, id);
  }

  /** Verrou et droit : `work` exige d'être affecté (technicien) ou de planifier (gérant). */
  private async lockFor(tx: Tx, ctx: FactureContext, id: string, mode: 'work' | 'manage') {
    const row = await this.lock(tx, ctx, id);
    const assigned = row.technicians.some((t) => t.memberId === ctx.memberId);
    const allowed =
      mode === 'work' ? canWorkOnFactureIntervention(ctx.role, assigned) : this.canManage(ctx);
    if (!allowed) throw this.denied();
    return row;
  }

  /** Saisie des travaux (temps, pièces, photos) : intervention en cours seulement. */
  private async lockForWork(tx: Tx, ctx: FactureContext, id: string) {
    const row = await this.lockFor(tx, ctx, id, 'work');
    if (!isFactureInterventionWorkOpen(row.status)) {
      throw conflict(
        'FACTURE_INTERVENTION_NOT_IN_PROGRESS',
        row.status === 'PLANNED'
          ? 'Démarrez d’abord l’intervention.'
          : 'Les travaux sont terminés : temps, pièces et photos sont figés.',
      );
    }
    return row;
  }

  private async transition(
    ctx: FactureContext,
    id: string,
    to: FactureInterventionStatus,
    data: Prisma.FactureInterventionUpdateInput,
    mode: 'work' | 'manage' = 'manage',
    /** Statut de départ exigé (démarrage ≠ réouverture, toutes deux vers « en cours »). */
    from?: FactureInterventionStatus,
    /** Suite dans la même transaction (notifications de rendez-vous). */
    after?: (tx: Tx) => Promise<unknown>,
  ) {
    await this.db.$transaction(async (tx) => {
      const row = await this.lockFor(tx, ctx, id, mode);
      if (!canMoveFactureIntervention(row.status, to) || (from && row.status !== from)) {
        throw this.badTransition(row.status, to);
      }
      await tx.factureIntervention.update({
        where: { organizationId_id: { organizationId: ctx.organizationId, id } },
        data: { ...data, status: to },
      });
      if (after) await after(tx);
    });
  }

  private badTransition(from: FactureInterventionStatus, to: FactureInterventionStatus) {
    const messages: Partial<Record<FactureInterventionStatus, string>> = {
      IN_PROGRESS:
        from === 'IN_PROGRESS'
          ? 'Cette intervention est déjà en cours.'
          : 'Seule une intervention planifiée se démarre, et une intervention réalisée non signée se rouvre.',
      COMPLETED: 'Seule une intervention en cours se termine.',
      SIGNED: 'Le client signe une intervention réalisée, une seule fois.',
      CANCELLED: 'Seule une intervention planifiée ou en cours s’annule.',
    };
    return conflict(
      'FACTURE_INTERVENTION_STATUS',
      messages[to] || 'Action impossible dans l’état actuel de l’intervention.',
    );
  }

  private slot(startIso: string, endIso: string) {
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end.getTime() <= start.getTime() ||
      end.getTime() - start.getTime() > FACTURE_MAX_INTERVENTION_SPAN_MS
    ) {
      throw new BadRequestException({
        code: 'FACTURE_INTERVENTION_SLOT',
        message: 'Créneau invalide : la fin suit le début, 31 jours au plus.',
      });
    }
    return { start, end };
  }

  private async assertClient(db: Tx | FacturePrismaService, organizationId: string, id: string) {
    const client = await db.factureClient.findUnique({
      where: { organizationId_id: { organizationId, id } },
      select: { isArchived: true, address: true, city: true, phone: true },
    });
    if (!client) {
      throw new NotFoundException({
        code: 'FACTURE_CLIENT_NOT_FOUND',
        message: 'Client introuvable.',
      });
    }
    if (client.isArchived) {
      throw conflict('FACTURE_CLIENT_ARCHIVED', 'Ce client est archivé : réactivez-le d’abord.');
    }
    return client;
  }

  private async assertEquipment(tx: Tx, organizationId: string, clientId: string, id: string) {
    const equipment = await tx.factureEquipment.findUnique({
      where: { organizationId_id: { organizationId, id } },
      select: { clientId: true, isArchived: true },
    });
    if (!equipment || equipment.clientId !== clientId || equipment.isArchived) {
      throw new NotFoundException({
        code: 'FACTURE_EQUIPMENT_NOT_FOUND',
        message: 'Équipement introuvable chez ce client.',
      });
    }
  }

  private async assertTechnicians(tx: Tx, organizationId: string, ids: string[]) {
    if (ids.length === 0) return;
    const found = await tx.factureMember.count({
      where: {
        organizationId,
        id: { in: ids },
        isActive: true,
        role: { in: ['TECHNICIAN', 'MANAGER'] },
      },
    });
    if (found !== new Set(ids).size) {
      throw new BadRequestException({
        code: 'FACTURE_TECHNICIAN_INVALID',
        message: 'Affectez des techniciens ou gérants actifs de l’équipe.',
      });
    }
  }

  private view(ctx: FactureContext, row: InterventionRow) {
    const assigned = row.technicians.some((t) => t.memberId === ctx.memberId);
    const {
      signatureKey,
      reportSnapshot: _snapshot,
      photos,
      timeEntries,
      parts,
      technicians,
      notifications,
      requiredSkills,
      ...rest
    } = row;
    return {
      ...rest,
      hasSignature: Boolean(signatureKey),
      technicians: technicians.map((t) => ({
        memberId: t.memberId,
        name: fullName(t.member),
        role: t.member.role,
      })),
      timeEntries: timeEntries.map(({ member, organizationId: _o, interventionId: _i, ...e }) => ({
        ...e,
        technician: fullName(member),
      })),
      totalMinutes: timeEntries.reduce((sum, e) => sum + e.minutes, 0),
      parts: parts.map(({ organizationId: _o, interventionId: _i, ...p }) => ({
        ...p,
        quantity: Number(p.quantity.toString()),
      })),
      photos: photos.map(({ storageKey: _k, ...p }) => p),
      requiredSkills: requiredSkills.map((s) => s.skill),
      /** Notifications au client (F4) : numéros et adresses masqués. */
      notifications: notifications.map((n) => ({ ...n, recipient: maskRecipient(n.recipient) })),
      /** Droits de l'utilisateur sur cette intervention (affichage des actions ; l'API décide). */
      can: {
        manage: this.canManage(ctx),
        work: canWorkOnFactureIntervention(ctx.role, assigned),
        invoice: hasFacturePermission(ctx.role, 'facture.documents.manage'),
      },
    };
  }

  private denied() {
    return new ForbiddenException({
      code: 'FORBIDDEN',
      message: "Vous n'avez pas les droits nécessaires.",
    });
  }

  private record(
    ctx: FactureContext,
    action: string,
    targetType: string,
    targetId: string,
    metadata?: Record<string, string | number>,
  ) {
    return this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action,
      targetType,
      targetId,
      ...(metadata ? { metadata } : {}),
    });
  }
}

/**
 * Empreinte SHA-256 du rapport signé : contenu complet de l'intervention au moment de la signature
 * (client, lieu, équipement, créneau, techniciens, temps, pièces, photos, rapport, signataire, date) et
 * empreinte de l'image de la signature. Sérialisation à ordre de clés fixe.
 */
/** Données imprimées d'un rapport, figées à la signature. */
export interface ReportSnapshot {
  client: {
    id: string;
    name: string;
    phone: string | null;
    address: string | null;
    city: string | null;
  };
  siteAddress: string | null;
  contactName: string | null;
  contactPhone: string | null;
  equipment: {
    id: string;
    name: string;
    brand: string | null;
    model: string | null;
    serialNumber: string | null;
    location: string | null;
  } | null;
  technicians: string[];
}

export function snapshotOf(row: InterventionRow): ReportSnapshot {
  return {
    client: { ...row.client },
    siteAddress: row.siteAddress,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    equipment: row.equipment ? { ...row.equipment } : null,
    technicians: row.technicians.map((t) => fullName(t.member)),
  };
}

export function hashReport(
  row: InterventionRow,
  snapshot: ReportSnapshot,
  signerName: string,
  signedAt: Date,
  png: Buffer,
) {
  const payload = {
    v: 2,
    /** Tout ce qui est imprimé du client, du lieu, du contact, de l'équipement et des techniciens. */
    printed: snapshot,
    number: row.number,
    client: { id: row.client.id, name: row.client.name },
    title: row.title,
    description: row.description,
    siteAddress: row.siteAddress,
    equipment: row.equipment
      ? {
          id: row.equipment.id,
          name: row.equipment.name,
          serialNumber: row.equipment.serialNumber,
        }
      : null,
    scheduledStart: row.scheduledStart.toISOString(),
    scheduledEnd: row.scheduledEnd.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    technicians: row.technicians.map((t) => t.memberId).sort(),
    time: row.timeEntries.map((e) => [
      e.id,
      e.memberId,
      e.workDate.toISOString().slice(0, 10),
      e.minutes,
      e.note,
    ]),
    parts: row.parts.map((p) => [p.id, p.itemId, p.label, p.unit, p.quantity.toString()]),
    photos: row.photos.map((p) => [p.id, p.storageKey]),
    workSummary: row.workSummary,
    recommendations: row.recommendations,
    signerName,
    signedAt: signedAt.toISOString(),
    signature: createHash('sha256').update(png).digest('hex'),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** Photo vérifiée et réencodée en JPEG (orientation appliquée, métadonnées et GPS retirés). */
export async function normalizePhoto(file: FactureUpload | undefined): Promise<Buffer> {
  if (!file || !PHOTO_TYPES.has(file.mimetype) || file.size > FACTURE_PHOTO_MAX_BYTES) {
    throw new BadRequestException({
      code: 'PHOTO_REFUSED',
      message: 'Photo refusée : image JPEG, PNG ou WebP de 8 Mo au plus.',
    });
  }
  try {
    return await sharp(file.buffer, { failOn: 'error', limitInputPixels: 8192 * 8192 })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new BadRequestException({
      code: 'PHOTO_REFUSED',
      message: 'Image illisible ou corrompue.',
    });
  }
}

/** Signature : PNG vérifié, réencodé sur fond blanc ; une signature vide (aucun trait) est refusée. */
async function normalizeSignature(file: FactureUpload | undefined): Promise<Buffer> {
  const refused = (message: string) =>
    new BadRequestException({ code: 'SIGNATURE_REFUSED', message });
  if (!file || file.mimetype !== 'image/png' || file.size > FACTURE_SIGNATURE_MAX_BYTES) {
    throw refused('Signature refusée : image PNG de 300 Ko au plus.');
  }
  let png: Buffer;
  try {
    png = await sharp(file.buffer, { failOn: 'error', limitInputPixels: 2048 * 2048 })
      .flatten({ background: '#ffffff' })
      .resize({ width: 800, height: 320, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    throw refused('Image de signature illisible.');
  }
  const stats = await sharp(png).greyscale().stats();
  // Aucun pixel sensiblement plus sombre que le fond : rien n'a été signé.
  if ((stats.channels[0]?.min ?? 255) > 200) throw refused('La signature est vide.');
  return png;
}

/** Destinataire masqué : 4 derniers chiffres d'un numéro, initiale et domaine d'une adresse. */
function maskRecipient(recipient: string): string {
  if (recipient.includes('@')) {
    const [local, domain] = recipient.split('@');
    return `${local!.slice(0, 1)}•••@${domain}`;
  }
  return maskPhone(recipient.replace(/\s/g, '')) ?? '';
}
