import type { NotificationEventCode } from '@marketplace/shared-types';
import {
  type AffiliateSettings,
  affiliateSettingsSchema,
  DEFAULT_AFFILIATE_SETTINGS,
  DEFAULT_LOYALTY_SETTINGS,
  type LoyaltySettings,
  loyaltySettingsSchema,
} from '@marketplace/validation';
import { ACCOUNT, cents, cr, dr, journalByKey, postJournalInTx } from './ledger';
import { Prisma } from './generated/prisma/client';

/**
 * Customer engagement in the order lifecycle (Phase 7): loyalty points (ADR 0031), referrals
 * and affiliate commissions (ADR 0032), and the notification outbox (ADR 0033). Everything
 * here runs inside the caller's transaction, so it commits or rolls back with the order change.
 */

type Tx = Prisma.TransactionClient;
const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const ZERO = D(0);
const sum = (values: Prisma.Decimal[]) => values.reduce((a, b) => a.add(b), ZERO);
const DAY_MS = 86_400_000;

// ---- Settings ---------------------------------------------------------------------------------

export async function loyaltySettingsInTx(
  db: Pick<Tx, 'platformSetting'>,
): Promise<LoyaltySettings> {
  const row = await db.platformSetting.findUnique({ where: { key: 'loyalty' } });
  const parsed = row ? loyaltySettingsSchema.safeParse(row.value) : null;
  return parsed?.success ? parsed.data : DEFAULT_LOYALTY_SETTINGS;
}

export async function affiliateSettingsInTx(
  db: Pick<Tx, 'platformSetting'>,
): Promise<AffiliateSettings> {
  const row = await db.platformSetting.findUnique({ where: { key: 'affiliates' } });
  const parsed = row ? affiliateSettingsSchema.safeParse(row.value) : null;
  return parsed?.success ? parsed.data : DEFAULT_AFFILIATE_SETTINGS;
}

/** Calendar months later (the day is clamped, e.g. 31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** Points earned for a merchandise amount: whole points only (1 per ₱100 by default). */
export function pointsForAmount(amount: Prisma.Decimal, settings: LoyaltySettings): number {
  if (amount.lte(0)) return 0;
  return amount.dividedBy(settings.pesosPerPoint).floor().toNumber();
}

/** The most points an order may use: the balance, and maxRedeemPercent of the items. */
export function maxRedeemablePoints(
  balance: number,
  itemsAfterDiscounts: Prisma.Decimal,
  settings: LoyaltySettings,
): number {
  if (!settings.enabled || balance <= 0 || itemsAfterDiscounts.lte(0)) return 0;
  const cap = itemsAfterDiscounts
    .times(settings.maxRedeemPercent)
    .dividedBy(100)
    .dividedBy(settings.pointValue)
    .floor()
    .toNumber();
  return Math.max(0, Math.min(balance, cap));
}

// ---- Loyalty ledger ---------------------------------------------------------------------------

export class InsufficientPointsError extends Error {
  readonly code = 'INSUFFICIENT_POINTS';
  constructor(readonly balance: number) {
    super(`Only ${balance} points are available.`);
  }
}

/** Locks (creating if needed) the customer's loyalty account row. */
export async function lockLoyaltyAccountInTx(tx: Tx, userId: string) {
  await tx.$executeRaw`
    INSERT INTO "loyalty_accounts" ("id", "user_id", "updated_at")
    VALUES (gen_random_uuid(), ${userId}::uuid, now())
    ON CONFLICT ("user_id") DO NOTHING`;
  const [row] = await tx.$queryRaw<{ id: string; balance: number; lifetime_earned: number }[]>`
    SELECT "id", "balance", "lifetime_earned" FROM "loyalty_accounts"
    WHERE "user_id" = ${userId}::uuid FOR UPDATE`;
  return { id: row!.id, balance: row!.balance, lifetimeEarned: row!.lifetime_earned };
}

export interface LoyaltyEntryInput {
  userId: string;
  type: Prisma.LoyaltyTransactionCreateManyInput['type'];
  points: number;
  description: string;
  idempotencyKey: string;
  orderId?: string | null;
  sellerOrderId?: string | null;
  refundId?: string | null;
  referralId?: string | null;
  createdById?: string | null;
  expiresAt?: Date | null;
  /** Peso value per point (default: the current setting). */
  pointValue?: string;
  now?: Date;
  /** Take what is there instead of failing when the balance is too low (reversals). */
  clampToBalance?: boolean;
  /**
   * Ledger lines for the value: 'EXPENSE' (5050 ↔ 2410), 'REFUND' (4090 → 2410, points given
   * back for refunded items), or null (no posting: e.g. points redeemed or given back before the
   * sale was posted, see ADR 0031).
   */
  posting?: 'EXPENSE' | 'REFUND' | null;
}

/**
 * Appends one entry to the points ledger and moves the cached balance, under the account lock.
 * The same idempotency key is applied once (returns null afterwards).
 */
export async function postLoyaltyInTx(
  tx: Tx,
  input: LoyaltyEntryInput,
): Promise<{ id: string; points: number; balanceAfter: number } | null> {
  if (input.points === 0) return null;
  const now = input.now ?? new Date();
  const account = await lockLoyaltyAccountInTx(tx, input.userId);
  const existing = await tx.loyaltyTransaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true },
  });
  if (existing) return null;
  let points = input.points;
  if (points < 0 && account.balance + points < 0) {
    if (!input.clampToBalance) throw new InsufficientPointsError(account.balance);
    points = -account.balance;
    if (points === 0) return null;
  }
  const settings = await loyaltySettingsInTx(tx);
  const pointValue = D(input.pointValue ?? settings.pointValue);
  const value = cents(pointValue.times(Math.abs(points)));
  const balanceAfter = account.balance + points;
  const row = await tx.loyaltyTransaction.create({
    data: {
      accountId: account.id,
      userId: input.userId,
      type: input.type,
      points,
      balanceAfter,
      value,
      expiresAt: points > 0 ? (input.expiresAt ?? null) : null,
      orderId: input.orderId ?? null,
      sellerOrderId: input.sellerOrderId ?? null,
      refundId: input.refundId ?? null,
      referralId: input.referralId ?? null,
      description: input.description,
      idempotencyKey: input.idempotencyKey,
      createdById: input.createdById ?? null,
      createdAt: now,
    },
    select: { id: true },
  });
  await tx.loyaltyAccount.update({
    where: { id: account.id },
    data: {
      balance: balanceAfter,
      ...(['EARN', 'REFERRAL_BONUS'].includes(input.type)
        ? { lifetimeEarned: { increment: points } }
        : {}),
    },
  });
  if (input.posting) {
    const dims = { kind: `LOYALTY_${input.type}` };
    const other = input.posting === 'REFUND' ? ACCOUNT.REFUNDS : ACCOUNT.LOYALTY_EXPENSE;
    await postJournalInTx(tx, {
      type: `LOYALTY_${input.type}`,
      description: input.description,
      occurredAt: now,
      idempotencyKey: `loyalty:${row.id}`,
      sourceType: 'LOYALTY_TRANSACTION',
      sourceId: row.id,
      createdById: input.createdById ?? null,
      lines:
        points > 0
          ? [dr(other, value, dims), cr(ACCOUNT.LOYALTY_LIABILITY, value, dims)]
          : [dr(ACCOUNT.LOYALTY_LIABILITY, value, dims), cr(other, value, dims)],
    });
  }
  return { id: row.id, points, balanceAfter };
}

/**
 * Points of a customer that have passed their expiry date and are still unused. Lots are used
 * first-in, first-out: what expired is the earned points with expires_at ≤ now minus every
 * point taken away since (spent, expired, reversed), floored at zero.
 */
export async function expirablePointsInTx(tx: Pick<Tx, '$queryRaw'>, userId: string, now: Date) {
  const [row] = await tx.$queryRaw<{ expired: bigint | null; debits: bigint | null }[]>`
    SELECT
      SUM(CASE WHEN "points" > 0 AND "expires_at" IS NOT NULL AND "expires_at" <= ${now} THEN "points" ELSE 0 END) AS "expired",
      SUM(CASE WHEN "points" < 0 THEN -"points" ELSE 0 END) AS "debits"
    FROM "loyalty_transactions" WHERE "user_id" = ${userId}::uuid`;
  return Math.max(0, Number(row?.expired ?? 0) - Number(row?.debits ?? 0));
}

/** Points that will expire between now and `until` (for "expiring soon"). */
export async function expiringPointsInTx(
  tx: Pick<Tx, '$queryRaw'>,
  userId: string,
  now: Date,
  until: Date,
): Promise<{ points: number; firstAt: Date | null }> {
  const lots = await tx.$queryRaw<{ points: number; expires_at: Date | null }[]>`
    SELECT "points", "expires_at" FROM "loyalty_transactions"
    WHERE "user_id" = ${userId}::uuid AND "points" > 0 ORDER BY "expires_at" ASC NULLS LAST, "created_at" ASC`;
  const [debit] = await tx.$queryRaw<{ debits: bigint | null }[]>`
    SELECT SUM(-"points") AS "debits" FROM "loyalty_transactions"
    WHERE "user_id" = ${userId}::uuid AND "points" < 0`;
  let used = Number(debit?.debits ?? 0);
  let points = 0;
  let firstAt: Date | null = null;
  for (const lot of lots) {
    const left = Math.max(0, lot.points - used);
    used = Math.max(0, used - lot.points);
    if (left === 0 || !lot.expires_at) continue;
    if (lot.expires_at > now && lot.expires_at <= until) {
      points += left;
      firstAt ??= lot.expires_at;
    }
  }
  return { points, firstAt };
}

/** Expires every customer's points past their date (worker, daily). Returns customers touched. */
export async function expireLoyaltyPoints(
  db: { $queryRaw: Tx['$queryRaw']; $transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T> },
  options: { now?: Date; limit?: number; userId?: string } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const users = await db.$queryRaw<{ user_id: string }[]>`
    SELECT DISTINCT t."user_id" FROM "loyalty_transactions" t
    JOIN "loyalty_accounts" a ON a."id" = t."account_id"
    WHERE t."points" > 0 AND t."expires_at" <= ${now} AND a."balance" > 0
      AND (${options.userId ?? null}::uuid IS NULL OR t."user_id" = ${options.userId ?? null}::uuid)
    LIMIT ${options.limit ?? 500}::int`;
  let touched = 0;
  const day = now.toISOString().slice(0, 10);
  for (const { user_id } of users) {
    const done = await db.$transaction(async (tx) => {
      await lockLoyaltyAccountInTx(tx, user_id);
      const points = await expirablePointsInTx(tx, user_id, now);
      if (points <= 0) return false;
      const result = await postLoyaltyInTx(tx, {
        userId: user_id,
        type: 'EXPIRE',
        points: -points,
        description: `${points} points expired`,
        idempotencyKey: `expire:${user_id}:${day}`,
        clampToBalance: true,
        posting: 'EXPENSE',
        now,
      });
      return result !== null;
    });
    if (done) touched += 1;
  }
  return touched;
}

/** Merchandise the customer paid for on a seller order: items after every discount. */
async function merchandisePaidInTx(tx: Tx, sellerOrderId: string) {
  const items = await tx.orderItem.findMany({
    where: { sellerOrderId },
    select: { lineTotal: true },
  });
  return sum(items.map((i) => i.lineTotal));
}

async function succeededItemRefundsInTx(tx: Tx, sellerOrderId: string) {
  const agg = await tx.refund.aggregate({
    where: { sellerOrderId, status: 'SUCCEEDED' },
    _sum: { itemsAmount: true },
  });
  return agg._sum.itemsAmount ?? ZERO;
}

/** Points for a completed seller order, on what was paid less what was refunded. */
export async function earnLoyaltyForSellerOrderInTx(tx: Tx, sellerOrderId: string, now: Date) {
  const settings = await loyaltySettingsInTx(tx);
  if (!settings.enabled) return null;
  const so = await tx.sellerOrder.findUniqueOrThrow({
    where: { id: sellerOrderId },
    select: { id: true, orderId: true, number: true, order: { select: { customerId: true } } },
  });
  const net = (await merchandisePaidInTx(tx, so.id)).sub(await succeededItemRefundsInTx(tx, so.id));
  const points = pointsForAmount(net, settings);
  if (points <= 0) return null;
  return postLoyaltyInTx(tx, {
    userId: so.order.customerId,
    type: 'EARN',
    points,
    description: `Order ${so.number} completed`,
    idempotencyKey: `earn:${so.id}`,
    orderId: so.orderId,
    sellerOrderId: so.id,
    expiresAt: addMonths(now, settings.expiryMonths),
    posting: 'EXPENSE',
    now,
  });
}

/**
 * Spent points given back for a seller order: all of them when it is cancelled, or the share
 * of the refunded items. Posted to the ledger only when the sale was posted (the redemption is
 * recognised in the sale journal).
 */
export async function restoreRedeemedPointsInTx(
  tx: Tx,
  input: { sellerOrderId: string; refundId?: string; now: Date },
) {
  const so = await tx.sellerOrder.findUniqueOrThrow({
    where: { id: input.sellerOrderId },
    select: {
      id: true,
      orderId: true,
      number: true,
      pointsRedeemed: true,
      order: { select: { customerId: true } },
    },
  });
  if (so.pointsRedeemed <= 0) return null;
  const restored = await tx.loyaltyTransaction.aggregate({
    where: { sellerOrderId: so.id, type: 'RESTORE' },
    _sum: { points: true },
  });
  const left = so.pointsRedeemed - (restored._sum.points ?? 0);
  if (left <= 0) return null;
  let points = left;
  if (input.refundId) {
    const refund = await tx.refund.findUniqueOrThrow({
      where: { id: input.refundId },
      select: { itemsAmount: true },
    });
    const paid = await merchandisePaidInTx(tx, so.id);
    if (paid.lte(0)) return null;
    const share = Prisma.Decimal.min(1, refund.itemsAmount.dividedBy(paid));
    points = Math.min(left, share.times(so.pointsRedeemed).round().toNumber());
  }
  if (points <= 0) return null;
  const salePosted = (await journalByKey(tx, `sale:${so.id}`)) !== null;
  // The redeemed value at the time of the order, so the ledger reverses what the sale used.
  const redeem = await tx.loyaltyTransaction.findFirst({
    where: { orderId: so.orderId, type: 'REDEEM' },
    select: { points: true, value: true },
  });
  const pointValue = redeem
    ? redeem.value.dividedBy(Math.abs(redeem.points)).toString()
    : undefined;
  return postLoyaltyInTx(tx, {
    userId: so.order.customerId,
    type: 'RESTORE',
    points,
    description: input.refundId
      ? `Points given back for refunded items on ${so.number}`
      : `Points given back: ${so.number} cancelled`,
    idempotencyKey: input.refundId ? `restore:${input.refundId}` : `restore:cancel:${so.id}`,
    orderId: so.orderId,
    sellerOrderId: so.id,
    refundId: input.refundId ?? null,
    pointValue,
    expiresAt: addMonths(input.now, (await loyaltySettingsInTx(tx)).expiryMonths),
    posting: salePosted ? 'REFUND' : null,
    now: input.now,
  });
}

/** Earned points taken back after a refund on a completed seller order (proportional). */
export async function reverseEarnedPointsInTx(
  tx: Tx,
  input: { sellerOrderId: string; refundId: string; now: Date },
) {
  const earned = await tx.loyaltyTransaction.findUnique({
    where: { idempotencyKey: `earn:${input.sellerOrderId}` },
    select: { points: true, userId: true, orderId: true },
  });
  if (!earned) return null;
  const settings = await loyaltySettingsInTx(tx);
  const reversed = await tx.loyaltyTransaction.aggregate({
    where: { sellerOrderId: input.sellerOrderId, type: 'REVERSE' },
    _sum: { points: true },
  });
  const net = (await merchandisePaidInTx(tx, input.sellerOrderId)).sub(
    await succeededItemRefundsInTx(tx, input.sellerOrderId),
  );
  const shouldHave = pointsForAmount(net, settings);
  const take = earned.points + (reversed._sum.points ?? 0) - shouldHave;
  if (take <= 0) return null;
  return postLoyaltyInTx(tx, {
    userId: earned.userId,
    type: 'REVERSE',
    points: -take,
    description: 'Points taken back for a refund',
    idempotencyKey: `reverse:${input.refundId}`,
    orderId: earned.orderId,
    sellerOrderId: input.sellerOrderId,
    refundId: input.refundId,
    clampToBalance: true,
    posting: 'EXPENSE',
    now: input.now,
  });
}

// ---- Referrals --------------------------------------------------------------------------------

/** Rewards both customers on the referee's first completed seller order. */
export async function rewardReferralInTx(tx: Tx, sellerOrderId: string, now: Date) {
  const settings = await loyaltySettingsInTx(tx);
  if (!settings.enabled || !settings.referral.enabled) return null;
  const so = await tx.sellerOrder.findUniqueOrThrow({
    where: { id: sellerOrderId },
    select: { id: true, number: true, order: { select: { customerId: true } } },
  });
  const [referral] = await tx.$queryRaw<{ id: string; referrer_id: string; status: string }[]>`
    SELECT "id", "referrer_id", "status"::text FROM "referrals"
    WHERE "referee_id" = ${so.order.customerId}::uuid FOR UPDATE`;
  if (!referral || referral.status !== 'PENDING') return null;
  await tx.referral.update({
    where: { id: referral.id },
    data: { status: 'REWARDED', rewardedAt: now, sellerOrderId: so.id },
  });
  const expiresAt = addMonths(now, settings.expiryMonths);
  await postLoyaltyInTx(tx, {
    userId: referral.referrer_id,
    type: 'REFERRAL_BONUS',
    points: settings.referral.referrerPoints,
    description: 'A friend you referred completed their first order',
    idempotencyKey: `referral:${referral.id}:referrer`,
    referralId: referral.id,
    expiresAt,
    posting: 'EXPENSE',
    now,
  });
  await postLoyaltyInTx(tx, {
    userId: so.order.customerId,
    type: 'REFERRAL_BONUS',
    points: settings.referral.refereePoints,
    description: 'Welcome bonus for joining with a referral code',
    idempotencyKey: `referral:${referral.id}:referee`,
    referralId: referral.id,
    expiresAt,
    posting: 'EXPENSE',
    now,
  });
  return referral.id;
}

// ---- Affiliates -------------------------------------------------------------------------------

/** Accrues the affiliate commission of a completed seller order (net of refunds so far). */
export async function accrueAffiliateInTx(tx: Tx, sellerOrderId: string, now: Date) {
  const [conv] = await tx.$queryRaw<
    {
      id: string;
      status: string;
      base_amount: Prisma.Decimal;
      commission_amount: Prisma.Decimal;
    }[]
  >`
    SELECT "id", "status"::text, "base_amount", "commission_amount" FROM "affiliate_conversions"
    WHERE "seller_order_id" = ${sellerOrderId}::uuid FOR UPDATE`;
  if (!conv || conv.status !== 'PENDING') return null;
  const refunded = await succeededItemRefundsInTx(tx, sellerOrderId);
  const commission = D(conv.commission_amount);
  const base = D(conv.base_amount);
  const reversed = base.lte(0)
    ? commission
    : cents(commission.times(Prisma.Decimal.min(1, refunded.dividedBy(base))));
  await tx.affiliateConversion.update({
    where: { id: conv.id },
    data: { status: 'ACCRUED', accruedAt: now, reversedAmount: reversed },
  });
  const amount = commission.sub(reversed);
  const so = await tx.sellerOrder.findUniqueOrThrow({
    where: { id: sellerOrderId },
    select: { number: true },
  });
  await postJournalInTx(tx, {
    type: 'AFFILIATE_COMMISSION',
    description: `Affiliate commission on ${so.number}`,
    occurredAt: now,
    idempotencyKey: `affiliate:${conv.id}`,
    sourceType: 'AFFILIATE_CONVERSION',
    sourceId: conv.id,
    lines: [
      dr(ACCOUNT.AFFILIATE_EXPENSE, amount, { kind: 'AFFILIATE' }),
      cr(ACCOUNT.AFFILIATE_PAYABLE, amount, { kind: 'AFFILIATE' }),
    ],
  });
  return conv.id;
}

/** A refund lowers the affiliate commission: recorded on the conversion, posted once accrued. */
export async function reverseAffiliateForRefundInTx(
  tx: Tx,
  input: { sellerOrderId: string; refundId: string; now: Date },
) {
  const [conv] = await tx.$queryRaw<
    {
      id: string;
      status: string;
      base_amount: Prisma.Decimal;
      commission_amount: Prisma.Decimal;
      reversed_amount: Prisma.Decimal;
    }[]
  >`
    SELECT "id", "status"::text, "base_amount", "commission_amount", "reversed_amount"
    FROM "affiliate_conversions" WHERE "seller_order_id" = ${input.sellerOrderId}::uuid FOR UPDATE`;
  if (!conv || conv.status === 'CANCELLED') return null;
  if (conv.status === 'PENDING') return null; // applied when it accrues
  const refunded = await succeededItemRefundsInTx(tx, input.sellerOrderId);
  const commission = D(conv.commission_amount);
  const base = D(conv.base_amount);
  const target = base.lte(0)
    ? commission
    : cents(commission.times(Prisma.Decimal.min(1, refunded.dividedBy(base))));
  const more = target.sub(conv.reversed_amount);
  if (more.lte(0)) return null;
  await tx.affiliateConversion.update({
    where: { id: conv.id },
    data: { reversedAmount: target },
  });
  await postJournalInTx(tx, {
    type: 'AFFILIATE_REVERSAL',
    description: 'Affiliate commission reversed for a refund',
    occurredAt: input.now,
    idempotencyKey: `affiliate-reversal:${input.refundId}`,
    sourceType: 'AFFILIATE_CONVERSION',
    sourceId: conv.id,
    lines: [
      dr(ACCOUNT.AFFILIATE_PAYABLE, more, { kind: 'AFFILIATE_REVERSAL' }),
      cr(ACCOUNT.AFFILIATE_EXPENSE, more, { kind: 'AFFILIATE_REVERSAL' }),
    ],
  });
  return conv.id;
}

/**
 * What an affiliate is owed: every accrued commission net of reversals (paid or not), minus
 * every payout recorded. Reversals after a payout lower the next one.
 */
export async function affiliatePayableInTx(tx: Pick<Tx, '$queryRaw'>, affiliateAccountId: string) {
  const [row] = await tx.$queryRaw<
    { earned: Prisma.Decimal | null; paid: Prisma.Decimal | null }[]
  >`
    SELECT
      (SELECT SUM("commission_amount" - "reversed_amount") FROM "affiliate_conversions"
        WHERE "affiliate_account_id" = ${affiliateAccountId}::uuid AND "status" IN ('ACCRUED', 'PAID')) AS "earned",
      (SELECT SUM("amount") FROM "affiliate_payouts" WHERE "affiliate_account_id" = ${affiliateAccountId}::uuid) AS "paid"`;
  return D(row?.earned ?? 0).sub(D(row?.paid ?? 0));
}

// ---- Notification outbox ----------------------------------------------------------------------

export interface NotificationEmit {
  event: NotificationEventCode;
  userIds: string[];
  data: Record<string, string | number | null>;
  link?: string | null;
}

/** Writes a notification event; the worker renders and sends it after the commit. */
export async function emitNotificationInTx(
  tx: Pick<Tx, 'notificationEvent'>,
  input: NotificationEmit,
) {
  const userIds = [...new Set(input.userIds)];
  if (userIds.length === 0) return null;
  const row = await tx.notificationEvent.create({
    data: {
      event: input.event,
      userIds,
      data: input.data as Prisma.InputJsonValue,
      link: input.link ?? null,
    },
    select: { id: true },
  });
  return row.id;
}

/** The seller's owner and active team members. */
export async function sellerRecipientIdsInTx(tx: Pick<Tx, 'seller'>, sellerId: string) {
  const seller = await tx.seller.findUnique({
    where: { id: sellerId },
    select: { ownerId: true, members: { where: { status: 'ACTIVE' }, select: { userId: true } } },
  });
  if (!seller) return [];
  return [seller.ownerId, ...seller.members.map((m) => m.userId)];
}

// ---- Lifecycle hooks --------------------------------------------------------------------------

/**
 * Called by transitionSellerOrderInTx after every status change: shipment and delivery
 * notifications; loyalty, referral and affiliate rewards on completion; given-back points and
 * cancelled conversions on cancellation.
 */
export async function onSellerOrderStatusInTx(
  tx: Tx,
  input: { sellerOrderId: string; to: string; now: Date },
) {
  const { sellerOrderId, to, now } = input;
  if (!['SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED'].includes(to)) return;
  const so = await tx.sellerOrder.findUniqueOrThrow({
    where: { id: sellerOrderId },
    select: {
      id: true,
      orderId: true,
      number: true,
      store: { select: { name: true } },
      order: {
        select: {
          orderNumber: true,
          customerId: true,
          customer: { select: { firstName: true } },
        },
      },
    },
  });
  const base = {
    firstName: so.order.customer.firstName,
    orderNumber: so.number,
    storeName: so.store.name,
  };
  const link = `/account/orders/${so.orderId}`;
  if (to === 'SHIPPED') {
    const shipment = await tx.shipment.findFirst({
      where: { sellerOrderId, direction: 'FORWARD', returnRequestId: null },
      orderBy: { createdAt: 'desc' },
      select: { carrierName: true, trackingNumber: true },
    });
    await emitNotificationInTx(tx, {
      event: 'ORDER_SHIPPED',
      userIds: [so.order.customerId],
      data: {
        ...base,
        carrier: shipment?.carrierName ?? 'the courier',
        trackingNumber: shipment?.trackingNumber ?? '—',
      },
      link,
    });
  } else if (to === 'DELIVERED') {
    await emitNotificationInTx(tx, {
      event: 'ORDER_DELIVERED',
      userIds: [so.order.customerId],
      data: base,
      link,
    });
  } else if (to === 'COMPLETED') {
    const earned = await earnLoyaltyForSellerOrderInTx(tx, sellerOrderId, now);
    await rewardReferralInTx(tx, sellerOrderId, now);
    await accrueAffiliateInTx(tx, sellerOrderId, now);
    if (earned) {
      await emitNotificationInTx(tx, {
        event: 'LOYALTY_POINTS_EARNED',
        userIds: [so.order.customerId],
        data: { ...base, points: earned.points, balance: earned.balanceAfter },
        link: '/account/loyalty',
      });
    }
  } else if (to === 'CANCELLED') {
    await restoreRedeemedPointsInTx(tx, { sellerOrderId, now });
    await tx.affiliateConversion.updateMany({
      where: { sellerOrderId, status: 'PENDING' },
      data: { status: 'CANCELLED', cancelledAt: now },
    });
  }
}

/** Called when a refund succeeds: points and affiliate commission follow the refund. */
export async function onRefundSucceededInTx(tx: Tx, refundId: string, now = new Date()) {
  const refund = await tx.refund.findUniqueOrThrow({
    where: { id: refundId },
    select: {
      id: true,
      amount: true,
      orderId: true,
      sellerOrderId: true,
      sellerOrder: { select: { number: true, status: true } },
      order: {
        select: { orderNumber: true, customerId: true, customer: { select: { firstName: true } } },
      },
    },
  });
  if (refund.sellerOrderId) {
    // A cancelled seller order already got all its points back.
    if (refund.sellerOrder?.status !== 'CANCELLED') {
      await restoreRedeemedPointsInTx(tx, { sellerOrderId: refund.sellerOrderId, refundId, now });
    }
    await reverseEarnedPointsInTx(tx, { sellerOrderId: refund.sellerOrderId, refundId, now });
    await reverseAffiliateForRefundInTx(tx, {
      sellerOrderId: refund.sellerOrderId,
      refundId,
      now,
    });
  }
  await emitNotificationInTx(tx, {
    event: 'REFUND_APPROVED',
    userIds: [refund.order.customerId],
    data: {
      firstName: refund.order.customer.firstName,
      orderNumber: refund.sellerOrder?.number ?? refund.order.orderNumber,
      amount: refund.amount.toFixed(2),
    },
    link: `/account/orders/${refund.orderId}`,
  });
}

/** Last N days, for "expiring soon". */
export const daysFrom = (now: Date, days: number) => new Date(now.getTime() + days * DAY_MS);
