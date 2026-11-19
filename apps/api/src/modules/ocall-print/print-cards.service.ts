import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ocall/print-database';
import {
  PRINT_BATCH_MAX,
  PRINT_CARD_KINDS,
  type PrintCardKind,
  type PrintItemStatus,
  type PrintOrderStatus,
  type PrintSourceApp,
} from '@ocall/shared';
import type {
  PrintActor,
  PrintCardContent,
  PrintCardSummary,
  PrintScope,
} from '../../common/integration/print-gateway';
import { isUniqueViolation, printConflict, printInvalid, printNotFound } from './print-errors';
import { releaseCardLines } from './print-order-lines';
import { PrintPrismaService } from './print-prisma.service';
import { PrintQrSigner, newCardNumber } from './print-qr';
import { renderCardSvgs } from './print-render';
import { PrintTemplatesService, scopeWhere } from './print-templates.service';

type CardRow = Prisma.PrintCardGetPayload<object>;
type Tx = Prisma.TransactionClient;

const REASON_MAX = 200;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

@Injectable()
export class PrintCardsService {
  constructor(
    private readonly db: PrintPrismaService,
    private readonly signer: PrintQrSigner,
    private readonly templates: PrintTemplatesService,
  ) {}

  /** Résumés de cartes, avec leur dernière ligne de commande. */
  async summaries(organizationId: string, cards: CardRow[]): Promise<PrintCardSummary[]> {
    if (cards.length === 0) return [];
    const items = await this.db.printOrderItem.findMany({
      where: { organizationId, cardId: { in: cards.map((c) => c.id) } },
      orderBy: { createdAt: 'desc' },
      select: {
        cardId: true,
        status: true,
        rejectReason: true,
        order: { select: { id: true, number: true, status: true } },
      },
    });
    const last = new Map<string, (typeof items)[number]>();
    for (const item of items) if (!last.has(item.cardId)) last.set(item.cardId, item);
    return cards.map((c) => {
      const item = last.get(c.id);
      return {
        id: c.id,
        cardNumber: c.cardNumber,
        status: c.status,
        holderKind: c.holderKind,
        holderId: c.holderId,
        sourceApp: c.sourceApp,
        scopeId: c.scopeId,
        validUntil: day(c.validUntil),
        replacesCardId: c.replacesCardId,
        revokedAt: c.revokedAt?.toISOString() ?? null,
        revokeReason: c.revokeReason,
        createdAt: c.createdAt.toISOString(),
        print: item
          ? {
              orderId: item.order.id,
              orderNumber: item.order.number,
              orderStatus: item.order.status as PrintOrderStatus,
              itemStatus: item.status as PrintItemStatus,
              rejectReason: item.rejectReason,
            }
          : null,
      };
    });
  }

  private reason(value: string): string {
    const reason = value?.trim() ?? '';
    if (reason.length < 3 || reason.length > REASON_MAX)
      throw printInvalid('PRINT_REASON_REQUIRED', `Motif : de 3 à ${REASON_MAX} caractères.`);
    return reason;
  }

  /** Crée une carte ; le numéro aléatoire est retenté en cas de collision (improbable). */
  private async createCard(
    tx: Tx,
    actor: PrintActor,
    data: {
      sourceApp: string;
      scopeId: string | null;
      holderKind: PrintCardKind;
      holderId: string;
      validUntil: Date | null;
      replacesCardId?: string;
    },
  ): Promise<CardRow> {
    for (let attempt = 0; ; attempt++) {
      const cardNumber = newCardNumber();
      const taken = await tx.printCard.findUnique({ where: { cardNumber }, select: { id: true } });
      if (taken && attempt < 5) continue;
      return tx.printCard.create({
        data: {
          organizationId: actor.organizationId,
          ...data,
          cardNumber,
          createdByUserId: actor.userId,
        },
      });
    }
  }

  async issue(
    actor: PrintActor,
    sourceApp: PrintSourceApp,
    holders: {
      holderKind: PrintCardKind;
      holderId: string;
      scopeId: string | null;
      validUntil: string | null;
    }[],
  ): Promise<PrintCardSummary[]> {
    if (holders.length === 0) return [];
    if (holders.length > PRINT_BATCH_MAX)
      throw printInvalid('PRINT_BATCH_TOO_LARGE', `${PRINT_BATCH_MAX} cartes au plus à la fois.`);
    for (const h of holders) {
      if (!PRINT_CARD_KINDS.includes(h.holderKind) || !UUID.test(h.holderId))
        throw printInvalid('PRINT_HOLDER_INVALID', 'Titulaire invalide.');
      if (h.validUntil !== null && !DATE.test(h.validUntil))
        throw printInvalid('PRINT_DATE_INVALID', 'Date de validité invalide.');
    }
    const ids: string[] = [];
    for (const h of holders) {
      const where = {
        organizationId: actor.organizationId,
        sourceApp,
        holderKind: h.holderKind,
        holderId: h.holderId,
        status: 'ACTIVE' as const,
      };
      const existing = await this.db.printCard.findFirst({ where, select: { id: true } });
      if (existing) {
        ids.push(existing.id);
        continue;
      }
      try {
        const card = await this.db.$transaction((tx) =>
          this.createCard(tx, actor, {
            sourceApp,
            scopeId: h.scopeId,
            holderKind: h.holderKind,
            holderId: h.holderId,
            validUntil: h.validUntil ? new Date(`${h.validUntil}T00:00:00Z`) : null,
          }),
        );
        ids.push(card.id);
      } catch (error) {
        // Création simultanée pour le même titulaire : l'index unique garde une seule carte active.
        if (!isUniqueViolation(error)) throw error;
        const winner = await this.db.printCard.findFirst({ where, select: { id: true } });
        if (!winner) throw error;
        ids.push(winner.id);
      }
    }
    const rows = await this.db.printCard.findMany({ where: { id: { in: ids } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return this.summaries(
      actor.organizationId,
      ids.map((id) => byId.get(id)!),
    );
  }

  async list(
    actor: PrintActor,
    scope: PrintScope,
    filter: {
      holderKind?: PrintCardKind;
      holderIds?: string[];
      cardIds?: string[];
      status?: 'ACTIVE' | 'REVOKED';
    },
  ): Promise<PrintCardSummary[]> {
    const rows = await this.db.printCard.findMany({
      where: {
        ...scopeWhere(actor, scope),
        ...(filter.holderKind ? { holderKind: filter.holderKind } : {}),
        ...(filter.holderIds ? { holderId: { in: filter.holderIds } } : {}),
        ...(filter.cardIds ? { id: { in: filter.cardIds.filter((id) => UUID.test(id)) } } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
    return this.summaries(actor.organizationId, rows);
  }

  /** Carte visible dans le périmètre, verrouillée dans la transaction. */
  private async lockVisible(tx: Tx, actor: PrintActor, scope: PrintScope, cardId: string) {
    if (!UUID.test(cardId)) throw printNotFound('Carte');
    await tx.$queryRaw`SELECT id FROM "PrintCard" WHERE id = ${cardId}::uuid AND "organizationId" = ${actor.organizationId}::uuid FOR UPDATE`;
    const card = await tx.printCard.findFirst({
      where: { id: cardId, ...scopeWhere(actor, scope) },
    });
    if (!card) throw printNotFound('Carte');
    return card;
  }

  private async revokeLocked(tx: Tx, actor: PrintActor, card: CardRow, reason: string) {
    if (card.status !== 'ACTIVE')
      throw printConflict('PRINT_CARD_NOT_ACTIVE', 'Cette carte n’est plus active.');
    await tx.printCard.update({
      where: { id: card.id },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedByUserId: actor.userId,
        revokeReason: reason,
      },
    });
    await releaseCardLines(tx, actor.organizationId, card.id, actor.userId, reason);
  }

  async revoke(
    actor: PrintActor,
    scope: PrintScope,
    cardId: string,
    reasonInput: string,
  ): Promise<PrintCardSummary> {
    const reason = this.reason(reasonInput);
    await this.db.$transaction(async (tx) => {
      const card = await this.lockVisible(tx, actor, scope, cardId);
      await this.revokeLocked(tx, actor, card, reason);
    });
    const [summary] = await this.summaries(actor.organizationId, [
      await this.db.printCard.findUniqueOrThrow({ where: { id: cardId } }),
    ]);
    return summary!;
  }

  async replace(
    actor: PrintActor,
    scope: PrintScope,
    cardId: string,
    reasonInput: string,
  ): Promise<PrintCardSummary> {
    const reason = this.reason(reasonInput);
    const created = await this.db.$transaction(async (tx) => {
      const card = await this.lockVisible(tx, actor, scope, cardId);
      await this.revokeLocked(tx, actor, card, reason);
      return this.createCard(tx, actor, {
        sourceApp: card.sourceApp,
        scopeId: card.scopeId,
        holderKind: card.holderKind,
        holderId: card.holderId,
        validUntil: card.validUntil,
        replacesCardId: card.id,
      });
    });
    const [summary] = await this.summaries(actor.organizationId, [created]);
    return summary!;
  }

  async revokeHolder(
    actor: PrintActor,
    sourceApp: PrintSourceApp,
    holderKind: PrintCardKind,
    holderId: string,
    reasonInput: string,
  ): Promise<number> {
    const reason = this.reason(reasonInput);
    if (!UUID.test(holderId)) return 0;
    return this.db.$transaction(async (tx) => {
      const cards = await tx.printCard.findMany({
        where: {
          organizationId: actor.organizationId,
          sourceApp,
          holderKind,
          holderId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      for (const { id } of cards) {
        const card = await this.lockVisible(tx, actor, { sourceApp, scopeIds: null }, id);
        if (card.status === 'ACTIVE') await this.revokeLocked(tx, actor, card, reason);
      }
      return cards.length;
    });
  }

  async verify(actor: PrintActor, qr: string): Promise<PrintCardSummary | null> {
    const cardNumber = typeof qr === 'string' ? this.signer.verify(qr) : null;
    if (!cardNumber) return null;
    const card = await this.db.printCard.findFirst({
      where: { cardNumber, organizationId: actor.organizationId },
    });
    if (!card) return null;
    const [summary] = await this.summaries(actor.organizationId, [card]);
    return summary!;
  }

  async preview(
    actor: PrintActor,
    scope: PrintScope,
    cardId: string,
    templateId: string,
    content: PrintCardContent,
    photo: Buffer | null,
  ): Promise<{ front: string; back: string }> {
    if (!UUID.test(cardId)) throw printNotFound('Carte');
    const card = await this.db.printCard.findFirst({
      where: { id: cardId, ...scopeWhere(actor, scope) },
    });
    if (!card) throw printNotFound('Carte');
    const v = await this.templates.activeVersion(actor, scope, templateId);
    if (v.kind !== card.holderKind)
      throw printInvalid('PRINT_TEMPLATE_KIND', 'Ce modèle ne correspond pas à ce type de carte.');
    return renderCardSvgs({
      layout: v.layout,
      data: this.templates.cardData(v.kind, content, card.cardNumber),
      assets: { photo, logo: await this.templates.logo(v.logoKey) },
    });
  }
}
