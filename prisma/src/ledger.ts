import { randomInt } from 'node:crypto';
import {
  DEFAULT_FINANCE_SETTINGS,
  financeSettingsSchema,
  type FeeChannel,
  type FinanceSettings,
} from '@marketplace/validation';
import { Prisma } from './generated/prisma/client';

/**
 * The double-entry ledger (ADR 0027). Every money event is a journal transaction whose lines
 * balance (total debits = total credits, enforced by a database trigger when it is posted).
 * Posted journals are never edited or deleted; corrections are reversals. Seller balances are
 * sums of the seller payable lines (no balance columns anywhere).
 */

type Tx = Prisma.TransactionClient;
type Db = Pick<Tx, '$queryRaw'>;
const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const ZERO = D(0);
export const cents = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const sum = (values: Prisma.Decimal[]) => values.reduce((a, b) => a.add(b), ZERO);

/** Chart of accounts codes used by automatic postings (seeded by the migration). */
export const ACCOUNT = {
  BANK: '1010',
  PROVIDER: '1020',
  COD_RECEIVABLE: '1100',
  INPUT_VAT: '1200',
  CLEARING: '2010',
  SELLER_PENDING: '2110',
  SELLER_AVAILABLE: '2120',
  SELLER_RESERVED: '2130',
  SELLER_PAYOUT: '2140',
  VENDOR_PAYABLE: '2210',
  OUTPUT_VAT: '2310',
  WITHHOLDING: '2320',
  COMMISSION: '4010',
  FEE_RECOVERY: '4020',
  SHIPPING: '4030',
  CHARGES: '4040',
  REFUNDS: '4090',
  PAYMENT_FEES: '5010',
  COD_FEES: '5020',
  VOUCHERS: '5030',
  TRANSFER_FEES: '5040',
} as const;
export type AccountCode = (typeof ACCOUNT)[keyof typeof ACCOUNT] | (string & {});

/** A journal line: a positive amount is a debit, a negative amount a credit. */
export interface JournalLine {
  account: AccountCode;
  amount: Prisma.Decimal;
  sellerId?: string | null;
  sellerOrderId?: string | null;
  kind?: string | null;
  description?: string | null;
}

export const dr = (
  account: AccountCode,
  amount: Prisma.Decimal,
  extra: Partial<JournalLine> = {},
) => ({ ...extra, account, amount }) as JournalLine;
export const cr = (
  account: AccountCode,
  amount: Prisma.Decimal,
  extra: Partial<JournalLine> = {},
) => ({ ...extra, account, amount: amount.neg() }) as JournalLine;

export interface PostJournalInput {
  type: string;
  description: string;
  lines: JournalLine[];
  occurredAt?: Date;
  /** The same key is posted once; later calls return null. */
  idempotencyKey?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  reversalOfId?: string | null;
  createdById?: string | null;
  currency?: string;
}

export class UnbalancedJournalError extends Error {
  constructor(debits: Prisma.Decimal, credits: Prisma.Decimal) {
    super(`Journal does not balance: debits ${debits.toFixed(2)}, credits ${credits.toFixed(2)}`);
  }
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function financeReference(prefix: string): string {
  let suffix = '';
  for (let i = 0; i < 8; i++) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}-${suffix}`;
}

/**
 * Posts a balanced journal in the caller's transaction. Zero lines are dropped; nothing is
 * posted when every line is zero. Returns null when the idempotency key was already posted.
 */
export async function postJournalInTx(
  tx: Tx,
  input: PostJournalInput,
): Promise<{ id: string; reference: string } | null> {
  const lines = input.lines
    .map((l) => ({ ...l, amount: cents(l.amount) }))
    .filter((l) => !l.amount.isZero());
  if (lines.length === 0) return null;
  const debits = sum(lines.filter((l) => l.amount.gt(0)).map((l) => l.amount));
  const credits = sum(lines.filter((l) => l.amount.lt(0)).map((l) => l.amount.neg()));
  if (!debits.eq(credits)) throw new UnbalancedJournalError(debits, credits);

  const codes = [...new Set(lines.map((l) => l.account))];
  const accounts = await tx.ledgerAccount.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true, active: true },
  });
  const accountId = new Map(accounts.map((a) => [a.code, a]));
  for (const code of codes) {
    const a = accountId.get(code);
    if (!a) throw new Error(`Ledger account ${code} does not exist`);
    if (!a.active) throw new Error(`Ledger account ${code} is inactive`);
  }

  const reference = financeReference('JE');
  const header = {
    reference,
    type: input.type,
    status: 'DRAFT' as const,
    description: input.description.slice(0, 300),
    currency: input.currency ?? 'PHP',
    occurredAt: input.occurredAt ?? new Date(),
    sourceType: input.sourceType ?? null,
    sourceId: input.sourceId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    reversalOfId: input.reversalOfId ?? null,
    createdById: input.createdById ?? null,
  };
  let id: string;
  if (input.idempotencyKey) {
    // ON CONFLICT DO NOTHING: a duplicate neither fails the transaction nor posts twice.
    const created = await tx.journalTransaction.createMany({
      data: [header],
      skipDuplicates: true,
    });
    if (created.count === 0) return null;
    id = (
      await tx.journalTransaction.findUniqueOrThrow({
        where: { reference },
        select: { id: true },
      })
    ).id;
  } else {
    id = (await tx.journalTransaction.create({ data: header, select: { id: true } })).id;
  }
  await tx.journalEntry.createMany({
    data: lines.map((l, i) => ({
      transactionId: id,
      lineNo: i + 1,
      accountId: accountId.get(l.account)!.id,
      sellerId: l.sellerId ?? null,
      sellerOrderId: l.sellerOrderId ?? null,
      kind: l.kind ?? null,
      debit: l.amount.gt(0) ? l.amount : ZERO,
      credit: l.amount.lt(0) ? l.amount.neg() : ZERO,
      description: l.description?.slice(0, 300) ?? null,
    })),
  });
  // The trigger checks the balance and the seller on seller payable lines.
  await tx.journalTransaction.update({
    where: { id },
    data: { status: 'POSTED', postedAt: new Date(), postedById: input.createdById ?? null },
  });
  return { id, reference };
}

/** Posts the exact opposite of a posted journal (once). */
export async function reverseJournalInTx(
  tx: Tx,
  journalId: string,
  input: { description?: string; createdById?: string | null; occurredAt?: Date; type?: string },
): Promise<{ id: string; reference: string } | null> {
  const original = await tx.journalTransaction.findUniqueOrThrow({
    where: { id: journalId },
    include: { entries: { include: { account: { select: { code: true } } } } },
  });
  if (original.status !== 'POSTED') throw new Error('Only posted journals can be reversed');
  return postJournalInTx(tx, {
    type: input.type ?? 'REVERSAL',
    description: input.description ?? `Reversal of ${original.reference}: ${original.description}`,
    occurredAt: input.occurredAt,
    idempotencyKey: `reversal:${original.id}`,
    reversalOfId: original.id,
    sourceType: original.sourceType,
    sourceId: original.sourceId,
    createdById: input.createdById,
    currency: original.currency,
    lines: original.entries
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((e) => ({
        account: e.account.code,
        amount: e.credit.sub(e.debit),
        sellerId: e.sellerId,
        sellerOrderId: e.sellerOrderId,
        kind: e.kind,
        description: e.description,
      })),
  });
}

export async function journalByKey(tx: Tx, key: string) {
  return tx.journalTransaction.findUnique({
    where: { idempotencyKey: key },
    select: { id: true, reference: true, status: true },
  });
}

// ---- Settings and taxes ------------------------------------------------------------------------

export async function financeSettingsInTx(
  db: Pick<Tx, 'platformSetting'>,
): Promise<FinanceSettings> {
  const row = await db.platformSetting.findUnique({ where: { key: 'finance' } });
  const parsed = row ? financeSettingsSchema.safeParse(row.value) : null;
  return parsed?.success ? parsed.data : DEFAULT_FINANCE_SETTINGS;
}

export interface TaxRuleSnapshot {
  ruleId: string | null;
  code: string | null;
  ratePercent: string;
  basePercent: string;
  inclusive: boolean;
}
const NO_TAX: TaxRuleSnapshot = {
  ruleId: null,
  code: null,
  ratePercent: '0',
  basePercent: '100',
  inclusive: true,
};

/**
 * The tax rule in force at a time for what is taxed and, for goods and remittances, the
 * seller's registration (a rule for the exact registration beats one for ANY).
 */
export async function taxRuleAt(
  db: Pick<Tx, 'taxRule'>,
  appliesTo: 'GOODS' | 'MARKETPLACE_SERVICES' | 'SELLER_REMITTANCE',
  at: Date,
  registration: 'VAT_REGISTERED' | 'NON_VAT' | 'ANY' = 'ANY',
  jurisdiction = 'PH',
): Promise<TaxRuleSnapshot> {
  const rules = await db.taxRule.findMany({
    where: {
      jurisdiction,
      appliesTo,
      sellerRegistration: { in: registration === 'ANY' ? ['ANY'] : [registration, 'ANY'] },
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });
  const rule =
    rules.find((r) => r.sellerRegistration === registration) ??
    rules.find((r) => r.sellerRegistration === 'ANY');
  if (!rule) return NO_TAX;
  return {
    ruleId: rule.id,
    code: rule.code,
    ratePercent: rule.ratePercent.toString(),
    basePercent: rule.basePercent.toString(),
    inclusive: rule.inclusive,
  };
}

/** Splits a tax-inclusive gross amount into net and tax (rounded to the centavo). */
export function splitInclusive(
  gross: Prisma.Decimal,
  ratePercent: string | number | Prisma.Decimal,
) {
  const rate = D(ratePercent);
  const tax = rate.isZero() ? ZERO : cents(gross.times(rate).dividedBy(rate.add(100)));
  return { net: gross.sub(tax), tax };
}

/**
 * Revenue lines for a marketplace service charged to a seller (commission, fee recovery):
 * credit the revenue net of output VAT and the VAT payable, both tagged with the seller order.
 */
function serviceRevenueLines(
  revenueAccount: AccountCode,
  gross: Prisma.Decimal,
  rule: TaxRuleSnapshot,
  dims: Partial<JournalLine>,
): JournalLine[] {
  const { net, tax } = splitInclusive(gross, rule.ratePercent);
  return [cr(revenueAccount, net, dims), cr(ACCOUNT.OUTPUT_VAT, tax, dims)];
}

export const channelOf = (method: string): FeeChannel =>
  method === 'COD' ? 'COD' : method === 'BANK_TRANSFER' ? 'BANK_TRANSFER' : 'ONLINE';

/** Largest-remainder allocation of an amount in centavos by weights. */
export function allocateCents(total: Prisma.Decimal, weights: Prisma.Decimal[]): Prisma.Decimal[] {
  const totalCents = cents(total).times(100).toNumber();
  const weightSum = sum(weights);
  if (totalCents === 0 || weightSum.isZero()) return weights.map(() => ZERO);
  const exact = weights.map((w) => w.times(totalCents).dividedBy(weightSum));
  const floors = exact.map((e) => e.floor().toNumber());
  let left = totalCents - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, index) => ({ index, remainder: e.sub(e.floor()).toNumber() }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index]! += 1;
    left -= 1;
  }
  return floors.map((f) => D(f).dividedBy(100));
}

// ---- Seller balances -----------------------------------------------------------------------------

export interface SellerBalances {
  /** Earned, not yet eligible for settlement. */
  pending: Prisma.Decimal;
  /** Part of pending tied to orders with an open return, dispute or refund. */
  held: Prisma.Decimal;
  /** Settled and payable (negative: the seller owes the marketplace). */
  available: Prisma.Decimal;
  /** Held back by finance. */
  reserved: Prisma.Decimal;
  /** Requested payouts not yet paid. */
  inPayout: Prisma.Decimal;
  /** Paid out to the seller (net of reversed payouts). */
  paid: Prisma.Decimal;
}

/** Locks a seller's balances for the rest of the transaction (payouts, settlement, reserves). */
export async function lockSellerBalanceInTx(tx: Tx, sellerId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'seller-balance:' + sellerId}))`;
}

/** Balances derived from posted ledger lines; never stored. */
export async function sellerBalances(db: Db, sellerId: string): Promise<SellerBalances> {
  const rows = await db.$queryRaw<{ code: string; balance: Prisma.Decimal }[]>`
    SELECT a."code", COALESCE(SUM(e."credit" - e."debit"), 0) AS "balance"
    FROM "journal_entries" e
    JOIN "journal_transactions" t ON t."id" = e."transaction_id" AND t."status" = 'POSTED'
    JOIN "ledger_accounts" a ON a."id" = e."account_id"
    WHERE e."seller_id" = ${sellerId}::uuid AND a."seller_subledger"
    GROUP BY a."code"`;
  const [paid] = await db.$queryRaw<{ amount: Prisma.Decimal | null }[]>`
    SELECT SUM(e."credit" - e."debit") AS "amount"
    FROM "journal_entries" e
    JOIN "journal_transactions" t ON t."id" = e."transaction_id" AND t."status" = 'POSTED'
    JOIN "ledger_accounts" a ON a."id" = e."account_id"
    WHERE e."seller_id" = ${sellerId}::uuid AND e."kind" = 'PAYOUT' AND a."code" IN ('1010', '1020')`;
  const [held] = await db.$queryRaw<{ amount: Prisma.Decimal | null }[]>`
    SELECT SUM(e."credit" - e."debit") AS "amount"
    FROM "journal_entries" e
    JOIN "journal_transactions" t ON t."id" = e."transaction_id" AND t."status" = 'POSTED'
    JOIN "ledger_accounts" a ON a."id" = e."account_id" AND a."code" = '2110'
    WHERE e."seller_id" = ${sellerId}::uuid AND e."seller_order_id" IN (
      SELECT r."seller_order_id" FROM "return_requests" r
       WHERE r."seller_id" = ${sellerId}::uuid
         AND r."status" NOT IN ('RESOLVED', 'CLOSED', 'CANCELLED', 'REJECTED')
      UNION
      SELECT f."seller_order_id" FROM "refunds" f
       WHERE f."seller_order_id" IS NOT NULL AND f."status" IN ('PROCESSING', 'AWAITING_PAYOUT'))`;
  const of = (code: string) => D(rows.find((r) => r.code === code)?.balance ?? 0);
  return {
    pending: of(ACCOUNT.SELLER_PENDING),
    held: D(held?.amount ?? 0),
    available: of(ACCOUNT.SELLER_AVAILABLE),
    reserved: of(ACCOUNT.SELLER_RESERVED),
    inPayout: of(ACCOUNT.SELLER_PAYOUT),
    paid: D(paid?.amount ?? 0),
  };
}

/** Settled seller orders take later adjustments in the available balance. */
async function sellerBucketFor(tx: Tx, sellerOrderId: string): Promise<AccountCode> {
  const settled = await tx.settlementLine.count({ where: { sellerOrderId } });
  return settled > 0 ? ACCOUNT.SELLER_AVAILABLE : ACCOUNT.SELLER_PENDING;
}

/**
 * What the seller still holds for a seller order (sales and shipping credits less refunds) and
 * the commission not yet given back, from posted ledger lines.
 */
export async function sellerOrderPosition(db: Db, sellerOrderId: string) {
  const rows = await db.$queryRaw<{ kind: string | null; amount: Prisma.Decimal }[]>`
    SELECT e."kind", SUM(e."credit" - e."debit") AS "amount"
    FROM "journal_entries" e
    JOIN "journal_transactions" t ON t."id" = e."transaction_id" AND t."status" = 'POSTED'
    JOIN "ledger_accounts" a ON a."id" = e."account_id" AND a."seller_subledger"
    WHERE e."seller_order_id" = ${sellerOrderId}::uuid
    GROUP BY e."kind"`;
  const of = (kind: string) => D(rows.find((r) => r.kind === kind)?.amount ?? 0);
  return {
    credited: of('SALE').add(of('SHIPPING_CREDIT')).add(of('REFUND')),
    // COMMISSION lines are debits (negative here); reversals are credits.
    commission: of('COMMISSION').neg().sub(of('COMMISSION_REVERSAL')),
  };
}

// ---- Money in ---------------------------------------------------------------------------------

const cashAccountFor = (provider: string): AccountCode =>
  provider === 'MANUAL_BANK' || provider === 'COD' ? ACCOUNT.BANK : ACCOUNT.PROVIDER;

/** Money received for an online payment or a bank transfer (not COD): into clearing. */
export async function postPaymentReceivedInTx(tx: Tx, paymentId: string, now = new Date()) {
  const p = await tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
    select: { id: true, reference: true, provider: true, amountReceived: true, paidAt: true },
  });
  if (p.provider === 'COD' || p.amountReceived.lte(0)) return null;
  return postJournalInTx(tx, {
    type: 'PAYMENT_RECEIVED',
    description: `Payment ${p.reference} received`,
    occurredAt: p.paidAt ?? now,
    idempotencyKey: `receipt:${p.id}`,
    sourceType: 'PAYMENT',
    sourceId: p.id,
    lines: [
      dr(cashAccountFor(p.provider), p.amountReceived, { kind: 'RECEIPT' }),
      cr(ACCOUNT.CLEARING, p.amountReceived, { kind: 'RECEIPT' }),
    ],
  });
}

/**
 * The provider's fee on a received payment (configured per method). The marketplace pays it;
 * when the seller bears the channel's fees it is recovered from the seller orders the payment
 * paid, in proportion to their totals (plus VAT on the recovery).
 */
export async function postPaymentFeeInTx(tx: Tx, paymentId: string, now = new Date()) {
  const p = await tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
    select: {
      id: true,
      reference: true,
      method: true,
      provider: true,
      status: true,
      amountReceived: true,
      orderId: true,
      paidAt: true,
    },
  });
  if (p.provider === 'COD' || p.amountReceived.lte(0)) return null;
  const settings = await financeSettingsInTx(tx);
  const config = settings.fees.methods[p.method];
  const fee = cents(p.amountReceived.times(config.percent).dividedBy(100)).add(config.fixed);
  if (fee.lte(0)) return null;
  const at = p.paidAt ?? now;
  const lines: JournalLine[] = [
    dr(ACCOUNT.PAYMENT_FEES, fee, { kind: 'PAYMENT_FEE' }),
    cr(cashAccountFor(p.provider), fee, { kind: 'PAYMENT_FEE' }),
  ];
  if (p.status === 'PAID' && settings.fees.bearer[channelOf(p.method)] === 'SELLER') {
    const sellerOrders = await tx.sellerOrder.findMany({
      where: { orderId: p.orderId },
      select: { id: true, sellerId: true, total: true },
      orderBy: { number: 'asc' },
    });
    const shares = allocateCents(
      fee,
      sellerOrders.map((s) => s.total),
    );
    const rule = await taxRuleAt(tx, 'MARKETPLACE_SERVICES', at);
    sellerOrders.forEach((so, i) => {
      const dims = { sellerId: so.sellerId, sellerOrderId: so.id, kind: 'PAYMENT_FEE' };
      lines.push(dr(ACCOUNT.SELLER_PENDING, shares[i]!, dims));
      lines.push(...serviceRevenueLines(ACCOUNT.FEE_RECOVERY, shares[i]!, rule, dims));
    });
  }
  return postJournalInTx(tx, {
    type: 'PAYMENT_FEE',
    description: `${p.method} fee on ${p.reference}`,
    occurredAt: at,
    idempotencyKey: `fee:${p.id}`,
    sourceType: 'PAYMENT',
    sourceId: p.id,
    lines,
  });
}

/** A courier (or self-delivering seller) collected cash on delivery. */
export async function postCodCollectedInTx(tx: Tx, collectionId: string, now = new Date()) {
  const c = await tx.codCollection.findUniqueOrThrow({
    where: { id: collectionId },
    select: {
      id: true,
      carrier: true,
      collectedAmount: true,
      collectedAt: true,
      sellerOrder: { select: { number: true } },
    },
  });
  const amount = c.collectedAmount ?? ZERO;
  if (amount.lte(0)) return null;
  return postJournalInTx(tx, {
    type: 'COD_COLLECTED',
    description: `Cash collected for ${c.sellerOrder.number} (${c.carrier ?? 'courier'})`,
    occurredAt: c.collectedAt ?? now,
    idempotencyKey: `cod-collected:${c.id}`,
    sourceType: 'COD_COLLECTION',
    sourceId: c.id,
    lines: [
      dr(ACCOUNT.COD_RECEIVABLE, amount, { kind: 'COD', description: c.carrier ?? null }),
      cr(ACCOUNT.CLEARING, amount, { kind: 'COD' }),
    ],
  });
}

/**
 * A courier remitted collected cash: the bank receives what arrived; the receivable closes for
 * what was expected; a shortage is a COD fee/shortage expense, an overage other income.
 */
export async function postCodRemittanceInTx(tx: Tx, remittanceId: string) {
  const r = await tx.codRemittance.findUniqueOrThrow({
    where: { id: remittanceId },
    select: {
      id: true,
      reference: true,
      carrier: true,
      amount: true,
      remittedAt: true,
      collections: { select: { collectedAmount: true } },
    },
  });
  const expected = sum(r.collections.map((c) => c.collectedAmount ?? ZERO));
  const diff = r.amount.sub(expected);
  return postJournalInTx(tx, {
    type: 'COD_REMITTED',
    description: `COD remittance ${r.reference} from ${r.carrier}`,
    occurredAt: r.remittedAt,
    idempotencyKey: `cod-remittance:${r.id}`,
    sourceType: 'COD_REMITTANCE',
    sourceId: r.id,
    lines: [
      dr(ACCOUNT.BANK, r.amount, { kind: 'COD' }),
      cr(ACCOUNT.COD_RECEIVABLE, expected, { kind: 'COD', description: r.carrier }),
      diff.lt(0)
        ? dr(ACCOUNT.COD_FEES, diff.neg(), { kind: 'COD_DIFFERENCE' })
        : cr(ACCOUNT.REFUNDS, diff, { kind: 'COD_DIFFERENCE' }),
    ],
  });
}

/** The configured COD fee, recovered from the seller when sellers bear COD fees. */
export async function postCodFeeInTx(tx: Tx, collectionId: string, now = new Date()) {
  const c = await tx.codCollection.findUniqueOrThrow({
    where: { id: collectionId },
    select: {
      id: true,
      collectedAmount: true,
      sellerOrder: { select: { id: true, sellerId: true, number: true } },
    },
  });
  const settings = await financeSettingsInTx(tx);
  if (settings.fees.bearer.COD !== 'SELLER') return null;
  const config = settings.fees.methods.COD;
  const amount = c.collectedAmount ?? ZERO;
  const fee = amount.lte(0)
    ? ZERO
    : cents(amount.times(config.percent).dividedBy(100)).add(config.fixed);
  if (fee.lte(0)) return null;
  const rule = await taxRuleAt(tx, 'MARKETPLACE_SERVICES', now);
  const dims = {
    sellerId: c.sellerOrder.sellerId,
    sellerOrderId: c.sellerOrder.id,
    kind: 'COD_FEE',
  };
  return postJournalInTx(tx, {
    type: 'COD_FEE',
    description: `COD fee on ${c.sellerOrder.number}`,
    occurredAt: now,
    idempotencyKey: `codfee:${c.id}`,
    sourceType: 'COD_COLLECTION',
    sourceId: c.id,
    lines: [
      dr(ACCOUNT.SELLER_PENDING, fee, dims),
      ...serviceRevenueLines(ACCOUNT.FEE_RECOVERY, fee, rule, dims),
    ],
  });
}

// ---- Sales, shipping credits and refunds --------------------------------------------------------

/**
 * Allocates a seller order's money once it is financially received (online payment, approved
 * bank transfer, COD remittance): the seller earns its items less its own discount (plus any
 * tax charged on top of prices, which is the seller's), the marketplace keeps shipping and
 * charges and pays for its own vouchers; the commission (with output VAT on it) is deducted
 * from the seller. Posted once per seller order.
 */
export async function postSaleInTx(tx: Tx, sellerOrderId: string, now = new Date()) {
  const so = await tx.sellerOrder.findUniqueOrThrow({
    where: { id: sellerOrderId },
    select: {
      id: true,
      sellerId: true,
      number: true,
      total: true,
      platformDiscount: true,
      shippingFee: true,
      sellerShippingDiscount: true,
      platformShippingDiscount: true,
      chargesTotal: true,
      commissionAmount: true,
      items: {
        select: { lineSubtotal: true, sellerDiscount: true, vatAmount: true, taxInclusive: true },
      },
    },
  });
  const gross = sum(so.items.map((i) => i.lineSubtotal.sub(i.sellerDiscount)));
  const taxOnTop = sum(so.items.filter((i) => !i.taxInclusive).map((i) => i.vatAmount));
  const seller = { sellerId: so.sellerId, sellerOrderId: so.id };
  const rule = await taxRuleAt(tx, 'MARKETPLACE_SERVICES', now);
  const commissionDims = { ...seller, kind: 'COMMISSION' };
  const posted = await postJournalInTx(tx, {
    type: 'SALE',
    description: `Sale ${so.number}`,
    occurredAt: now,
    idempotencyKey: `sale:${so.id}`,
    sourceType: 'SELLER_ORDER',
    sourceId: so.id,
    lines: [
      dr(ACCOUNT.CLEARING, so.total, { ...seller, kind: 'SALE' }),
      dr(ACCOUNT.VOUCHERS, so.platformDiscount.add(so.platformShippingDiscount), {
        ...seller,
        kind: 'VOUCHER',
      }),
      cr(ACCOUNT.SELLER_PENDING, gross.add(taxOnTop), { ...seller, kind: 'SALE' }),
      cr(ACCOUNT.SHIPPING, so.shippingFee.sub(so.sellerShippingDiscount), {
        ...seller,
        kind: 'SHIPPING',
      }),
      cr(ACCOUNT.CHARGES, so.chargesTotal, { ...seller, kind: 'CHARGES' }),
      dr(ACCOUNT.SELLER_PENDING, so.commissionAmount, commissionDims),
      ...serviceRevenueLines(ACCOUNT.COMMISSION, so.commissionAmount, rule, commissionDims),
    ],
  });
  await postShippingCreditIfDueInTx(tx, sellerOrderId, now);
  return posted;
}

/**
 * A seller who arranged the delivery themselves keeps the shipping fee the customer paid
 * (less their own shipping discount). Posted once, when both the sale is posted and a
 * self-arranged shipment exists.
 */
export async function postShippingCreditIfDueInTx(tx: Tx, sellerOrderId: string, now = new Date()) {
  const [sale, selfShipment, so] = await Promise.all([
    journalByKey(tx, `sale:${sellerOrderId}`),
    tx.shipment.count({
      where: {
        sellerOrderId,
        carrier: 'SELF',
        direction: 'FORWARD',
        returnRequestId: null,
        status: { not: 'CANCELLED' },
      },
    }),
    tx.sellerOrder.findUniqueOrThrow({
      where: { id: sellerOrderId },
      select: { sellerId: true, number: true, shippingFee: true, sellerShippingDiscount: true },
    }),
  ]);
  if (!sale || selfShipment === 0) return null;
  const credit = so.shippingFee.sub(so.sellerShippingDiscount);
  if (credit.lte(0)) return null;
  const dims = { sellerId: so.sellerId, sellerOrderId, kind: 'SHIPPING_CREDIT' };
  return postJournalInTx(tx, {
    type: 'SHIPPING_CREDIT',
    description: `Shipping fee for ${so.number} (self-arranged delivery)`,
    occurredAt: now,
    idempotencyKey: `shipcredit:${sellerOrderId}`,
    sourceType: 'SELLER_ORDER',
    sourceId: sellerOrderId,
    lines: [
      dr(ACCOUNT.SHIPPING, credit, dims),
      cr(await sellerBucketFor(tx, sellerOrderId), credit, dims),
    ],
  });
}

/**
 * A refund succeeded: the money leaves the account it was paid from; the seller's share
 * (seller_debit) is taken back from the seller (pending, or available once settled); the
 * commission on the refunded items is given back with its output VAT; the rest is the
 * marketplace's (contra revenue). Refunds without a seller order return unallocated money.
 */
export async function postRefundInTx(tx: Tx, refundId: string, now = new Date()) {
  const r = await tx.refund.findUniqueOrThrow({
    where: { id: refundId },
    select: {
      id: true,
      reference: true,
      amount: true,
      sellerDebit: true,
      commissionReversal: true,
      method: true,
      succeededAt: true,
      sellerOrderId: true,
      sellerOrder: { select: { sellerId: true, number: true } },
      payment: { select: { provider: true } },
    },
  });
  const cash = r.method === 'MANUAL' ? ACCOUNT.BANK : cashAccountFor(r.payment.provider);
  const lines: JournalLine[] = [cr(cash, r.amount, { kind: 'REFUND' })];
  if (r.sellerOrderId && r.sellerOrder) {
    const seller = { sellerId: r.sellerOrder.sellerId, sellerOrderId: r.sellerOrderId };
    const bucket = await sellerBucketFor(tx, r.sellerOrderId);
    lines.push(dr(bucket, r.sellerDebit, { ...seller, kind: 'REFUND' }));
    lines.push(dr(ACCOUNT.REFUNDS, r.amount.sub(r.sellerDebit), { ...seller, kind: 'REFUND' }));
    if (r.commissionReversal.gt(0)) {
      // Give back the VAT at the rate charged on the original commission.
      const [orig] = await tx.$queryRaw<
        { net: Prisma.Decimal | null; tax: Prisma.Decimal | null }[]
      >`
        SELECT SUM(CASE WHEN a."code" = '4010' THEN e."credit" ELSE 0 END) AS "net",
               SUM(CASE WHEN a."code" = '2310' THEN e."credit" ELSE 0 END) AS "tax"
        FROM "journal_entries" e
        JOIN "journal_transactions" t ON t."id" = e."transaction_id"
        JOIN "ledger_accounts" a ON a."id" = e."account_id"
        WHERE t."idempotency_key" = ${'sale:' + r.sellerOrderId} AND e."kind" = 'COMMISSION'`;
      const net = D(orig?.net ?? 0);
      const tax = D(orig?.tax ?? 0);
      const vat = net.add(tax).isZero()
        ? ZERO
        : cents(r.commissionReversal.times(tax).dividedBy(net.add(tax)));
      const dims = { ...seller, kind: 'COMMISSION_REVERSAL' };
      lines.push(cr(bucket, r.commissionReversal, dims));
      lines.push(dr(ACCOUNT.COMMISSION, r.commissionReversal.sub(vat), dims));
      lines.push(dr(ACCOUNT.OUTPUT_VAT, vat, dims));
    }
  } else {
    lines.push(dr(ACCOUNT.CLEARING, r.amount, { kind: 'REFUND' }));
  }
  return postJournalInTx(tx, {
    type: 'REFUND',
    description: `Refund ${r.reference}${r.sellerOrder ? ` on ${r.sellerOrder.number}` : ''}`,
    occurredAt: r.succeededAt ?? now,
    idempotencyKey: `refund:${r.id}`,
    sourceType: 'REFUND',
    sourceId: r.id,
    lines,
  });
}

// ---- Settlement periods -----------------------------------------------------------------------

/** Philippine time has no daylight saving: a fixed UTC+8 offset. */
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Biweekly periods count from this Monday (Philippine time). */
const BIWEEKLY_ANCHOR = Date.UTC(2026, 0, 5) - MANILA_OFFSET_MS;

export interface SettlementPeriod {
  start: Date;
  /** Exclusive. */
  end: Date;
}

/** The settlement period containing an instant. */
export function periodContaining(
  at: Date,
  settings: FinanceSettings['settlement'],
): SettlementPeriod {
  const local = new Date(at.getTime() + MANILA_OFFSET_MS);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  if (settings.frequency === 'MONTHLY') {
    const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - MANILA_OFFSET_MS;
    const end = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - MANILA_OFFSET_MS;
    return { start: new Date(start), end: new Date(end) };
  }
  const back = (local.getUTCDay() - settings.weekStartsOn + 7) % 7;
  let start = midnight - back * DAY_MS - MANILA_OFFSET_MS;
  let length = 7 * DAY_MS;
  if (settings.frequency === 'BIWEEKLY') {
    length = 14 * DAY_MS;
    const anchor = BIWEEKLY_ANCHOR + ((settings.weekStartsOn - 1 + 7) % 7) * DAY_MS;
    const weeks = Math.floor((start - anchor) / (7 * DAY_MS));
    if (((weeks % 2) + 2) % 2 === 1) start -= 7 * DAY_MS;
  }
  return { start: new Date(start), end: new Date(start + length) };
}

/** The most recent period that has ended at `now`. */
export function lastClosedPeriod(
  now: Date,
  settings: FinanceSettings['settlement'],
): SettlementPeriod {
  const current = periodContaining(now, settings);
  return periodContaining(new Date(current.start.getTime() - 1), settings);
}
