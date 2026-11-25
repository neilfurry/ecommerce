import { Prisma } from '@marketplace/database';
import type {
  OrderAddress,
  OrderDetail,
  OrderItemDto,
  OrderSummary,
  SellerOrderDto,
} from '@marketplace/validation';

export const orderDetailInclude = {
  sellerOrders: {
    orderBy: { number: 'asc' },
    include: {
      store: { select: { id: true, name: true, slug: true } },
      items: {
        orderBy: { createdAt: 'asc' },
        include: { product: { select: { slug: true } }, review: { select: { id: true } } },
      },
      shippingGroup: true,
    },
  },
  coupons: { orderBy: { createdAt: 'asc' } },
  events: { orderBy: { createdAt: 'asc' } },
  customer: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.OrderInclude;
export type OrderDetailRow = Prisma.OrderGetPayload<{ include: typeof orderDetailInclude }>;

export const orderSummaryInclude = {
  items: {
    select: { productName: true, imageUrl: true, quantity: true },
    orderBy: { createdAt: 'asc' },
  },
  _count: { select: { sellerOrders: true } },
  customer: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.OrderInclude;
export type OrderSummaryRow = Prisma.OrderGetPayload<{ include: typeof orderSummaryInclude }>;

const m = (d: Prisma.Decimal) => d.toFixed(2);

/** The stored address copy (see CheckoutService) as the API shows it. */
export const addressOf = (json: Prisma.JsonValue): OrderAddress => json as unknown as OrderAddress;

export function summaryDto(row: OrderSummaryRow): OrderSummary {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    paymentMethod: row.paymentMethod,
    paymentStatus: row.paymentStatus,
    grandTotal: m(row.grandTotal),
    currency: row.currency,
    itemCount: row.items.reduce((n, i) => n + i.quantity, 0),
    sellerCount: row._count.sellerOrders,
    preview: row.items
      .slice(0, 4)
      .map((i) => ({ productName: i.productName, imageUrl: i.imageUrl })),
    paymentDueAt: row.paymentDueAt?.toISOString() ?? null,
    placedAt: row.placedAt.toISOString(),
  };
}

export function itemDto(i: OrderDetailRow['sellerOrders'][number]['items'][number]): OrderItemDto {
  const snapshot = i.pricingSnapshot as { source?: string } | null;
  return {
    id: i.id,
    productId: i.productId,
    variantId: i.variantId,
    productSlug: i.product?.slug ?? null,
    sku: i.sku,
    productName: i.productName,
    variantTitle: i.variantTitle,
    options: (i.options ?? {}) as Record<string, string>,
    imageUrl: i.imageUrl,
    quantity: i.quantity,
    unitPrice: m(i.unitPrice),
    regularUnitPrice: m(i.regularUnitPrice),
    lineSubtotal: m(i.lineSubtotal),
    sellerDiscount: m(i.sellerDiscount),
    platformDiscount: m(i.platformDiscount),
    lineTotal: m(i.lineTotal),
    vatAmount: m(i.vatAmount),
    priceSource: snapshot?.source ?? 'REGULAR',
    reviewed: !!i.review,
  };
}

export function sellerOrderDto(so: OrderDetailRow['sellerOrders'][number]): SellerOrderDto {
  const g = so.shippingGroup;
  const origin = g?.origin as { label?: string } | undefined;
  return {
    id: so.id,
    number: so.number,
    status: so.status,
    sellerId: so.sellerId,
    store: so.store,
    items: so.items.map(itemDto),
    shipping: g
      ? {
          method: g.method,
          carrier: g.provider === 'mock' ? 'Mock Express' : g.provider,
          serviceName: g.serviceName,
          origin: origin?.label ?? '',
          weightGrams: g.weightGrams,
          chargeableWeightGrams: g.chargeableWeightGrams,
          fee: m(g.fee),
          discount: m(g.discount),
          etaMinDays: g.etaMinDays,
          etaMaxDays: g.etaMaxDays,
        }
      : null,
    itemsSubtotal: m(so.itemsSubtotal),
    wholesaleSavings: m(so.wholesaleSavings),
    sellerDiscount: m(so.sellerDiscount),
    platformDiscount: m(so.platformDiscount),
    shippingFee: m(so.shippingFee),
    shippingDiscount: m(so.sellerShippingDiscount.plus(so.platformShippingDiscount)),
    charges: (so.charges ?? []) as { code: string; label: string; amount: string }[],
    vatAmount: m(so.vatAmount),
    total: m(so.total),
    customerNote: so.customerNote,
  };
}

/** Customers may cancel while the order waits for payment, or a COD order nobody started on. */
export const isCancellable = (
  row: Pick<OrderDetailRow, 'status' | 'paymentStatus' | 'sellerOrders'>,
) =>
  row.status === 'AWAITING_PAYMENT' ||
  (row.status === 'PLACED' &&
    row.paymentStatus === 'PAY_ON_DELIVERY' &&
    row.sellerOrders.every((so) => so.status === 'PENDING'));

export function detailDto(row: OrderDetailRow): OrderDetail {
  const snapshot = row.pricingSnapshot as { vat?: { rate: string; included: boolean } };
  return {
    ...summaryDto({
      ...row,
      items: row.sellerOrders.flatMap((so) => so.items),
      _count: { sellerOrders: row.sellerOrders.length },
    }),
    buyerType: row.buyerType,
    address: addressOf(row.shippingAddress),
    contactEmail: row.contactEmail,
    sellerOrders: row.sellerOrders.map(sellerOrderDto),
    coupons: row.coupons.map((c) => ({
      code: c.code,
      scope: c.scope,
      type: c.type,
      amount: m(c.amount),
    })),
    totals: {
      itemsSubtotal: m(row.itemsSubtotal),
      wholesaleSavings: m(row.wholesaleSavings),
      couponDiscount: m(row.couponDiscount),
      shippingFee: m(row.shippingFee),
      shippingDiscount: m(row.shippingDiscount),
      chargesTotal: m(row.chargesTotal),
      vatAmount: m(row.vatAmount),
      grandTotal: m(row.grandTotal),
    },
    vat: snapshot.vat ?? { rate: '0.12', included: true },
    events: row.events.map((e) => ({
      type: e.type,
      note: e.note,
      createdAt: e.createdAt.toISOString(),
    })),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    cancellable: isCancellable(row),
  };
}

export { Prisma };
