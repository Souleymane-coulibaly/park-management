import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/facture-database';
import {
  FACTURE_ACCEPTABLE_TYPES,
  FACTURE_DOCUMENT_TYPE_LABELS,
  FACTURE_ISSUABLE_TYPES,
  FACTURE_LIVE_STATUSES,
  FACTURE_MAX_DOCUMENT_TOTAL,
  FACTURE_FINAL_TYPES,
  type FactureDocumentType,
  type FactureVatBucket,
  canAcceptFactureDocument,
  canCancelFactureDocument,
  canConvertFactureDocument,
  canCreditFactureInvoice,
  canRecordFacturePayment,
  computeFactureTotals,
  factureBalance,
  factureInvoiceStatus,
  formatXof,
  hasFacturePermission,
  isFactureOverdue,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import { composeMail } from '../../common/mail/mail-compose';
import { MailService } from '../../common/mail/mail.service';
import { STORAGE_PROVIDER, type StorageProvider } from '../../common/storage/storage-provider';
import { PrismaService } from '../../prisma/prisma.service';
import type { FactureContext } from './facture-access';
import {
  type FactureClientIdentity,
  type FactureSellerIdentity,
  renderFactureDocumentPdf,
} from './facture-document-pdf';
import { allocateFactureNumber } from './facture-numbering';
import { loadFactureLogos } from './facture-pdf';
import { FacturePrismaService } from './facture-prisma.service';
import type {
  CreateFactureDocumentDto,
  FactureDocumentQueryDto,
  FactureDraftDto,
  FactureLineDto,
  SendFactureDocumentDto,
} from './facture-commercial.dto';

type Tx = Prisma.TransactionClient;
type DocumentRow = Prisma.FactureDocumentGetPayload<{ include: { lines: true } }>;

const NOT_FOUND = { code: 'FACTURE_DOCUMENT_NOT_FOUND', message: 'Document introuvable.' };
const LIST_LIMIT = 200;
const DAY = 86_400_000;

const conflict = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  new ConflictException({ code, message, ...extra });

const dateFr = (d: Date) => d.toLocaleDateString('fr-FR', { timeZone: 'UTC' });

/** Date du jour (UTC, heure du Mali) à minuit. */
export const todayUtc = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

const DEFAULT_PAYMENT_TERMS_DAYS = 30;

/**
 * Documents commerciaux d'Ocall Facture (F1, F2) : devis, pro forma, bons de commande (commandes
 * clients), factures et avoirs. Les montants sont toujours recalculés ici (jamais repris du navigateur).
 * Un brouillon n'a pas de numéro ; l'émission attribue le numéro définitif, sans trou, et fige le
 * document (contrôlé aussi par la base). Une facture émise ne s'annule jamais : elle se corrige par un
 * avoir, dans la limite de son TTC. Encaissements, relances, exports : `FactureBillingService`.
 */
@Injectable()
export class FactureDocumentsService {
  constructor(
    private readonly db: FacturePrismaService,
    private readonly core: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  // ─── Lecture ───

  async list(ctx: FactureContext, query: FactureDocumentQueryDto) {
    const rows = await this.db.factureDocument.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(query.type ? { type: query.type } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.clientId ? { clientId: query.clientId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
      take: LIST_LIMIT,
      select: {
        id: true,
        type: true,
        status: true,
        number: true,
        issueDate: true,
        subject: true,
        totalTtc: true,
        dueDate: true,
        amountPaid: true,
        amountCredited: true,
        createdAt: true,
        client: { select: { id: true, name: true } },
      },
    });
    const now = new Date();
    return rows.map((r) => {
      const amounts = invoiceAmounts(r);
      return {
        ...r,
        ...amounts,
        balance: r.type === 'INVOICE' && r.status !== 'DRAFT' ? factureBalance(amounts) : null,
        overdue: isFactureOverdue({ ...r, ...amounts }, now),
      };
    });
  }

  async get(ctx: FactureContext, id: string) {
    const doc = await this.db.factureDocument.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      include: {
        lines: { orderBy: { position: 'asc' } },
        client: true,
        source: { select: { id: true, type: true, number: true, status: true } },
        derived: {
          select: { id: true, type: true, number: true, status: true },
          orderBy: { createdAt: 'asc' },
        },
        creditedInvoice: { select: { id: true, number: true } },
        creditNotes: {
          select: { id: true, number: true, status: true, totalTtc: true },
          orderBy: { createdAt: 'asc' },
        },
        payments: { orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }] },
        intervention: { select: { id: true, number: true } },
      },
    });
    if (!doc) throw new NotFoundException(NOT_FOUND);
    const { sellerSnapshot: _s, clientSnapshot, client, ...rest } = doc;
    const amounts = invoiceAmounts(doc);
    const billed = doc.type === 'INVOICE' && doc.status !== 'DRAFT';
    return {
      ...rest,
      ...amounts,
      balance: billed ? factureBalance(amounts) : null,
      overdue: isFactureOverdue({ ...doc, ...amounts }, new Date()),
      creditNotes: doc.creditNotes.map((c) => ({ ...c, totalTtc: Number(c.totalTtc) })),
      payments: doc.payments.map(({ organizationId: _o, invoiceId: _i, ...p }) => ({
        ...p,
        amount: Number(p.amount),
      })),
      totalHt: Number(doc.totalHt),
      totalVat: Number(doc.totalVat),
      totalTtc: Number(doc.totalTtc),
      vatBreakdown: doc.vatBreakdown as unknown as FactureVatBucket[],
      lines: doc.lines.map(lineView),
      // Document émis : identité du client figée à l'émission.
      client: {
        ...(clientSnapshot ? (clientSnapshot as object) : identityOf(client)),
        id: client.id,
      },
      clientArchived: client.isArchived,
    };
  }

  // ─── Brouillons ───

  async create(ctx: FactureContext, dto: CreateFactureDocumentDto) {
    const id = await this.db.$transaction((tx) => this.createDraft(tx, ctx, dto));
    await this.record(ctx, 'facture.document_created', id, { type: dto.type });
    return this.get(ctx, id);
  }

  /**
   * Crée un brouillon dans la transaction de l'appelant (création d'un document, facturation d'une
   * intervention) : client vérifié, valeurs proposées par les réglages, lignes et totaux recalculés.
   */
  async createDraft(tx: Tx, ctx: FactureContext, dto: CreateFactureDocumentDto): Promise<string> {
    const settings = await tx.factureSettings.findUnique({
      where: { organizationId: ctx.organizationId },
    });
    const withValidity = dto.type === 'QUOTE' || dto.type === 'PRO_FORMA';
    await this.assertClient(tx, ctx.organizationId, dto.clientId);
    const doc = await tx.factureDocument.create({
      data: {
        organizationId: ctx.organizationId,
        type: dto.type,
        createdByUserId: ctx.userId,
        ...this.draftFields(dto),
        // Valeurs proposées par les réglages, modifiables sur le brouillon.
        validityDays: withValidity ? (dto.validityDays ?? settings?.quoteValidityDays ?? 30) : null,
        paymentTermsDays:
          dto.type === 'INVOICE'
            ? (dto.paymentTermsDays ?? settings?.paymentTermsDays ?? DEFAULT_PAYMENT_TERMS_DAYS)
            : null,
        terms: dto.terms !== undefined ? dto.terms : (settings?.defaultTerms ?? null),
      },
      select: { id: true },
    });
    await this.writeLines(tx, ctx.organizationId, doc.id, dto.lines);
    return doc.id;
  }

  /** Remplace le contenu d'un brouillon (lignes comprises), sous verrou. */
  async update(ctx: FactureContext, id: string, dto: FactureDraftDto) {
    await this.db.$transaction(async (tx) => {
      const doc = await this.lock(tx, ctx.organizationId, id);
      if (doc.status !== 'DRAFT') {
        throw conflict('FACTURE_DOCUMENT_NOT_DRAFT', 'Un document émis ne se modifie plus.');
      }
      this.assertBilling(ctx, doc.type);
      if (doc.type === 'CREDIT_NOTE' && dto.clientId !== doc.clientId) {
        throw conflict(
          'FACTURE_CREDIT_NOTE_CLIENT',
          'Un avoir concerne toujours le client de la facture corrigée.',
        );
      }
      if (dto.clientId !== doc.clientId && (await this.interventionOf(tx, doc))) {
        throw conflict(
          'FACTURE_INTERVENTION_CLIENT',
          'La facture d’une intervention concerne toujours le client de l’intervention.',
        );
      }
      // Client d'un avoir : celui de la facture, même archivé depuis.
      if (doc.type !== 'CREDIT_NOTE') await this.assertClient(tx, ctx.organizationId, dto.clientId);
      const withValidity = doc.type === 'QUOTE' || doc.type === 'PRO_FORMA';
      await tx.factureDocumentLine.deleteMany({
        where: { organizationId: ctx.organizationId, documentId: id },
      });
      await tx.factureDocument.update({
        where: { organizationId_id: { organizationId: ctx.organizationId, id } },
        data: {
          ...this.draftFields(dto),
          ...(dto.terms !== undefined ? { terms: dto.terms } : {}),
          ...(withValidity && dto.validityDays !== undefined
            ? { validityDays: dto.validityDays }
            : {}),
          ...(doc.type === 'INVOICE' && dto.paymentTermsDays !== undefined
            ? { paymentTermsDays: dto.paymentTermsDays ?? DEFAULT_PAYMENT_TERMS_DAYS }
            : {}),
        },
      });
      await this.writeLines(tx, ctx.organizationId, id, dto.lines);
    });
    await this.record(ctx, 'facture.document_updated', id, { lines: dto.lines.length });
    return this.get(ctx, id);
  }

  /** Un brouillon se supprime (il n'a pas de numéro) ; un document émis s'annule. */
  async remove(ctx: FactureContext, id: string) {
    await this.db.$transaction(async (tx) => {
      const doc = await this.lock(tx, ctx.organizationId, id);
      if (doc.status !== 'DRAFT') {
        throw conflict(
          'FACTURE_DOCUMENT_NOT_DRAFT',
          FACTURE_FINAL_TYPES.includes(doc.type)
            ? 'Un document émis ne se supprime pas : la facture se corrige par un avoir.'
            : 'Un document émis ne se supprime pas : annulez-le.',
        );
      }
      this.assertBilling(ctx, doc.type);
      if (await this.interventionOf(tx, doc)) {
        throw conflict(
          'FACTURE_DOCUMENT_FROM_INTERVENTION',
          'Cette facture vient d’une intervention : complétez-la et émettez-la plutôt que de la supprimer.',
        );
      }
      await tx.factureDocument.delete({
        where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      });
    });
    await this.record(ctx, 'facture.document_deleted', id);
  }

  async duplicate(ctx: FactureContext, id: string) {
    const source = await this.row(this.db, ctx.organizationId, id);
    if (source.type === 'CREDIT_NOTE') {
      throw conflict('FACTURE_DOCUMENT_NOT_DUPLICABLE', 'Un avoir ne se duplique pas.');
    }
    const copy = await this.db.$transaction(async (tx) => {
      await this.assertClient(tx, ctx.organizationId, source.clientId);
      const doc = await tx.factureDocument.create({
        data: {
          ...this.copyFields(source),
          type: source.type,
          paymentTermsDays: source.paymentTermsDays,
          createdByUserId: ctx.userId,
        },
        select: { id: true },
      });
      await this.copyLines(tx, source, doc.id);
      return doc.id;
    });
    await this.record(ctx, 'facture.document_duplicated', copy, { from: id });
    return this.get(ctx, copy);
  }

  // ─── Émission et cycle de vie ───

  /**
   * Émission : contrôles (lignes, identité de l'entreprise enregistrée, motif d'exonération), numéro définitif attribué dans
   * la même transaction, identités du vendeur et du client figées. Deux émissions simultanées du même
   * brouillon : la seconde attend le verrou puis échoue (un seul numéro attribué).
   */
  async issue(ctx: FactureContext, id: string, now: Date = new Date()) {
    const number = await this.db.$transaction(async (tx) => {
      const doc = await this.lock(tx, ctx.organizationId, id);
      if (doc.status !== 'DRAFT') {
        throw conflict('FACTURE_DOCUMENT_NOT_DRAFT', 'Ce document est déjà émis.');
      }
      if (!FACTURE_ISSUABLE_TYPES.includes(doc.type)) {
        throw conflict('FACTURE_ISSUE_NOT_AVAILABLE', 'Ce document ne s’émet pas.');
      }
      this.assertBilling(ctx, doc.type);
      if (doc.lines.length === 0) {
        throw conflict('FACTURE_DOCUMENT_EMPTY', 'Ajoutez au moins une ligne avant d’émettre.');
      }
      const settings = await tx.factureSettings.findUnique({
        where: { organizationId: ctx.organizationId },
      });
      // Identité enregistrée exigée ; NIF, adresse et régime facultatifs (signalés, non bloquants).
      if (!settings) {
        throw conflict('SETTINGS_REQUIRED', 'Enregistrez d’abord l’identité de l’entreprise.');
      }
      if (doc.lines.some((l) => l.vatRate === 0) && !doc.vatExemptionReason) {
        throw conflict(
          'FACTURE_VAT_EXEMPTION_REASON_REQUIRED',
          'Une ligne est exonérée de TVA : indiquez le motif d’exonération.',
        );
      }
      const client = await tx.factureClient.findUniqueOrThrow({
        where: { organizationId_id: { organizationId: ctx.organizationId, id: doc.clientId } },
      });
      const issueDate = todayUtc(now);
      if (doc.type === 'CREDIT_NOTE') await this.applyCreditNote(tx, doc);
      const allocated = await allocateFactureNumber(tx, ctx.organizationId, doc.type, now);
      await tx.factureDocument.update({
        where: { organizationId_id: { organizationId: ctx.organizationId, id } },
        data: {
          status: 'ISSUED',
          number: allocated.number,
          year: allocated.year,
          sequence: allocated.sequence,
          issueDate,
          validUntil: doc.validityDays
            ? new Date(issueDate.getTime() + doc.validityDays * DAY)
            : null,
          ...(doc.type === 'INVOICE'
            ? {
                dueDate: new Date(
                  issueDate.getTime() + (doc.paymentTermsDays ?? DEFAULT_PAYMENT_TERMS_DAYS) * DAY,
                ),
              }
            : {}),
          issuedAt: now,
          issuedByUserId: ctx.userId,
          sellerSnapshot: {
            ...sellerOf(settings),
            salesperson: await this.personName(ctx.userId),
          } as unknown as Prisma.InputJsonValue,
          clientSnapshot: identityOf(client) as unknown as Prisma.InputJsonValue,
        },
      });
      return allocated.number;
    });
    await this.record(ctx, 'facture.document_issued', id, { number });
    return this.get(ctx, id);
  }

  async decide(ctx: FactureContext, id: string, decision: 'ACCEPTED' | 'REFUSED') {
    await this.db.$transaction(async (tx) => {
      const doc = await this.lock(tx, ctx.organizationId, id);
      if (!canAcceptFactureDocument(doc)) {
        throw conflict(
          'FACTURE_DOCUMENT_STATUS',
          FACTURE_ACCEPTABLE_TYPES.includes(doc.type)
            ? 'Seul un document émis, ni accepté ni refusé, peut recevoir la réponse du client.'
            : 'Seuls les devis et les pro forma sont acceptés ou refusés.',
        );
      }
      await tx.factureDocument.update({
        where: { organizationId_id: { organizationId: ctx.organizationId, id } },
        data:
          decision === 'ACCEPTED'
            ? { status: 'ACCEPTED', acceptedAt: new Date() }
            : { status: 'REFUSED', refusedAt: new Date() },
      });
    });
    await this.record(
      ctx,
      decision === 'ACCEPTED' ? 'facture.document_accepted' : 'facture.document_refused',
      id,
    );
    return this.get(ctx, id);
  }

  /** Annulation d'un document émis : son numéro reste attribué (aucun trou), son contenu est conservé. */
  async cancel(ctx: FactureContext, id: string, reason: string) {
    await this.db.$transaction(async (tx) => {
      const doc = await this.lock(tx, ctx.organizationId, id);
      if (!canCancelFactureDocument(doc)) {
        throw conflict(
          'FACTURE_DOCUMENT_STATUS',
          FACTURE_FINAL_TYPES.includes(doc.type)
            ? 'Une facture ou un avoir émis ne s’annule pas : la facture se corrige par un avoir.'
            : doc.status === 'DRAFT'
              ? 'Un brouillon se supprime, il ne s’annule pas.'
              : 'Ce document est déjà annulé.',
        );
      }
      const derived = await tx.factureDocument.count({
        where: {
          organizationId: ctx.organizationId,
          sourceDocumentId: id,
          status: { not: 'CANCELLED' },
        },
      });
      if (derived > 0) {
        throw conflict(
          'FACTURE_DOCUMENT_HAS_DERIVED',
          'Ce document a été converti : annulez ou supprimez d’abord les documents qui en découlent.',
        );
      }
      await tx.factureDocument.update({
        where: { organizationId_id: { organizationId: ctx.organizationId, id } },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason },
      });
    });
    await this.record(ctx, 'facture.document_cancelled', id);
    return this.get(ctx, id);
  }

  /**
   * Conversion (devis → pro forma, bon de commande ou facture ; pro forma → bon ou facture ; bon → facture) :
   * un nouveau brouillon reprend client, lignes et conditions, lié à son origine. Idempotente : une seule
   * conversion par origine et par type (la seconde demande renvoie le document déjà créé). Convertir un
   * devis ou une pro forma vaut acceptation par le client.
   */
  async convert(ctx: FactureContext, id: string, target: FactureDocumentType) {
    const result = await this.db.$transaction(async (tx) => {
      const source = await this.lock(tx, ctx.organizationId, id);
      const existing = await tx.factureDocument.findUnique({
        where: {
          organizationId_sourceDocumentId_type: {
            organizationId: ctx.organizationId,
            sourceDocumentId: id,
            type: target,
          },
        },
        select: { id: true },
      });
      if (existing) return { id: existing.id, created: false };
      if (!canConvertFactureDocument(source, target)) {
        throw conflict(
          'FACTURE_CONVERSION_NOT_ALLOWED',
          `Conversion impossible : ${FACTURE_DOCUMENT_TYPE_LABELS[source.type].toLowerCase()} ${
            source.status === 'DRAFT' ? 'non émis' : 'refusé ou annulé'
          }, ou vers ce type de document.`,
        );
      }
      await this.assertClient(tx, ctx.organizationId, source.clientId);
      const settings = await tx.factureSettings.findUnique({
        where: { organizationId: ctx.organizationId },
        select: { quoteValidityDays: true, paymentTermsDays: true },
      });
      const doc = await tx.factureDocument.create({
        data: {
          ...this.copyFields(source),
          type: target,
          sourceDocumentId: id,
          validityDays: target === 'PRO_FORMA' ? (settings?.quoteValidityDays ?? 30) : null,
          paymentTermsDays:
            target === 'INVOICE'
              ? (settings?.paymentTermsDays ?? DEFAULT_PAYMENT_TERMS_DAYS)
              : null,
          createdByUserId: ctx.userId,
        },
        select: { id: true },
      });
      await this.copyLines(tx, source, doc.id);
      if (FACTURE_ACCEPTABLE_TYPES.includes(source.type) && source.status !== 'ACCEPTED') {
        await tx.factureDocument.update({
          where: { organizationId_id: { organizationId: ctx.organizationId, id } },
          data: { status: 'ACCEPTED', acceptedAt: new Date() },
        });
      }
      return { id: doc.id, created: true };
    });
    if (result.created) {
      await this.record(ctx, 'facture.document_converted', result.id, { from: id, type: target });
    }
    return this.get(ctx, result.id);
  }

  // ─── Avoirs ───

  /**
   * Avoir sur une facture émise : un brouillon reprend son client et ses lignes (à ajuster pour un avoir
   * partiel). Un seul avoir en brouillon à la fois par facture (une seconde demande le renvoie). Le
   * plafond (TTC de la facture moins les avoirs déjà émis) est contrôlé à l'émission de l'avoir.
   */
  async createCreditNote(ctx: FactureContext, invoiceId: string) {
    this.assertBilling(ctx, 'CREDIT_NOTE');
    const result = await this.db.$transaction(async (tx) => {
      const invoice = await this.lock(tx, ctx.organizationId, invoiceId);
      const draft = await tx.factureDocument.findFirst({
        where: {
          organizationId: ctx.organizationId,
          creditedInvoiceId: invoiceId,
          status: 'DRAFT',
        },
        select: { id: true },
      });
      if (draft) return { id: draft.id, created: false };
      if (!canCreditFactureInvoice({ ...invoice, ...invoiceAmounts(invoice) })) {
        throw conflict(
          'FACTURE_CREDIT_NOT_ALLOWED',
          invoice.type !== 'INVOICE' || invoice.status === 'DRAFT'
            ? 'Un avoir se crée sur une facture émise.'
            : 'Cette facture est déjà entièrement couverte par des avoirs.',
        );
      }
      const doc = await tx.factureDocument.create({
        data: {
          ...this.copyFields(invoice),
          type: 'CREDIT_NOTE',
          creditedInvoiceId: invoiceId,
          subject: `Avoir sur la facture ${invoice.number}`,
          validityDays: null,
          terms: null,
          createdByUserId: ctx.userId,
        },
        select: { id: true },
      });
      await this.copyLines(tx, invoice, doc.id);
      return { id: doc.id, created: true };
    });
    if (result.created) {
      await this.record(ctx, 'facture.credit_note_created', result.id, { invoice: invoiceId });
    }
    return this.get(ctx, result.id);
  }

  /**
   * Émission d'un avoir, dans la même transaction et sous verrou de la facture corrigée : montant
   * positif, plafonné au TTC de la facture moins les avoirs déjà émis. La facture est créditée d'autant
   * et son statut recalculé (« annulée par avoir » sans encaissement ; sinon trop-perçu éventuel).
   */
  private async applyCreditNote(tx: Tx, note: DocumentRow) {
    const invoice = await this.lock(tx, note.organizationId, note.creditedInvoiceId!);
    const amounts = invoiceAmounts(invoice);
    const available = amounts.totalTtc - amounts.amountCredited;
    const credit = Number(note.totalTtc);
    if (credit <= 0) {
      throw conflict('FACTURE_CREDIT_NOTE_EMPTY', 'Le montant de l’avoir doit être positif.');
    }
    if (credit > available) {
      throw conflict(
        'FACTURE_CREDIT_EXCEEDS_INVOICE',
        `L’avoir dépasse le montant restant à créditer sur la facture (${formatXof(available)}).`,
        { details: { available } },
      );
    }
    // TVA : un avoir ne corrige que des taux présents sur la facture, sans dépasser, taux par taux, la
    // base hors taxe facturée (avoirs déjà émis compris) — jamais de TVA déduite qui n'a pas été facturée.
    const issued = await tx.factureDocument.findMany({
      where: {
        organizationId: note.organizationId,
        creditedInvoiceId: invoice.id,
        status: { not: 'DRAFT' },
        id: { not: note.id },
      },
      select: { vatBreakdown: true },
    });
    const baseByRate = (buckets: FactureVatBucket[]) =>
      buckets.reduce(
        (m, b) => m.set(b.rate, (m.get(b.rate) ?? 0) + b.base),
        new Map<number, number>(),
      );
    const invoiced = baseByRate(invoice.vatBreakdown as unknown as FactureVatBucket[]);
    const credited = baseByRate(
      issued.flatMap((d) => d.vatBreakdown as unknown as FactureVatBucket[]),
    );
    for (const [rate, base] of baseByRate(note.vatBreakdown as unknown as FactureVatBucket[])) {
      const left = (invoiced.get(rate) ?? 0) - (credited.get(rate) ?? 0);
      if (base > left) {
        throw conflict(
          'FACTURE_CREDIT_NOTE_VAT',
          invoiced.has(rate)
            ? `L’avoir dépasse la base hors taxe restant à créditer au taux de ${rate} % (${formatXof(Math.max(0, left))}).`
            : `La facture ne comporte aucune ligne au taux de ${rate} % : l’avoir doit reprendre ses taux.`,
          { details: { rate, available: Math.max(0, left) } },
        );
      }
    }
    const next = { ...amounts, amountCredited: amounts.amountCredited + credit };
    await tx.factureDocument.update({
      where: { organizationId_id: { organizationId: note.organizationId, id: invoice.id } },
      data: {
        amountCredited: BigInt(next.amountCredited),
        status: factureInvoiceStatus({ ...next, sent: invoice.sentAt !== null }),
      },
    });
  }

  // ─── PDF et envoi ───

  async pdf(ctx: FactureContext, id: string): Promise<{ body: Buffer; filename: string }> {
    const doc = await this.row(this.db, ctx.organizationId, id);
    const [seller, client, source] = await Promise.all([
      doc.sellerSnapshot
        ? (doc.sellerSnapshot as unknown as FactureSellerIdentity)
        : this.liveSeller(ctx.organizationId),
      doc.clientSnapshot
        ? (doc.clientSnapshot as unknown as FactureClientIdentity)
        : this.db.factureClient
            .findUniqueOrThrow({
              where: {
                organizationId_id: { organizationId: ctx.organizationId, id: doc.clientId },
              },
            })
            .then(identityOf),
      // Document d'origine imprimé : la facture corrigée pour un avoir, sinon la conversion.
      (doc.creditedInvoiceId ?? doc.sourceDocumentId)
        ? this.db.factureDocument.findUnique({
            where: {
              organizationId_id: {
                organizationId: ctx.organizationId,
                id: (doc.creditedInvoiceId ?? doc.sourceDocumentId)!,
              },
            },
            select: { number: true },
          })
        : null,
    ]);
    const lines = doc.lines.map(lineView);
    const totals = computeFactureTotals(lines);
    const salesperson =
      (doc.sellerSnapshot as { salesperson?: { name: string; loginId: string } | null } | null)
        ?.salesperson ?? (await this.personName(doc.createdByUserId));
    const body = await renderFactureDocumentPdf(
      seller,
      client,
      {
        type: doc.type,
        number: doc.number,
        issueDate: doc.issueDate,
        issuedAt: doc.issuedAt,
        validUntil: doc.validUntil,
        dueDate: doc.dueDate,
        paymentTermsDays: doc.paymentTermsDays,
        subject: doc.subject,
        clientReference: doc.clientReference,
        salesperson,
        notes: doc.notes,
        terms: doc.terms,
        vatExemptionReason: doc.vatExemptionReason,
        sourceNumber: source?.number ?? null,
        grossHt: totals.grossHt,
        totalDiscount: totals.totalDiscount,
        totalHt: Number(doc.totalHt),
        totalVat: Number(doc.totalVat),
        totalTtc: Number(doc.totalTtc),
        vat: doc.vatBreakdown as unknown as FactureVatBucket[],
        lines,
      },
      await loadFactureLogos(this.db, this.storage, ctx.organizationId),
    );
    return { body, filename: `${doc.number ?? `brouillon-${doc.id.slice(0, 8)}`}.pdf` };
  }

  /**
   * Envoi par e-mail d'un document émis, PDF en pièce jointe, réponse adressée à l'entreprise. Le statut
   * passe à « envoyé » seulement si le fournisseur accepte le message. Chaque envoi demandé est un nouvel
   * envoi (clé d'idempotence : document et rang d'envoi, contre le double clic).
   */
  async send(ctx: FactureContext, id: string, dto: SendFactureDocumentDto) {
    const doc = await this.row(this.db, ctx.organizationId, id);
    if (!FACTURE_LIVE_STATUSES.includes(doc.status)) {
      throw conflict(
        'FACTURE_DOCUMENT_NOT_SENDABLE',
        doc.status === 'DRAFT'
          ? 'Émettez le document avant de l’envoyer.'
          : 'Un document refusé ou annulé ne s’envoie plus.',
      );
    }
    const label = FACTURE_DOCUMENT_TYPE_LABELS[doc.type];
    await this.deliver(ctx, doc, dto, {
      subject: label,
      tag: 'facture-document',
      idempotencyKey: `facture-document/${id}/${doc.sentCount + 1}`,
      paragraphs: [
        `Veuillez trouver ci-joint notre ${label.toLowerCase()} n° ${doc.number}${
          doc.subject ? ` (${doc.subject})` : ''
        }, d’un montant de ${formatXof(Number(doc.totalTtc))} TTC.`,
      ],
    });
    // Statut relu au moment d'écrire : seul un document encore « émis » passe à « envoyé » (une facture
    // soldée ou un devis accepté pendant l'envoi gardent leur statut).
    await this.db.$transaction([
      this.db.factureDocument.update({
        where: { organizationId_id: { organizationId: ctx.organizationId, id } },
        data: { sentAt: new Date(), sentCount: { increment: 1 } },
      }),
      this.db.factureDocument.updateMany({
        where: { organizationId: ctx.organizationId, id, status: 'ISSUED' },
        data: { status: 'SENT' },
      }),
    ]);
    // Destinataire jamais journalisé (donnée personnelle) : seul le rang d'envoi l'est.
    await this.record(ctx, 'facture.document_sent', id, { sendRank: doc.sentCount + 1 });
    return this.get(ctx, id);
  }

  /**
   * Relance d'une facture émise qui reste à encaisser : e-mail rappelant le reste dû et l'échéance,
   * facture en pièce jointe. Comptée seulement si le fournisseur accepte le message ; clé d'idempotence
   * par rang de relance (contre le double clic).
   */
  async remind(ctx: FactureContext, id: string, dto: SendFactureDocumentDto, now = new Date()) {
    const doc = await this.row(this.db, ctx.organizationId, id);
    const amounts = invoiceAmounts(doc);
    if (!canRecordFacturePayment({ ...doc, ...amounts })) {
      throw conflict(
        'FACTURE_REMINDER_NOT_ALLOWED',
        'Seule une facture émise qui reste à encaisser se relance.',
      );
    }
    const due = doc.dueDate!;
    const late = due.getTime() < todayUtc(now).getTime();
    const rank = doc.reminderCount + 1;
    await this.deliver(ctx, doc, dto, {
      subject: `Relance — facture`,
      tag: 'facture-reminder',
      idempotencyKey: `facture-document/${id}/reminder/${rank}`,
      paragraphs: [
        `Sauf erreur de notre part, notre facture n° ${doc.number} du ${dateFr(doc.issueDate!)}, ${
          late ? `échue le ${dateFr(due)}` : `payable au plus tard le ${dateFr(due)}`
        }, présente un reste à payer de ${formatXof(factureBalance(amounts))}.`,
        `Nous vous remercions de bien vouloir procéder à son règlement. Si celui-ci est déjà parti, merci de ne pas tenir compte de ce message.`,
      ],
    });
    await this.db.factureDocument.update({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      data: { reminderCount: { increment: 1 }, lastReminderAt: now },
    });
    await this.record(ctx, 'facture.invoice_reminded', id, { reminderRank: rank });
    return this.get(ctx, id);
  }

  /**
   * Envoi d'un document émis par e-mail, PDF en pièce jointe, réponse adressée à l'entreprise. Échoue
   * (502) si le fournisseur refuse le message : rien n'est alors compté comme envoyé.
   */
  private async deliver(
    ctx: FactureContext,
    doc: DocumentRow,
    dto: SendFactureDocumentDto,
    mail: { subject: string; tag: string; idempotencyKey: string; paragraphs: string[] },
  ) {
    const client = doc.clientSnapshot as unknown as FactureClientIdentity;
    const seller = doc.sellerSnapshot as unknown as FactureSellerIdentity;
    const to = dto.to ?? client.email;
    if (!to) {
      throw new BadRequestException({
        code: 'FACTURE_RECIPIENT_REQUIRED',
        message: 'Le client n’a pas d’e-mail : indiquez un destinataire.',
      });
    }
    if (!this.mail.enabled) {
      throw conflict('MAIL_DISABLED', 'L’envoi d’e-mails n’est pas activé sur cette plateforme.');
    }
    const { body, filename } = await this.pdf(ctx, doc.id);
    const brand = seller.tradeName ?? seller.legalName;
    const content = composeMail(
      { brand, signature: seller.legalName },
      `${mail.subject} ${doc.number} — ${brand}`,
      [
        `Bonjour${client.contactName ? ` ${client.contactName}` : ''},`,
        ...(dto.message ? [dto.message] : []),
        ...mail.paragraphs,
        seller.email
          ? `Pour toute question, répondez simplement à cet e-mail.`
          : `Pour toute question, contactez-nous${seller.phone ? ` au ${seller.phone}` : ''}.`,
      ],
    );
    const sent = await this.mail.send({
      to: [to],
      ...content,
      tag: mail.tag,
      idempotencyKey: mail.idempotencyKey,
      ...(seller.email ? { replyTo: seller.email } : {}),
      attachments: [{ filename, content: body }],
    });
    if (!sent) {
      throw new BadGatewayException({
        code: 'MAIL_NOT_SENT',
        message: 'L’e-mail n’a pas pu être envoyé. Réessayez dans quelques instants.',
      });
    }
  }

  // ─── Outils internes ───

  /** Avoirs : réservés aux rôles qui gèrent la facturation (gérant, comptable). */
  private assertBilling(ctx: FactureContext, type: FactureDocumentType) {
    if (type === 'CREDIT_NOTE' && !hasFacturePermission(ctx.role, 'facture.billing.manage')) {
      throw new ForbiddenException({
        code: 'FACTURE_FORBIDDEN',
        message: 'Les avoirs sont réservés au gérant et au comptable.',
      });
    }
  }

  private draftFields(dto: FactureDraftDto) {
    return {
      clientId: dto.clientId,
      subject: dto.subject ?? null,
      clientReference: dto.clientReference ?? null,
      notes: dto.notes ?? null,
      vatExemptionReason: dto.vatExemptionReason ?? null,
    };
  }

  private copyFields(source: DocumentRow) {
    return {
      organizationId: source.organizationId,
      clientId: source.clientId,
      subject: source.subject,
      clientReference: source.clientReference,
      notes: source.notes,
      terms: source.terms,
      vatExemptionReason: source.vatExemptionReason,
      validityDays: source.validityDays,
      totalHt: source.totalHt,
      totalVat: source.totalVat,
      totalTtc: source.totalTtc,
      vatBreakdown: source.vatBreakdown as Prisma.InputJsonValue,
    };
  }

  /** Lignes et totaux recalculés côté serveur ; un article doit appartenir à l'organisation. */
  private async writeLines(
    tx: Tx,
    organizationId: string,
    documentId: string,
    lines: FactureLineDto[],
  ) {
    const input = lines.map((l) => ({ ...l, discountPercent: l.discountPercent ?? 0 }));
    const totals = computeFactureTotals(input);
    if (totals.totalTtc > FACTURE_MAX_DOCUMENT_TOTAL) {
      throw new BadRequestException({
        code: 'FACTURE_DOCUMENT_TOO_LARGE',
        message: 'Montant total trop élevé pour un seul document.',
      });
    }
    const itemIds = [...new Set(input.map((l) => l.itemId).filter((v): v is string => Boolean(v)))];
    if (itemIds.length > 0) {
      const found = await tx.factureItem.count({ where: { organizationId, id: { in: itemIds } } });
      if (found !== itemIds.length) {
        throw new NotFoundException({
          code: 'FACTURE_ITEM_NOT_FOUND',
          message: 'Article introuvable.',
        });
      }
    }
    if (input.length > 0) {
      await tx.factureDocumentLine.createMany({
        data: input.map((l, position) => ({
          organizationId,
          documentId,
          position,
          itemId: l.itemId ?? null,
          reference: l.reference ?? null,
          label: l.label,
          description: l.description ?? null,
          unit: l.unit,
          quantity: new Prisma.Decimal(l.quantity),
          unitPrice: l.unitPrice,
          discountPercent: l.discountPercent,
          vatRate: l.vatRate,
          totalHt: BigInt(totals.lines[position]!),
        })),
      });
    }
    await tx.factureDocument.update({
      where: { organizationId_id: { organizationId, id: documentId } },
      data: {
        totalHt: BigInt(totals.totalHt),
        totalVat: BigInt(totals.totalVat),
        totalTtc: BigInt(totals.totalTtc),
        vatBreakdown: totals.vat as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async copyLines(tx: Tx, source: DocumentRow, documentId: string) {
    if (source.lines.length === 0) return;
    await tx.factureDocumentLine.createMany({
      data: source.lines.map(({ id: _id, documentId: _d, ...line }) => ({ ...line, documentId })),
    });
  }

  private async assertClient(tx: Tx, organizationId: string, clientId: string) {
    const client = await tx.factureClient.findUnique({
      where: { organizationId_id: { organizationId, id: clientId } },
      select: { isArchived: true },
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
  }

  /** Intervention facturée par ce document (F3), s'il en vient. */
  private interventionOf(tx: Tx, doc: { organizationId: string; id: string; type: string }) {
    if (doc.type !== 'INVOICE') return Promise.resolve(null);
    return tx.factureIntervention.findUnique({
      where: {
        organizationId_invoiceId: { organizationId: doc.organizationId, invoiceId: doc.id },
      },
      select: { id: true },
    });
  }

  /** Verrouille le document (et le lit avec ses lignes) jusqu'à la fin de la transaction. */
  async lock(tx: Tx, organizationId: string, id: string): Promise<DocumentRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "FactureDocument"
      WHERE "organizationId" = ${organizationId}::uuid AND "id" = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundException(NOT_FOUND);
    return this.row(tx, organizationId, id);
  }

  private async row(db: Tx | FacturePrismaService, organizationId: string, id: string) {
    const doc = await db.factureDocument.findUnique({
      where: { organizationId_id: { organizationId, id } },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
    if (!doc) throw new NotFoundException(NOT_FOUND);
    return doc;
  }

  private async liveSeller(organizationId: string): Promise<FactureSellerIdentity> {
    const settings = await this.db.factureSettings.findUnique({ where: { organizationId } });
    if (!settings) {
      throw conflict('SETTINGS_REQUIRED', 'Enregistrez d’abord l’identité de l’entreprise.');
    }
    return sellerOf(settings);
  }

  /** Vendeur imprimé : prénom, nom et identifiant de connexion du compte (base Suite). */
  private async personName(userId: string): Promise<{ name: string; loginId: string } | null> {
    const user = await this.core.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, loginId: true },
    });
    return user
      ? { name: `${user.firstName} ${user.lastName}`.trim(), loginId: user.loginId }
      : null;
  }

  record(
    ctx: FactureContext,
    action: string,
    targetId: string,
    metadata?: Record<string, string | number>,
  ) {
    return this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action,
      targetType: 'FactureDocument',
      targetId,
      ...(metadata ? { metadata } : {}),
    });
  }
}

/** Montants de facturation d'un document, en nombres (FCFA entiers, exacts). */
export function invoiceAmounts(doc: {
  totalTtc: bigint;
  amountPaid: bigint;
  amountCredited: bigint;
}) {
  return {
    totalTtc: Number(doc.totalTtc),
    amountPaid: Number(doc.amountPaid),
    amountCredited: Number(doc.amountCredited),
  };
}

function lineView(line: {
  id?: string;
  position: number;
  itemId: string | null;
  reference: string | null;
  label: string;
  description: string | null;
  unit: string;
  quantity: Prisma.Decimal;
  unitPrice: number;
  discountPercent: number;
  vatRate: number;
  totalHt: bigint;
}) {
  return {
    id: line.id,
    position: line.position,
    itemId: line.itemId,
    reference: line.reference,
    label: line.label,
    description: line.description,
    unit: line.unit,
    quantity: Number(line.quantity.toString()),
    unitPrice: line.unitPrice,
    discountPercent: line.discountPercent,
    vatRate: line.vatRate,
    totalHt: Number(line.totalHt),
  };
}

function identityOf(client: FactureClientIdentity): FactureClientIdentity {
  return {
    name: client.name,
    contactName: client.contactName,
    email: client.email,
    phone: client.phone,
    address: client.address,
    city: client.city,
    country: client.country,
    nif: client.nif,
    rccm: client.rccm,
    rib: client.rib ?? null,
    description: client.description ?? null,
  };
}

function sellerOf(settings: FactureSellerIdentity): FactureSellerIdentity {
  return {
    legalName: settings.legalName,
    tradeName: settings.tradeName,
    description: settings.description ?? null,
    address: settings.address,
    city: settings.city,
    country: settings.country,
    phone: settings.phone,
    email: settings.email,
    nif: settings.nif,
    rccm: settings.rccm,
    taxRegime: settings.taxRegime,
    bankDetails: settings.bankDetails,
    legalFooter: settings.legalFooter,
    accentColor: settings.accentColor,
  };
}
