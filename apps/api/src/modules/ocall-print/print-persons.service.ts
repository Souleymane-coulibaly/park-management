import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@ocall/print-database';
import {
  hasControlChars,
  PRINT_CARD_KINDS,
  PRINT_PERSON_LIMITS,
  type PrintCardKind,
  printSearchText,
  type PrintSourceApp,
} from '@ocall/shared';
import type {
  PrintActor,
  PrintCardContent,
  PrintCardSummary,
  PrintDelivery,
  PrintOrderDetail,
  PrintPersonExport,
} from '../../common/integration/print-gateway';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
  privateKey,
} from '../../common/storage/storage-provider';
import { PrismaService } from '../../prisma/prisma.service';
import { PrintCardsService } from './print-cards.service';
import { isUuid, printConflict, printInvalid, printNotFound } from './print-errors';
import { isImageRefusal, processPrintPhoto } from './print-images';
import { PrintOrdersService } from './print-orders.service';
import { PrintPrismaService } from './print-prisma.service';

/** Accès autonome : une seule source, toute l'organisation. */
export const STANDALONE = { sourceApp: 'OCALL_PRINT' as const, scopeIds: null };

type PersonRow = Prisma.PrintPersonGetPayload<object>;

export interface PersonInput {
  kind?: PrintCardKind;
  lastName?: string;
  firstName?: string;
  lastNameAr?: string | null;
  firstNameAr?: string | null;
  reference?: string | null;
  groupLabel?: string | null;
  jobTitle?: string | null;
  birthDate?: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown, label: string, max: number, required: boolean): string | null {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
    if (required) throw printInvalid('PRINT_PERSON_INVALID', `${label} obligatoire.`);
    return null;
  }
  if (typeof value !== 'string' || value.trim().length > max || hasControlChars(value))
    throw printInvalid('PRINT_PERSON_INVALID', `${label} : ${max} caractères au plus.`);
  return value.trim().replace(/\s+/g, ' ');
}

@Injectable()
export class PrintPersonsService {
  constructor(
    private readonly db: PrintPrismaService,
    private readonly core: PrismaService,
    private readonly cards: PrintCardsService,
    private readonly orders: PrintOrdersService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  view(p: PersonRow) {
    return {
      id: p.id,
      kind: p.kind,
      lastName: p.lastName,
      firstName: p.firstName,
      lastNameAr: p.lastNameAr,
      firstNameAr: p.firstNameAr,
      reference: p.reference,
      groupLabel: p.groupLabel,
      jobTitle: p.jobTitle,
      birthDate: p.birthDate ? p.birthDate.toISOString().slice(0, 10) : null,
      hasPhoto: p.photoKey !== null,
      archivedAt: p.archivedAt?.toISOString() ?? null,
      transferredApp: p.transferredApp,
      transferredAt: p.transferredAt?.toISOString() ?? null,
    };
  }

  private fields(input: PersonInput, partial: boolean) {
    const L = PRINT_PERSON_LIMITS;
    const out: Record<string, unknown> = {};
    const set = (key: keyof PersonInput, label: string, max: number, required: boolean) => {
      if (partial && input[key] === undefined) return;
      out[key] = text(input[key], label, max, required);
    };
    set('lastName', 'Nom', L.nameMax, true);
    set('firstName', 'Prénom', L.nameMax, true);
    set('lastNameAr', 'Nom en arabe', L.nameMax, false);
    set('firstNameAr', 'Prénom en arabe', L.nameMax, false);
    set('reference', 'Matricule ou numéro', L.referenceMax, false);
    set('groupLabel', 'Classe ou service', L.groupMax, false);
    set('jobTitle', 'Fonction', L.jobMax, false);
    if (!partial || input.birthDate !== undefined) {
      const b = input.birthDate;
      if (b === null || b === undefined || b === '') out.birthDate = null;
      else if (typeof b !== 'string' || !DATE.test(b) || Number.isNaN(Date.parse(b)))
        throw printInvalid('PRINT_PERSON_INVALID', 'Date de naissance invalide.');
      else out.birthDate = new Date(`${b}T00:00:00Z`);
    }
    return out;
  }

  private search(p: Record<string, unknown>) {
    return printSearchText(
      p.lastName as string,
      p.firstName as string,
      p.reference as string | null,
      p.groupLabel as string | null,
      p.jobTitle as string | null,
    );
  }

  async list(actor: PrintActor, filter: { kind?: string; q?: string; archived?: boolean }) {
    const kind = PRINT_CARD_KINDS.includes(filter.kind as PrintCardKind)
      ? (filter.kind as PrintCardKind)
      : undefined;
    const q = filter.q ? printSearchText(filter.q) : '';
    const rows = await this.db.printPerson.findMany({
      where: {
        organizationId: actor.organizationId,
        transferredAt: null,
        archivedAt: filter.archived ? { not: null } : null,
        ...(kind ? { kind } : {}),
        ...(q ? { searchText: { contains: q } } : {}),
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 1000,
    });
    const cards = await this.cards.list(actor, STANDALONE, {
      holderIds: rows.map((r) => r.id),
      status: 'ACTIVE',
    });
    const byHolder = new Map(cards.map((c) => [c.holderId, c]));
    return rows.map((r) => ({ ...this.view(r), card: byHolder.get(r.id) ?? null }));
  }

  private async load(actor: PrintActor, id: string): Promise<PersonRow> {
    if (!isUuid(id)) throw printNotFound('Fiche');
    const p = await this.db.printPerson.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!p) throw printNotFound('Fiche');
    return p;
  }

  /** Fiche modifiable : ni archivée, ni reprise par une autre application. */
  private async loadActive(actor: PrintActor, id: string): Promise<PersonRow> {
    const p = await this.load(actor, id);
    if (p.transferredAt)
      throw printConflict(
        'PRINT_PERSON_TRANSFERRED',
        'Cette fiche a été reprise par Ocall School : elle se gère désormais dans School.',
      );
    if (p.archivedAt) throw printConflict('PRINT_PERSON_ARCHIVED', 'Cette fiche est archivée.');
    return p;
  }

  async get(actor: PrintActor, id: string) {
    const p = await this.load(actor, id);
    const cards = await this.cards.list(actor, STANDALONE, { holderIds: [p.id] });
    return { ...this.view(p), cards };
  }

  private referenceTaken(error: unknown) {
    return (
      typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
    );
  }

  async create(actor: PrintActor, input: PersonInput) {
    if (!PRINT_CARD_KINDS.includes(input.kind as PrintCardKind))
      throw printInvalid('PRINT_KIND_INVALID', 'Type de fiche invalide.');
    const data = this.fields(input, false);
    try {
      const p = await this.db.printPerson.create({
        data: {
          organizationId: actor.organizationId,
          kind: input.kind as PrintCardKind,
          ...(data as object),
          lastName: data.lastName as string,
          firstName: data.firstName as string,
          searchText: this.search(data),
          createdByUserId: actor.userId,
        },
      });
      return this.view(p);
    } catch (error) {
      if (this.referenceTaken(error))
        throw printConflict('PRINT_REFERENCE_TAKEN', 'Ce matricule ou numéro est déjà utilisé.');
      throw error;
    }
  }

  async update(actor: PrintActor, id: string, input: PersonInput) {
    const p = await this.loadActive(actor, id);
    const data = this.fields(input, true);
    const merged = { ...p, ...data };
    try {
      const updated = await this.db.printPerson.update({
        where: { id: p.id },
        data: { ...data, searchText: this.search(merged) },
      });
      return this.view(updated);
    } catch (error) {
      if (this.referenceTaken(error))
        throw printConflict('PRINT_REFERENCE_TAKEN', 'Ce matricule ou numéro est déjà utilisé.');
      throw error;
    }
  }

  /** Archivage : la fiche sort des listes ; ses cartes actives sont révoquées. */
  async archive(actor: PrintActor, id: string) {
    const p = await this.loadActive(actor, id);
    await this.cards.revokeHolder(actor, 'OCALL_PRINT', p.kind, p.id, 'Fiche archivée');
    await this.db.printPerson.update({ where: { id: p.id }, data: { archivedAt: new Date() } });
  }

  async setPhoto(actor: PrintActor, id: string, file: Buffer) {
    const p = await this.loadActive(actor, id);
    const photo = await processPrintPhoto(file);
    if (isImageRefusal(photo)) throw printInvalid(photo.code, photo.message);
    const key = privateKey(actor.organizationId, null, randomUUID(), 'jpg');
    await this.storage.put(key, photo.body, photo.mimeType);
    try {
      await this.db.printPerson.update({
        where: { id: p.id },
        data: { photoKey: key, photoSha: photo.sha256 },
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
    if (p.photoKey) await this.storage.delete(p.photoKey).catch(() => undefined);
    return this.view({ ...p, photoKey: key });
  }

  async photo(actor: PrintActor, id: string): Promise<Buffer | null> {
    const p = await this.load(actor, id);
    return p.photoKey ? this.storage.get(p.photoKey) : null;
  }

  /** Émetteur imprimé sur les cartes de l'accès autonome : l'organisation (sans contact en V1). */
  private async issuer(actor: PrintActor): Promise<PrintCardContent['issuer']> {
    const org = await this.core.organization.findUniqueOrThrow({
      where: { id: actor.organizationId },
      select: { name: true },
    });
    return { name: org.name, nameAr: null, contact: null };
  }

  content(p: PersonRow, issuer: PrintCardContent['issuer'], validUntil: string | null) {
    return {
      issuer,
      holder: {
        firstName: p.firstName,
        lastName: p.lastName,
        firstNameAr: p.firstNameAr,
        lastNameAr: p.lastNameAr,
        reference: p.reference,
        group: p.groupLabel,
        jobTitle: p.jobTitle,
        birthDate: p.birthDate ? p.birthDate.toISOString().slice(0, 10) : null,
      },
      period: null,
      validUntil,
    } satisfies PrintCardContent;
  }

  async issueCards(
    actor: PrintActor,
    personIds: string[],
    validUntil: string | null,
  ): Promise<PrintCardSummary[]> {
    if (!Array.isArray(personIds) || personIds.length === 0 || !personIds.every(isUuid))
      throw printInvalid('PRINT_HOLDER_INVALID', 'Aucune fiche sélectionnée.');
    const persons = await this.db.printPerson.findMany({
      where: {
        id: { in: personIds },
        organizationId: actor.organizationId,
        archivedAt: null,
        transferredAt: null,
      },
    });
    if (persons.length !== new Set(personIds).size) throw printNotFound('Fiche');
    // Cartes renvoyées dans l'ordre de la demande (une fiche demandée deux fois : une seule carte).
    const byId = new Map(persons.map((p) => [p.id, p]));
    const ordered = [...new Set(personIds)].map((id) => byId.get(id)!);
    return this.cards.issue(
      actor,
      'OCALL_PRINT',
      ordered.map((p) => ({ holderKind: p.kind, holderId: p.id, scopeId: null, validUntil })),
    );
  }

  async cardPreview(actor: PrintActor, cardId: string, templateId: string) {
    const [card] = isUuid(cardId)
      ? await this.db.printCard.findMany({
          where: { id: cardId, organizationId: actor.organizationId, sourceApp: 'OCALL_PRINT' },
        })
      : [];
    if (!card) throw printNotFound('Carte');
    const p = await this.load(actor, card.holderId);
    const validUntil = card.validUntil?.toISOString().slice(0, 10) ?? null;
    return this.cards.preview(
      actor,
      STANDALONE,
      cardId,
      templateId,
      this.content(p, await this.issuer(actor), validUntil),
      p.photoKey ? await this.storage.get(p.photoKey) : null,
    );
  }

  async order(
    actor: PrintActor,
    input: {
      templateId: string;
      cardIds: string[];
      delivery: PrintDelivery;
      idempotencyKey: string;
    },
  ): Promise<PrintOrderDetail> {
    const ids = Array.isArray(input.cardIds) ? input.cardIds : [];
    if (ids.length === 0) throw printInvalid('PRINT_ORDER_EMPTY', 'Aucune carte à commander.');
    if (!ids.every(isUuid)) throw printNotFound('Carte');
    const cards = await this.db.printCard.findMany({
      where: { id: { in: ids }, organizationId: actor.organizationId, sourceApp: 'OCALL_PRINT' },
    });
    if (cards.length !== new Set(ids).size) throw printNotFound('Carte');
    const persons = await this.db.printPerson.findMany({
      where: { id: { in: cards.map((c) => c.holderId) }, organizationId: actor.organizationId },
    });
    const byId = new Map(persons.map((p) => [p.id, p]));
    const issuer = await this.issuer(actor);
    const items = await Promise.all(
      cards.map(async (c) => {
        const p = byId.get(c.holderId)!;
        return {
          cardId: c.id,
          content: this.content(p, issuer, c.validUntil?.toISOString().slice(0, 10) ?? null),
          photo: p.photoKey ? await this.storage.get(p.photoKey) : null,
        };
      }),
    );
    return this.orders.submit(
      actor,
      { sourceApp: 'OCALL_PRINT', scopeId: null, establishmentId: null },
      {
        templateId: input.templateId,
        idempotencyKey: input.idempotencyKey,
        delivery: input.delivery,
        items,
      },
    );
  }

  // ─── Reprise par Ocall School (décision du 19/11/2026 : aucune double saisie, aucun doublon) ───

  async transferable(actor: PrintActor): Promise<PrintPersonExport[]> {
    const rows = await this.db.printPerson.findMany({
      where: { organizationId: actor.organizationId, archivedAt: null, transferredAt: null },
      orderBy: [{ kind: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }],
      take: 5000,
    });
    const cards = await this.cards.list(actor, STANDALONE, {
      holderIds: rows.map((r) => r.id),
      status: 'ACTIVE',
    });
    const byHolder = new Map(cards.map((c) => [c.holderId, c.cardNumber]));
    return rows.map((p) => {
      const v = this.view(p);
      return {
        id: v.id,
        kind: v.kind,
        firstName: v.firstName,
        lastName: v.lastName,
        firstNameAr: v.firstNameAr,
        lastNameAr: v.lastNameAr,
        reference: v.reference,
        groupLabel: v.groupLabel,
        jobTitle: v.jobTitle,
        birthDate: v.birthDate,
        hasPhoto: v.hasPhoto,
        activeCardNumber: byHolder.get(p.id) ?? null,
      };
    });
  }

  async completeTransfer(
    actor: PrintActor,
    personId: string,
    target: { sourceApp: PrintSourceApp; holderId: string; scopeId: string | null },
  ): Promise<void> {
    if (!isUuid(target.holderId))
      throw printInvalid('PRINT_HOLDER_INVALID', 'Fiche cible invalide.');
    const p = await this.load(actor, personId);
    if (p.transferredAt) {
      // Reprise rejouée vers la même fiche : rien à faire ; vers une autre : refus.
      if (p.transferredApp === target.sourceApp && p.transferredId === target.holderId) return;
      throw printConflict('PRINT_PERSON_TRANSFERRED', 'Cette fiche a déjà été reprise.');
    }
    if (p.archivedAt) throw printConflict('PRINT_PERSON_ARCHIVED', 'Cette fiche est archivée.');
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PrintPerson" WHERE id = ${p.id}::uuid FOR UPDATE`;
      const fresh = await tx.printPerson.findUniqueOrThrow({ where: { id: p.id } });
      if (fresh.transferredAt)
        throw printConflict('PRINT_PERSON_TRANSFERRED', 'Cette fiche a déjà été reprise.');
      await tx.printPerson.update({
        where: { id: p.id },
        data: {
          transferredApp: target.sourceApp,
          transferredId: target.holderId,
          transferredAt: new Date(),
        },
      });
      // La fiche cible a déjà une carte active : la carte autonome est révoquée (jamais deux actives).
      const targetActive = await tx.printCard.count({
        where: {
          organizationId: actor.organizationId,
          sourceApp: target.sourceApp,
          holderKind: p.kind,
          holderId: target.holderId,
          status: 'ACTIVE',
        },
      });
      if (targetActive > 0)
        await tx.printCard.updateMany({
          where: {
            organizationId: actor.organizationId,
            sourceApp: 'OCALL_PRINT',
            holderId: p.id,
            status: 'ACTIVE',
          },
          data: {
            status: 'REVOKED',
            revokedAt: new Date(),
            revokedByUserId: actor.userId,
            revokeReason: 'Reprise par Ocall School : la fiche avait déjà une carte.',
          },
        });
      // Cartes de la fiche : passent à l'application cible, numéro et QR conservés.
      await tx.printCard.updateMany({
        where: { organizationId: actor.organizationId, sourceApp: 'OCALL_PRINT', holderId: p.id },
        data: { sourceApp: target.sourceApp, holderId: target.holderId, scopeId: target.scopeId },
      });
    });
  }
}
