import { HttpStatus, Injectable } from '@nestjs/common';
import {
  cancelOrderInTx,
  cancelSellerOrderInTx,
  type CancelledOrder,
  ConcurrentUpdateError,
  InvalidTransitionError,
  lockOrderInTx,
  Prisma,
  transitionSellerOrderInTx,
} from '@marketplace/database';
import {
  type AuthenticatedUser,
  hasPermission,
  type PaginatedResponse,
  SELLER_ORDER_TABS,
  type SellerOrderStatus,
  type SellerOrderTab,
} from '@marketplace/shared-types';
import type {
  AddNoteRequest,
  AdminOrderDetail,
  AdminOrderSummary,
  OrderDetail,
  OrderSummary,
  SellerOrderCounts,
  SellerOrderDetail,
  SellerOrderSummary,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { sellerScope } from '../../common/auth/seller-scope';
import { ApiException } from '../../common/errors/api.exception';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { settleCodPaymentInTx } from './cod/cod.service';
import {
  addressOf,
  CUSTOMER_VIEWER,
  detailDto,
  eventDto,
  isCancellable,
  orderDetailInclude,
  orderSummaryInclude,
  sellerOrderDto,
  sellerOrderInclude,
  summaryDto,
  type Viewer,
} from './order-mapping';
import { OrderNotifier } from './order-notifier.service';
import { PaymentsService } from './payments/payments.service';
import { RefundsService } from './refunds/refunds.service';

type Tx = Prisma.TransactionClient;

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Order not found.');
const conflict = (message: string) => new ApiException(HttpStatus.CONFLICT, 'CONFLICT', message);
const invalid = (message: string) =>
  new ApiException(HttpStatus.CONFLICT, 'INVALID_TRANSITION', message);
const page = <T>(
  items: T[],
  query: { page: number; pageSize: number },
  totalItems: number,
): PaginatedResponse<T> => ({
  items,
  page: query.page,
  pageSize: query.pageSize,
  totalItems,
  totalPages: Math.ceil(totalItems / query.pageSize),
});

/** Database and state-machine errors as API errors. */
function translate(error: unknown): unknown {
  if (error instanceof InvalidTransitionError) return invalid(error.message);
  if (error instanceof ConcurrentUpdateError) return conflict(error.message);
  return error;
}

/** Work to do once a cancellation committed. */
interface Followup {
  refundIds: string[];
  closedPayments: { provider: string; providerReference: string | null }[];
}

/**
 * Orders for customers (their own), sellers (their own seller orders only) and staff (all):
 * views, cancellation (direct or by request), acceptance, staff moves and notes. Shipping
 * changes go through ShipmentsService, money through PaymentsService and RefundsService.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly notifier: OrderNotifier,
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  /** Seller employees may act with seller.orders.manage; others only look. */
  sellerViewer(user: AuthenticatedUser): Viewer {
    return { type: 'SELLER', canManage: hasPermission(user, 'seller.orders.manage') };
  }

  staffViewer(user: AuthenticatedUser): Viewer {
    return { type: 'STAFF', canManage: hasPermission(user, 'orders.manage') };
  }

  // ---- Customers ---------------------------------------------------------------------------

  async listMine(
    user: AuthenticatedUser,
    query: { page: number; pageSize: number; status?: OrderSummary['status'] },
  ): Promise<PaginatedResponse<OrderSummary>> {
    const where: Prisma.OrderWhereInput = {
      customerId: user.id,
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: orderSummaryInclude,
        orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);
    return page(rows.map(summaryDto), query, total);
  }

  /** One of the customer's orders (404 for anyone else's). */
  async getMine(user: AuthenticatedUser, id: string): Promise<OrderDetail> {
    const row = await this.prisma.order.findFirst({
      where: { id, customerId: user.id },
      include: orderDetailInclude,
    });
    if (!row) throw notFound();
    return detailDto(row, CUSTOMER_VIEWER, await this.payments.bankSettings());
  }

  /** The whole order, while it waits for payment or before any seller started on it. */
  async cancelMine(user: AuthenticatedUser, id: string, reason: string): Promise<OrderDetail> {
    const row = await this.prisma.order.findFirst({
      where: { id, customerId: user.id },
      include: orderDetailInclude,
    });
    if (!row) throw notFound();
    if (!isCancellable(row)) throw conflict('This order can no longer be cancelled.');
    const result = await this.cancelWholeOrder(id, {
      fromStatuses: ['AWAITING_PAYMENT', 'PLACED'],
      reason,
      eventType: 'CANCELLED_BY_CUSTOMER',
      actorId: user.id,
      onlyIfAllPending: true,
    });
    if (!result) throw conflict('This order was already cancelled.');
    return this.getMine(user, id);
  }

  /**
   * Cancels a whole order (customer or staff) and refunds what was paid for it.
   * Returns null when it was not in one of `fromStatuses`.
   */
  private async cancelWholeOrder(
    orderId: string,
    input: {
      fromStatuses: ('AWAITING_PAYMENT' | 'PLACED')[];
      reason: string;
      eventType: 'CANCELLED_BY_CUSTOMER' | 'CANCELLED_BY_STAFF';
      actorId: string;
      onlyIfAllPending: boolean;
    },
  ): Promise<CancelledOrder | null> {
    const followup: Followup = { refundIds: [], closedPayments: [] };
    let cancelled: CancelledOrder | null;
    try {
      cancelled = await this.prisma.$transaction(
        async (tx) => {
          // Lock the order so a concurrent cancellation, payment or expiry cannot also run.
          await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
          if (input.onlyIfAllPending) {
            const started = await tx.sellerOrder.count({
              where: { orderId, status: { notIn: ['AWAITING_PAYMENT', 'PENDING', 'CANCELLED'] } },
            });
            if (started > 0) throw conflict('A seller has already started on this order.');
          }
          const before = await tx.sellerOrder.findMany({
            where: { orderId, status: { not: 'CANCELLED' } },
            select: { id: true },
          });
          const result = await cancelOrderInTx(tx, {
            orderId,
            fromStatuses: input.fromStatuses,
            reason: input.reason,
            eventType: input.eventType,
            actorId: input.actorId,
          });
          if (!result) return null;
          followup.closedPayments = result.closedPayments;
          if (result.moneyReceived) {
            for (const so of before) {
              const refundId = await this.refunds.createForCancellationInTx(
                tx,
                so.id,
                input.eventType === 'CANCELLED_BY_STAFF' ? input.actorId : null,
              );
              if (refundId) followup.refundIds.push(refundId);
            }
          }
          return result;
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      throw translate(error);
    }
    if (!cancelled) return null;
    await this.afterCancellation(followup);
    await this.notifications
      .sendOrderCancelled({
        to: cancelled.customerEmail,
        firstName: cancelled.customerFirstName,
        orderNumber: cancelled.orderNumber,
        reason: input.reason,
        link: `${this.config.appUrls.storefront}/account/orders/${orderId}`,
        moneyReceived: cancelled.moneyReceived,
      })
      .catch(() => undefined);
    await this.notifier.sellersOf(
      orderId,
      'Order cancelled',
      `The order was cancelled: ${input.reason}`,
    );
    return cancelled;
  }

  private async afterCancellation(followup: Followup) {
    await this.payments.expireAtProviders(followup.closedPayments);
    for (const id of followup.refundIds) await this.refunds.execute(id);
  }

  /**
   * Cancels one seller order (customer before the seller starts; seller or staff before it
   * ships): stock, flash sale units and the seller's coupon use go back, a booked shipment is
   * cancelled, the cash-on-delivery collection is closed and paid money is refunded.
   */
  private async cancelSellerOrder(
    sellerOrderId: string,
    actor: { type: 'CUSTOMER' | 'SELLER' | 'STAFF'; id: string },
    reason: string,
    eventType:
      | 'CANCELLED_BY_CUSTOMER'
      | 'CANCELLED_BY_SELLER'
      | 'CANCELLED_BY_STAFF'
      | 'CANCELLATION_APPROVED',
    extra?: (tx: Tx) => Promise<void>,
    before?: (tx: Tx) => Promise<void>,
  ): Promise<void> {
    const followup: Followup = { refundIds: [], closedPayments: [] };
    const cancelledShipments: { carrier: string; trackingNumber: string }[] = [];
    let orderId: string;
    try {
      orderId = await this.prisma.$transaction(
        async (tx) => {
          const so = await tx.sellerOrder.findUniqueOrThrow({
            where: { id: sellerOrderId },
            select: { orderId: true, status: true },
          });
          await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${so.orderId}::uuid FOR UPDATE`;
          if (before) await before(tx);
          if (so.status === 'AWAITING_PAYMENT') {
            throw conflict('While the order waits for payment, cancel the whole order instead.');
          }
          // A booked (not yet picked up) shipment is cancelled with the order.
          const booked = await tx.shipment.findMany({
            where: { sellerOrderId, status: 'BOOKED' },
            select: { id: true, carrier: true, trackingNumber: true },
          });
          for (const s of booked) {
            await tx.shipment.update({ where: { id: s.id }, data: { status: 'CANCELLED' } });
            await tx.shipmentEvent.create({
              data: {
                shipmentId: s.id,
                status: 'CANCELLED',
                description: 'Order cancelled',
                occurredAt: new Date(),
                source: actor.type,
                actorId: actor.id,
              },
            });
            cancelledShipments.push(s);
          }
          await cancelSellerOrderInTx(tx, {
            sellerOrderId,
            actor: actor.type,
            actorId: actor.id,
            reason,
            eventType,
            expectedFrom: [so.status as SellerOrderStatus],
          });
          await tx.cancellationRequest.updateMany({
            where: { sellerOrderId, status: 'REQUESTED' },
            data: {
              status: eventType === 'CANCELLATION_APPROVED' ? 'APPROVED' : 'WITHDRAWN',
              respondedAt: new Date(),
              respondedById: actor.type === 'CUSTOMER' ? null : actor.id,
            },
          });
          await settleCodPaymentInTx(tx, so.orderId);
          const refundId = await this.refunds.createForCancellationInTx(
            tx,
            sellerOrderId,
            actor.type === 'STAFF' ? actor.id : null,
          );
          if (refundId) followup.refundIds.push(refundId);
          if (extra) await extra(tx);
          return so.orderId;
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      throw translate(error);
    }
    await this.afterCancellation(followup);
    await this.notifier.customer(
      orderId,
      'Part of your order was cancelled',
      `${reason}${followup.refundIds.length > 0 ? ' What you paid for it will be refunded.' : ''}`,
    );
    if (actor.type !== 'SELLER') {
      await this.notifier.seller(
        sellerOrderId,
        'Order cancelled',
        `The order was cancelled: ${reason}`,
      );
    }
  }

  /** Customer: cancel one store's part of the order before the seller accepts it. */
  async cancelMySellerOrder(user: AuthenticatedUser, sellerOrderId: string, reason: string) {
    const so = await this.ownSellerOrder(user.id, sellerOrderId);
    if (so.status !== 'PENDING') {
      throw invalid(
        so.status === 'AWAITING_PAYMENT'
          ? 'While the order waits for payment, cancel the whole order instead.'
          : 'The seller has started on this order; ask the seller to cancel instead.',
      );
    }
    await this.cancelSellerOrder(
      sellerOrderId,
      { type: 'CUSTOMER', id: user.id },
      reason,
      'CANCELLED_BY_CUSTOMER',
    );
    return this.getMine(user, so.orderId);
  }

  /** Customer: ask the seller to cancel an order it is already preparing. */
  async requestCancellation(user: AuthenticatedUser, sellerOrderId: string, reason: string) {
    const so = await this.ownSellerOrder(user.id, sellerOrderId);
    if (!['PROCESSING', 'READY_FOR_PICKUP'].includes(so.status)) {
      throw invalid(
        so.status === 'PENDING'
          ? 'The seller has not started yet: cancel it directly.'
          : 'This order can no longer be cancelled; request a return after delivery instead.',
      );
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${so.orderId}::uuid FOR UPDATE`;
        const [current] = await tx.$queryRaw<{ status: string }[]>`
          SELECT "status"::text FROM "seller_orders" WHERE "id" = ${sellerOrderId}::uuid`;
        if (!['PROCESSING', 'READY_FOR_PICKUP'].includes(current?.status ?? '')) {
          throw invalid('This order can no longer be cancelled.');
        }
        await tx.cancellationRequest.create({
          data: { sellerOrderId, requestedById: user.id, reason },
        });
        await tx.orderEvent.create({
          data: {
            orderId: so.orderId,
            sellerOrderId,
            type: 'CANCELLATION_REQUESTED',
            actorType: 'CUSTOMER',
            actorId: user.id,
            note: reason,
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('You already asked to cancel this order.');
      }
      throw error;
    }
    await this.notifier.seller(
      sellerOrderId,
      'Cancellation requested',
      `The customer asked to cancel: ${reason} Please approve or decline it in the Seller Center.`,
    );
    return this.getMine(user, so.orderId);
  }

  async orderIdOfMySellerOrder(customerId: string, sellerOrderId: string): Promise<string> {
    return (await this.ownSellerOrder(customerId, sellerOrderId)).orderId;
  }

  private async ownSellerOrder(customerId: string, sellerOrderId: string) {
    const so = await this.prisma.sellerOrder.findFirst({
      where: { id: sellerOrderId, order: { customerId } },
      select: { id: true, orderId: true, status: true },
    });
    if (!so) throw notFound();
    return so;
  }

  // ---- Sellers ------------------------------------------------------------------------------

  private sellerWhere(
    sellerId: string | undefined,
    query: { status?: SellerOrderStatus; tab?: SellerOrderTab; search?: string },
  ): Prisma.SellerOrderWhereInput {
    const statuses = query.tab ? [...SELLER_ORDER_TABS[query.tab]] : undefined;
    return {
      ...(sellerId ? { sellerId } : {}),
      ...(query.status ? { status: query.status } : statuses ? { status: { in: statuses } } : {}),
      ...(query.search
        ? {
            OR: [
              { number: { contains: query.search.toUpperCase() } },
              { shipments: { some: { trackingNumber: { contains: query.search.toUpperCase() } } } },
              {
                order: { customer: { firstName: { contains: query.search, mode: 'insensitive' } } },
              },
              {
                order: { customer: { lastName: { contains: query.search, mode: 'insensitive' } } },
              },
            ],
          }
        : {}),
    };
  }

  async listForSeller(
    user: AuthenticatedUser | null,
    query: {
      page: number;
      pageSize: number;
      status?: SellerOrderStatus;
      tab?: SellerOrderTab;
      search?: string;
      sellerId?: string;
    },
  ): Promise<PaginatedResponse<SellerOrderSummary>> {
    const sellerId = user ? sellerScope(user).sellerId : query.sellerId;
    const where = this.sellerWhere(sellerId, query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.sellerOrder.findMany({
        where,
        include: {
          order: { include: { customer: { select: { firstName: true, lastName: true } } } },
          items: { select: { quantity: true } },
          store: { select: { id: true, name: true } },
          seller: { select: { id: true, businessName: true } },
          cancellations: { where: { status: 'REQUESTED' }, select: { id: true } },
          shipments: {
            where: { direction: 'FORWARD', returnRequestId: null, status: { not: 'CANCELLED' } },
            select: { trackingNumber: true },
            take: 1,
          },
        },
        // New orders oldest first (work them in order); other tabs newest first.
        orderBy:
          query.tab === 'NEW' || query.tab === 'PROCESSING'
            ? [{ createdAt: 'asc' }, { id: 'asc' }]
            : [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.sellerOrder.count({ where }),
    ]);
    return page(
      rows.map((so) => ({
        id: so.id,
        number: so.number,
        orderNumber: so.order.orderNumber,
        status: so.status,
        paymentMethod: so.order.paymentMethod,
        paymentStatus: so.order.paymentStatus,
        customerName: `${so.order.customer.firstName} ${so.order.customer.lastName}`,
        itemCount: so.items.reduce((n, i) => n + i.quantity, 0),
        total: so.total.toFixed(2),
        commissionAmount: so.commissionAmount.toFixed(2),
        store: so.store,
        seller: so.seller,
        cancellationRequested: so.cancellations.length > 0,
        trackingNumber: so.shipments[0]?.trackingNumber ?? null,
        placedAt: so.order.placedAt.toISOString(),
      })),
      query,
      total,
    );
  }

  /** Tab badges of the Seller Center order dashboard. */
  async sellerCounts(user: AuthenticatedUser): Promise<SellerOrderCounts> {
    const { sellerId } = sellerScope(user);
    const grouped = await this.prisma.sellerOrder.groupBy({
      by: ['status'],
      where: { sellerId },
      _count: { _all: true },
    });
    const count = (statuses: readonly string[]) =>
      grouped.filter((g) => statuses.includes(g.status)).reduce((n, g) => n + g._count._all, 0);
    const [returns, cancellationRequests] = await Promise.all([
      this.prisma.returnRequest.count({ where: { sellerId, status: 'REQUESTED' } }),
      this.prisma.cancellationRequest.count({
        where: { status: 'REQUESTED', sellerOrder: { sellerId } },
      }),
    ]);
    return {
      NEW: count(SELLER_ORDER_TABS.NEW),
      PROCESSING: count(SELLER_ORDER_TABS.PROCESSING),
      READY_FOR_PICKUP: count(SELLER_ORDER_TABS.READY_FOR_PICKUP),
      SHIPPED: count(SELLER_ORDER_TABS.SHIPPED),
      COMPLETED: count(SELLER_ORDER_TABS.COMPLETED),
      CANCELLED: count(SELLER_ORDER_TABS.CANCELLED),
      returns,
      cancellationRequests,
    };
  }

  /** A seller's own suborder (404 for another seller's); staff pass null to see any. */
  async getSellerOrder(
    user: AuthenticatedUser | null,
    id: string,
    viewer: Viewer,
  ): Promise<SellerOrderDetail> {
    const where: Prisma.SellerOrderWhereInput = user
      ? { id, sellerId: sellerScope(user).sellerId }
      : { id };
    const so = await this.prisma.sellerOrder.findFirst({
      where,
      include: {
        ...sellerOrderInclude,
        coupons: true,
        events: { orderBy: { createdAt: 'asc' } },
        ledgerEntries: { orderBy: { createdAt: 'asc' } },
        order: {
          include: {
            customer: { select: { firstName: true, lastName: true, email: true } },
            events: { where: { sellerOrderId: null }, orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });
    if (!so) throw notFound();
    const events = [...so.order.events, ...so.events].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    return {
      ...sellerOrderDto(so, viewer),
      orderId: so.orderId,
      orderNumber: so.order.orderNumber,
      paymentMethod: so.order.paymentMethod,
      paymentStatus: so.order.paymentStatus,
      buyerType: so.order.buyerType,
      customer: {
        name: `${so.order.customer.firstName} ${so.order.customer.lastName}`,
        email: so.order.customer.email,
      },
      address: addressOf(so.order.shippingAddress),
      commission: {
        amount: so.commissionAmount.toFixed(2),
        items: so.items.map((i) => ({
          orderItemId: i.id,
          ruleId: i.commissionRuleId,
          ratePercent: i.commissionRate.toFixed(2),
          base: i.commissionBase.toFixed(2),
          amount: i.commissionAmount.toFixed(2),
        })),
      },
      coupons: so.coupons.map((c) => ({
        code: c.code,
        scope: c.scope,
        type: c.type,
        amount: c.amount.toFixed(2),
      })),
      events: events.map(eventDto),
      ledger: so.ledgerEntries.map((e) => ({
        id: e.id,
        type: e.type,
        amount: e.amount.toFixed(2),
        description: e.description,
        sellerOrderId: e.sellerOrderId,
        refundId: e.refundId,
        createdAt: e.createdAt.toISOString(),
      })),
      placedAt: so.order.placedAt.toISOString(),
    };
  }

  private async sellerOwned(user: AuthenticatedUser, sellerOrderId: string) {
    const so = await this.prisma.sellerOrder.findFirst({
      where: { id: sellerOrderId, sellerId: sellerScope(user).sellerId },
      select: { id: true, orderId: true, status: true },
    });
    if (!so) throw notFound();
    return so;
  }

  /** Seller: start preparing a new order. */
  async accept(user: AuthenticatedUser, sellerOrderId: string): Promise<SellerOrderDetail> {
    const so = await this.sellerOwned(user, sellerOrderId);
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockOrderInTx(tx, so.orderId);
        await transitionSellerOrderInTx(tx, {
          sellerOrderId,
          to: 'PROCESSING',
          actor: 'SELLER',
          actorId: user.id,
          expectedFrom: ['PENDING'],
          note: 'Accepted by the seller',
        });
      });
    } catch (error) {
      throw translate(error);
    }
    await this.notifier.customer(
      so.orderId,
      'Your order is being prepared',
      'The seller accepted your order and is preparing it for shipping.',
    );
    return this.getSellerOrder(user, sellerOrderId, this.sellerViewer(user));
  }

  /** Seller: cancel (out of stock, cannot fulfil...) before the parcel is picked up. */
  async sellerCancel(
    user: AuthenticatedUser,
    sellerOrderId: string,
    reason: string,
    context: RequestContext,
  ) {
    await this.sellerOwned(user, sellerOrderId);
    await this.cancelSellerOrder(
      sellerOrderId,
      { type: 'SELLER', id: user.id },
      reason,
      'CANCELLED_BY_SELLER',
      (tx) =>
        this.audit.record(
          {
            action: 'orders.seller_cancelled',
            actorId: user.id,
            entityType: 'seller_order',
            entityId: sellerOrderId,
            metadata: { reason },
          },
          context,
          tx,
        ),
    );
    return this.getSellerOrder(user, sellerOrderId, this.sellerViewer(user));
  }

  /** Seller or staff: answer the customer's cancellation request. */
  async answerCancellation(
    user: AuthenticatedUser,
    asSeller: boolean,
    sellerOrderId: string,
    approve: boolean,
    response: string | undefined,
    context: RequestContext,
  ) {
    const so = asSeller
      ? await this.sellerOwned(user, sellerOrderId)
      : await this.prisma.sellerOrder.findUnique({
          where: { id: sellerOrderId },
          select: { id: true, orderId: true, status: true },
        });
    if (!so) throw notFound();
    const request = await this.prisma.cancellationRequest.findFirst({
      where: { sellerOrderId, status: 'REQUESTED' },
    });
    if (!request) throw conflict('There is no open cancellation request.');
    const actorType = asSeller ? 'SELLER' : 'STAFF';
    if (approve) {
      await this.cancelSellerOrder(
        sellerOrderId,
        { type: actorType, id: user.id },
        `Cancelled at the customer’s request: ${request.reason}`,
        'CANCELLATION_APPROVED',
        (tx) =>
          this.audit.record(
            {
              action: 'orders.cancellation_approved',
              actorId: user.id,
              entityType: 'seller_order',
              entityId: sellerOrderId,
            },
            context,
            tx,
          ),
        // Approve only a request that is still open (a concurrent rejection wins otherwise).
        async (tx) => {
          const { count } = await tx.cancellationRequest.updateMany({
            where: { id: request.id, status: 'REQUESTED' },
            data: {
              status: 'APPROVED',
              response: response ?? null,
              respondedById: user.id,
              respondedAt: new Date(),
            },
          });
          if (count === 0) throw conflict('The request was already answered.');
        },
      );
    } else {
      if (!response || response.trim().length < 5) {
        throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'VALIDATION_FAILED',
          'Tell the customer why.',
          [{ path: 'response', message: 'At least 5 characters' }],
        );
      }
      await this.prisma.$transaction(async (tx) => {
        // Same lock order as cancellations (order first), so the two never deadlock.
        await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${so.orderId}::uuid FOR UPDATE`;
        const { count } = await tx.cancellationRequest.updateMany({
          where: { id: request.id, status: 'REQUESTED' },
          data: { status: 'REJECTED', response, respondedById: user.id, respondedAt: new Date() },
        });
        if (count === 0) throw conflict('The request was already answered.');
        await tx.orderEvent.create({
          data: {
            orderId: so.orderId,
            sellerOrderId,
            type: 'CANCELLATION_REJECTED',
            actorType,
            actorId: user.id,
            note: response,
          },
        });
      });
      await this.notifier.customer(
        so.orderId,
        'Cancellation declined',
        `Your cancellation request was declined: ${response}`,
      );
    }
    return asSeller
      ? this.getSellerOrder(user, sellerOrderId, this.sellerViewer(user))
      : this.getSellerOrder(null, sellerOrderId, this.staffViewer(user));
  }

  // ---- Notes ---------------------------------------------------------------------------------

  /**
   * A note on an order or seller order. Customers write visible-to-all notes on their own
   * orders; sellers write customer-visible or seller-and-staff notes on their own seller
   * orders; staff choose any visibility.
   */
  async addNote(
    user: AuthenticatedUser,
    author: 'CUSTOMER' | 'SELLER' | 'STAFF',
    target: { orderId?: string; sellerOrderId?: string },
    input: AddNoteRequest,
  ): Promise<void> {
    const visibility = author === 'CUSTOMER' ? 'CUSTOMER' : (input.visibility ?? 'CUSTOMER');
    if (author === 'SELLER' && visibility === 'STAFF') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Sellers cannot write staff-only notes.',
      );
    }
    let orderId: string;
    let sellerOrderId: string | null = null;
    if (target.sellerOrderId) {
      const so = await this.prisma.sellerOrder.findFirst({
        where: {
          id: target.sellerOrderId,
          ...(author === 'SELLER' ? { sellerId: sellerScope(user).sellerId } : {}),
          ...(author === 'CUSTOMER' ? { order: { customerId: user.id } } : {}),
        },
        select: { id: true, orderId: true },
      });
      if (!so) throw notFound();
      orderId = so.orderId;
      sellerOrderId = so.id;
    } else {
      if (author === 'SELLER') throw notFound();
      const order = await this.prisma.order.findFirst({
        where: { id: target.orderId, ...(author === 'CUSTOMER' ? { customerId: user.id } : {}) },
        select: { id: true },
      });
      if (!order) throw notFound();
      orderId = order.id;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.orderNote.create({
        data: {
          orderId,
          sellerOrderId,
          authorId: user.id,
          authorType: author,
          visibility,
          body: input.body,
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId,
          sellerOrderId,
          type: 'NOTE_ADDED',
          actorType: author,
          actorId: user.id,
          // The text lives in the note (with its visibility); the history only says one was added.
          note: visibility === 'CUSTOMER' ? 'Note added' : 'Internal note added',
        },
      });
    });
  }

  // ---- Staff ---------------------------------------------------------------------------------

  async listAll(query: {
    page: number;
    pageSize: number;
    status?: OrderSummary['status'];
    paymentMethod?: OrderSummary['paymentMethod'];
    search?: string;
  }): Promise<PaginatedResponse<AdminOrderSummary>> {
    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
      ...(query.search
        ? {
            OR: [
              { orderNumber: { contains: query.search.toUpperCase() } },
              { customer: { email: { contains: query.search.toLowerCase() } } },
              { customer: { firstName: { contains: query.search, mode: 'insensitive' } } },
              { customer: { lastName: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: orderSummaryInclude,
        orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);
    return page(
      rows.map((r) => ({
        ...summaryDto(r),
        buyerType: r.buyerType,
        customer: {
          id: r.customer.id,
          name: `${r.customer.firstName} ${r.customer.lastName}`,
          email: r.customer.email,
        },
      })),
      query,
      total,
    );
  }

  async getAny(user: AuthenticatedUser, id: string): Promise<AdminOrderDetail> {
    const row = await this.prisma.order.findUnique({ where: { id }, include: orderDetailInclude });
    if (!row) throw notFound();
    const commission = await this.prisma.sellerOrder.aggregate({
      where: { orderId: id },
      _sum: { commissionAmount: true },
    });
    return {
      ...detailDto(row, this.staffViewer(user), await this.payments.bankSettings()),
      customer: {
        id: row.customer.id,
        name: `${row.customer.firstName} ${row.customer.lastName}`,
        email: row.customer.email,
      },
      commissionAmount: (commission._sum.commissionAmount ?? new Prisma.Decimal(0)).toFixed(2),
    };
  }

  /** Staff: cancel a whole order (waiting for payment, or nothing shipped yet). */
  async staffCancelOrder(
    user: AuthenticatedUser,
    id: string,
    reason: string,
    context: RequestContext,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id }, select: { id: true } });
    if (!order) throw notFound();
    const shipped = await this.prisma.sellerOrder.count({
      where: {
        orderId: id,
        status: {
          notIn: ['AWAITING_PAYMENT', 'PENDING', 'PROCESSING', 'READY_FOR_PICKUP', 'CANCELLED'],
        },
      },
    });
    if (shipped > 0)
      throw invalid(
        'Part of this order has shipped; cancel the remaining seller orders one by one.',
      );
    const booked = await this.prisma.shipment.count({
      where: { sellerOrder: { orderId: id }, status: 'BOOKED' },
    });
    if (booked > 0)
      throw invalid('Cancel the booked shipments first (or cancel the seller orders one by one).');
    const result = await this.cancelWholeOrder(id, {
      fromStatuses: ['AWAITING_PAYMENT', 'PLACED'],
      reason,
      eventType: 'CANCELLED_BY_STAFF',
      actorId: user.id,
      onlyIfAllPending: false,
    });
    if (!result) throw conflict('This order is already closed.');
    await this.audit.recordSafely(
      {
        action: 'orders.staff_cancelled',
        actorId: user.id,
        entityType: 'order',
        entityId: id,
        metadata: { reason },
      },
      context,
    );
    return this.getAny(user, id);
  }

  async staffCancelSellerOrder(
    user: AuthenticatedUser,
    sellerOrderId: string,
    reason: string,
    context: RequestContext,
  ) {
    const so = await this.prisma.sellerOrder.findUnique({
      where: { id: sellerOrderId },
      select: { id: true },
    });
    if (!so) throw notFound();
    await this.cancelSellerOrder(
      sellerOrderId,
      { type: 'STAFF', id: user.id },
      reason,
      'CANCELLED_BY_STAFF',
      (tx) =>
        this.audit.record(
          {
            action: 'orders.staff_cancelled',
            actorId: user.id,
            entityType: 'seller_order',
            entityId: sellerOrderId,
            metadata: { reason },
          },
          context,
          tx,
        ),
    );
    return this.getSellerOrder(null, sellerOrderId, this.staffViewer(user));
  }

  /**
   * Staff moves outside shipping: accept for the seller (New → Processing) or close a
   * delivered order early (Delivered → Completed). Shipping statuses follow shipment updates.
   */
  async staffTransition(
    user: AuthenticatedUser,
    sellerOrderId: string,
    to: SellerOrderStatus,
    note: string,
    context: RequestContext,
  ) {
    const so = await this.prisma.sellerOrder.findUnique({
      where: { id: sellerOrderId },
      select: { status: true, orderId: true },
    });
    if (!so) throw notFound();
    const allowed =
      (to === 'PROCESSING' && so.status === 'PENDING') ||
      (to === 'COMPLETED' && so.status === 'DELIVERED');
    if (!allowed) {
      throw invalid(
        to === 'CANCELLED'
          ? 'Use “Cancel” to cancel an order.'
          : 'Shipping statuses follow the shipment: update the shipment instead.',
      );
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockOrderInTx(tx, so.orderId);
        await transitionSellerOrderInTx(tx, {
          sellerOrderId,
          to,
          actor: 'STAFF',
          actorId: user.id,
          expectedFrom: [so.status as SellerOrderStatus],
          note,
        });
        await this.audit.record(
          {
            action: 'orders.staff_transition',
            actorId: user.id,
            entityType: 'seller_order',
            entityId: sellerOrderId,
            metadata: { from: so.status, to, note },
          },
          context,
          tx,
        );
      });
    } catch (error) {
      throw translate(error);
    }
    return this.getSellerOrder(null, sellerOrderId, this.staffViewer(user));
  }
}
