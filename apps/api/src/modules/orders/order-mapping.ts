import { Prisma } from '@marketplace/database';
import {
  canTransition,
  nextStatuses,
  OPEN_RETURN_STATUSES,
  type ReturnStatus,
  type SellerOrderStatus,
} from '@marketplace/shared-types';
import type {
  BankAccount,
  OrderAddress,
  OrderDetail,
  OrderItemDto,
  OrderNoteDto,
  OrderPayment,
  OrderSummary,
  PaymentAttemptDto,
  ProofDto,
  RefundDto,
  SellerOrderActions,
  SellerOrderDto,
  ShipmentDto,
} from '@marketplace/validation';

const shipmentInclude = {
  events: { orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }] },
} satisfies Prisma.ShipmentInclude;
export type ShipmentRow = Prisma.ShipmentGetPayload<{ include: typeof shipmentInclude }>;

export const refundInclude = {
  order: { select: { orderNumber: true } },
  sellerOrder: { select: { number: true } },
  payment: { select: { reference: true } },
} satisfies Prisma.RefundInclude;
export type RefundRow = Prisma.RefundGetPayload<{ include: typeof refundInclude }>;

const noteInclude = {
  author: { select: { firstName: true, lastName: true } },
} satisfies Prisma.OrderNoteInclude;

export const sellerOrderInclude = {
  store: { select: { id: true, name: true, slug: true } },
  items: {
    orderBy: { createdAt: 'asc' },
    include: { product: { select: { slug: true } }, review: { select: { id: true } } },
  },
  shippingGroup: true,
  shipments: { orderBy: { createdAt: 'asc' }, include: shipmentInclude },
  codCollection: true,
  cancellations: { orderBy: { createdAt: 'desc' }, take: 1 },
  returns: {
    orderBy: { createdAt: 'desc' },
    select: { id: true, number: true, status: true, createdAt: true },
  },
  refunds: { orderBy: { createdAt: 'asc' }, include: refundInclude },
  notes: { orderBy: { createdAt: 'asc' }, include: noteInclude },
  promotions: {
    orderBy: { createdAt: 'asc' },
    include: { campaign: { select: { season: true } } },
  },
  rating: { select: { id: true } },
} satisfies Prisma.SellerOrderInclude;
export type SellerOrderRow = Prisma.SellerOrderGetPayload<{ include: typeof sellerOrderInclude }>;

export const paymentInclude = {
  proofs: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.PaymentInclude;
export type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

export const orderDetailInclude = {
  sellerOrders: { orderBy: { number: 'asc' }, include: sellerOrderInclude },
  coupons: { orderBy: { createdAt: 'asc' } },
  events: { orderBy: { createdAt: 'asc' } },
  customer: { select: { id: true, firstName: true, lastName: true, email: true } },
  payments: { orderBy: { createdAt: 'asc' }, include: paymentInclude },
  notes: { where: { sellerOrderId: null }, orderBy: { createdAt: 'asc' }, include: noteInclude },
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
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

/** Who is looking: decides which notes they see and which actions they get. */
export interface Viewer {
  type: 'CUSTOMER' | 'SELLER' | 'STAFF';
  /** Seller employees with seller.orders.manage; staff with orders.manage. */
  canManage: boolean;
}
export const CUSTOMER_VIEWER: Viewer = { type: 'CUSTOMER', canManage: true };

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
    paymentDueAt: iso(row.paymentDueAt),
    placedAt: row.placedAt.toISOString(),
  };
}

export function itemDto(i: SellerOrderRow['items'][number]): OrderItemDto {
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
    promotionDiscount: m(i.promotionDiscount),
    pointsDiscount: m(i.pointsDiscount),
    lineTotal: m(i.lineTotal),
    vatAmount: m(i.vatAmount),
    priceSource: snapshot?.source ?? 'REGULAR',
    reviewed: !!i.review,
  };
}

export function shipmentDto(s: ShipmentRow): ShipmentDto {
  return {
    id: s.id,
    direction: s.direction,
    carrier: s.carrier,
    carrierName: s.carrierName,
    serviceName: s.serviceName,
    trackingNumber: s.trackingNumber,
    status: s.status,
    codAmount: m(s.codAmount),
    hasWaybill: s.waybillFileId !== null,
    test: !s.livemode,
    failedAttempts: s.failedAttempts,
    pickedUpAt: iso(s.pickedUpAt),
    deliveredAt: iso(s.deliveredAt),
    createdAt: s.createdAt.toISOString(),
    events: s.events.map((e) => ({
      id: e.id,
      status: e.status,
      description: e.description,
      location: e.location,
      occurredAt: e.occurredAt.toISOString(),
      source: e.source,
    })),
  };
}

export function refundDto(r: RefundRow): RefundDto {
  return {
    id: r.id,
    reference: r.reference,
    orderId: r.orderId,
    orderNumber: r.order.orderNumber,
    sellerOrderId: r.sellerOrderId,
    sellerOrderNumber: r.sellerOrder?.number ?? null,
    paymentReference: r.payment.reference,
    returnRequestId: r.returnRequestId,
    reason: r.reason,
    kind: r.kind as 'FULL' | 'PARTIAL',
    status: r.status,
    method: r.method as 'ORIGINAL' | 'MANUAL',
    amount: m(r.amount),
    itemsAmount: m(r.itemsAmount),
    shippingAmount: m(r.shippingAmount),
    chargesAmount: m(r.chargesAmount),
    sellerDebit: m(r.sellerDebit),
    commissionReversal: m(r.commissionReversal),
    test: !r.livemode,
    payoutReference: r.payoutReference,
    failureMessage: r.failureMessage,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    succeededAt: iso(r.succeededAt),
  };
}

type NoteRow = SellerOrderRow['notes'][number];
const visibleNotes: Record<Viewer['type'], readonly string[]> = {
  CUSTOMER: ['CUSTOMER'],
  SELLER: ['CUSTOMER', 'SELLER'],
  STAFF: ['CUSTOMER', 'SELLER', 'STAFF'],
};
export function notesFor(notes: NoteRow[], viewer: Viewer): OrderNoteDto[] {
  return notes
    .filter((n) => visibleNotes[viewer.type].includes(n.visibility))
    .map((n) => ({
      id: n.id,
      sellerOrderId: n.sellerOrderId,
      authorType: n.authorType,
      // Customers see the store or "Marketplace" rather than employees' names.
      authorName:
        viewer.type === 'CUSTOMER' && n.authorType === 'STAFF'
          ? 'Marketplace support'
          : `${n.author.firstName} ${n.author.lastName}`,
      visibility: n.visibility,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
    }));
}

const activeForward = (so: SellerOrderRow) =>
  so.shipments.find(
    (s) => s.direction === 'FORWARD' && s.returnRequestId === null && s.status !== 'CANCELLED',
  ) ?? null;

/** What `viewer` may do with this seller order now (the API checks again on every action). */
export function actionsFor(
  so: SellerOrderRow,
  viewer: Viewer,
  now = new Date(),
): SellerOrderActions {
  const status = so.status as SellerOrderStatus;
  const openRequest = so.cancellations[0]?.status === 'REQUESTED';
  const shipment = activeForward(so);
  const none: SellerOrderActions = {
    accept: false,
    cancel: false,
    requestCancellation: false,
    answerCancellation: false,
    bookShipment: false,
    updateShipment: false,
    confirmReceived: false,
    requestReturn: false,
    moveTo: [],
    canManage: viewer.canManage,
  };
  if (!viewer.canManage) return none;
  if (viewer.type === 'CUSTOMER') {
    const openReturn = so.returns.some((r) =>
      OPEN_RETURN_STATUSES.includes(r.status as ReturnStatus),
    );
    return {
      ...none,
      // While waiting for payment the whole order is cancelled instead (OrderDetail.cancellable).
      cancel: status === 'PENDING',
      requestCancellation: !openRequest && ['PROCESSING', 'READY_FOR_PICKUP'].includes(status),
      confirmReceived: status === 'SHIPPED' && shipment?.carrier === 'SELF',
      requestReturn:
        status === 'DELIVERED' &&
        !openReturn &&
        so.returnWindowEndsAt !== null &&
        so.returnWindowEndsAt > now,
    };
  }
  if (viewer.type === 'SELLER') {
    return {
      ...none,
      accept: status === 'PENDING',
      cancel: canTransition(status, 'CANCELLED', 'SELLER'),
      answerCancellation: openRequest,
      bookShipment: status === 'PROCESSING',
      updateShipment:
        shipment?.carrier === 'SELF' &&
        ['READY_FOR_PICKUP', 'SHIPPED', 'DELIVERY_FAILED', 'RETURNING_TO_SELLER'].includes(status),
    };
  }
  return {
    ...none,
    cancel: status !== 'AWAITING_PAYMENT' && canTransition(status, 'CANCELLED', 'STAFF'),
    answerCancellation: openRequest,
    updateShipment: shipment !== null && !['DELIVERED', 'COMPLETED', 'CANCELLED'].includes(status),
    // Shipping statuses follow the shipment (update it instead); cancelling has its own action.
    moveTo: nextStatuses(status, 'STAFF').filter(
      (to) => (to === 'PROCESSING' && status === 'PENDING') || to === 'COMPLETED',
    ),
  };
}

export function sellerOrderDto(
  so: SellerOrderRow,
  viewer: Viewer,
  now = new Date(),
): SellerOrderDto {
  const g = so.shippingGroup;
  const origin = g?.origin as { label?: string } | undefined;
  const request = so.cancellations[0] ?? null;
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
    promotionDiscount: m(so.promotionDiscount),
    pointsDiscount: m(so.pointsDiscount),
    promotions: so.promotions.map((p) => ({
      campaignId: p.campaignId,
      name: p.name,
      type: p.type,
      scope: p.scope,
      season: p.campaign.season,
      amount: m(p.amount),
      shippingAmount: m(p.shippingAmount),
    })),
    sellerRated: so.rating !== null,
    shippingFee: m(so.shippingFee),
    shippingDiscount: m(so.sellerShippingDiscount.plus(so.platformShippingDiscount)),
    charges: (so.charges ?? []) as { code: string; label: string; amount: string }[],
    vatAmount: m(so.vatAmount),
    total: m(so.total),
    customerNote: so.customerNote,
    acceptedAt: iso(so.acceptedAt),
    shippedAt: iso(so.shippedAt),
    deliveredAt: iso(so.deliveredAt),
    completedAt: iso(so.completedAt),
    cancelledAt: iso(so.cancelledAt),
    cancelReason: so.cancelReason,
    returnWindowEndsAt: iso(so.returnWindowEndsAt),
    shipments: so.shipments.map(shipmentDto),
    cod: so.codCollection
      ? {
          expectedAmount: m(so.codCollection.expectedAmount),
          status: so.codCollection.status,
          collectedAt: iso(so.codCollection.collectedAt),
        }
      : null,
    cancellationRequest: request
      ? {
          id: request.id,
          status: request.status,
          reason: request.reason,
          response: request.response,
          createdAt: request.createdAt.toISOString(),
          respondedAt: iso(request.respondedAt),
        }
      : null,
    returns: so.returns.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
    refunds: so.refunds.map(refundDto),
    notes: notesFor(so.notes, viewer),
    actions: actionsFor(so, viewer, now),
  };
}

export function proofDto(p: PaymentRow['proofs'][number]): ProofDto {
  return {
    id: p.id,
    status: p.status,
    bankName: p.bankName,
    referenceNumber: p.referenceNumber,
    amount: m(p.amount),
    transferredAt: p.transferredAt.toISOString(),
    rejectionReason: p.rejectionReason,
    createdAt: p.createdAt.toISOString(),
    reviewedAt: iso(p.reviewedAt),
  };
}

export function attemptDto(p: PaymentRow, now = new Date()): PaymentAttemptDto {
  const open = p.status === 'PENDING' && (!p.expiresAt || p.expiresAt > now);
  return {
    id: p.id,
    reference: p.reference,
    method: p.method,
    provider: p.provider,
    status: p.status,
    amount: m(p.amount),
    test: !p.livemode,
    checkoutUrl:
      open && p.provider !== 'MANUAL_BANK' && p.provider !== 'COD' ? p.checkoutUrl : null,
    expiresAt: iso(p.expiresAt),
    paidAt: iso(p.paidAt),
    failureMessage: p.failureMessage,
    proofs: p.proofs.map(proofDto),
    createdAt: p.createdAt.toISOString(),
  };
}

/** The order's payments as the customer (or staff) sees them. */
export function orderPaymentDto(
  row: Pick<OrderDetailRow, 'status' | 'paymentMethod' | 'paymentDueAt' | 'payments'>,
  bank: { accounts: BankAccount[]; instructions: string },
  now = new Date(),
): OrderPayment {
  const waiting =
    row.status === 'AWAITING_PAYMENT' && (!row.paymentDueAt || row.paymentDueAt > now);
  const bankAttempt =
    row.paymentMethod === 'BANK_TRANSFER'
      ? ([...row.payments].reverse().find((p) => p.provider === 'MANUAL_BANK') ?? null)
      : null;
  const reviewing = bankAttempt?.proofs.some((p) => p.status === 'SUBMITTED') ?? false;
  const received = row.payments.reduce((s, p) => s.add(p.amountReceived), new Prisma.Decimal(0));
  const refunded = row.payments.reduce((s, p) => s.add(p.refundedAmount), new Prisma.Decimal(0));
  return {
    attempts: row.payments.map((p) => attemptDto(p, now)),
    canPay:
      waiting &&
      row.paymentMethod !== 'BANK_TRANSFER' &&
      row.paymentMethod !== 'COD' &&
      !row.payments.some((p) => p.status === 'PAID'),
    bankTransfer:
      bankAttempt && waiting
        ? {
            reference: bankAttempt.reference,
            amount: m(bankAttempt.amount),
            accounts: bank.accounts,
            instructions: bank.instructions,
            dueAt: iso(row.paymentDueAt),
          }
        : null,
    canUploadProof: !!bankAttempt && waiting && bankAttempt.status === 'PENDING' && !reviewing,
    amountReceived: m(received),
    amountRefunded: m(refunded),
  };
}

/** Customers may cancel the whole order while it waits for payment or nobody started on it. */
export const isCancellable = (row: Pick<OrderDetailRow, 'status' | 'sellerOrders'>) =>
  row.status === 'AWAITING_PAYMENT' ||
  (row.status === 'PLACED' && row.sellerOrders.every((so) => so.status === 'PENDING'));

export function eventDto(e: OrderDetailRow['events'][number]) {
  return {
    type: e.type,
    sellerOrderId: e.sellerOrderId,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    actorType: e.actorType,
    note: e.note,
    createdAt: e.createdAt.toISOString(),
  };
}

export function detailDto(
  row: OrderDetailRow,
  viewer: Viewer,
  bank: { accounts: BankAccount[]; instructions: string },
  now = new Date(),
): OrderDetail {
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
    sellerOrders: row.sellerOrders.map((so) => sellerOrderDto(so, viewer, now)),
    coupons: row.coupons.map((c) => ({
      code: c.code,
      scope: c.scope,
      type: c.type,
      amount: m(c.amount),
    })),
    totals: {
      itemsSubtotal: m(row.itemsSubtotal),
      wholesaleSavings: m(row.wholesaleSavings),
      promotionDiscount: m(row.promotionDiscount),
      couponDiscount: m(row.couponDiscount),
      pointsDiscount: m(row.pointsDiscount),
      shippingFee: m(row.shippingFee),
      shippingDiscount: m(row.shippingDiscount),
      chargesTotal: m(row.chargesTotal),
      vatAmount: m(row.vatAmount),
      grandTotal: m(row.grandTotal),
    },
    pointsRedeemed: row.pointsRedeemed,
    vat: snapshot.vat ?? { rate: '0.12', included: true },
    events: row.events.map(eventDto),
    cancelledAt: iso(row.cancelledAt),
    cancelReason: row.cancelReason,
    cancellable: viewer.type === 'CUSTOMER' && isCancellable(row),
    payment: orderPaymentDto(row, bank, now),
    notes: notesFor(row.notes, viewer),
  };
}

export { Prisma };
