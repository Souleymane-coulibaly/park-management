import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@ocall/print-database';
import {
  hasControlChars,
  PRINT_CARD_UNIT_PRICE,
  PRINT_CURRENCY,
  PRINT_ORDER_CANCELLABLE,
  PRINT_ORDER_MAX_ITEMS,
  PRINT_ORDER_STATUSES,
  type PrintCardData,
  type PrintCardKind,
  type PrintItemStatus,
  printOrderNumber,
  type PrintOrderStatus,
  type PrintSourceApp,
} from '@ocall/shared';
import {
  type PrintActor,
  type PrintCardContent,
  type PrintDelivery,
  type PrintOrderDetail,
  type PrintOrderSummary,
  type PrintScope,
  printHolderLabel,
} from '../../common/integration/print-gateway';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
  privateKey,
} from '../../common/storage/storage-provider';
import {
  isUniqueViolation,
  isUuid,
  printConflict,
  printInvalid,
  printNotFound,
} from './print-errors';
import { isImageRefusal, processPrintPhoto } from './print-images';
import { lockOrder } from './print-order-lines';
import { PrintPrismaService } from './print-prisma.service';
import { type RenderCard, renderProductionPdf, renderProofPdf } from './print-render';
import { PrintTemplatesService, scopeWhere } from './print-templates.service';

export type OrderRow = Prisma.PrintOrderGetPayload<{
  include: {
    template: { include: { template: { select: { name: true } } } };
    items: true;
    events: true;
  };
}>;

const KEY = /^[A-Za-z0-9_-]{8,100}$/;

const iso = (d: Date | null) => d?.toISOString() ?? null;

function clean(value: unknown, label: string, min: number, max: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < min || text.length > max || hasControlChars(text))
    throw printInvalid('PRINT_DELIVERY_INVALID', `${label} : de ${min} à ${max} caractères.`);
  return text;
}

export function orderSummary(
  o: Omit<OrderRow, 'template' | 'items' | 'events'>,
): PrintOrderSummary {
  return {
    id: o.id,
    number: o.number,
    sourceApp: o.sourceApp,
    scopeId: o.scopeId,
    kind: o.kind,
    status: o.status,
    unitPrice: o.unitPrice,
    currency: o.currency,
    quantity: o.quantity,
    totalAmount: o.totalAmount,
    paymentStatus: o.paymentStatus,
    paidAmount: o.paidAmount,
    paidAt: iso(o.paidAt),
    submittedAt: o.submittedAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    filesPurged: o.filesPurgedAt !== null,
  };
}

export function orderDetail(o: OrderRow): PrintOrderDetail {
  return {
    ...orderSummary(o),
    templateName: o.template.template.name,
    templateVersion: o.template.version,
    delivery: {
      address: o.deliveryAddress,
      contactName: o.contactName,
      contactPhone: o.contactPhone,
      note: o.note,
    },
    acceptedAt: iso(o.acceptedAt),
    productionAt: iso(o.productionAt),
    readyAt: iso(o.readyAt),
    deliveredAt: iso(o.deliveredAt),
    cancelledAt: iso(o.cancelledAt),
    rejectedAt: iso(o.rejectedAt),
    closedReason: o.closedReason,
    paymentReference: o.paymentReference,
    items: [...o.items]
      .sort((a, b) => (a.holderLabel ?? a.cardNumber).localeCompare(b.holderLabel ?? b.cardNumber))
      .map((i) => ({
        id: i.id,
        cardId: i.cardId,
        cardNumber: i.cardNumber,
        holderKind: i.holderKind,
        holderLabel: i.holderLabel,
        status: i.status as PrintItemStatus,
        rejectReason: i.rejectReason,
      })),
    events: [...o.events]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((e) => ({
        type: e.type,
        actorKind: e.actorKind,
        createdAt: e.createdAt.toISOString(),
        details: e.details as Record<string, unknown>,
      })),
  };
}

export const ORDER_INCLUDE = {
  template: { include: { template: { select: { name: true } } } },
  items: true,
  events: true,
} as const;

@Injectable()
export class PrintOrdersService {
  constructor(
    private readonly db: PrintPrismaService,
    private readonly templates: PrintTemplatesService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private delivery(input: PrintDelivery): PrintDelivery {
    const note = typeof input?.note === 'string' ? input.note.trim() : '';
    if (note.length > 500 || hasControlChars(note.replace(/\n/g, ' ')))
      throw printInvalid('PRINT_DELIVERY_INVALID', 'Commentaire : 500 caractères au plus.');
    return {
      address: clean(input?.address, 'Adresse de livraison', 5, 300),
      contactName: clean(input?.contactName, 'Personne à contacter', 2, 120),
      contactPhone: clean(input?.contactPhone, 'Téléphone', 6, 30),
      note: note || null,
    };
  }

  async submit(
    actor: PrintActor,
    target: { sourceApp: PrintSourceApp; scopeId: string | null; establishmentId: string | null },
    input: {
      templateId: string;
      idempotencyKey: string;
      delivery: PrintDelivery;
      items: { cardId: string; content: PrintCardContent; photo: Buffer | null }[];
    },
  ): Promise<PrintOrderDetail> {
    if (typeof input.idempotencyKey !== 'string' || !KEY.test(input.idempotencyKey))
      throw printInvalid('PRINT_IDEMPOTENCY_KEY', 'Clé d’envoi invalide.');
    const scope: PrintScope = {
      sourceApp: target.sourceApp,
      scopeIds: target.scopeId === null ? null : [target.scopeId],
    };
    // Reprise d'un envoi déjà enregistré (réseau coupé, double clic) : même commande, aucun doublon.
    const replay = await this.findByKey(actor, input.idempotencyKey);
    if (replay) return this.visibleReplay(replay, target);

    const delivery = this.delivery(input.delivery);
    const items = input.items ?? [];
    if (items.length === 0) throw printInvalid('PRINT_ORDER_EMPTY', 'Aucune carte à commander.');
    if (items.length > PRINT_ORDER_MAX_ITEMS)
      throw printInvalid(
        'PRINT_ORDER_TOO_LARGE',
        `${PRINT_ORDER_MAX_ITEMS} cartes au plus par commande.`,
      );
    const ids = items.map((i) => i.cardId);
    if (new Set(ids).size !== ids.length || !ids.every(isUuid))
      throw printInvalid('PRINT_ORDER_DUPLICATE', 'Une carte figure deux fois dans la commande.');
    // Photo obligatoire pour commander (décision du 19/11/2026), facultative pour l'inscription.
    const missing = items.filter((i) => !i.photo).map((i) => i.cardId);
    if (missing.length > 0)
      throw printConflict('PRINT_PHOTO_REQUIRED', 'Une photo est obligatoire pour chaque carte.', {
        cardIds: missing,
      });

    const template = await this.templates.activeVersion(actor, scope, input.templateId);
    const cards = await this.db.printCard.findMany({
      where: { id: { in: ids }, ...scopeWhere(actor, scope) },
    });
    if (cards.length !== ids.length) throw printNotFound('Carte');
    const byId = new Map(cards.map((c) => [c.id, c]));
    for (const c of cards) {
      if (c.status !== 'ACTIVE')
        throw printConflict('PRINT_CARD_NOT_ACTIVE', 'Une carte révoquée ne se commande pas.', {
          cardIds: [c.id],
        });
      if (c.holderKind !== template.kind)
        throw printInvalid(
          'PRINT_TEMPLATE_KIND',
          'Ce modèle ne correspond pas à ce type de carte.',
        );
      if (c.scopeId !== target.scopeId) throw printNotFound('Carte');
    }

    // Photos réencodées (sans métadonnées) et copiées dans le stockage Print avant la transaction ;
    // supprimées si la commande n'est pas enregistrée.
    const stored: string[] = [];
    const lines: {
      cardId: string;
      cardNumber: string;
      kind: PrintCardKind;
      label: string;
      data: PrintCardData;
      photoKey: string;
    }[] = [];
    try {
      for (const item of items) {
        const card = byId.get(item.cardId)!;
        const photo = await processPrintPhoto(item.photo!);
        if (isImageRefusal(photo))
          throw printInvalid(photo.code, `${printHolderLabel(item.content)} : ${photo.message}`);
        const key = privateKey(actor.organizationId, null, randomUUID(), 'jpg');
        await this.storage.put(key, photo.body, photo.mimeType);
        stored.push(key);
        lines.push({
          cardId: card.id,
          cardNumber: card.cardNumber,
          kind: card.holderKind,
          label: printHolderLabel(item.content),
          data: this.templates.cardData(card.holderKind, item.content, card.cardNumber),
          photoKey: key,
        });
      }
      const id = await this.db.$transaction(async (tx) => {
        const year = new Date().getUTCFullYear();
        const [counter] = await tx.$queryRaw<{ value: number }[]>`
          INSERT INTO "PrintCounter" ("organizationId", "year", "value")
          VALUES (${actor.organizationId}::uuid, ${year}, 1)
          ON CONFLICT ("organizationId", "year") DO UPDATE SET "value" = "PrintCounter"."value" + 1
          RETURNING "value"`;
        // Cartes encore actives au moment de l'enregistrement : verrou partagé, une révocation
        // simultanée attend la fin de la commande puis en retire la ligne (ou la commande la voit révoquée).
        await tx.$queryRaw`SELECT id FROM "PrintCard" WHERE id = ANY(${ids}::uuid[]) FOR SHARE`;
        const live = await tx.printCard.count({
          where: { id: { in: ids }, organizationId: actor.organizationId, status: 'ACTIVE' },
        });
        if (live !== ids.length)
          throw printConflict('PRINT_CARD_NOT_ACTIVE', 'Une carte a été révoquée entre-temps.');
        const order = await tx.printOrder.create({
          data: {
            organizationId: actor.organizationId,
            number: printOrderNumber(year, counter!.value),
            sourceApp: target.sourceApp,
            scopeId: target.scopeId,
            establishmentId: target.establishmentId,
            kind: template.kind,
            templateVersionId: template.versionId,
            unitPrice: PRINT_CARD_UNIT_PRICE,
            currency: PRINT_CURRENCY,
            quantity: lines.length,
            totalAmount: lines.length * PRINT_CARD_UNIT_PRICE,
            deliveryAddress: delivery.address,
            contactName: delivery.contactName,
            contactPhone: delivery.contactPhone,
            note: delivery.note,
            idempotencyKey: input.idempotencyKey,
            submittedByUserId: actor.userId,
          },
        });
        await tx.printOrderItem.createMany({
          data: lines.map((l) => ({
            organizationId: actor.organizationId,
            orderId: order.id,
            cardId: l.cardId,
            cardNumber: l.cardNumber,
            holderKind: l.kind,
            holderLabel: l.label,
            data: l.data as unknown as Prisma.InputJsonValue,
            photoKey: l.photoKey,
          })),
        });
        await tx.printOrderEvent.create({
          data: {
            organizationId: actor.organizationId,
            orderId: order.id,
            type: 'SUBMITTED',
            actorKind: 'CLIENT',
            actorUserId: actor.userId,
            details: { quantity: lines.length, templateVersion: template.version },
          },
        });
        return order.id;
      });
      return this.detail(actor, scope, id);
    } catch (error) {
      await Promise.all(stored.map((k) => this.storage.delete(k).catch(() => undefined)));
      if (isUniqueViolation(error)) {
        const again = await this.findByKey(actor, input.idempotencyKey);
        if (again) return this.visibleReplay(again, target);
        throw printConflict(
          'PRINT_CARD_ALREADY_ORDERED',
          'Une de ces cartes est déjà dans une commande en cours ou a déjà été imprimée.',
        );
      }
      throw error;
    }
  }

  private findByKey(actor: PrintActor, key: string) {
    return this.db.printOrder.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: actor.organizationId,
          idempotencyKey: key,
        },
      },
      include: ORDER_INCLUDE,
    });
  }

  /** Une clé déjà utilisée ne rend que la commande du même périmètre (jamais celle d'un autre). */
  private visibleReplay(
    order: OrderRow,
    target: { sourceApp: PrintSourceApp; scopeId: string | null },
  ): PrintOrderDetail {
    if (order.sourceApp !== target.sourceApp || order.scopeId !== target.scopeId)
      throw printConflict('PRINT_IDEMPOTENCY_KEY', 'Clé d’envoi déjà utilisée.');
    return orderDetail(order);
  }

  async list(
    actor: PrintActor,
    scope: PrintScope,
    filter: { status?: PrintOrderStatus },
  ): Promise<PrintOrderSummary[]> {
    if (filter.status && !PRINT_ORDER_STATUSES.includes(filter.status))
      throw printInvalid('PRINT_STATUS_INVALID', 'État invalide.');
    const rows = await this.db.printOrder.findMany({
      where: { ...scopeWhere(actor, scope), ...(filter.status ? { status: filter.status } : {}) },
      orderBy: { submittedAt: 'desc' },
      take: 500,
    });
    return rows.map(orderSummary);
  }

  private async load(actor: PrintActor, scope: PrintScope, id: string): Promise<OrderRow> {
    if (!isUuid(id)) throw printNotFound('Commande');
    const order = await this.db.printOrder.findFirst({
      where: { id, ...scopeWhere(actor, scope) },
      include: ORDER_INCLUDE,
    });
    if (!order) throw printNotFound('Commande');
    return order;
  }

  async detail(actor: PrintActor, scope: PrintScope, id: string): Promise<PrintOrderDetail> {
    return orderDetail(await this.load(actor, scope, id));
  }

  async cancel(
    actor: PrintActor,
    scope: PrintScope,
    id: string,
    reasonInput: string,
  ): Promise<PrintOrderDetail> {
    const reason = clean(reasonInput, 'Motif', 3, 200);
    await this.load(actor, scope, id);
    await this.db.$transaction(async (tx) => {
      await lockOrder(tx, actor.organizationId, id);
      const order = await tx.printOrder.findUniqueOrThrow({ where: { id } });
      if (!PRINT_ORDER_CANCELLABLE.includes(order.status as PrintOrderStatus))
        throw printConflict(
          'PRINT_ORDER_NOT_CANCELLABLE',
          'La production a commencé : la commande ne peut plus être annulée.',
        );
      await tx.printOrderItem.updateMany({
        where: { organizationId: actor.organizationId, orderId: id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      await tx.printOrder.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          closedReason: reason,
          quantity: 0,
          totalAmount: 0,
        },
      });
      await tx.printOrderEvent.create({
        data: {
          organizationId: actor.organizationId,
          orderId: id,
          type: 'CANCELLED',
          actorKind: 'CLIENT',
          actorUserId: actor.userId,
          details: { reason },
        },
      });
    });
    return this.detail(actor, scope, id);
  }

  /** Cartes d'une commande prêtes au rendu (données figées, photo et logo du stockage Print). */
  async renderable(order: OrderRow, statuses: PrintItemStatus[]): Promise<RenderCard[]> {
    if (order.filesPurgedAt)
      throw printConflict(
        'PRINT_FILES_PURGED',
        'Les fichiers de cette commande ont été purgés (conservation de 90 jours).',
      );
    const version = order.template;
    const logo = await this.templates.logo(version.logoKey);
    const items = order.items
      .filter((i) => statuses.includes(i.status as PrintItemStatus))
      .sort((a, b) => (a.holderLabel ?? '').localeCompare(b.holderLabel ?? ''));
    return Promise.all(
      items.map(async (i) => ({
        layout: version.layout as unknown as RenderCard['layout'],
        data: i.data as unknown as PrintCardData,
        assets: { photo: i.photoKey ? await this.storage.get(i.photoKey) : null, logo },
      })),
    );
  }

  async proofPdf(actor: PrintActor, scope: PrintScope, id: string): Promise<Buffer> {
    const order = await this.load(actor, scope, id);
    const cards = await this.renderable(order, ['PENDING', 'PRINTED', 'REJECTED']);
    return renderProofPdf(
      `Bon à tirer ${order.number}`,
      `Commande ${order.number} — ${order.template.template.name} (version ${order.template.version})`,
      cards,
    );
  }

  /** Fichier de production (atelier) : cartes à imprimer ou imprimées, format CR80 recto verso. */
  async productionPdf(order: OrderRow): Promise<Buffer> {
    return renderProductionPdf(
      `Production ${order.number}`,
      await this.renderable(order, ['PENDING', 'PRINTED']),
    );
  }
}
