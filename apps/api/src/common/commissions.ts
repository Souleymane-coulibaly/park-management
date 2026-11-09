import type { Prisma } from '@ocall/database';
import {
  PARK_APP_PRODUCT_CODES,
  PARK_PRODUCT_CODE,
  allocatePayment,
  commissionPayableFrom,
  computeCommissions,
} from '@ocall/shared';

type Tx = Prisma.TransactionClient;

/**
 * Moteur de commissions des partenaires (Sprint 12B, étendu au Sprint S3), appelé dans la transaction
 * de la confirmation d'un règlement. Règles :
 * - uniquement sur un règlement CONFIRMÉ et facturé (jamais une déclaration, une demande de paiement,
 *   un essai gratuit ni l'offre School Free, qui ne produisent aucun règlement) ;
 * - uniquement si l'application payée a une attribution CONFIRMÉE à un partenaire ACTIF (attribution de
 *   l'application, ou attribution antérieure « toutes applications ») ;
 * - uniquement selon une règle VALIDÉE par Ocall : celle figée sur l'attribution (conditions
 *   contractuelles conservées), sinon la règle du partenaire, puis la plus précise des règles actives
 *   (type de partenaire et application) ; aucune règle validée → aucune commission ;
 * - date de règlement : fin du mois suivant l'encaissement ;
 * - une commission par règlement et par nature (contrainte d'unicité : aucun doublon).
 */
export async function accrueCommissions(tx: Tx, paymentId: string): Promise<number> {
  const p = await tx.subscriptionPayment.findUniqueOrThrow({
    where: { id: paymentId },
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      paidAt: true,
      organizationId: true,
      invoice: { select: { total: true, lines: { select: { kind: true, amount: true } } } },
      subscription: {
        select: { startedAt: true, productId: true, product: { select: { code: true } } },
      },
    },
  });
  if (p.status !== 'CONFIRMED' || !p.invoice || p.amount <= 0) return 0;
  const productId = p.subscription.productId;
  const scope = await attributionScope(tx, productId);
  const attribution = await tx.attribution.findFirst({
    where: {
      organizationId: p.organizationId,
      status: 'CONFIRMED',
      ...coveringAttributions(scope.productIds),
    },
    // Attribution de l'application avant une attribution antérieure « toutes applications ».
    orderBy: [{ productId: { sort: 'asc', nulls: 'last' } }],
    select: {
      id: true,
      partnerId: true,
      rule: true,
      partner: { select: { status: true, type: true, commissionRule: true } },
    },
  });
  if (!attribution || attribution.partner.status !== 'ACTIVE') return 0;
  const rule = await applicableRule(tx, {
    frozen: attribution.rule,
    partnerRule: attribution.partner.commissionRule,
    partnerType: attribution.partner.type,
    // Règle de l'application commerciale (Ocall Park pour toute la famille Park) ou du produit exact.
    productIds: [...new Set([productId, scope.canonicalId])],
  });
  if (!rule) return 0;
  const allocation = allocatePayment(p.invoice.lines, p.invoice.total, p.amount);
  // Prime de setup versée UNE SEULE FOIS par organisation et application (décision client), même
  // réglé en plusieurs fois ou après une réattribution : base cumulée plafonnée au setup facturé.
  if (allocation.setup > 0) {
    const fee = await tx.productSetupFee.findUnique({
      where: { organizationId_productId: { organizationId: p.organizationId, productId } },
      select: { amount: true },
    });
    const already = await tx.commission.aggregate({
      where: {
        organizationId: p.organizationId,
        productId,
        kind: 'SETUP',
        status: { not: 'REVERSED' },
        // Prime d'un règlement remboursé : compensée par une régularisation, le plafond est rendu
        // (le setup encaissé de nouveau est commissionné une fois, et une seule).
        NOT: { subscriptionPayment: { status: 'REFUNDED' } },
      },
      _sum: { baseAmount: true },
    });
    const remaining = Math.max(
      0,
      (fee?.amount ?? allocation.setup) - (already._sum.baseAmount ?? 0),
    );
    allocation.setup = Math.min(allocation.setup, remaining);
  }
  const lines = computeCommissions({
    allocation,
    rule,
    windowStart: p.subscription.startedAt ?? p.paidAt,
    paidAt: p.paidAt,
  });
  if (lines.length === 0) return 0;
  const payableFrom = commissionPayableFrom(p.paidAt);
  const created = await tx.commission.createMany({
    data: lines.map((l) => ({
      partnerId: attribution.partnerId,
      attributionId: attribution.id,
      subscriptionPaymentId: p.id,
      organizationId: p.organizationId,
      productId,
      kind: l.kind,
      baseAmount: l.baseAmount,
      rateBps: l.rateBps,
      amount: l.amount,
      currency: p.currency,
      payableFrom,
    })),
    skipDuplicates: true,
  });
  return created.count;
}

/**
 * Périmètre d'attribution d'une application. La famille Ocall Park (Park, Restaurant, Park +
 * Restaurant) forme une seule application commerciale « Ocall Park » : `canonicalId` est l'application
 * des attributions et des règles, `productIds` les produits qu'elle couvre.
 */
export async function attributionScope(
  tx: Tx,
  productId: string,
): Promise<{ canonicalId: string; productIds: string[] }> {
  const product = await tx.saasProduct.findUniqueOrThrow({
    where: { id: productId },
    select: { code: true },
  });
  if (!PARK_APP_PRODUCT_CODES.includes(product.code)) {
    return { canonicalId: productId, productIds: [productId] };
  }
  const family = await tx.saasProduct.findMany({
    where: { code: { in: [...PARK_APP_PRODUCT_CODES] } },
    select: { id: true, code: true },
  });
  return {
    canonicalId: family.find((f) => f.code === PARK_PRODUCT_CODE)?.id ?? productId,
    productIds: family.map((f) => f.id),
  };
}

/** Attributions couvrant ces produits : celles de l'application, ou antérieures « toutes applications ». */
export const coveringAttributions = (productIds: string[]) => ({
  OR: [{ productId: { in: productIds } }, { productId: null }],
});

type Rule = {
  id: string;
  setupRateBps: number;
  monthlyRateBps: number;
  monthlyWindowMonths: number | null;
  isActive: boolean;
  validatedAt: Date | null;
};

/**
 * Règle de commission applicable, toujours VALIDÉE par Ocall (jamais un barème proposé non approuvé).
 * La règle figée sur l'attribution reste appliquée même désactivée ensuite (conditions contractuelles
 * conservées) ; les autres doivent être actives. Ordre : figée, partenaire, type + application, type,
 * application, générale. `productIds` vide : attribution antérieure « toutes applications » (règles
 * sans application seulement).
 */
export async function applicableRule(
  tx: Tx,
  input: {
    frozen: Rule | null;
    partnerRule: Rule | null;
    partnerType: 'REFERRER' | 'RESELLER';
    productIds: string[];
  },
): Promise<Rule | null> {
  if (input.frozen?.validatedAt) return input.frozen;
  if (input.partnerRule?.isActive && input.partnerRule.validatedAt) return input.partnerRule;
  const product = input.productIds.length > 0 ? { in: input.productIds } : undefined;
  for (const where of [
    ...(product ? [{ partnerType: input.partnerType, productId: product }] : []),
    { partnerType: input.partnerType, productId: null },
    ...(product ? [{ partnerType: null, productId: product }] : []),
    { partnerType: null, productId: null },
  ]) {
    const rule = await tx.commissionRule.findFirst({
      where: { ...where, isActive: true, validatedAt: { not: null } },
      orderBy: { validatedAt: 'desc' },
    });
    if (rule) return rule;
  }
  return null;
}

/**
 * Remboursement ou litige sur un règlement : ses commissions non versées sont annulées ; si une
 * commission a déjà été versée, une régularisation négative est créée (déduite du prochain
 * versement). Idempotent.
 */
export async function reverseCommissions(
  tx: Tx,
  paymentId: string,
  reason: string,
): Promise<{ reversed: number; adjustment: number }> {
  const reversed = await tx.commission.updateMany({
    where: {
      subscriptionPaymentId: paymentId,
      kind: { not: 'ADJUSTMENT' },
      status: { in: ['ACCRUED', 'VALIDATED'] },
      payoutId: null,
    },
    data: { status: 'REVERSED', reversedAt: new Date(), reversalReason: reason },
  });
  const paid = await tx.commission.findMany({
    where: {
      subscriptionPaymentId: paymentId,
      kind: { not: 'ADJUSTMENT' },
      OR: [{ status: 'PAID' }, { payoutId: { not: null }, status: { not: 'REVERSED' } }],
    },
    select: {
      amount: true,
      partnerId: true,
      attributionId: true,
      organizationId: true,
      productId: true,
      currency: true,
    },
  });
  const total = paid.reduce((t, c) => t + c.amount, 0);
  if (total > 0) {
    const ref = paid[0]!;
    const created = await tx.commission.createMany({
      data: [
        {
          partnerId: ref.partnerId,
          attributionId: ref.attributionId,
          subscriptionPaymentId: paymentId,
          organizationId: ref.organizationId,
          productId: ref.productId,
          kind: 'ADJUSTMENT',
          baseAmount: 0,
          rateBps: 0,
          amount: -total,
          currency: ref.currency,
          reversalReason: reason,
          // Dette du partenaire : imputable dès le prochain versement (après validation), sans le
          // délai M+1 des nouvelles primes.
          payableFrom: new Date(),
        },
      ],
      skipDuplicates: true,
    });
    return { reversed: reversed.count, adjustment: created.count ? -total : 0 };
  }
  return { reversed: reversed.count, adjustment: 0 };
}
