import type { FinanceSettings } from '@marketplace/validation';
import { Prisma } from './generated/prisma/client';
import {
  ACCOUNT,
  cents,
  cr,
  dr,
  financeReference,
  financeSettingsInTx,
  lastClosedPeriod,
  lockSellerBalanceInTx,
  postJournalInTx,
  sellerBalances,
  taxRuleAt,
  type JournalLine,
  type SettlementPeriod,
} from './ledger';

/**
 * Seller settlement (ADR 0028). For a closed period, each seller's eligible seller orders move
 * from pending to available in one journal; withholding tax on the period's remittance is
 * deducted; an immutable statement is stored with one line per settled order; the
 * marketplace's service invoice (commission and fees) and credit note (commission given back)
 * are issued from the same ledger lines.
 *
 * Eligible: money received (sale posted), not settled yet, and either delivered with the
 * return window (plus hold days) ended before the period end, or finished without delivery
 * (cancelled, returned to the seller) — in both cases with no open return, dispute or refund.
 */

type Tx = Prisma.TransactionClient;
const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const ZERO = D(0);
const sum = (values: Prisma.Decimal[]) => values.reduce((a, b) => a.add(b), ZERO);

/** Seller orders of a seller that can be settled for a period ending at `cutoff`. */
export async function eligibleSellerOrders(
  db: Pick<Tx, '$queryRaw'>,
  sellerId: string | null,
  cutoff: Date,
  holdDays: number,
): Promise<{ id: string; seller_id: string }[]> {
  const holdUntil = new Date(cutoff.getTime() - holdDays * 24 * 60 * 60 * 1000);
  return db.$queryRaw<{ id: string; seller_id: string }[]>`
    SELECT so."id", so."seller_id" FROM "seller_orders" so
    WHERE (${sellerId}::uuid IS NULL OR so."seller_id" = ${sellerId}::uuid)
      AND EXISTS (SELECT 1 FROM "journal_transactions" t
                   WHERE t."idempotency_key" = 'sale:' || so."id"::text AND t."status" = 'POSTED')
      AND NOT EXISTS (SELECT 1 FROM "settlement_lines" l WHERE l."seller_order_id" = so."id")
      AND (
        (so."status" IN ('DELIVERED', 'COMPLETED') AND so."return_window_ends_at" IS NOT NULL
           AND so."return_window_ends_at" <= ${holdUntil})
        OR (so."status" IN ('CANCELLED', 'RETURNED_TO_SELLER') AND so."updated_at" <= ${cutoff})
      )
      AND NOT EXISTS (SELECT 1 FROM "return_requests" r WHERE r."seller_order_id" = so."id"
                       AND r."status" NOT IN ('RESOLVED', 'CLOSED', 'CANCELLED', 'REJECTED'))
      AND NOT EXISTS (SELECT 1 FROM "refunds" f WHERE f."seller_order_id" = so."id"
                       AND f."status" IN ('PROCESSING', 'AWAITING_PAYOUT'))
    ORDER BY so."seller_id", so."number"`;
}

interface OrderComponents {
  sellerOrderId: string;
  number: string;
  pending: Prisma.Decimal;
  grossSales: Prisma.Decimal;
  shippingCredits: Prisma.Decimal;
  commission: Prisma.Decimal;
  paymentFees: Prisma.Decimal;
  refunds: Prisma.Decimal;
  commissionReversals: Prisma.Decimal;
  otherAdjustments: Prisma.Decimal;
  withholdingBase: Prisma.Decimal;
}

/** The seller order's pending lines by kind (signed: positive increases what the seller gets). */
async function componentsOf(tx: Tx, sellerOrderId: string): Promise<OrderComponents> {
  const rows = await tx.$queryRaw<{ kind: string | null; amount: Prisma.Decimal }[]>`
    SELECT e."kind", SUM(e."credit" - e."debit") AS "amount"
    FROM "journal_entries" e
    JOIN "journal_transactions" t ON t."id" = e."transaction_id" AND t."status" = 'POSTED'
    JOIN "ledger_accounts" a ON a."id" = e."account_id" AND a."code" = '2110'
    WHERE e."seller_order_id" = ${sellerOrderId}::uuid
    GROUP BY e."kind"`;
  const of = (kind: string) => D(rows.find((r) => r.kind === kind)?.amount ?? 0);
  const known = [
    'SALE',
    'SHIPPING_CREDIT',
    'COMMISSION',
    'PAYMENT_FEE',
    'COD_FEE',
    'REFUND',
    'COMMISSION_REVERSAL',
  ];
  const pending = sum(rows.map((r) => D(r.amount)));
  const so = await tx.sellerOrder.findUniqueOrThrow({
    where: { id: sellerOrderId },
    select: {
      number: true,
      items: {
        select: { lineSubtotal: true, sellerDiscount: true, vatAmount: true, taxInclusive: true },
      },
    },
  });
  const grossSales = of('SALE');
  const refunds = of('REFUND').neg();
  // Withholding base (RR 16-2023): the goods sold net of returns, excluding VAT, shipping and
  // the platform fee. The VAT share comes from the items' tax snapshot.
  const itemsGross = sum(so.items.map((i) => i.lineSubtotal.sub(i.sellerDiscount)));
  const taxOnTop = sum(so.items.filter((i) => !i.taxInclusive).map((i) => i.vatAmount));
  const itemsTax = sum(so.items.map((i) => i.vatAmount));
  const charged = itemsGross.add(taxOnTop);
  const vatShare = charged.isZero() ? ZERO : itemsTax.dividedBy(charged);
  const sold = Prisma.Decimal.max(ZERO, grossSales.sub(refunds));
  const withholdingBase = cents(sold.times(D(1).sub(vatShare)));
  return {
    sellerOrderId,
    number: so.number,
    pending,
    grossSales,
    shippingCredits: of('SHIPPING_CREDIT'),
    commission: of('COMMISSION').neg(),
    paymentFees: of('PAYMENT_FEE').add(of('COD_FEE')).neg(),
    refunds,
    commissionReversals: of('COMMISSION_REVERSAL'),
    otherAdjustments: sum(
      rows.filter((r) => !known.includes(r.kind ?? '')).map((r) => D(r.amount)),
    ),
    withholdingBase: grossSales.isZero() ? ZERO : withholdingBase,
  };
}

export interface SettleResult {
  settlementId: string;
  reference: string;
  ordersCount: number;
  netSettled: string;
  withholdingTax: string;
}

/**
 * Settles one seller for a period (in the caller's transaction). Returns null when the seller
 * has nothing eligible or the period is already settled.
 */
export async function settleSellerInTx(
  tx: Tx,
  input: {
    sellerId: string;
    period: SettlementPeriod;
    settings: FinanceSettings;
    createdById?: string | null;
    now?: Date;
  },
): Promise<SettleResult | null> {
  const now = input.now ?? new Date();
  await lockSellerBalanceInTx(tx, input.sellerId);
  const existing = await tx.settlement.findUnique({
    where: { sellerId_periodStart: { sellerId: input.sellerId, periodStart: input.period.start } },
  });
  if (existing) return null;
  const eligible = await eligibleSellerOrders(
    tx,
    input.sellerId,
    input.period.end,
    input.settings.settlement.holdDays,
  );
  if (eligible.length === 0) return null;
  const orders: OrderComponents[] = [];
  for (const so of eligible) orders.push(await componentsOf(tx, so.id));

  const seller = await tx.seller.findUniqueOrThrow({
    where: { id: input.sellerId },
    select: {
      businessName: true,
      taxRegisteredName: true,
      tin: true,
      vatRegistered: true,
      addressLine1: true,
      addressLine2: true,
      barangay: true,
      city: true,
      province: true,
      postalCode: true,
      withholdingExemptUntil: true,
    },
  });
  const rule = await taxRuleAt(
    tx,
    'SELLER_REMITTANCE',
    input.period.end,
    seller.vatRegistered ? 'VAT_REGISTERED' : 'NON_VAT',
  );
  const exempt =
    seller.withholdingExemptUntil !== null &&
    seller.withholdingExemptUntil.getTime() >= input.period.start.getTime();
  const withholdingBase = sum(orders.map((o) => o.withholdingBase));
  const withholdingTax =
    exempt || rule.ruleId === null
      ? ZERO
      : cents(
          withholdingBase
            .times(rule.basePercent)
            .dividedBy(100)
            .times(rule.ratePercent)
            .dividedBy(100),
        );

  const before = await sellerBalances(tx, input.sellerId);
  const periodLabel = `${input.period.start.toISOString().slice(0, 10)} – ${new Date(input.period.end.getTime() - 1).toISOString().slice(0, 10)}`;
  const lines: JournalLine[] = [];
  for (const o of orders) {
    const dims = { sellerId: input.sellerId, sellerOrderId: o.sellerOrderId, kind: 'SETTLEMENT' };
    lines.push(dr(ACCOUNT.SELLER_PENDING, o.pending, dims));
    lines.push(cr(ACCOUNT.SELLER_AVAILABLE, o.pending, dims));
  }
  const whDims = { sellerId: input.sellerId, kind: 'WITHHOLDING' };
  lines.push(dr(ACCOUNT.SELLER_AVAILABLE, withholdingTax, whDims));
  lines.push(cr(ACCOUNT.WITHHOLDING, withholdingTax, whDims));
  const settlementId = (await tx.$queryRaw<{ id: string }[]>`SELECT gen_random_uuid() AS "id"`)[0]!
    .id;
  const reference = financeReference('ST');
  const journal = await postJournalInTx(tx, {
    type: 'SETTLEMENT',
    description: `Settlement ${reference} for ${periodLabel}`,
    occurredAt: now,
    idempotencyKey: `settlement:${input.sellerId}:${input.period.start.toISOString()}`,
    sourceType: 'SETTLEMENT',
    sourceId: settlementId,
    createdById: input.createdById,
    lines,
  });
  const after = await sellerBalances(tx, input.sellerId);
  const total = (pick: (o: OrderComponents) => Prisma.Decimal) => sum(orders.map(pick));
  await tx.settlement.create({
    data: {
      id: settlementId,
      reference,
      sellerId: input.sellerId,
      periodStart: input.period.start,
      periodEnd: input.period.end,
      ordersCount: orders.length,
      grossSales: total((o) => o.grossSales),
      shippingCredits: total((o) => o.shippingCredits),
      commission: total((o) => o.commission),
      paymentFees: total((o) => o.paymentFees),
      refunds: total((o) => o.refunds),
      commissionReversals: total((o) => o.commissionReversals),
      otherAdjustments: total((o) => o.otherAdjustments),
      netSettled: total((o) => o.pending),
      withholdingBase,
      withholdingTax,
      withholdingSnapshot: {
        ...rule,
        exempt,
        reason: exempt
          ? `Exempt until ${seller.withholdingExemptUntil!.toISOString().slice(0, 10)} (sworn declaration)`
          : rule.ruleId === null
            ? 'No withholding rule in force'
            : null,
      },
      openingAvailable: before.available,
      closingAvailable: after.available,
      journalId: journal?.id ?? null,
      createdById: input.createdById ?? null,
      createdAt: now,
      lines: {
        create: orders.map((o) => ({
          sellerOrderId: o.sellerOrderId,
          orderNumber: o.number,
          grossSales: o.grossSales,
          shippingCredits: o.shippingCredits,
          commission: o.commission,
          paymentFees: o.paymentFees,
          refunds: o.refunds,
          commissionReversals: o.commissionReversals,
          otherAdjustments: o.otherAdjustments,
          net: o.pending,
          withholdingBase: o.withholdingBase,
        })),
      },
    },
  });
  await issueServiceDocumentsInTx(tx, {
    settlementId,
    sellerId: input.sellerId,
    sellerOrderIds: orders.map((o) => o.sellerOrderId),
    settings: input.settings,
    buyer: {
      name: seller.taxRegisteredName ?? seller.businessName,
      tin: seller.tin,
      vatRegistered: seller.vatRegistered,
      address: [
        seller.addressLine1,
        seller.addressLine2,
        seller.barangay,
        seller.city,
        seller.province,
        seller.postalCode,
      ]
        .filter(Boolean)
        .join(', '),
    },
    now,
  });
  return {
    settlementId,
    reference,
    ordersCount: orders.length,
    netSettled: total((o) => o.pending).toFixed(2),
    withholdingTax: withholdingTax.toFixed(2),
  };
}

/** Next gap-free number for a document type and year (row lock until commit). */
export async function nextDocumentNumber(tx: Tx, prefix: string, year: number): Promise<string> {
  const key = `${prefix}-${year}`;
  const [row] = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO "document_sequences" ("key", "last_value", "updated_at") VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET "last_value" = "document_sequences"."last_value" + 1, "updated_at" = now()
    RETURNING "last_value"`;
  return `${key}-${String(row!.last_value).padStart(6, '0')}`;
}

const SERVICE_LABELS: Record<string, string> = {
  COMMISSION: 'Marketplace commission',
  PAYMENT_FEE: 'Payment processing fees',
  COD_FEE: 'Cash-on-delivery fees',
};

/**
 * The service invoice (commission and fees charged on the settled orders) and the credit note
 * (commission given back on refunds), computed from the revenue and output VAT ledger lines of
 * those orders so the documents always agree with the books.
 */
async function issueServiceDocumentsInTx(
  tx: Tx,
  input: {
    settlementId: string;
    sellerId: string;
    sellerOrderIds: string[];
    settings: FinanceSettings;
    buyer: Record<string, unknown>;
    now: Date;
  },
) {
  if (input.sellerOrderIds.length === 0) return;
  const rows = await tx.$queryRaw<
    { kind: string; net: Prisma.Decimal; tax: Prisma.Decimal; rate: Prisma.Decimal | null }[]
  >`
    SELECT e."kind",
           SUM(CASE WHEN a."code" IN ('4010', '4020') THEN e."credit" - e."debit" ELSE 0 END) AS "net",
           SUM(CASE WHEN a."code" = '2310' THEN e."credit" - e."debit" ELSE 0 END) AS "tax"
    FROM "journal_entries" e
    JOIN "journal_transactions" t ON t."id" = e."transaction_id" AND t."status" = 'POSTED'
    JOIN "ledger_accounts" a ON a."id" = e."account_id"
    WHERE e."seller_order_id" = ANY(${input.sellerOrderIds}::uuid[])
      AND e."kind" IN ('COMMISSION', 'PAYMENT_FEE', 'COD_FEE', 'COMMISSION_REVERSAL')
      AND a."code" IN ('4010', '4020', '2310')
    GROUP BY e."kind"`;
  const rule = await taxRuleAt(tx, 'MARKETPLACE_SERVICES', input.now);
  const issuer = input.settings.issuer;
  const year = Number(new Date(input.now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 4));
  const issue = async (
    type: 'SERVICE_INVOICE' | 'CREDIT_NOTE',
    prefix: string,
    items: { description: string; net: Prisma.Decimal; tax: Prisma.Decimal }[],
  ) => {
    const lines = items.filter((i) => !i.net.isZero() || !i.tax.isZero());
    if (lines.length === 0) return;
    const subtotal = sum(lines.map((l) => l.net));
    const taxAmount = sum(lines.map((l) => l.tax));
    await tx.financeDocument.create({
      data: {
        type,
        number: await nextDocumentNumber(tx, prefix, year),
        sellerId: input.sellerId,
        settlementId: input.settlementId,
        issuedAt: input.now,
        subtotal,
        taxAmount,
        total: subtotal.add(taxAmount),
        lines: lines.map((l) => ({
          description: l.description,
          amount: l.net.toFixed(2),
          taxAmount: l.tax.toFixed(2),
        })),
        taxSnapshot: { ...rule },
        buyerSnapshot: input.buyer as Prisma.InputJsonValue,
        issuerSnapshot: { ...issuer },
        createdAt: input.now,
      },
    });
  };
  const invoiceLines = ['COMMISSION', 'PAYMENT_FEE', 'COD_FEE'].map((kind) => {
    const r = rows.find((x) => x.kind === kind);
    return { description: SERVICE_LABELS[kind]!, net: D(r?.net ?? 0), tax: D(r?.tax ?? 0) };
  });
  await issue('SERVICE_INVOICE', 'SI', invoiceLines);
  const reversal = rows.find((x) => x.kind === 'COMMISSION_REVERSAL');
  await issue('CREDIT_NOTE', 'CN', [
    {
      description: 'Commission returned on refunds',
      net: D(reversal?.net ?? 0).neg(),
      tax: D(reversal?.tax ?? 0).neg(),
    },
  ]);
}

/**
 * Settles every seller with eligible orders for the last closed period, each in its own
 * transaction. Returns what was settled.
 */
export async function runSettlement(
  db: {
    $queryRaw: Tx['$queryRaw'];
    $transaction: <T>(fn: (tx: Tx) => Promise<T>, options?: { timeout?: number }) => Promise<T>;
    platformSetting: Tx['platformSetting'];
  },
  options: {
    now?: Date;
    period?: SettlementPeriod;
    createdById?: string | null;
    sellerId?: string;
  } = {},
): Promise<SettleResult[]> {
  const now = options.now ?? new Date();
  const settings = await financeSettingsInTx(db);
  const period = options.period ?? lastClosedPeriod(now, settings.settlement);
  const candidates = await eligibleSellerOrders(
    db,
    options.sellerId ?? null,
    period.end,
    settings.settlement.holdDays,
  );
  const sellers = [...new Set(candidates.map((c) => c.seller_id))];
  const results: SettleResult[] = [];
  for (const sellerId of sellers) {
    const result = await db.$transaction(
      (tx) =>
        settleSellerInTx(tx, { sellerId, period, settings, createdById: options.createdById, now }),
      { timeout: 60_000 },
    );
    if (result) results.push(result);
  }
  return results;
}
