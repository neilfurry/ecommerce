import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  lockOrderInTx,
  onRefundSucceededInTx,
  postRefundInTx,
  Prisma,
  sellerOrderPosition,
  syncOrderPaymentStatusInTx,
} from '@marketplace/database';
import type { RefundInput, WebhookOutcome } from '@marketplace/payments';
import type { AuthenticatedUser, PaginatedResponse } from '@marketplace/shared-types';
import type { RefundDto, SellerLedger } from '@marketplace/validation';
import type { RequestContext } from '../../../common/auth/auth.decorators';
import { sellerScope } from '../../../common/auth/seller-scope';
import { ApiException } from '../../../common/errors/api.exception';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { refundDto, refundInclude } from '../order-mapping';
import { OrderNotifier } from '../order-notifier.service';
import { newReference } from '../references';
import { PaymentGatewaysService } from '../payments/payment-gateways.service';

type Tx = Prisma.TransactionClient;
type Decimal = Prisma.Decimal;
const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const ZERO = D(0);
/** Rounds to centavos (half up), like the checkout. */
const cents = (d: Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const minD = (a: Decimal, b: Decimal) => (a.lt(b) ? a : b);
const nonNeg = (d: Decimal) => (d.lt(0) ? ZERO : d);

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Refund not found.');
const conflict = (message: string) => new ApiException(HttpStatus.CONFLICT, 'CONFLICT', message);

const ONLINE = ['MOCK', 'PAYMONGO', 'MAYA_BUSINESS', 'XENDIT'];
const GATEWAY_REASON: Record<string, RefundInput['reason']> = {
  CANCELLATION: 'requested_by_customer',
  RETURN: 'requested_by_customer',
  GOODWILL: 'requested_by_customer',
  DUPLICATE_PAYMENT: 'duplicate',
  LATE_PAYMENT: 'others',
  OTHER: 'others',
};

/** What a refund gives back and what it costs the seller. */
export interface RefundSpec {
  paymentId: string;
  sellerOrderId: string | null;
  returnRequestId: string | null;
  reason: 'CANCELLATION' | 'RETURN' | 'LATE_PAYMENT' | 'DUPLICATE_PAYMENT' | 'GOODWILL' | 'OTHER';
  kind: 'FULL' | 'PARTIAL';
  itemsAmount: Decimal;
  shippingAmount: Decimal;
  chargesAmount: Decimal;
  sellerDebit: Decimal;
  commissionReversal: Decimal;
  note: string | null;
  idempotencyKey: string;
  requestedById: string | null;
}

/**
 * Refunds and the seller payables they change.
 *
 * Creating a refund reserves the amount on the payment (refunded_amount, never more than was
 * received: CHECK) under the payment row lock, so two refunds can never give back the same
 * money; each has a unique idempotency key and at most one live refund exists per return and
 * per cancelled seller order (partial unique indexes). Online refunds then go to the provider
 * with the refund id as its idempotency key; manual ones (bank transfer, cash on delivery)
 * wait for finance to pay out. Only a SUCCEEDED refund posts the seller's REFUND and
 * COMMISSION_REVERSAL ledger entries (once per refund: unique index).
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateways: PaymentGatewaysService,
    private readonly audit: AuditService,
    private readonly notifier: OrderNotifier,
  ) {}

  // ---- Creating ------------------------------------------------------------------------------

  /** Inside the caller's transaction. Returns the existing refund for a repeated key. */
  async createInTx(tx: Tx, spec: RefundSpec): Promise<{ id: string; created: boolean }> {
    const owner = await tx.payment.findUnique({
      where: { id: spec.paymentId },
      select: { orderId: true },
    });
    if (owner) await lockOrderInTx(tx, owner.orderId);
    // Checked under the order lock, so a concurrent request with the same key sees its twin.
    const existing = await tx.refund.findUnique({ where: { idempotencyKey: spec.idempotencyKey } });
    if (existing) return { id: existing.id, created: false };
    const amount = spec.itemsAmount.add(spec.shippingAmount).add(spec.chargesAmount);
    if (amount.lte(0)) throw conflict('There is nothing to refund.');
    const [payment] = await tx.$queryRaw<
      {
        id: string;
        order_id: string;
        provider: string;
        provider_payment_id: string | null;
        livemode: boolean;
        amount_received: Decimal;
        refunded_amount: Decimal;
      }[]
    >`SELECT "id", "order_id", "provider"::text, "provider_payment_id", "livemode", "amount_received", "refunded_amount"
      FROM "payments" WHERE "id" = ${spec.paymentId}::uuid FOR UPDATE`;
    if (!payment) throw conflict('The payment to refund was not found.');
    const available = D(payment.amount_received).sub(payment.refunded_amount);
    if (amount.gt(available)) {
      throw conflict(
        available.lte(0)
          ? 'No money has been received on this payment (yet) or it was already refunded.'
          : `At most ₱${available.toFixed(2)} can still be refunded on this payment.`,
      );
    }
    const method =
      ONLINE.includes(payment.provider) && payment.provider_payment_id ? 'ORIGINAL' : 'MANUAL';
    const refund = await tx.refund.create({
      data: {
        reference: newReference('RF'),
        orderId: payment.order_id,
        sellerOrderId: spec.sellerOrderId,
        paymentId: payment.id,
        returnRequestId: spec.returnRequestId,
        reason: spec.reason,
        kind: spec.kind,
        status: method === 'ORIGINAL' ? 'PROCESSING' : 'AWAITING_PAYOUT',
        amount,
        itemsAmount: spec.itemsAmount,
        shippingAmount: spec.shippingAmount,
        chargesAmount: spec.chargesAmount,
        sellerDebit: spec.sellerDebit,
        commissionReversal: spec.commissionReversal,
        method,
        idempotencyKey: spec.idempotencyKey,
        note: spec.note,
        livemode: payment.livemode,
        requestedById: spec.requestedById,
      },
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: { refundedAmount: { increment: amount } },
    });
    await tx.paymentEvent.create({
      data: {
        paymentId: payment.id,
        type: 'REFUND_CREATED',
        actorId: spec.requestedById,
        data: { refund: refund.reference, amount: amount.toFixed(2), method },
      },
    });
    await tx.orderEvent.create({
      data: {
        orderId: payment.order_id,
        sellerOrderId: spec.sellerOrderId,
        type: 'REFUND_CREATED',
        actorType: spec.requestedById ? 'STAFF' : 'SYSTEM',
        actorId: spec.requestedById,
        note: `Refund ${refund.reference} of ₱${amount.toFixed(2)}`,
      },
    });
    return { id: refund.id, created: true };
  }

  /**
   * The refund owed when a paid seller order is cancelled: everything the customer paid for
   * it. The seller gives back what was credited for it, and gets its commission back.
   * Nothing when no money was received for the order (cash on delivery, unpaid).
   */
  async createForCancellationInTx(
    tx: Tx,
    sellerOrderId: string,
    actorId: string | null,
  ): Promise<string | null> {
    const so = await tx.sellerOrder.findUniqueOrThrow({
      where: { id: sellerOrderId },
      select: {
        orderId: true,
        itemsSubtotal: true,
        sellerDiscount: true,
        platformDiscount: true,
        shippingFee: true,
        sellerShippingDiscount: true,
        platformShippingDiscount: true,
        chargesTotal: true,
        refunds: { where: { status: { not: 'FAILED' } }, select: { amount: true } },
      },
    });
    const payment = await this.refundablePayment(tx, so.orderId);
    if (!payment) return null;
    const alreadyRefunded = so.refunds.reduce((s, r) => s.add(r.amount), ZERO);
    let items = so.itemsSubtotal.sub(so.sellerDiscount).sub(so.platformDiscount);
    let shipping = nonNeg(
      so.shippingFee.sub(so.sellerShippingDiscount).sub(so.platformShippingDiscount),
    );
    let charges = so.chargesTotal;
    // Earlier partial refunds on this seller order come off items first, then shipping, charges.
    let left = alreadyRefunded;
    for (const take of ['items', 'shipping', 'charges'] as const) {
      const value = take === 'items' ? items : take === 'shipping' ? shipping : charges;
      const cut = minD(value, left);
      left = left.sub(cut);
      if (take === 'items') items = value.sub(cut);
      else if (take === 'shipping') shipping = value.sub(cut);
      else charges = value.sub(cut);
    }
    if (items.add(shipping).add(charges).lte(0)) return null;
    const { debit, reversal } = await this.remainingSellerPosition(tx, sellerOrderId);
    const result = await this.createInTx(tx, {
      paymentId: payment.id,
      sellerOrderId,
      returnRequestId: null,
      reason: 'CANCELLATION',
      kind: 'FULL',
      itemsAmount: items,
      shippingAmount: shipping,
      chargesAmount: charges,
      sellerDebit: debit,
      commissionReversal: reversal,
      note: 'Seller order cancelled after payment.',
      idempotencyKey: `cancellation:${sellerOrderId}`,
      requestedById: actorId,
    });
    return result.id;
  }

  /**
   * The refund of an approved return: the returned quantities' share of each line's price
   * (plus shipping when staff decided so). The seller is charged its share of the items.
   */
  async createForReturnInTx(
    tx: Tx,
    returnRequestId: string,
    actorId: string | null,
  ): Promise<string> {
    const rr = await tx.returnRequest.findUniqueOrThrow({
      where: { id: returnRequestId },
      include: {
        items: { include: { orderItem: true } },
        sellerOrder: {
          select: {
            shippingFee: true,
            sellerShippingDiscount: true,
            platformShippingDiscount: true,
          },
        },
      },
    });
    const payment = await this.refundablePayment(tx, rr.orderId);
    if (!payment) {
      throw conflict(
        'No money has been received for this order yet (cash on delivery is refunded once the courier remits it).',
      );
    }
    let items = ZERO;
    let debit = ZERO;
    let reversal = ZERO;
    for (const ri of rr.items) {
      const i = ri.orderItem;
      const share = D(ri.quantity).div(i.quantity);
      items = items.add(cents(i.lineTotal.mul(share)));
      debit = debit.add(cents(i.lineSubtotal.sub(i.sellerDiscount).mul(share)));
      reversal = reversal.add(cents(i.commissionAmount.mul(share)));
    }
    const decided = rr.refundAmount ? D(rr.refundAmount) : items;
    let shipping = ZERO;
    let refundItems = items;
    if (decided.gt(items)) {
      const shippingNet = nonNeg(
        rr.sellerOrder.shippingFee
          .sub(rr.sellerOrder.sellerShippingDiscount)
          .sub(rr.sellerOrder.platformShippingDiscount),
      );
      shipping = minD(decided.sub(items), shippingNet);
    } else if (decided.lt(items)) {
      // A partial refund: the seller's charge shrinks in the same proportion.
      const ratio = items.isZero() ? ZERO : decided.div(items);
      debit = cents(debit.mul(ratio));
      reversal = cents(reversal.mul(ratio));
      refundItems = decided;
    }
    const result = await this.createInTx(tx, {
      paymentId: payment.id,
      sellerOrderId: rr.sellerOrderId,
      returnRequestId,
      reason: 'RETURN',
      kind: decided.gte(items) ? 'FULL' : 'PARTIAL',
      itemsAmount: refundItems,
      shippingAmount: shipping,
      chargesAmount: ZERO,
      sellerDebit: debit,
      commissionReversal: reversal,
      note: `Return ${rr.number}`,
      idempotencyKey: `return:${returnRequestId}`,
      requestedById: actorId,
    });
    return result.id;
  }

  /** Staff refunds: a seller order (full or partial), or a late/duplicate payment. */
  async createByStaff(
    staff: AuthenticatedUser,
    input: {
      sellerOrderId?: string;
      paymentId?: string;
      reason: Exclude<RefundSpec['reason'], 'RETURN'>;
      kind: 'FULL' | 'PARTIAL';
      amount?: string;
      note: string;
      idempotencyKey: string;
    },
    context: RequestContext,
  ): Promise<RefundDto> {
    const key = `staff:${staff.id}:${input.idempotencyKey}`;
    let refundId: string;
    try {
      refundId = await this.prisma.$transaction(async (tx) => {
        // Order lock first (as every order change does): the seller order's remaining amount
        // below is then read after any concurrent refund committed, and lock order is the same
        // as in payments and cancellations, so concurrent refunds cannot deadlock.
        const target = input.sellerOrderId
          ? await tx.sellerOrder.findUnique({
              where: { id: input.sellerOrderId },
              select: { orderId: true },
            })
          : await tx.payment.findUnique({
              where: { id: input.paymentId! },
              select: { orderId: true },
            });
        if (target) await lockOrderInTx(tx, target.orderId);
        const existing = await tx.refund.findUnique({ where: { idempotencyKey: key } });
        if (existing) return existing.id;
        const id = input.sellerOrderId
          ? await this.staffSellerOrderRefundInTx(
              tx,
              staff.id,
              { ...input, sellerOrderId: input.sellerOrderId },
              key,
            )
          : await this.staffPaymentRefundInTx(
              tx,
              staff.id,
              { ...input, paymentId: input.paymentId! },
              key,
            );
        await this.audit.record(
          {
            action: 'refunds.created',
            actorId: staff.id,
            entityType: 'refund',
            entityId: id,
            metadata: { reason: input.reason, kind: input.kind },
          },
          context,
          tx,
        );
        return id;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.refund.findUnique({ where: { idempotencyKey: key } });
        if (existing) return this.get(existing.id);
        throw conflict('A refund for this is already in progress.');
      }
      throw error;
    }
    await this.execute(refundId);
    return this.get(refundId);
  }

  private async staffSellerOrderRefundInTx(
    tx: Tx,
    staffId: string,
    input: {
      sellerOrderId: string;
      reason: RefundSpec['reason'];
      kind: 'FULL' | 'PARTIAL';
      amount?: string;
      note: string;
    },
    key: string,
  ): Promise<string> {
    const so = await tx.sellerOrder.findUnique({
      where: { id: input.sellerOrderId },
      include: { refunds: { where: { status: { not: 'FAILED' } }, select: { amount: true } } },
    });
    if (!so) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Seller order not found.');
    const payment = await this.refundablePayment(tx, so.orderId);
    if (!payment) throw conflict('No money has been received for this order (yet).');
    const shippingNet = nonNeg(
      so.shippingFee.sub(so.sellerShippingDiscount).sub(so.platformShippingDiscount),
    );
    const refunded = so.refunds.reduce((s, r) => s.add(r.amount), ZERO);
    const remaining = so.total.sub(refunded);
    const amount = input.kind === 'FULL' ? remaining : D(input.amount!);
    if (amount.lte(0)) throw conflict('This seller order has been fully refunded.');
    if (amount.gt(remaining)) {
      throw conflict(
        `At most ₱${remaining.toFixed(2)} of this seller order can still be refunded.`,
      );
    }
    const ratio = so.total.isZero() ? ZERO : amount.div(so.total);
    const shipping = minD(cents(shippingNet.mul(ratio)), amount);
    const charges = minD(cents(so.chargesTotal.mul(ratio)), amount.sub(shipping));
    const position = await this.remainingSellerPosition(tx, so.id);
    // Goodwill is the marketplace's cost; otherwise the seller bears its share.
    const sellerShare =
      input.reason === 'GOODWILL' ? ZERO : remaining.isZero() ? ZERO : amount.div(remaining);
    const result = await this.createInTx(tx, {
      paymentId: payment.id,
      sellerOrderId: so.id,
      returnRequestId: null,
      reason: input.reason,
      kind: input.kind,
      itemsAmount: amount.sub(shipping).sub(charges),
      shippingAmount: shipping,
      chargesAmount: charges,
      sellerDebit: minD(cents(position.debit.mul(sellerShare)), position.debit),
      commissionReversal: minD(cents(position.reversal.mul(sellerShare)), position.reversal),
      note: input.note,
      idempotencyKey: key,
      requestedById: staffId,
    });
    return result.id;
  }

  private async staffPaymentRefundInTx(
    tx: Tx,
    staffId: string,
    input: {
      paymentId: string;
      reason: RefundSpec['reason'];
      kind: 'FULL' | 'PARTIAL';
      amount?: string;
      note: string;
    },
    key: string,
  ): Promise<string> {
    const payment = await tx.payment.findUnique({ where: { id: input.paymentId } });
    if (!payment) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Payment not found.');
    const available = payment.amountReceived.sub(payment.refundedAmount);
    const amount = input.kind === 'FULL' ? available : D(input.amount!);
    const result = await this.createInTx(tx, {
      paymentId: payment.id,
      sellerOrderId: null,
      returnRequestId: null,
      reason: input.reason,
      kind: input.kind,
      itemsAmount: amount,
      shippingAmount: ZERO,
      chargesAmount: ZERO,
      sellerDebit: ZERO,
      commissionReversal: ZERO,
      note: input.note,
      idempotencyKey: key,
      requestedById: staffId,
    });
    return result.id;
  }

  /**
   * The order's payment that money can be refunded from: the one that paid it (online, bank
   * transfer), or the cash on delivery payment once remittances have been confirmed (it stays
   * PENDING while some seller orders are still to be remitted). Late and duplicate payments
   * (CANCELLED) are refunded by staff directly.
   */
  private async refundablePayment(tx: Tx, orderId: string) {
    return tx.payment.findFirst({
      where: { orderId, amountReceived: { gt: 0 }, status: { in: ['PAID', 'PENDING'] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
  }

  /** What the seller still holds for a seller order in the ledger (credits less earlier refunds). */
  private async remainingSellerPosition(tx: Tx, sellerOrderId: string) {
    const { credited, commission } = await sellerOrderPosition(tx, sellerOrderId);
    // Pending refunds count too, so two refunds never charge the seller twice.
    const pending = await tx.refund.aggregate({
      where: { sellerOrderId, status: { in: ['PROCESSING', 'AWAITING_PAYOUT'] } },
      _sum: { sellerDebit: true, commissionReversal: true },
    });
    return {
      debit: nonNeg(credited.sub(pending._sum.sellerDebit ?? ZERO)),
      reversal: nonNeg(commission.sub(pending._sum.commissionReversal ?? ZERO)),
    };
  }

  // ---- Executing -----------------------------------------------------------------------------

  /**
   * Sends an online refund to the provider (after its creation committed). The provider gets
   * the refund id as idempotency key, so calling this again never refunds twice.
   */
  async execute(refundId: string): Promise<void> {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: { payment: true },
    });
    if (!refund || refund.method !== 'ORIGINAL' || refund.status !== 'PROCESSING') return;
    if (refund.providerRefundId) return; // waiting for the provider's webhook
    let result;
    try {
      result = await this.gateways.forProvider(refund.payment.provider).refund({
        providerPaymentId: refund.payment.providerPaymentId!,
        amount: refund.amount.toFixed(2),
        reason: GATEWAY_REASON[refund.reason] ?? 'others',
        idempotencyKey: refund.id,
        notes: `${refund.reference}${refund.note ? `: ${refund.note}` : ''}`.slice(0, 250),
      });
    } catch (error) {
      // Left PROCESSING without a provider id: reconciliation lists it; staff can retry.
      this.logger.warn(
        `Refund ${refund.reference}: provider call failed (${(error as Error).message})`,
      );
      await this.prisma.refund.update({
        where: { id: refundId },
        data: { failureMessage: (error as Error).message.slice(0, 500) },
      });
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.refund.updateMany({
        where: { id: refundId, providerRefundId: null },
        data: { providerRefundId: result.providerRefundId, failureMessage: null },
      });
      if (result.state === 'SUCCEEDED') await this.markSucceededInTx(tx, refundId, null);
      if (result.state === 'FAILED') {
        await this.markFailedInTx(
          tx,
          refundId,
          result.failureMessage ?? 'The provider refused the refund.',
        );
      }
    });
    await this.notifyOutcome(refundId);
  }

  /** A provider's refund webhook (inside the webhook transaction). */
  async applyProviderUpdateInTx(
    tx: Tx,
    provider: string,
    outcome: Extract<WebhookOutcome, { kind: 'refund.updated' }>,
  ): Promise<string | null> {
    const refund = await tx.refund.findFirst({
      where: {
        providerRefundId: outcome.providerRefundId,
        payment: { provider: provider as 'MOCK' },
      },
      select: { id: true },
    });
    // The provider can report before our call has stored its id: fail so it is retried.
    if (!refund) throw new Error('No refund matches this event yet.');
    if (outcome.state === 'SUCCEEDED') await this.markSucceededInTx(tx, refund.id, null);
    else if (outcome.state === 'FAILED') {
      await this.markFailedInTx(
        tx,
        refund.id,
        outcome.failureMessage ?? 'The provider could not complete the refund.',
      );
    }
    return null;
  }

  /** Idempotent: a refund succeeds (and charges the seller) once. */
  async markSucceededInTx(
    tx: Tx,
    refundId: string,
    processedById: string | null,
    payoutReference?: string,
  ) {
    const owner = await tx.refund.findUnique({
      where: { id: refundId },
      select: { orderId: true },
    });
    if (owner) await lockOrderInTx(tx, owner.orderId);
    const [refund] = await tx.$queryRaw<{ status: string }[]>`
      SELECT "status"::text FROM "refunds" WHERE "id" = ${refundId}::uuid FOR UPDATE`;
    if (!refund || refund.status === 'SUCCEEDED' || refund.status === 'FAILED') return;
    const now = new Date();
    const row = await tx.refund.update({
      where: { id: refundId },
      data: {
        status: 'SUCCEEDED',
        succeededAt: now,
        failureMessage: null,
        ...(processedById ? { processedById } : {}),
        ...(payoutReference ? { payoutReference } : {}),
      },
      include: { sellerOrder: { select: { sellerId: true, number: true } } },
    });
    // Seller share, commission given back and the money out, in the double-entry ledger.
    await postRefundInTx(tx, refundId, now);
    // Loyalty points and affiliate commission follow the refund; REFUND_APPROVED notification.
    await onRefundSucceededInTx(tx, refundId, now);
    await tx.paymentEvent.create({
      data: {
        paymentId: row.paymentId,
        type: 'REFUND_SUCCEEDED',
        actorId: processedById,
        data: { refund: row.reference, amount: row.amount.toFixed(2) },
      },
    });
    await tx.orderEvent.create({
      data: {
        orderId: row.orderId,
        sellerOrderId: row.sellerOrderId,
        type: 'REFUND_SUCCEEDED',
        actorType: processedById ? 'STAFF' : 'PROVIDER',
        actorId: processedById,
        note: `Refund ${row.reference} of ₱${row.amount.toFixed(2)} completed`,
      },
    });
    await syncOrderPaymentStatusInTx(tx, row.orderId);
  }

  /** The reserved amount is released, so a corrected refund can be made. */
  async markFailedInTx(tx: Tx, refundId: string, message: string) {
    const owner = await tx.refund.findUnique({
      where: { id: refundId },
      select: { orderId: true },
    });
    if (owner) await lockOrderInTx(tx, owner.orderId);
    const [refund] = await tx.$queryRaw<{ status: string }[]>`
      SELECT "status"::text FROM "refunds" WHERE "id" = ${refundId}::uuid FOR UPDATE`;
    if (!refund || refund.status === 'SUCCEEDED' || refund.status === 'FAILED') return;
    const row = await tx.refund.update({
      where: { id: refundId },
      data: { status: 'FAILED', failureMessage: message.slice(0, 500) },
    });
    await tx.payment.update({
      where: { id: row.paymentId },
      data: { refundedAmount: { decrement: row.amount } },
    });
    await tx.paymentEvent.create({
      data: {
        paymentId: row.paymentId,
        type: 'REFUND_FAILED',
        data: { refund: row.reference, message: message.slice(0, 200) },
      },
    });
    await tx.orderEvent.create({
      data: {
        orderId: row.orderId,
        sellerOrderId: row.sellerOrderId,
        type: 'REFUND_FAILED',
        actorType: 'PROVIDER',
        note: `Refund ${row.reference} failed: ${message.slice(0, 200)}`,
      },
    });
  }

  private async notifyOutcome(refundId: string) {
    const r = await this.prisma.refund.findUnique({ where: { id: refundId } });
    if (r?.status !== 'SUCCEEDED') return;
    // The REFUND_APPROVED notification event was written with the refund.
    await this.notifier.kick();
  }

  /** Finance paid a manual refund out (bank transfer to the customer, e-wallet...). */
  async markPaid(
    staff: AuthenticatedUser,
    refundId: string,
    payoutReference: string,
    context: RequestContext,
  ): Promise<RefundDto> {
    await this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({ where: { id: refundId } });
      if (!refund) throw notFound();
      if (refund.status !== 'AWAITING_PAYOUT')
        throw conflict('This refund is not waiting for a payout.');
      await this.markSucceededInTx(tx, refundId, staff.id, payoutReference);
      await this.audit.record(
        {
          action: 'refunds.paid_out',
          actorId: staff.id,
          entityType: 'refund',
          entityId: refundId,
          metadata: { payoutReference },
        },
        context,
        tx,
      );
    });
    await this.notifyOutcome(refundId);
    return this.get(refundId);
  }

  /** A failed refund is tried again as a new refund (the failed one stays in the history). */
  async retry(
    staff: AuthenticatedUser,
    refundId: string,
    context: RequestContext,
  ): Promise<RefundDto> {
    const newId = await this.prisma.$transaction(async (tx) => {
      const old = await tx.refund.findUnique({ where: { id: refundId } });
      if (!old) throw notFound();
      if (old.status !== 'FAILED') throw conflict('Only failed refunds can be retried.');
      const result = await this.createInTx(tx, {
        paymentId: old.paymentId,
        sellerOrderId: old.sellerOrderId,
        returnRequestId: old.returnRequestId,
        reason: old.reason,
        kind: old.kind as 'FULL',
        itemsAmount: old.itemsAmount,
        shippingAmount: old.shippingAmount,
        chargesAmount: old.chargesAmount,
        sellerDebit: old.sellerDebit,
        commissionReversal: old.commissionReversal,
        note: old.note,
        idempotencyKey: `retry:${old.id}`,
        requestedById: staff.id,
      });
      await this.audit.record(
        {
          action: 'refunds.retried',
          actorId: staff.id,
          entityType: 'refund',
          entityId: result.id,
          metadata: { retryOf: old.reference },
        },
        context,
        tx,
      );
      return result.id;
    });
    await this.execute(newId);
    return this.get(newId);
  }

  /** A PROCESSING refund whose provider call never went through is sent again. */
  async resend(
    staff: AuthenticatedUser,
    refundId: string,
    context: RequestContext,
  ): Promise<RefundDto> {
    const refund = await this.prisma.refund.findUnique({ where: { id: refundId } });
    if (!refund) throw notFound();
    if (refund.status !== 'PROCESSING' || refund.method !== 'ORIGINAL' || refund.providerRefundId) {
      throw conflict('This refund is not waiting to be sent to the provider.');
    }
    await this.audit.record(
      { action: 'refunds.resent', actorId: staff.id, entityType: 'refund', entityId: refundId },
      context,
    );
    await this.execute(refundId);
    return this.get(refundId);
  }

  // ---- Views ---------------------------------------------------------------------------------

  async get(id: string): Promise<RefundDto> {
    const row = await this.prisma.refund.findUnique({ where: { id }, include: refundInclude });
    if (!row) throw notFound();
    return refundDto(row);
  }

  async list(query: {
    page: number;
    pageSize: number;
    status?: RefundDto['status'];
    reason?: RefundDto['reason'];
    search?: string;
  }): Promise<PaginatedResponse<RefundDto>> {
    const where: Prisma.RefundWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.reason ? { reason: query.reason } : {}),
      ...(query.search
        ? {
            OR: [
              { reference: { contains: query.search.toUpperCase() } },
              { order: { orderNumber: { contains: query.search.toUpperCase() } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.refund.findMany({
        where,
        include: refundInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.refund.count({ where }),
    ]);
    return {
      items: rows.map(refundDto),
      page: query.page,
      pageSize: query.pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /**
   * A seller's payable lines in the double-entry ledger (pending, available, reserved, in
   * payout), newest first, with the total owed to the seller.
   */
  async ledger(
    user: AuthenticatedUser | null,
    query: { page: number; pageSize: number; sellerId?: string },
  ): Promise<SellerLedger> {
    const sellerId = user ? sellerScope(user).sellerId : query.sellerId;
    if (!sellerId)
      throw new ApiException(HttpStatus.BAD_REQUEST, 'BAD_REQUEST', 'Choose a seller.');
    const where: Prisma.JournalEntryWhereInput = {
      sellerId,
      account: { sellerSubledger: true },
      transaction: { status: 'POSTED' },
    };
    const [rows, total, sum] = await this.prisma.$transaction([
      this.prisma.journalEntry.findMany({
        where,
        include: {
          transaction: { select: { description: true, sourceType: true, sourceId: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { lineNo: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.journalEntry.count({ where }),
      this.prisma.journalEntry.aggregate({ where, _sum: { debit: true, credit: true } }),
    ]);
    return {
      items: rows.map((e) => ({
        id: e.id,
        type: e.kind ?? 'ADJUSTMENT',
        amount: e.credit.sub(e.debit).toFixed(2),
        description: e.description ?? e.transaction.description,
        sellerOrderId: e.sellerOrderId,
        refundId: e.transaction.sourceType === 'REFUND' ? e.transaction.sourceId : null,
        createdAt: e.createdAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / query.pageSize),
      balance: (sum._sum.credit ?? ZERO).sub(sum._sum.debit ?? ZERO).toFixed(2),
    };
  }
}
