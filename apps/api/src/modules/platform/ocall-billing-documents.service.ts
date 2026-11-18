import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type InvoiceLineKind,
  type OcallLegalIdentity,
  SUBSCRIPTION_PAYMENT_METHOD_LABELS,
  type SubscriptionPaymentMethod,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { NO_FACTURE_LOGOS, type FactureLetterheadIdentity } from '../../common/pdf/letterhead';
import {
  type FacturePdfLine,
  renderFactureDocumentPdf,
} from '../../common/pdf/commercial-document-pdf';
import { LegalIdentityService } from './legal-identity.service';
import { renderOcallReceiptPdf } from './ocall-receipt-pdf';

/** Couleur des documents Ocall (vert de la marque, identique à l'en-tête Facture par défaut). */
const OCALL_ACCENT = '#1f6f4a';

const UNITS: Record<InvoiceLineKind, string> = {
  SETUP: '',
  MONTHLY: 'mois',
  ADJUSTMENT: '',
  EXTRA_SITES: 'site·mois',
  SHOWCASE: 'mois',
  SITE_PRORATA: '',
};

const dateFr = (d: Date) =>
  d.toLocaleDateString('fr-FR', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

const PROVISIONAL_INVOICE = {
  notice:
    'FACTURE PROVISOIRE — les mentions légales obligatoires de l’émetteur n’étaient pas renseignées à l’émission : ce document n’est pas une facture définitive.',
  watermark: 'PROVISOIRE',
};
const PROVISIONAL_RECEIPT = {
  notice:
    'REÇU PROVISOIRE — la facture réglée n’est pas une facture définitive (mentions légales de l’émetteur incomplètes à son émission).',
  watermark: 'PROVISOIRE',
};

/** Identité imprimée : jamais complétée par une valeur inventée ; « Ocall Suite » si la raison sociale manque. */
function letterhead(identity: OcallLegalIdentity): FactureLetterheadIdentity {
  const legalFooter = [
    identity.legalForm,
    identity.shareCapital ? `Capital : ${identity.shareCapital}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');
  return {
    legalName: identity.legalName ?? 'Ocall Suite',
    tradeName: identity.tradeName,
    description: null,
    address: identity.address,
    city: [identity.city, identity.country].filter(Boolean).join(', ') || null,
    country: '',
    phone: identity.phone,
    email: identity.email,
    nif: identity.nif,
    rccm: identity.rccm,
    taxRegime: identity.taxRegime,
    bankDetails: identity.bankDetails,
    legalFooter: legalFooter || null,
  };
}

/**
 * Factures et reçus d'abonnement Ocall en PDF (commercialisation J2). Moteur de documents d'Ocall
 * Facture, mais facturation Ocall indépendante : l'émetteur est l'identité légale d'Ocall, figée sur la
 * facture à son émission ; aucune donnée d'Ocall Facture n'est lue. Rendu en mémoire, jamais stocké.
 *
 * `organizationId` : espace client, limité aux documents de l'organisation (404 sinon).
 */
@Injectable()
export class OcallBillingDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly legal: LegalIdentityService,
  ) {}

  async invoicePdf(id: string, organizationId?: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
      select: {
        number: true,
        status: true,
        total: true,
        issuedAt: true,
        dueAt: true,
        paidAt: true,
        cancelledAt: true,
        cancelReason: true,
        notes: true,
        issuerSnapshot: true,
        organization: { select: { name: true, code: true, countryCode: true } },
        product: { select: { name: true } },
        lines: {
          orderBy: { position: 'asc' },
          select: {
            kind: true,
            label: true,
            quantity: true,
            unitAmount: true,
            amount: true,
            reason: true,
          },
        },
      },
    });
    if (!invoice) {
      throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Facture introuvable.' });
    }
    const snapshot = invoice.issuerSnapshot as OcallLegalIdentity | null;
    const issuer = snapshot ?? (await this.legal.current());
    const lines: FacturePdfLine[] = invoice.lines.map((l) => ({
      reference: null,
      label: l.label,
      description: l.reason,
      unit: UNITS[l.kind],
      quantity: l.quantity,
      unitPrice: l.unitAmount,
      discountPercent: 0,
      vatRate: 0,
      totalHt: l.amount,
    }));
    const notes = [
      invoice.notes,
      invoice.status === 'PAID' && invoice.paidAt
        ? `Facture acquittée le ${dateFr(invoice.paidAt)}.`
        : null,
    ]
      .filter(Boolean)
      .join('\n');
    const provisional =
      invoice.status === 'CANCELLED'
        ? {
            notice: `FACTURE ANNULÉE${invoice.cancelledAt ? ` le ${dateFr(invoice.cancelledAt)}` : ''}${invoice.cancelReason ? ` : ${invoice.cancelReason}` : ''}.`,
            watermark: 'ANNULÉE',
          }
        : snapshot
          ? null
          : PROVISIONAL_INVOICE;
    const body = await renderFactureDocumentPdf(
      { ...letterhead(issuer), accentColor: OCALL_ACCENT },
      {
        name: invoice.organization.name,
        contactName: null,
        email: null,
        phone: null,
        address: null,
        city: null,
        country: invoice.organization.countryCode,
        nif: null,
        rccm: null,
        rib: null,
        description: `Client Ocall ${invoice.organization.code}`,
      },
      {
        type: 'INVOICE',
        number: invoice.number,
        issueDate: invoice.issuedAt,
        issuedAt: invoice.issuedAt,
        validUntil: null,
        dueDate: invoice.dueAt,
        paymentTermsDays: null,
        subject: `Abonnement ${invoice.product.name}`,
        clientReference: null,
        salesperson: null,
        establishment: null,
        notes: notes || null,
        terms: null,
        vatExemptionReason: null,
        sourceNumber: null,
        grossHt: invoice.total,
        totalDiscount: 0,
        totalHt: invoice.total,
        totalVat: 0,
        totalTtc: invoice.total,
        vat: [],
        lines,
        provisional,
        untaxed: {
          title: 'Régime fiscal',
          text: issuer.taxRegime ?? 'Mention fiscale de l’émetteur non renseignée.',
        },
        signatures: false,
      },
      NO_FACTURE_LOGOS,
      {
        creator: 'Ocall Suite',
        title: `${provisional === PROVISIONAL_INVOICE ? 'Facture provisoire' : 'Facture'} ${invoice.number}`,
      },
    );
    return { body, filename: `Facture-${invoice.number}.pdf`, definitive: snapshot !== null };
  }

  async receiptPdf(paymentId: string, organizationId?: string) {
    const payment = await this.prisma.subscriptionPayment.findFirst({
      where: { id: paymentId, ...(organizationId ? { organizationId } : {}) },
      select: {
        id: true,
        status: true,
        amount: true,
        method: true,
        reference: true,
        receiptNumber: true,
        paidAt: true,
        validatedAt: true,
        refundedAt: true,
        periodStart: true,
        periodEnd: true,
        organization: { select: { name: true, code: true } },
        subscription: { select: { product: { select: { name: true } } } },
        invoice: { select: { number: true, issuerSnapshot: true } },
      },
    });
    if (!payment) {
      throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Règlement introuvable.' });
    }
    if (payment.status !== 'CONFIRMED' && payment.status !== 'REFUNDED') {
      throw new ConflictException({
        code: 'RECEIPT_NOT_AVAILABLE',
        message: 'Le reçu est disponible une fois le règlement confirmé par Ocall.',
      });
    }
    const snapshot = (payment.invoice?.issuerSnapshot ?? null) as OcallLegalIdentity | null;
    const issuer = snapshot ?? (await this.legal.current());
    const number = payment.receiptNumber ?? `REG-${payment.id.slice(0, 8).toUpperCase()}`;
    const body = await renderOcallReceiptPdf(letterhead(issuer), OCALL_ACCENT, {
      number,
      client: payment.organization,
      amount: payment.amount,
      method:
        SUBSCRIPTION_PAYMENT_METHOD_LABELS[payment.method as SubscriptionPaymentMethod] ??
        payment.method,
      reference: payment.reference,
      paidAt: payment.paidAt,
      confirmedAt: payment.validatedAt,
      invoiceNumber: payment.invoice?.number ?? null,
      product: payment.subscription.product.name,
      periodStart: payment.periodStart,
      periodEnd: payment.periodEnd,
      refundedAt: payment.status === 'REFUNDED' ? payment.refundedAt : null,
      provisional: snapshot ? null : PROVISIONAL_RECEIPT,
    });
    return { body, filename: `Recu-${number}.pdf`, definitive: snapshot !== null };
  }
}
