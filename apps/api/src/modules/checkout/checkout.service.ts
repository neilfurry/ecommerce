import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@marketplace/database';
import {
  type AuthenticatedUser,
  ONLINE_PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
} from '@marketplace/shared-types';
import type {
  CheckoutQuote,
  CheckoutRequestParsed,
  OrderDetail,
  PlaceOrderRequest,
} from '@marketplace/validation';
import { ApiException } from '../../common/errors/api.exception';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { formatAddress } from '../addresses/addresses.service';
import { optionsOf, thumbnailOf } from '../cart/cart.service';
import { InventoryService } from '../inventory/inventory.service';
import { ReservationsService } from '../inventory/reservations.service';
import { areaName } from '../locations/locations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../orders/payments/payments.service';
import { ShippingService } from '../shipping/shipping.service';
import { type CheckoutPlan, CheckoutPricingService } from './checkout-pricing.service';
import { D, ZERO } from './money';

/** Holds of unpaid orders outlast the payment deadline a little, so the order sweep runs first. */
const HOLD_GRACE_MINUTES = 5;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** e.g. MP261125K7Q2XA: date (Manila) and 6 random characters. */
export function newOrderNumber(now = new Date()): string {
  const manila = new Date(now.getTime() + 8 * 3_600_000).toISOString();
  const date = manila.slice(2, 4) + manila.slice(5, 7) + manila.slice(8, 10);
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `MP${date}${suffix}`;
}

const changed = (message: string) =>
  new ApiException(HttpStatus.CONFLICT, 'CHECKOUT_CHANGED', message);

/**
 * Checkout: the quote (a read-only breakdown) and placing the order. Placing re-runs the
 * whole calculation inside one transaction that also writes the order, its seller suborders,
 * shipping groups and items, takes coupon uses and flash sale units with guarded updates and
 * reserves the stock, so either everything happens or nothing does.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: CheckoutPricingService,
    private readonly reservations: ReservationsService,
    private readonly inventory: InventoryService,
    private readonly shipping: ShippingService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
  ) {}

  async quote(user: AuthenticatedUser, input: CheckoutRequestParsed): Promise<CheckoutQuote> {
    return (await this.pricing.plan(user, input)).quote;
  }

  async place(
    user: AuthenticatedUser,
    input: PlaceOrderRequest & CheckoutRequestParsed,
    idempotencyKey: string,
  ): Promise<{ order: OrderDetail; created: boolean }> {
    const previous = await this.prisma.order.findUnique({
      where: { customerId_idempotencyKey: { customerId: user.id, idempotencyKey } },
    });
    if (previous) return { order: await this.orders.getMine(user, previous.id), created: false };

    let result: {
      orderId: string;
      plan: CheckoutPlan;
      stockLevelIds: string[];
      payment: { paymentId: string; online: boolean };
    };
    try {
      result = await this.prisma.$transaction(
        (tx) => this.placeInTx(tx, user, input, idempotencyKey),
        {
          timeout: 30_000,
          maxWait: 15_000,
        },
      );
    } catch (error) {
      // The same checkout submitted twice at once: the other request created the order.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.order.findUnique({
          where: { customerId_idempotencyKey: { customerId: user.id, idempotencyKey } },
        });
        if (existing)
          return { order: await this.orders.getMine(user, existing.id), created: false };
      }
      throw error;
    }
    await this.inventory.checkLowStock(result.stockLevelIds);
    // The provider's hosted checkout is opened after the order is safely stored; if the
    // provider is down the order waits and the customer presses "Pay now" again.
    if (result.payment.online) await this.payments.openCheckout(result.payment.paymentId);
    const order = await this.orders.getMine(user, result.orderId);
    await this.notify(user, order, result.plan).catch((error: Error) =>
      this.logger.warn(`Order ${order.orderNumber}: could not queue emails (${error.message})`),
    );
    return { order, created: true };
  }

  private async placeInTx(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    input: PlaceOrderRequest & CheckoutRequestParsed,
    idempotencyKey: string,
  ) {
    // Serialise use of the coupons involved (usage limits, one use per customer).
    const codes = [...new Set(input.couponCodes.map((c) => c.toUpperCase()))].sort();
    if (codes.length > 0) {
      await tx.$queryRaw`SELECT "id" FROM "coupons" WHERE "code" = ANY(${codes}::text[]) ORDER BY "id" FOR UPDATE`;
    }
    const plan = await this.pricing.plan(user, input, tx);
    if (plan.quote.problems.length > 0) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        plan.quote.problems[0]!.message,
        plan.quote.problems,
      );
    }
    const rejected = plan.quote.coupons.find((c) => c.status === 'NOT_APPLIED');
    if (rejected) throw changed(`Coupon ${rejected.code}: ${rejected.message}`);
    if (!D(input.expectedGrandTotal).equals(plan.grandTotal)) {
      throw changed(
        `The total changed to ₱${plan.grandTotal.toFixed(2)} (prices, stock or coupons changed). Please review your order.`,
      );
    }
    const address = plan.address!;
    const online = ONLINE_PAYMENT_METHODS.includes(plan.paymentMethod);
    const now = new Date();
    // Bank transfers get hours (configurable); online payments get minutes.
    const windowMs =
      plan.paymentMethod === 'BANK_TRANSFER'
        ? plan.orderSettings.bankTransfer.windowHours * 3_600_000
        : plan.settings.paymentWindowMinutes * 60_000;
    const paymentDueAt = online ? new Date(now.getTime() + windowMs) : null;
    const orderNumber = newOrderNumber(now);
    const place = { region: address.region, province: address.province };
    const shippingAddress = {
      recipientName: address.recipientName,
      mobile: address.mobile,
      streetAddress: address.streetAddress,
      addressLine2: address.addressLine2,
      barangay: address.barangay.name,
      city: address.city.name,
      province: address.province?.name ?? null,
      region: address.region.name,
      postalCode: address.postalCode,
      formatted: formatAddress({ ...address, place: address }),
      area: areaName(place),
      codes: {
        region: address.regionCode,
        province: address.provinceCode,
        city: address.cityCode,
        barangay: address.barangayCode,
      },
    };
    const t = plan.quote.totals;
    const order = await tx.order.create({
      data: {
        orderNumber,
        customerId: user.id,
        status: online ? 'AWAITING_PAYMENT' : 'PLACED',
        paymentMethod: plan.paymentMethod,
        paymentStatus: online ? 'PENDING' : 'PAY_ON_DELIVERY',
        buyerType: plan.buyerType,
        idempotencyKey,
        addressId: address.id,
        shippingAddress,
        contactEmail: (
          await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { email: true } })
        ).email,
        itemsSubtotal: D(t.itemsSubtotal),
        wholesaleSavings: D(t.wholesaleSavings),
        couponDiscount: D(t.couponDiscount),
        shippingFee: D(t.shippingFee),
        shippingDiscount: D(t.shippingDiscount),
        chargesTotal: D(t.chargesTotal),
        vatAmount: D(t.vatAmount),
        grandTotal: D(t.grandTotal),
        pricingSnapshot: {
          quote: plan.quote,
          settings: plan.settings,
          shippingProvider: this.shipping.providerName,
        } as unknown as Prisma.InputJsonValue,
        paymentDueAt,
        placedAt: now,
        events: {
          create: {
            type: online ? 'AWAITING_PAYMENT' : 'PLACED',
            note: online
              ? `Waiting for ${PAYMENT_METHOD_LABELS[plan.paymentMethod]} payment.`
              : 'Cash on delivery.',
            actorId: user.id,
            createdAt: now,
          },
        },
      },
    });

    const holds: { variantId: string; quantity: number; orderItemId: string }[] = [];
    const sellerOrders: { id: string; total: Prisma.Decimal }[] = [];
    for (const [index, group] of plan.groups.entries()) {
      const sellerOrder = await tx.sellerOrder.create({
        data: {
          orderId: order.id,
          sellerId: group.sellerId,
          storeId: group.store.id,
          number: `${orderNumber}-${index + 1}`,
          status: online ? 'AWAITING_PAYMENT' : 'PENDING',
          itemsSubtotal: group.itemsSubtotal,
          wholesaleSavings: group.wholesaleSavings,
          sellerDiscount: group.sellerDiscount,
          platformDiscount: group.platformDiscount,
          shippingFee: group.shippingFee,
          sellerShippingDiscount: group.sellerShippingDiscount,
          platformShippingDiscount: group.platformShippingDiscount,
          chargesTotal: group.chargesTotal,
          vatAmount: group.vatAmount,
          total: group.total,
          commissionAmount: group.commissionAmount,
          charges: group.charges.map((c) => ({
            code: c.code,
            label: c.label,
            amount: c.amount.toFixed(2),
          })),
          customerNote: group.note,
          shippingGroup: {
            create: {
              warehouseId: group.origin!.warehouseId,
              method: group.shipping!.method,
              provider: this.shipping.providerName,
              serviceName: group.shipping!.serviceName,
              origin: { ...group.origin!.place },
              destination: { ...shippingAddress.codes, label: shippingAddress.formatted },
              weightGrams: group.weightGrams,
              chargeableWeightGrams: group.shipping!.chargeableWeightGrams,
              parcels: this.shipping.parcelsOf({
                weightGrams: group.weightGrams,
                volumeCm3: group.volumeCm3,
              }),
              fee: group.shippingFee,
              discount: group.sellerShippingDiscount.plus(group.platformShippingDiscount),
              etaMinDays: group.shipping!.etaMinDays,
              etaMaxDays: group.shipping!.etaMaxDays,
            },
          },
        },
      });
      sellerOrders.push({ id: sellerOrder.id, total: sellerOrder.total });
      for (const line of group.lines) {
        const item = await tx.orderItem.create({
          data: {
            orderId: order.id,
            sellerOrderId: sellerOrder.id,
            productId: line.variant.productId,
            variantId: line.variant.id,
            flashSaleItemId: line.price.flashSale?.itemId ?? null,
            sku: line.variant.sku,
            productName: line.variant.product.name,
            variantTitle: line.variant.title,
            options: optionsOf(line.variant),
            imageUrl: thumbnailOf(line.variant),
            quantity: line.quantity,
            unitPrice: D(line.price.unitPrice),
            regularUnitPrice: D(line.price.regularPrice),
            lineSubtotal: line.lineSubtotal,
            sellerDiscount: line.sellerDiscount,
            platformDiscount: line.platformDiscount,
            lineTotal: line.lineTotal,
            vatAmount: line.vatAmount,
            pricingSnapshot: line.price as unknown as Prisma.InputJsonValue,
            commissionRuleId: line.commission.ruleId,
            commissionRate: line.commission.ratePercent,
            commissionBase: line.commission.base,
            commissionAmount: line.commission.amount,
            weightGrams: line.variant.weightGrams,
          },
        });
        holds.push({ variantId: line.variant.id, quantity: line.quantity, orderItemId: item.id });

        // Flash sale units: a guarded update, so the cap is never exceeded by parallel checkouts.
        if (line.price.flashSale) {
          const taken = await tx.$executeRaw`
            UPDATE "flash_sale_items" SET "sold_quantity" = "sold_quantity" + ${line.quantity}, "updated_at" = ${now}
            WHERE "id" = ${line.price.flashSale.itemId}::uuid AND "status" = 'ACTIVE'
              AND "sold_quantity" + ${line.quantity} <= "quantity_limit"`;
          if (taken !== 1)
            throw changed(`The flash sale price for ${line.variant.product.name} has sold out.`);
        }
      }
      const coupon = plan.coupons.find(
        (c) => c.scope === 'SELLER' && c.sellerId === group.sellerId,
      );
      if (coupon) {
        await tx.orderCoupon.create({
          data: {
            orderId: order.id,
            sellerOrderId: sellerOrder.id,
            couponId: coupon.couponId,
            code: coupon.code,
            scope: coupon.scope,
            type: coupon.type,
            amount: coupon.amount,
          },
        });
      }
    }

    for (const coupon of plan.coupons) {
      if (coupon.scope === 'PLATFORM') {
        await tx.orderCoupon.create({
          data: {
            orderId: order.id,
            couponId: coupon.couponId,
            code: coupon.code,
            scope: coupon.scope,
            type: coupon.type,
            amount: coupon.amount,
          },
        });
      }
      const taken = await tx.$executeRaw`
        UPDATE "coupons" SET "used_count" = "used_count" + 1, "updated_at" = ${now}
        WHERE "id" = ${coupon.couponId}::uuid AND ("usage_limit" IS NULL OR "used_count" < "usage_limit")`;
      if (taken !== 1) throw changed(`Coupon ${coupon.code} has been fully used.`);
      await tx.couponRedemption.create({
        data: {
          couponId: coupon.couponId,
          orderId: order.id,
          userId: user.id,
          amount: coupon.amount,
        },
      });
    }

    // Stock: held until fulfilment (COD) or until just after the payment deadline (online).
    const reservationIds = await this.reservations.reserveInTx(tx, {
      checkoutReference: orderNumber,
      items: holds,
      expiresAt: paymentDueAt
        ? new Date(paymentDueAt.getTime() + HOLD_GRACE_MINUTES * 60_000)
        : null,
    });
    const reserved = await tx.stockReservation.findMany({
      where: { id: { in: reservationIds } },
      select: { stockLevelId: true },
    });

    for (const [productId, quantity] of this.unitsByProduct(plan)) {
      await tx.product.update({
        where: { id: productId },
        data: { soldCount: { increment: quantity } },
      });
    }
    if (plan.cartItemIds.length > 0) {
      await tx.cartItem.deleteMany({ where: { id: { in: plan.cartItemIds }, userId: user.id } });
    }
    const payment = await this.payments.createForOrderInTx(tx, order, sellerOrders);
    return {
      orderId: order.id,
      plan,
      payment,
      stockLevelIds: [...new Set(reserved.map((r) => r.stockLevelId))],
    };
  }

  private unitsByProduct(plan: CheckoutPlan) {
    const units = new Map<string, number>();
    for (const group of plan.groups) {
      for (const line of group.lines) {
        units.set(line.variant.productId, (units.get(line.variant.productId) ?? 0) + line.quantity);
      }
    }
    return units;
  }

  private async notify(user: AuthenticatedUser, order: OrderDetail, plan: CheckoutPlan) {
    const lines = (so: OrderDetail['sellerOrders'][number]) =>
      so.items.map((i) => ({
        productName: i.productName,
        variantTitle: i.variantTitle,
        quantity: i.quantity,
        lineTotal: i.lineTotal,
      }));
    const customer = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await this.notifications.sendOrderPlaced({
      to: customer.email,
      firstName: customer.firstName,
      orderNumber: order.orderNumber,
      status: order.status === 'AWAITING_PAYMENT' ? 'AWAITING_PAYMENT' : 'PLACED',
      paymentMethod: PAYMENT_METHOD_LABELS[order.paymentMethod],
      paymentDueAt: order.paymentDueAt,
      grandTotal: order.grandTotal,
      sellers: order.sellerOrders.map((so) => ({ storeName: so.store.name, lines: lines(so) })),
      address: order.address.formatted,
      link: `${this.config.appUrls.storefront}/account/orders/${order.id}`,
    });
    const sellers = await this.prisma.seller.findMany({
      where: { id: { in: plan.groups.map((g) => g.sellerId) } },
      select: { id: true, email: true, businessName: true },
    });
    for (const so of order.sellerOrders) {
      const seller = sellers.find((s) => s.id === so.sellerId);
      if (!seller) continue;
      await this.notifications.sendSellerNewOrder({
        to: seller.email,
        businessName: seller.businessName,
        number: so.number,
        paymentMethod: PAYMENT_METHOD_LABELS[order.paymentMethod],
        awaitingPayment: order.status === 'AWAITING_PAYMENT',
        total: so.total,
        lines: lines(so),
        link: `${this.config.appUrls.seller}/orders/${so.id}`,
      });
    }
  }
}

export { ZERO };
