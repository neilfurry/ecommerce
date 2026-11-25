import { HttpStatus, Injectable } from '@nestjs/common';
import { cancelOrderInTx, Prisma } from '@marketplace/database';
import type { AuthenticatedUser, PaginatedResponse } from '@marketplace/shared-types';
import type {
  AdminOrderDetail,
  AdminOrderSummary,
  OrderDetail,
  OrderSummary,
  SellerOrderDetail,
  SellerOrderSummary,
} from '@marketplace/validation';
import { sellerScope } from '../../common/auth/seller-scope';
import { ApiException } from '../../common/errors/api.exception';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  addressOf,
  detailDto,
  isCancellable,
  orderDetailInclude,
  orderSummaryInclude,
  sellerOrderDto,
  summaryDto,
} from './order-mapping';

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Order not found.');
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

/** Order history for customers (own orders), sellers (own suborders) and staff. */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
  ) {}

  // ---- Customers ---------------------------------------------------------------------------

  async listMine(
    user: AuthenticatedUser,
    query: { page: number; pageSize: number; status?: 'AWAITING_PAYMENT' | 'PLACED' | 'CANCELLED' },
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
    return detailDto(row);
  }

  async cancelMine(user: AuthenticatedUser, id: string, reason: string): Promise<OrderDetail> {
    const row = await this.prisma.order.findFirst({
      where: { id, customerId: user.id },
      include: orderDetailInclude,
    });
    if (!row) throw notFound();
    if (!isCancellable(row)) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'This order can no longer be cancelled.',
      );
    }
    const cancelled = await this.prisma.$transaction(async (tx) => {
      // Lock the order so a concurrent cancellation or expiry cannot also run.
      await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${id}::uuid FOR UPDATE`;
      return cancelOrderInTx(tx, {
        orderId: id,
        fromStatuses: ['AWAITING_PAYMENT', 'PLACED'],
        reason,
        eventType: 'CANCELLED_BY_CUSTOMER',
        actorId: user.id,
      });
    });
    if (!cancelled)
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'This order was already cancelled.');
    await this.notifications
      .sendOrderCancelled({
        to: cancelled.customerEmail,
        firstName: cancelled.customerFirstName,
        orderNumber: cancelled.orderNumber,
        reason,
        link: `${this.config.appUrls.storefront}/account/orders/${id}`,
      })
      .catch(() => undefined);
    return this.getMine(user, id);
  }

  // ---- Sellers ------------------------------------------------------------------------------

  async listForSeller(
    user: AuthenticatedUser | null,
    query: {
      page: number;
      pageSize: number;
      status?: 'AWAITING_PAYMENT' | 'PENDING' | 'CANCELLED';
      search?: string;
      sellerId?: string;
    },
  ): Promise<PaginatedResponse<SellerOrderSummary>> {
    const sellerId = user ? sellerScope(user).sellerId : query.sellerId;
    const where: Prisma.SellerOrderWhereInput = {
      ...(sellerId ? { sellerId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { number: { contains: query.search.toUpperCase() } },
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
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.sellerOrder.findMany({
        where,
        include: {
          order: { include: { customer: { select: { firstName: true, lastName: true } } } },
          items: { select: { quantity: true } },
          store: { select: { id: true, name: true } },
          seller: { select: { id: true, businessName: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
        placedAt: so.order.placedAt.toISOString(),
      })),
      query,
      total,
    );
  }

  /** A seller's own suborder (404 for another seller's); staff pass null to see any. */
  async getSellerOrder(user: AuthenticatedUser | null, id: string): Promise<SellerOrderDetail> {
    const where: Prisma.SellerOrderWhereInput = user
      ? { id, sellerId: sellerScope(user).sellerId }
      : { id };
    const so = await this.prisma.sellerOrder.findFirst({
      where,
      include: {
        ...orderDetailInclude.sellerOrders.include,
        coupons: true,
        events: { orderBy: { createdAt: 'asc' } },
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
      ...sellerOrderDto(so),
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
      events: events.map((e) => ({
        type: e.type,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
      })),
      placedAt: so.order.placedAt.toISOString(),
    };
  }

  // ---- Staff ---------------------------------------------------------------------------------

  async listAll(query: {
    page: number;
    pageSize: number;
    status?: 'AWAITING_PAYMENT' | 'PLACED' | 'CANCELLED';
    paymentMethod?: 'COD' | 'GCASH' | 'MAYA' | 'CARD' | 'QR_PH' | 'BANK_TRANSFER';
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

  async getAny(id: string): Promise<AdminOrderDetail> {
    const row = await this.prisma.order.findUnique({ where: { id }, include: orderDetailInclude });
    if (!row) throw notFound();
    const commission = await this.prisma.sellerOrder.aggregate({
      where: { orderId: id },
      _sum: { commissionAmount: true },
    });
    return {
      ...detailDto(row),
      customer: {
        id: row.customer.id,
        name: `${row.customer.firstName} ${row.customer.lastName}`,
        email: row.customer.email,
      },
      commissionAmount: (commission._sum.commissionAmount ?? new Prisma.Decimal(0)).toFixed(2),
    };
  }
}
