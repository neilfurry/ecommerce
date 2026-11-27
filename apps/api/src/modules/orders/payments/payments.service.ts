import { webhookRejections } from '../../../infrastructure/observability/metrics';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  applyPaymentFailedInTx,
  applyPaymentSucceededInTx,
  lockOrderInTx,
  type PaymentConfirmationSource,
  type PaymentSucceededResult,
  Prisma,
} from '@marketplace/database';
import {
  GatewayError,
  type PaymentGateway,
  type WebhookHeaders,
  type WebhookOutcome,
  WebhookSignatureError,
} from '@marketplace/payments';
import {
  type AuthenticatedUser,
  type PaginatedResponse,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from '@marketplace/shared-types';
import type {
  AdminPayment,
  AdminPaymentDetail,
  AdminProof,
  BankProofInput,
  StartPaymentResponse,
  WebhookEventDto,
} from '@marketplace/validation';
import { FilePurpose } from '@marketplace/database';
import type { RequestContext } from '../../../common/auth/auth.decorators';
import { ApiException } from '../../../common/errors/api.exception';
import { AppConfig } from '../../../config/app-config';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { FilesService } from '../../files/files.service';
import { PlatformSettingsService } from '../../settings/platform-settings.service';
import { attemptDto, paymentInclude, proofDto, refundDto, refundInclude } from '../order-mapping';
import { OrderNotifier } from '../order-notifier.service';
import { newReference } from '../references';
import { RefundsService } from '../refunds/refunds.service';
import { PaymentGatewaysService, WEBHOOK_SOURCES } from './payment-gateways.service';

type Tx = Prisma.TransactionClient;
type WebhookProvider = 'MOCK' | 'PAYMONGO';

const notFound = (what = 'Order') =>
  new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found.`);
const conflict = (message: string) => new ApiException(HttpStatus.CONFLICT, 'CONFLICT', message);
const m = (d: Prisma.Decimal) => d.toFixed(2);
const iso = (d: Date | null) => d?.toISOString() ?? null;
/** Stock holds of unpaid orders outlast the deadline a little (see CheckoutService). */
const HOLD_GRACE_MS = 5 * 60_000;

/** Why an outcome was or was not acted on; stored on the webhook event. */
interface Applied {
  status: 'PROCESSED' | 'IGNORED';
  note: string | null;
  after: () => Promise<void>;
}

/**
 * Payments: the attempt created with each order, hosted checkouts, verification, webhooks,
 * bank transfer proofs and the finance views.
 *
 * Money is recorded only from a signed webhook, a server-side status lookup or a finance
 * decision; the browser coming back from the checkout page proves nothing on its own.
 * Every confirmation goes through applyPaymentSucceededInTx, which locks the payment and the
 * order, so retries and races can never pay an order twice.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateways: PaymentGatewaysService,
    private readonly settings: PlatformSettingsService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly notifier: OrderNotifier,
    private readonly refunds: RefundsService,
    private readonly config: AppConfig,
  ) {}

  // ---- Checkout ------------------------------------------------------------------------------

  /**
   * The payment record created with the order, inside the order transaction:
   * cash on delivery (one expected collection per seller order), a bank transfer waiting for
   * the customer's transfer, or an online attempt whose hosted checkout is opened right after
   * the order commits (`openCheckout`).
   */
  async createForOrderInTx(
    tx: Tx,
    order: {
      id: string;
      paymentMethod: PaymentMethod;
      grandTotal: Prisma.Decimal;
      paymentDueAt: Date | null;
    },
    sellerOrders: { id: string; total: Prisma.Decimal }[],
  ): Promise<{ paymentId: string; online: boolean }> {
    const base = {
      orderId: order.id,
      reference: newReference('PAY'),
      method: order.paymentMethod,
      amount: order.grandTotal,
    };
    if (order.paymentMethod === 'COD') {
      const payment = await tx.payment.create({
        data: {
          ...base,
          provider: 'COD',
          status: 'PENDING',
          livemode: this.config.isProduction,
          events: { create: { type: 'CREATED', toStatus: 'PENDING', data: { method: 'COD' } } },
        },
      });
      await tx.codCollection.createMany({
        data: sellerOrders.map((so) => ({
          sellerOrderId: so.id,
          orderId: order.id,
          expectedAmount: so.total,
        })),
      });
      return { paymentId: payment.id, online: false };
    }
    if (order.paymentMethod === 'BANK_TRANSFER') {
      const payment = await tx.payment.create({
        data: {
          ...base,
          provider: 'MANUAL_BANK',
          status: 'PENDING',
          livemode: this.config.isProduction,
          expiresAt: order.paymentDueAt,
          events: {
            create: { type: 'CREATED', toStatus: 'PENDING', data: { method: 'BANK_TRANSFER' } },
          },
        },
      });
      return { paymentId: payment.id, online: false };
    }
    const gateway = this.activeGatewayFor(order.paymentMethod);
    const payment = await tx.payment.create({
      data: {
        ...base,
        provider: gateway.code,
        status: 'CREATED',
        livemode: gateway.livemode,
        expiresAt: order.paymentDueAt,
        events: {
          create: { type: 'CREATED', toStatus: 'CREATED', data: { provider: gateway.code } },
        },
      },
    });
    return { paymentId: payment.id, online: true };
  }

  /**
   * Opens the provider's hosted checkout for a CREATED attempt. Called after the order
   * commits (a provider outage must not lose the order); on failure the attempt stays
   * CREATED and the customer can press "Pay now" again.
   */
  async openCheckout(paymentId: string): Promise<{ checkoutUrl: string } | null> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        order: {
          select: {
            orderNumber: true,
            id: true,
            contactEmail: true,
            shippingAddress: true,
            customer: { select: { firstName: true, lastName: true, email: true, mobile: true } },
          },
        },
      },
    });
    if (!payment || payment.status !== 'CREATED' || !payment.expiresAt) return null;
    const gateway = this.gateways.forProvider(payment.provider);
    const link = `${this.config.appUrls.storefront}/account/orders/${payment.orderId}`;
    let created;
    try {
      created = await gateway.createCheckout({
        paymentReference: payment.reference,
        orderNumber: payment.order.orderNumber,
        method: payment.method,
        amount: m(payment.amount),
        currency: 'PHP',
        description: `Order ${payment.order.orderNumber}`,
        customer: {
          name: `${payment.order.customer.firstName} ${payment.order.customer.lastName}`,
          email: payment.order.customer.email,
          phone: payment.order.customer.mobile ?? null,
        },
        // The page the customer returns to only asks the API to verify; it never marks paid.
        successUrl: `${link}?payment=${payment.reference}`,
        cancelUrl: `${link}?payment=${payment.reference}&cancelled=1`,
        expiresAt: payment.expiresAt,
      });
    } catch (error) {
      const message =
        error instanceof GatewayError
          ? error.message
          : 'The payment provider could not be reached.';
      this.logger.warn(`Payment ${payment.reference}: checkout not opened (${message})`);
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { failureCode: 'CHECKOUT_NOT_OPENED', failureMessage: message.slice(0, 500) },
      });
      return null;
    }
    // Conditional: a concurrent "Pay now" may have opened one already; keep the first.
    const updated = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: 'CREATED' },
      data: {
        status: 'PENDING',
        providerReference: created.providerReference,
        checkoutUrl: created.checkoutUrl,
        failureCode: null,
        failureMessage: null,
      },
    });
    if (updated.count === 0) {
      await gateway.expire(created.providerReference).catch(() => undefined);
      const current = await this.prisma.payment.findUnique({ where: { id: payment.id } });
      return current?.checkoutUrl ? { checkoutUrl: current.checkoutUrl } : null;
    }
    await this.prisma.paymentEvent.create({
      data: {
        paymentId: payment.id,
        type: 'CHECKOUT_OPENED',
        fromStatus: 'CREATED',
        toStatus: 'PENDING',
        data: { providerReference: created.providerReference },
      },
    });
    return { checkoutUrl: created.checkoutUrl };
  }

  /**
   * "Pay now": returns the open hosted checkout, or opens a new attempt when the previous
   * one failed or never opened. Refused once the order is paid, cancelled or past its deadline.
   */
  async startOnline(user: AuthenticatedUser, orderId: string): Promise<StartPaymentResponse> {
    const now = new Date();
    const paymentId = await this.prisma.$transaction(async (tx) => {
      const [order] = await tx.$queryRaw<
        {
          status: string;
          payment_method: PaymentMethod;
          payment_due_at: Date | null;
          grand_total: Prisma.Decimal;
        }[]
      >`SELECT "status"::text, "payment_method", "payment_due_at", "grand_total" FROM "orders"
        WHERE "id" = ${orderId}::uuid AND "customer_id" = ${user.id}::uuid FOR UPDATE`;
      if (!order) throw notFound();
      if (order.payment_method === 'COD' || order.payment_method === 'BANK_TRANSFER') {
        throw conflict(
          `${PAYMENT_METHOD_LABELS[order.payment_method]} orders are not paid online.`,
        );
      }
      if (order.status !== 'AWAITING_PAYMENT') {
        throw conflict('This order is not waiting for payment.');
      }
      if (order.payment_due_at && order.payment_due_at <= now) {
        throw conflict('The time to pay for this order has passed.');
      }
      const attempts = await tx.payment.findMany({
        where: { orderId, status: { in: ['CREATED', 'PENDING', 'PAID'] } },
        orderBy: { createdAt: 'desc' },
      });
      if (attempts.some((a) => a.status === 'PAID')) throw conflict('This order is already paid.');
      const open = attempts.find(
        (a) => a.status === 'PENDING' && a.checkoutUrl && (!a.expiresAt || a.expiresAt > now),
      );
      if (open) return open.id;
      const created = attempts.find((a) => a.status === 'CREATED');
      if (created) return created.id;
      const gateway = this.activeGatewayFor(order.payment_method);
      const payment = await tx.payment.create({
        data: {
          orderId,
          reference: newReference('PAY'),
          method: order.payment_method,
          amount: order.grand_total,
          provider: gateway.code,
          status: 'CREATED',
          livemode: gateway.livemode,
          expiresAt: order.payment_due_at,
          events: {
            create: {
              type: 'CREATED',
              toStatus: 'CREATED',
              actorId: user.id,
              data: { provider: gateway.code, retry: true },
            },
          },
        },
      });
      return payment.id;
    });
    const current = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (current.status === 'CREATED') await this.openCheckout(paymentId);
    const row = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: paymentInclude,
    });
    if (row.status !== 'PENDING' || !row.checkoutUrl) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'PROVIDER_ERROR',
        'The payment page could not be opened. Please try again in a few minutes.',
      );
    }
    return { payment: attemptDto(row, now), checkoutUrl: row.checkoutUrl };
  }

  /**
   * Asks the provider for the state of the order's open online attempts and records what it
   * says. Used when the customer returns from the checkout page (the redirect itself proves
   * nothing) and by staff. Returns whether anything changed.
   */
  async verify(
    orderId: string,
    actor: { customerId?: string; staffId?: string },
  ): Promise<boolean> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, ...(actor.customerId ? { customerId: actor.customerId } : {}) },
      select: { id: true },
    });
    if (!order) throw notFound();
    const open = await this.prisma.payment.findMany({
      where: {
        orderId,
        status: 'PENDING',
        providerReference: { not: null },
        provider: { in: ['MOCK', 'PAYMONGO', 'MAYA_BUSINESS', 'XENDIT'] },
      },
    });
    let changed = false;
    for (const payment of open) {
      changed =
        (await this.checkWithProvider(payment.id, 'VERIFICATION', actor.staffId ?? null)) ||
        changed;
    }
    return changed;
  }

  /** One status lookup for one attempt (verification and reconciliation). */
  async checkWithProvider(
    paymentId: string,
    source: Extract<PaymentConfirmationSource, 'VERIFICATION' | 'RECONCILIATION'>,
    actorId: string | null,
  ): Promise<boolean> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment?.providerReference || payment.status !== 'PENDING') return false;
    let state;
    try {
      state = await this.gateways.forProvider(payment.provider).retrieve(payment.providerReference);
    } catch (error) {
      this.logger.warn(
        `Payment ${payment.reference}: status lookup failed (${(error as Error).message})`,
      );
      return false;
    }
    if (state.state === 'PAID' && state.amountPaid) {
      const result = await this.prisma.$transaction((tx) =>
        applyPaymentSucceededInTx(tx, {
          paymentId,
          providerPaymentId: state.providerPaymentId,
          amount: state.amountPaid!,
          source,
          actorId,
        }),
      );
      await this.afterSucceeded(result);
      return result.result !== 'ALREADY_PAID';
    }
    if (state.state === 'FAILED' || state.state === 'EXPIRED') {
      const result = await this.prisma.$transaction((tx) =>
        applyPaymentFailedInTx(tx, {
          paymentId,
          final: true,
          failureCode: state.state === 'EXPIRED' ? 'EXPIRED' : state.failureCode,
          failureMessage:
            state.state === 'EXPIRED'
              ? 'The payment page expired.'
              : (state.failureMessage ?? 'The payment did not go through.'),
        }),
      );
      return result.closed;
    }
    return false;
  }

  // ---- Webhooks ------------------------------------------------------------------------------

  /**
   * A provider's webhook. Order of work, so retries are always safe:
   *  1. verify the signature over the raw body (401 and nothing stored when it fails);
   *  2. store the event once per (source, event id) — a redelivered event finds its row;
   *  3. process it in one transaction holding the event row lock, then mark it PROCESSED.
   * A processing error marks the event FAILED and answers 500 so the provider retries;
   * staff can also reprocess it.
   */
  async handleWebhook(
    provider: WebhookProvider,
    headers: WebhookHeaders,
    rawBody: Buffer | undefined,
  ): Promise<{ received: true; duplicate: boolean }> {
    if (!rawBody || rawBody.length === 0) {
      throw new ApiException(HttpStatus.BAD_REQUEST, 'BAD_REQUEST', 'Empty webhook body.');
    }
    let gateway: PaymentGateway;
    try {
      gateway = this.gateways.forProvider(provider);
    } catch {
      throw notFound('Webhook endpoint');
    }
    let parsed;
    try {
      parsed = gateway.parseWebhook(headers, rawBody);
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        this.logger.warn(`${provider} webhook refused: ${error.message}`);
        webhookRejections.inc({ provider });
        throw new ApiException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Invalid signature.');
      }
      throw error;
    }
    const source = provider === 'MOCK' ? WEBHOOK_SOURCES.MOCK : WEBHOOK_SOURCES.PAYMONGO;
    let eventRowId: string;
    try {
      const row = await this.prisma.webhookEvent.create({
        data: {
          source,
          eventId: parsed.eventId.slice(0, 160),
          eventType: parsed.eventType.slice(0, 80),
          livemode: parsed.livemode,
          payload: parsed.payload as Prisma.InputJsonValue,
        },
      });
      eventRowId = row.id;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const existing = await this.prisma.webhookEvent.findUniqueOrThrow({
        where: { source_eventId: { source, eventId: parsed.eventId.slice(0, 160) } },
      });
      if (existing.status === 'PROCESSED' || existing.status === 'IGNORED') {
        return { received: true, duplicate: true };
      }
      eventRowId = existing.id; // an earlier delivery failed or is still running: (re)process
    }
    const duplicate = await this.processEvent(eventRowId, provider, parsed.outcome);
    return { received: true, duplicate };
  }

  /** Staff: process a failed (or stuck) event again from its stored, verified payload. */
  async reprocessWebhookEvent(
    staff: AuthenticatedUser,
    id: string,
    context: RequestContext,
  ): Promise<WebhookEventDto> {
    const row = await this.prisma.webhookEvent.findUnique({ where: { id } });
    if (!row) throw notFound('Webhook event');
    if (row.status === 'PROCESSED' || row.status === 'IGNORED') {
      throw conflict('This event was already processed.');
    }
    const provider: WebhookProvider | null =
      row.source === WEBHOOK_SOURCES.MOCK
        ? 'MOCK'
        : row.source === WEBHOOK_SOURCES.PAYMONGO
          ? 'PAYMONGO'
          : null;
    if (!provider) throw conflict('Events from this source cannot be reprocessed here.');
    await this.audit.record(
      {
        action: 'payments.webhook_reprocessed',
        actorId: staff.id,
        entityType: 'webhook_event',
        entityId: id,
      },
      context,
    );
    await this.processEvent(id, provider, this.gateways.outcomeOf(row.source, row.payload)).catch(
      () => undefined, // recorded as FAILED with the error; returned below
    );
    return this.webhookEventDto(
      await this.prisma.webhookEvent.findUniqueOrThrow({ where: { id } }),
    );
  }

  /** Returns true when another delivery had already processed the event. */
  private async processEvent(
    eventRowId: string,
    provider: WebhookProvider,
    outcome: WebhookOutcome,
  ): Promise<boolean> {
    let applied: Applied | 'DUPLICATE';
    try {
      applied = await this.prisma.$transaction(
        async (tx) => {
          const [row] = await tx.$queryRaw<{ status: string }[]>`
            SELECT "status"::text FROM "webhook_events" WHERE "id" = ${eventRowId}::uuid FOR UPDATE`;
          if (!row || row.status === 'PROCESSED' || row.status === 'IGNORED') return 'DUPLICATE';
          const result = await this.applyOutcomeInTx(tx, provider, outcome, eventRowId);
          await tx.webhookEvent.update({
            where: { id: eventRowId },
            data: {
              status: result.status,
              error: result.note,
              attempts: { increment: 1 },
              processedAt: new Date(),
            },
          });
          return result;
        },
        { timeout: 20_000 },
      );
    } catch (error) {
      const message = (error as Error).message.slice(0, 1000);
      this.logger.error(`Webhook event ${eventRowId} failed: ${message}`);
      await this.prisma.webhookEvent
        .update({
          where: { id: eventRowId },
          data: { status: 'FAILED', error: message, attempts: { increment: 1 } },
        })
        .catch(() => undefined);
      throw new ApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_ERROR',
        'The event could not be processed; it will be retried.',
      );
    }
    if (applied === 'DUPLICATE') return true;
    await applied.after();
    return false;
  }

  private async applyOutcomeInTx(
    tx: Tx,
    provider: WebhookProvider,
    outcome: WebhookOutcome,
    webhookEventId: string,
  ): Promise<Applied> {
    const nothing = async () => undefined;
    if (outcome.kind === 'ignored') return { status: 'IGNORED', note: null, after: nothing };
    if (outcome.kind === 'refund.updated') {
      const note = await this.refunds.applyProviderUpdateInTx(tx, provider, outcome);
      return { status: note ? 'IGNORED' : 'PROCESSED', note, after: nothing };
    }
    // Only payments made through this provider can be settled by its events.
    const payment = await tx.payment.findFirst({
      where: {
        provider,
        OR: [
          ...(outcome.providerReference ? [{ providerReference: outcome.providerReference }] : []),
          ...(outcome.paymentReference ? [{ reference: outcome.paymentReference }] : []),
        ],
      },
      select: { id: true, reference: true },
    });
    if (!payment || (!outcome.providerReference && !outcome.paymentReference)) {
      return { status: 'IGNORED', note: 'No payment matches this event.', after: nothing };
    }
    if (outcome.kind === 'payment.paid') {
      const result = await applyPaymentSucceededInTx(tx, {
        paymentId: payment.id,
        providerPaymentId: outcome.providerPaymentId,
        amount: outcome.amount,
        source: 'WEBHOOK',
        webhookEventId,
      });
      return {
        status: 'PROCESSED',
        note: result.result === 'NEEDS_REVIEW' ? `Needs review: ${result.reason}` : null,
        after: () => this.afterSucceeded(result),
      };
    }
    const failed = await applyPaymentFailedInTx(tx, {
      paymentId: payment.id,
      final: outcome.final,
      failureCode: outcome.failureCode,
      failureMessage: outcome.failureMessage,
      webhookEventId,
    });
    return {
      status: 'PROCESSED',
      note: null,
      after: async () => {
        if (failed.closed) {
          await this.notifier.customer(
            failed.orderId,
            'Payment not completed',
            'Your payment did not go through. You can try again from your order page before the payment deadline.',
          );
        }
      },
    };
  }

  /** After a confirmation commits: close other open checkouts and tell the people involved. */
  private async afterSucceeded(result: PaymentSucceededResult): Promise<void> {
    if (result.result === 'NEEDS_REVIEW') {
      this.logger.warn(`Payment ${result.paymentId} needs finance review (${result.reason}).`);
      return;
    }
    if (result.result !== 'PAID') return;
    for (const other of result.otherOpenAttempts) {
      try {
        await this.gateways.forProvider(other.provider).expire(other.providerReference);
      } catch {
        // Best effort: if it is paid anyway it arrives as DUPLICATE_PAYMENT for review.
      }
    }
    // The customer's "payment received" message is the PAYMENT_CONFIRMED notification event
    // (written with the payment, delivered by the worker).
    await this.notifier.kick();
    await this.notifier.sellersOf(
      result.orderId,
      'Order paid: ready to process',
      'The customer has paid. Please accept and prepare the order.',
    );
  }

  /** Closes provider checkouts of attempts that a cancellation or expiry closed (best effort). */
  async expireAtProviders(closed: { provider: string; providerReference: string | null }[]) {
    for (const p of closed) {
      if (!p.providerReference || p.provider === 'COD' || p.provider === 'MANUAL_BANK') continue;
      try {
        await this.gateways.forProvider(p.provider).expire(p.providerReference);
      } catch (error) {
        this.logger.warn(`Could not expire ${p.provider} checkout (${(error as Error).message})`);
      }
    }
  }

  // ---- Mock checkout (development and tests only) ----------------------------------------

  private mockFor(user: AuthenticatedUser, sessionId: string) {
    const mock = this.gateways.mock;
    if (!mock) throw notFound('Test checkout');
    return this.prisma.mockPaymentSession
      .findUnique({ where: { id: sessionId } })
      .then(async (session) => {
        if (!session) throw notFound('Test checkout');
        const payment = await this.prisma.payment.findFirst({
          where: { reference: session.paymentReference, provider: 'MOCK' },
          include: { order: { select: { id: true, orderNumber: true, customerId: true } } },
        });
        // Only the customer who owns the order may open or complete its test checkout.
        if (!payment || payment.order.customerId !== user.id) throw notFound('Test checkout');
        return { mock, session, payment };
      });
  }

  async mockSession(user: AuthenticatedUser, sessionId: string) {
    const { session, payment } = await this.mockFor(user, sessionId);
    return {
      id: session.id,
      status: session.status as 'OPEN' | 'PAID' | 'FAILED' | 'EXPIRED',
      amount: m(session.amount),
      paymentReference: session.paymentReference,
      method: payment.method,
      orderId: payment.order.id,
      orderNumber: payment.order.orderNumber,
      test: true as const,
    };
  }

  /**
   * The customer's choice on the test checkout page. The mock signs a webhook exactly as a
   * provider would and it goes through the normal webhook path (signature, idempotency).
   */
  async completeMock(user: AuthenticatedUser, sessionId: string, outcome: 'paid' | 'failed') {
    const { mock } = await this.mockFor(user, sessionId);
    let signed;
    try {
      signed = await mock.simulate(sessionId, outcome);
    } catch (error) {
      if (error instanceof GatewayError) throw conflict(error.message);
      throw error;
    }
    await this.handleWebhook('MOCK', signed.headers, signed.rawBody);
    return this.mockSession(user, sessionId);
  }

  // ---- Bank transfers ----------------------------------------------------------------------

  async bankSettings() {
    const settings = await this.settings.orders();
    return {
      accounts: settings.bankTransfer.accounts,
      instructions: settings.bankTransfer.instructions,
    };
  }

  /**
   * The customer's proof of a bank transfer (PDF, JPG or PNG). The order then waits for finance
   * instead of expiring, and its stock stays held until the proof is reviewed.
   */
  async submitProof(
    user: AuthenticatedUser,
    orderId: string,
    input: BankProofInput,
    file: { buffer: Buffer; originalName: string },
  ): Promise<void> {
    const now = new Date();
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerId: user.id },
      select: { status: true, paymentMethod: true, paymentDueAt: true },
    });
    if (!order) throw notFound();
    if (order.paymentMethod !== 'BANK_TRANSFER')
      throw conflict('This order is not paid by bank transfer.');
    if (order.status !== 'AWAITING_PAYMENT')
      throw conflict('This order is not waiting for payment.');
    if (order.paymentDueAt && order.paymentDueAt <= now) {
      throw conflict('The time to pay for this order has passed.');
    }
    const transferredAt = new Date(input.transferredAt);
    if (transferredAt.getTime() > now.getTime() + 5 * 60_000) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        'The transfer date is in the future.',
        [{ path: 'transferredAt', message: 'Cannot be in the future' }],
      );
    }
    const stored = await this.files.upload({ ...file, purpose: FilePurpose.PAYMENT_PROOF });
    try {
      await this.prisma.$transaction(async (tx) => {
        const [locked] = await tx.$queryRaw<{ status: string; payment_due_at: Date | null }[]>`
          SELECT "status"::text, "payment_due_at" FROM "orders" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
        if (
          locked?.status !== 'AWAITING_PAYMENT' ||
          (locked.payment_due_at && locked.payment_due_at <= now)
        ) {
          throw conflict('This order is not waiting for payment.');
        }
        const payment = await tx.payment.findFirst({
          where: { orderId, provider: 'MANUAL_BANK', status: 'PENDING' },
          orderBy: { createdAt: 'desc' },
        });
        if (!payment) throw conflict('This order is not waiting for a bank transfer.');
        const open = await tx.bankTransferProof.count({
          where: { paymentId: payment.id, status: 'SUBMITTED' },
        });
        if (open > 0) throw conflict('A proof is already waiting for review.');
        await tx.bankTransferProof.create({
          data: {
            paymentId: payment.id,
            fileId: stored.id,
            submittedById: user.id,
            bankName: input.bankName,
            referenceNumber: input.referenceNumber,
            amount: new Prisma.Decimal(input.amount),
            transferredAt,
          },
        });
        await tx.paymentEvent.create({
          data: {
            paymentId: payment.id,
            type: 'PROOF_SUBMITTED',
            actorId: user.id,
            data: { amount: input.amount, bankName: input.bankName },
          },
        });
        await tx.orderEvent.create({
          data: {
            orderId,
            type: 'PAYMENT_PROOF_SUBMITTED',
            actorType: 'CUSTOMER',
            actorId: user.id,
            note: `Transfer of ₱${input.amount} from ${input.bankName}`,
          },
        });
        // Hold the stock while finance reviews, even past the payment deadline.
        await tx.$executeRaw`
          UPDATE "stock_reservations" r SET "expires_at" = NULL, "updated_at" = ${now}
          FROM "order_items" i
          WHERE r."order_item_id" = i."id" AND i."order_id" = ${orderId}::uuid AND r."status" = 'ACTIVE'`;
      });
    } catch (error) {
      await this.files.delete(stored.id, FilePurpose.PAYMENT_PROOF).catch(() => undefined);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('A proof is already waiting for review.');
      }
      throw error;
    }
  }

  /** Finance confirmed the transfer in the marketplace's bank account. */
  async approveProof(
    staff: AuthenticatedUser,
    proofId: string,
    context: RequestContext,
  ): Promise<AdminProof> {
    const result = await this.prisma.$transaction(async (tx) => {
      const proof = await this.lockSubmittedProof(tx, proofId);
      await tx.bankTransferProof.update({
        where: { id: proofId },
        data: { status: 'APPROVED', reviewedById: staff.id, reviewedAt: new Date() },
      });
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: proof.payment_id } });
      const applied = await applyPaymentSucceededInTx(tx, {
        paymentId: payment.id,
        providerPaymentId: proof.reference_number,
        // Finance approves only after seeing the full amount arrive.
        amount: m(payment.amount),
        source: 'FINANCE',
        actorId: staff.id,
      });
      await this.audit.record(
        {
          action: 'payments.bank_transfer_approved',
          actorId: staff.id,
          entityType: 'bank_transfer_proof',
          entityId: proofId,
          metadata: { paymentReference: payment.reference, result: applied.result },
        },
        context,
        tx,
      );
      return applied;
    });
    await this.afterSucceeded(result);
    return this.getProof(proofId);
  }

  /**
   * Finance could not find the transfer. The customer gets the reason and a fresh window to
   * transfer or upload a clearer proof.
   */
  async rejectProof(
    staff: AuthenticatedUser,
    proofId: string,
    reason: string,
    context: RequestContext,
  ): Promise<AdminProof> {
    const now = new Date();
    const settings = await this.settings.orders();
    const orderId = await this.prisma.$transaction(async (tx) => {
      const proof = await this.lockSubmittedProof(tx, proofId);
      await tx.bankTransferProof.update({
        where: { id: proofId },
        data: {
          status: 'REJECTED',
          reviewedById: staff.id,
          reviewedAt: now,
          rejectionReason: reason,
        },
      });
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: proof.payment_id } });
      await tx.paymentEvent.create({
        data: {
          paymentId: payment.id,
          type: 'PROOF_REJECTED',
          actorId: staff.id,
          data: { reason },
        },
      });
      const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId } });
      if (order.status === 'AWAITING_PAYMENT' && payment.status === 'PENDING') {
        const extended = new Date(now.getTime() + settings.bankTransfer.windowHours * 3_600_000);
        const dueAt =
          order.paymentDueAt && order.paymentDueAt > extended ? order.paymentDueAt : extended;
        await tx.order.update({ where: { id: order.id }, data: { paymentDueAt: dueAt } });
        await tx.payment.update({ where: { id: payment.id }, data: { expiresAt: dueAt } });
        await tx.$executeRaw`
          UPDATE "stock_reservations" r SET "expires_at" = ${new Date(dueAt.getTime() + HOLD_GRACE_MS)}, "updated_at" = ${now}
          FROM "order_items" i
          WHERE r."order_item_id" = i."id" AND i."order_id" = ${order.id}::uuid AND r."status" = 'ACTIVE'`;
      }
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'PAYMENT_PROOF_REJECTED',
          actorType: 'STAFF',
          actorId: staff.id,
          note: reason,
        },
      });
      await this.audit.record(
        {
          action: 'payments.bank_transfer_rejected',
          actorId: staff.id,
          entityType: 'bank_transfer_proof',
          entityId: proofId,
          metadata: { paymentReference: payment.reference },
        },
        context,
        tx,
      );
      return order.id;
    });
    await this.notifier.customer(
      orderId,
      'Bank transfer not confirmed',
      `We could not confirm your bank transfer: ${reason} Please check the details and upload a new proof from your order page.`,
    );
    return this.getProof(proofId);
  }

  private async lockSubmittedProof(tx: Tx, proofId: string) {
    const owner = await tx.bankTransferProof.findUnique({
      where: { id: proofId },
      select: { payment: { select: { orderId: true } } },
    });
    if (owner) await lockOrderInTx(tx, owner.payment.orderId);
    const [proof] = await tx.$queryRaw<
      { status: string; payment_id: string; reference_number: string }[]
    >`
      SELECT "status"::text, "payment_id", "reference_number" FROM "bank_transfer_proofs"
      WHERE "id" = ${proofId}::uuid FOR UPDATE`;
    if (!proof) throw notFound('Proof');
    if (proof.status !== 'SUBMITTED') throw conflict('This proof was already reviewed.');
    return proof;
  }

  /** The proof file, for its customer or for staff. */
  async proofFile(proofId: string, customerId: string | null) {
    const proof = await this.prisma.bankTransferProof.findFirst({
      where: { id: proofId, ...(customerId ? { payment: { order: { customerId } } } : {}) },
      select: { fileId: true },
    });
    if (!proof) throw notFound('Proof');
    return this.files.openContent(proof.fileId, FilePurpose.PAYMENT_PROOF);
  }

  // ---- Staff views -------------------------------------------------------------------------

  async listPayments(query: {
    page: number;
    pageSize: number;
    status?: AdminPayment['status'];
    provider?: AdminPayment['provider'];
    method?: AdminPayment['method'];
    queue?: 'review' | 'failed';
    search?: string;
  }): Promise<PaginatedResponse<AdminPayment>> {
    const where: Prisma.PaymentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.method ? { method: query.method } : {}),
      ...(query.queue === 'review' ? { reviewReason: { not: null }, reviewedAt: null } : {}),
      ...(query.queue === 'failed' ? { status: 'FAILED', reviewedAt: null } : {}),
      ...(query.search
        ? {
            OR: [
              { reference: { contains: query.search.toUpperCase() } },
              { order: { orderNumber: { contains: query.search.toUpperCase() } } },
              { providerReference: { contains: query.search } },
              { order: { customer: { email: { contains: query.search.toLowerCase() } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        include: adminPaymentInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return {
      items: rows.map(adminPaymentDto),
      page: query.page,
      pageSize: query.pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async getPayment(id: string): Promise<AdminPaymentDetail> {
    const row = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        ...adminPaymentInclude,
        proofs: { orderBy: { createdAt: 'asc' } },
        refunds: { orderBy: { createdAt: 'asc' }, include: refundInclude },
        events: {
          orderBy: { createdAt: 'asc' },
          include: { actor: { select: { firstName: true, lastName: true } } },
        },
      },
    });
    if (!row) throw notFound('Payment');
    return {
      ...adminPaymentDto(row),
      events: row.events.map((e) => ({
        type: e.type,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        data: (e.data ?? {}) as Record<string, unknown>,
        actorName: e.actor ? `${e.actor.firstName} ${e.actor.lastName}` : null,
        webhookEventId: e.webhookEventId,
        createdAt: e.createdAt.toISOString(),
      })),
      proofs: row.proofs.map(proofDto),
      refunds: row.refunds.map(refundDto),
    };
  }

  /** Finance marks a review item or failed payment as handled (with what they did). */
  async resolvePayment(
    staff: AuthenticatedUser,
    id: string,
    note: string,
    context: RequestContext,
  ): Promise<AdminPaymentDetail> {
    await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<
        { reviewed_at: Date | null; review_reason: string | null; status: string }[]
      >`
        SELECT "reviewed_at", "review_reason", "status"::text FROM "payments" WHERE "id" = ${id}::uuid FOR UPDATE`;
      if (!row) throw notFound('Payment');
      if (row.reviewed_at) throw conflict('This payment was already resolved.');
      if (!row.review_reason && row.status !== 'FAILED')
        throw conflict('Nothing to resolve on this payment.');
      await tx.payment.update({
        where: { id },
        data: { reviewedAt: new Date(), reviewedById: staff.id },
      });
      await tx.paymentEvent.create({
        data: { paymentId: id, type: 'RESOLVED', actorId: staff.id, data: { note } },
      });
      await this.audit.record(
        {
          action: 'payments.resolved',
          actorId: staff.id,
          entityType: 'payment',
          entityId: id,
          metadata: { note },
        },
        context,
        tx,
      );
    });
    return this.getPayment(id);
  }

  async listWebhookEvents(query: {
    page: number;
    pageSize: number;
    status?: WebhookEventDto['status'];
    source?: string;
  }): Promise<PaginatedResponse<WebhookEventDto>> {
    const where: Prisma.WebhookEventWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.source ? { source: query.source } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.webhookEvent.findMany({
        where,
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.webhookEvent.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.webhookEventDto(r)),
      page: query.page,
      pageSize: query.pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  private webhookEventDto(r: Prisma.WebhookEventGetPayload<object>): WebhookEventDto {
    return {
      id: r.id,
      source: r.source,
      eventId: r.eventId,
      eventType: r.eventType,
      livemode: r.livemode,
      status: r.status,
      attempts: r.attempts,
      error: r.error,
      receivedAt: r.receivedAt.toISOString(),
      processedAt: iso(r.processedAt),
    };
  }

  async listProofs(query: {
    page: number;
    pageSize: number;
    status?: AdminProof['status'];
  }): Promise<PaginatedResponse<AdminProof>> {
    const where: Prisma.BankTransferProofWhereInput = query.status ? { status: query.status } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.bankTransferProof.findMany({
        where,
        include: adminProofInclude,
        // Oldest first: the queue is worked in order of arrival.
        orderBy: [{ createdAt: query.status === 'SUBMITTED' ? 'asc' : 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.bankTransferProof.count({ where }),
    ]);
    return {
      items: rows.map(adminProofDto),
      page: query.page,
      pageSize: query.pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async getProof(id: string): Promise<AdminProof> {
    const row = await this.prisma.bankTransferProof.findUnique({
      where: { id },
      include: adminProofInclude,
    });
    if (!row) throw notFound('Proof');
    return adminProofDto(row);
  }

  /** Whether the active gateway takes this online method now (checkout shows the others as unavailable). */
  onlineAvailable(method: PaymentMethod): boolean {
    return this.gateways.supports(method);
  }

  gatewayStatuses() {
    return { items: this.gateways.statuses() };
  }

  private activeGatewayFor(method: PaymentMethod): PaymentGateway {
    let gateway: PaymentGateway;
    try {
      gateway = this.gateways.active;
    } catch {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'PROVIDER_ERROR',
        'Online payments are not available right now. Please choose another payment method.',
      );
    }
    if (!gateway.methods.includes(method)) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        `${PAYMENT_METHOD_LABELS[method]} is not available right now.`,
        [{ path: 'paymentMethod', message: 'Not available' }],
      );
    }
    return gateway;
  }
}

const adminPaymentInclude = {
  order: {
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      customer: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  },
} satisfies Prisma.PaymentInclude;

function adminPaymentDto(
  p: Prisma.PaymentGetPayload<{ include: typeof adminPaymentInclude }>,
): AdminPayment {
  return {
    id: p.id,
    reference: p.reference,
    order: {
      id: p.order.id,
      orderNumber: p.order.orderNumber,
      status: p.order.status,
      paymentStatus: p.order.paymentStatus,
    },
    customer: {
      id: p.order.customer.id,
      name: `${p.order.customer.firstName} ${p.order.customer.lastName}`,
      email: p.order.customer.email,
    },
    method: p.method,
    provider: p.provider,
    status: p.status,
    livemode: p.livemode,
    amount: m(p.amount),
    amountReceived: m(p.amountReceived),
    refundedAmount: m(p.refundedAmount),
    providerReference: p.providerReference,
    providerPaymentId: p.providerPaymentId,
    failureCode: p.failureCode,
    failureMessage: p.failureMessage,
    reviewReason: p.reviewReason as AdminPayment['reviewReason'],
    reviewedAt: iso(p.reviewedAt),
    expiresAt: iso(p.expiresAt),
    paidAt: iso(p.paidAt),
    createdAt: p.createdAt.toISOString(),
  };
}

const adminProofInclude = {
  payment: {
    select: {
      id: true,
      reference: true,
      amount: true,
      status: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentDueAt: true,
          customer: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
  },
  reviewedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.BankTransferProofInclude;

function adminProofDto(
  p: Prisma.BankTransferProofGetPayload<{ include: typeof adminProofInclude }>,
): AdminProof {
  const order = p.payment.order;
  return {
    ...proofDto(p),
    payment: {
      id: p.payment.id,
      reference: p.payment.reference,
      amount: m(p.payment.amount),
      status: p.payment.status,
    },
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentDueAt: iso(order.paymentDueAt),
    },
    customer: {
      name: `${order.customer.firstName} ${order.customer.lastName}`,
      email: order.customer.email,
    },
    reviewedBy: p.reviewedBy ? `${p.reviewedBy.firstName} ${p.reviewedBy.lastName}` : null,
  };
}
