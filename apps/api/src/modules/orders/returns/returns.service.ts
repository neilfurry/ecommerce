import { HttpStatus, Injectable } from '@nestjs/common';
import { FilePurpose, lockOrderInTx, Prisma } from '@marketplace/database';
import {
  type AuthenticatedUser,
  MAX_RETURN_IMAGES,
  OPEN_RETURN_STATUSES,
  type PaginatedResponse,
  type ReturnStatus,
} from '@marketplace/shared-types';
import {
  createReturnSchema,
  MAX_RETURN_IMAGE_BYTES,
  type ReturnDto,
  type SellerReturnDecision,
  type StaffReturnDecision,
} from '@marketplace/validation';
import type { RequestContext } from '../../../common/auth/auth.decorators';
import { sellerScope } from '../../../common/auth/seller-scope';
import { ApiException } from '../../../common/errors/api.exception';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { FilesService } from '../../files/files.service';
import { processImage } from '../../files/image-processor';
import { applyStockChange, recordLedger } from '../../inventory/stock-ledger';
import { PlatformSettingsService } from '../../settings/platform-settings.service';
import { refundDto, refundInclude, shipmentDto } from '../order-mapping';
import { OrderNotifier } from '../order-notifier.service';
import { restockItemsInTx } from '../order-stock';
import { RefundsService } from '../refunds/refunds.service';

type Tx = Prisma.TransactionClient;
const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const cents = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Return not found.');
const conflict = (message: string) => new ApiException(HttpStatus.CONFLICT, 'CONFLICT', message);
const invalid = (message: string) =>
  new ApiException(HttpStatus.CONFLICT, 'INVALID_TRANSITION', message);
const validation = (path: string, message: string) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', message, [
    { path, message },
  ]);

const returnInclude = {
  order: { select: { orderNumber: true } },
  sellerOrder: {
    select: {
      number: true,
      shippingFee: true,
      sellerShippingDiscount: true,
      platformShippingDiscount: true,
      store: { select: { id: true, name: true } },
    },
  },
  customer: { select: { firstName: true, lastName: true } },
  items: { include: { orderItem: true }, orderBy: { orderItemId: 'asc' } },
  images: { orderBy: { position: 'asc' } },
  shipments: {
    orderBy: { createdAt: 'asc' },
    include: { events: { orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }] } },
  },
  refunds: { orderBy: { createdAt: 'asc' }, include: refundInclude },
} satisfies Prisma.ReturnRequestInclude;
type ReturnRow = Prisma.ReturnRequestGetPayload<{ include: typeof returnInclude }>;

/** What the returned units cost the customer (items only). */
function itemsValue(row: Pick<ReturnRow, 'items'>): Prisma.Decimal {
  return row.items.reduce(
    (s, ri) => s.add(cents(ri.orderItem.lineTotal.mul(ri.quantity).div(ri.orderItem.quantity))),
    D(0),
  );
}
const shippingValue = (row: ReturnRow) => {
  const net = row.sellerOrder.shippingFee
    .sub(row.sellerOrder.sellerShippingDiscount)
    .sub(row.sellerOrder.platformShippingDiscount);
  return net.lt(0) ? D(0) : net;
};

type Actor = { type: 'CUSTOMER' | 'SELLER' | 'STAFF'; user: AuthenticatedUser };

/**
 * Returns: the customer asks within the return window (reason, items, photos); the seller
 * approves (full or partial refund, or replacement), or rejects; the customer can escalate a
 * rejection (or an unanswered request goes to the marketplace automatically) and staff
 * decide. Approved refunds are created once the item is back (or straight away when no
 * return parcel is needed) through RefundsService, which updates the seller's payables.
 */
@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly settings: PlatformSettingsService,
    private readonly refunds: RefundsService,
    private readonly audit: AuditService,
    private readonly notifier: OrderNotifier,
  ) {}

  // ---- Customer ------------------------------------------------------------------------------

  /** `data` is the JSON "data" field of the multipart request (validated here). */
  async create(
    user: AuthenticatedUser,
    data: unknown,
    images: { buffer: Buffer; originalName: string }[],
  ): Promise<ReturnDto> {
    let input: ReturnType<typeof createReturnSchema.parse>;
    try {
      const parsed = createReturnSchema.safeParse(
        typeof data === 'string' ? JSON.parse(data) : data,
      );
      if (!parsed.success) {
        throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'VALIDATION_FAILED',
          'Check the return details.',
          parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        );
      }
      input = parsed.data;
    } catch (error) {
      if (error instanceof ApiException) throw error;
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'BAD_REQUEST',
        'The "data" field must be JSON.',
      );
    }
    if (images.length > MAX_RETURN_IMAGES)
      throw validation('images', `At most ${MAX_RETURN_IMAGES} photos.`);
    const ids = input.items.map((i) => i.orderItemId);
    if (new Set(ids).size !== ids.length) throw validation('items', 'Each item once.');

    const so = await this.prisma.sellerOrder.findFirst({
      where: { id: input.sellerOrderId, order: { customerId: user.id } },
      select: {
        id: true,
        orderId: true,
        sellerId: true,
        number: true,
        status: true,
        returnWindowEndsAt: true,
      },
    });
    if (!so) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Order not found.');
    const now = new Date();
    if (so.status !== 'DELIVERED' || !so.returnWindowEndsAt || so.returnWindowEndsAt <= now) {
      throw invalid('Returns can be requested for delivered orders within the return window.');
    }

    // Photos are re-encoded (metadata removed) before anything is stored.
    const processed = [];
    for (const image of images) {
      processed.push(
        await processImage(image.buffer, image.originalName, {
          maxBytes: MAX_RETURN_IMAGE_BYTES,
          minEdge: 200,
          maxEdge: 1600,
          thumbnailEdge: 320,
        }),
      );
    }
    const stored: string[] = [];
    try {
      for (const [index, image] of processed.entries()) {
        const file = await this.files.upload({
          buffer: image.main,
          originalName: `return-${index + 1}.webp`,
          purpose: FilePurpose.RETURN_IMAGE,
        });
        stored.push(file.id);
      }
      const responseDays = (await this.settings.orders()).returns.sellerResponseDays;
      const id = await this.prisma.$transaction(async (tx) => {
        await lockOrderInTx(tx, so.orderId);
        const [locked] = await tx.$queryRaw<{ status: string }[]>`
          SELECT "status"::text FROM "seller_orders" WHERE "id" = ${so.id}::uuid FOR UPDATE`;
        if (locked?.status !== 'DELIVERED') throw invalid('This order can no longer be returned.');
        const open = await tx.returnRequest.count({
          where: { sellerOrderId: so.id, status: { in: [...OPEN_RETURN_STATUSES] } },
        });
        if (open > 0) throw conflict('A return for this order is already open.');
        const items = await tx.orderItem.findMany({
          where: { id: { in: ids }, sellerOrderId: so.id },
          include: {
            returnItems: {
              where: {
                returnRequest: {
                  status: { notIn: ['CANCELLED'] },
                  OR: [{ resolution: null }, { resolution: { not: 'REJECTED' } }],
                },
              },
              select: { quantity: true },
            },
          },
        });
        if (items.length !== ids.length) throw validation('items', 'Choose items from this order.');
        for (const wanted of input.items) {
          const item = items.find((i) => i.id === wanted.orderItemId)!;
          const returned = item.returnItems.reduce((n, r) => n + r.quantity, 0);
          if (wanted.quantity > item.quantity - returned) {
            throw validation(
              'items',
              `At most ${item.quantity - returned} of ${item.productName} can still be returned.`,
            );
          }
        }
        const previous = await tx.returnRequest.count({ where: { sellerOrderId: so.id } });
        const row = await tx.returnRequest.create({
          data: {
            number: `RT-${so.number}-${previous + 1}`,
            orderId: so.orderId,
            sellerOrderId: so.id,
            sellerId: so.sellerId,
            customerId: user.id,
            status: 'REQUESTED',
            reason: input.reason,
            description: input.description,
            requestedResolution: input.requestedResolution,
            sellerDeadline: new Date(now.getTime() + responseDays * 86_400_000),
            items: {
              create: input.items.map((i) => ({
                orderItemId: i.orderItemId,
                quantity: i.quantity,
              })),
            },
            images: { create: stored.map((fileId, position) => ({ fileId, position })) },
          },
        });
        await tx.orderEvent.create({
          data: {
            orderId: so.orderId,
            sellerOrderId: so.id,
            type: 'RETURN_REQUESTED',
            actorType: 'CUSTOMER',
            actorId: user.id,
            note: `Return ${row.number} requested`,
          },
        });
        return row.id;
      });
      await this.notifier.seller(
        so.id,
        'Return requested',
        `The customer asked to return items. Please answer within ${responseDays} days, or the marketplace will decide.`,
      );
      return this.get({ type: 'CUSTOMER', user }, id);
    } catch (error) {
      for (const fileId of stored)
        await this.files.delete(fileId, FilePurpose.RETURN_IMAGE).catch(() => undefined);
      throw error;
    }
  }

  /** The customer asks the marketplace to decide (after a rejection, or no answer in time). */
  async escalate(user: AuthenticatedUser, id: string, note: string): Promise<ReturnDto> {
    const row = await this.scoped({ type: 'CUSTOMER', user }, id);
    const overdue = row.status === 'REQUESTED' && row.sellerDeadline <= new Date();
    if (row.status !== 'REJECTED' && !overdue) {
      throw invalid(
        'You can escalate a rejected return, or one the seller did not answer in time.',
      );
    }
    await this.move(
      row,
      ['REJECTED', 'REQUESTED'],
      'ESCALATED',
      { escalationNote: note, escalatedAt: new Date() },
      {
        actorType: 'CUSTOMER',
        actorId: user.id,
        note: `Return ${row.number} sent to the marketplace`,
      },
    );
    return this.get({ type: 'CUSTOMER', user }, id);
  }

  async cancel(user: AuthenticatedUser, id: string): Promise<ReturnDto> {
    const row = await this.scoped({ type: 'CUSTOMER', user }, id);
    if (
      !['REQUESTED', 'APPROVED', 'REJECTED', 'ESCALATED'].includes(row.status) ||
      row.refunds.length > 0
    ) {
      throw invalid('This return can no longer be cancelled.');
    }
    await this.move(
      row,
      ['REQUESTED', 'APPROVED', 'REJECTED', 'ESCALATED'],
      'CANCELLED',
      { resolvedAt: new Date() },
      {
        actorType: 'CUSTOMER',
        actorId: user.id,
        note: `Return ${row.number} withdrawn by the customer`,
      },
    );
    return this.get({ type: 'CUSTOMER', user }, id);
  }

  /** The customer sent the item back and enters the courier's tracking number. */
  async shipBack(
    user: AuthenticatedUser,
    id: string,
    input: { carrierName: string; trackingNumber: string },
  ): Promise<ReturnDto> {
    const row = await this.scoped({ type: 'CUSTOMER', user }, id);
    if (row.status !== 'APPROVED' || !row.requiresReturnShipment) {
      throw invalid('This return is not waiting for the item to be sent back.');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.moveInTx(
        tx,
        row,
        ['APPROVED'],
        'RETURN_SHIPPED',
        {},
        {
          actorType: 'CUSTOMER',
          actorId: user.id,
          note: `Item sent back with ${input.carrierName} ${input.trackingNumber}`,
        },
      );
      await tx.shipment.create({
        data: {
          sellerOrderId: row.sellerOrderId,
          returnRequestId: row.id,
          direction: 'RETURN',
          carrier: 'SELF',
          carrierName: input.carrierName,
          serviceName: 'Customer return',
          trackingNumber: input.trackingNumber.toUpperCase(),
          status: 'IN_TRANSIT',
          weightGrams: 0,
          origin: { label: 'Customer' },
          destination: { label: row.sellerOrder.store.name },
          livemode: true,
          bookedById: user.id,
          lastEventAt: new Date(),
          events: {
            create: {
              status: 'IN_TRANSIT',
              description: `Sent back by the customer with ${input.carrierName}`,
              occurredAt: new Date(),
              source: 'CUSTOMER',
              actorId: user.id,
            },
          },
        },
      });
    });
    await this.notifier.seller(
      row.sellerOrderId,
      'Returned item on its way',
      `Tracking: ${input.carrierName} ${input.trackingNumber}.`,
    );
    return this.get({ type: 'CUSTOMER', user }, id);
  }

  // ---- Seller --------------------------------------------------------------------------------

  async sellerApprove(
    user: AuthenticatedUser,
    id: string,
    decision: SellerReturnDecision,
    context: RequestContext,
  ) {
    const row = await this.scoped({ type: 'SELLER', user }, id);
    if (row.status !== 'REQUESTED') throw invalid('This return is not waiting for your answer.');
    await this.decide(
      { type: 'SELLER', user },
      row,
      ['REQUESTED'],
      {
        resolution: decision.resolution,
        refundAmount: decision.refundAmount,
        requiresReturnShipment: decision.requiresReturnShipment,
        text: decision.response ?? null,
      },
      context,
    );
    return this.get({ type: 'SELLER', user }, id);
  }

  async sellerReject(user: AuthenticatedUser, id: string, response: string): Promise<ReturnDto> {
    const row = await this.scoped({ type: 'SELLER', user }, id);
    if (row.status !== 'REQUESTED') throw invalid('This return is not waiting for your answer.');
    await this.move(
      row,
      ['REQUESTED'],
      'REJECTED',
      { sellerResponse: response, sellerRespondedAt: new Date() },
      {
        actorType: 'SELLER',
        actorId: user.id,
        note: `Return ${row.number} rejected by the seller`,
      },
    );
    await this.notifier.customer(
      row.orderId,
      'Return not accepted by the seller',
      `The seller declined your return: ${response} If you disagree, you can ask the marketplace to decide from your order page.`,
    );
    return this.get({ type: 'SELLER', user }, id);
  }

  /**
   * The item came back. Sellable units go back into stock (or are recorded as damaged), and
   * an approved refund is created and sent.
   */
  async receive(
    actor: Actor,
    id: string,
    restock: boolean,
    context: RequestContext,
  ): Promise<ReturnDto> {
    const row = await this.scoped(actor, id);
    if (!['RETURN_SHIPPED', 'APPROVED'].includes(row.status) || !row.requiresReturnShipment) {
      throw invalid('This return is not waiting for the item.');
    }
    const refundId = await this.prisma.$transaction(async (tx) => {
      await this.moveInTx(
        tx,
        row,
        ['RETURN_SHIPPED', 'APPROVED'],
        'RECEIVED',
        { receivedAt: new Date(), restocked: restock },
        {
          actorType: actor.type,
          actorId: actor.user.id,
          note: `Returned items received${restock ? ' and restocked' : ' (not resellable)'}`,
        },
      );
      await tx.shipment.updateMany({
        where: {
          returnRequestId: row.id,
          direction: 'RETURN',
          status: { notIn: ['DELIVERED', 'CANCELLED'] },
        },
        data: { status: 'DELIVERED', deliveredAt: new Date() },
      });
      await restockItemsInTx(
        tx,
        row.items.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity })),
        restock,
        `Return ${row.number}`,
        actor.user.id,
      );
      await this.audit.record(
        {
          action: 'returns.received',
          actorId: actor.user.id,
          entityType: 'return_request',
          entityId: row.id,
          metadata: { restock },
        },
        context,
        tx,
      );
      return this.refundIfDueInTx(tx, row.id, actor.type === 'STAFF' ? actor.user.id : null);
    });
    if (refundId) await this.refunds.execute(refundId);
    return this.get(actor, id);
  }

  /**
   * A replacement sent by the seller (self-arranged delivery with tracking). The units leave
   * stock now; the return is resolved when the replacement is delivered.
   */
  async shipReplacement(
    user: AuthenticatedUser,
    id: string,
    input: { carrierName: string; trackingNumber: string },
  ): Promise<ReturnDto> {
    const row = await this.scoped({ type: 'SELLER', user }, id);
    const ready =
      row.status === 'RECEIVED' || (row.status === 'APPROVED' && !row.requiresReturnShipment);
    if (row.resolution !== 'REPLACEMENT' || !ready) {
      throw invalid('This return is not waiting for a replacement.');
    }
    if (row.shipments.some((s) => s.direction === 'FORWARD' && s.status !== 'CANCELLED')) {
      throw conflict('A replacement was already sent.');
    }
    await this.prisma.$transaction(async (tx) => {
      for (const ri of row.items) {
        const source = await tx.stockReservation.findFirst({
          where: { orderItemId: ri.orderItemId, status: 'CONVERTED' },
          orderBy: { convertedAt: 'desc' },
        });
        if (!source) continue; // untracked stock
        const after = await applyStockChange(tx, source.stockLevelId, { onHand: -ri.quantity });
        if (!after) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            'INSUFFICIENT_STOCK',
            `Not enough stock of ${ri.orderItem.productName} for the replacement.`,
          );
        }
        await recordLedger(tx, {
          sellerId: source.sellerId,
          warehouseId: source.warehouseId,
          variantId: source.variantId,
          stockLevelId: source.stockLevelId,
          type: 'SALE',
          quantityChange: -ri.quantity,
          after,
          reason: `Replacement for return ${row.number}`,
          actorId: user.id,
        });
      }
      await tx.shipment.create({
        data: {
          sellerOrderId: row.sellerOrderId,
          returnRequestId: row.id,
          direction: 'FORWARD',
          carrier: 'SELF',
          carrierName: input.carrierName,
          serviceName: 'Replacement',
          trackingNumber: input.trackingNumber.toUpperCase(),
          status: 'BOOKED',
          weightGrams: 0,
          origin: { label: row.sellerOrder.store.name },
          destination: { label: 'Customer' },
          livemode: true,
          bookedById: user.id,
          lastEventAt: new Date(),
          events: {
            create: {
              status: 'BOOKED',
              description: `Replacement handed to ${input.carrierName}`,
              occurredAt: new Date(),
              source: 'SELLER',
              actorId: user.id,
            },
          },
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: row.orderId,
          sellerOrderId: row.sellerOrderId,
          type: 'RETURN_UPDATED',
          actorType: 'SELLER',
          actorId: user.id,
          note: `Replacement sent: ${input.carrierName} ${input.trackingNumber}`,
        },
      });
    });
    await this.notifier.customer(
      row.orderId,
      'Replacement on its way',
      `The seller sent a replacement with ${input.carrierName} (tracking ${input.trackingNumber}).`,
    );
    return this.get({ type: 'SELLER', user }, id);
  }

  // ---- Staff ---------------------------------------------------------------------------------

  /** Staff decide an escalated (or any still open, undecided) return. */
  async staffDecide(
    user: AuthenticatedUser,
    id: string,
    decision: StaffReturnDecision,
    context: RequestContext,
  ) {
    const row = await this.scoped({ type: 'STAFF', user }, id);
    if (!['ESCALATED', 'REQUESTED', 'REJECTED'].includes(row.status)) {
      throw invalid('This return has already been decided.');
    }
    if (decision.resolution === 'REJECTED') {
      await this.prisma.$transaction(async (tx) => {
        await this.moveInTx(
          tx,
          row,
          ['ESCALATED', 'REQUESTED', 'REJECTED'],
          'CLOSED',
          {
            resolution: 'REJECTED',
            staffDecisionNote: decision.note,
            decidedById: user.id,
            resolvedAt: new Date(),
          },
          {
            actorType: 'STAFF',
            actorId: user.id,
            note: `Return ${row.number}: no refund (${decision.note})`,
          },
        );
        await this.audit.record(
          {
            action: 'returns.decided',
            actorId: user.id,
            entityType: 'return_request',
            entityId: row.id,
            metadata: { resolution: 'REJECTED' },
          },
          context,
          tx,
        );
      });
      await this.notifier.customer(
        row.orderId,
        'Return decision',
        `The marketplace reviewed your return: ${decision.note}`,
      );
    } else {
      await this.decide(
        { type: 'STAFF', user },
        row,
        ['ESCALATED', 'REQUESTED', 'REJECTED'],
        {
          resolution: decision.resolution,
          refundAmount: decision.refundAmount,
          requiresReturnShipment: decision.requiresReturnShipment ?? false,
          text: decision.note,
        },
        context,
      );
    }
    return this.get({ type: 'STAFF', user }, id);
  }

  // ---- Shared --------------------------------------------------------------------------------

  /** Approval by the seller or staff: the resolution, the amount and whether the item comes back. */
  private async decide(
    actor: Actor,
    row: ReturnRow,
    from: ReturnStatus[],
    d: {
      resolution: 'FULL_REFUND' | 'PARTIAL_REFUND' | 'REPLACEMENT';
      refundAmount?: string;
      requiresReturnShipment: boolean;
      text: string | null;
    },
    context: RequestContext,
  ) {
    const items = itemsValue(row);
    // Staff may also give back the shipping fee; sellers refund up to the items' value.
    const max = actor.type === 'STAFF' ? items.add(shippingValue(row)) : items;
    let amount: Prisma.Decimal | null = null;
    if (d.resolution === 'FULL_REFUND') amount = items;
    if (d.resolution === 'PARTIAL_REFUND') {
      amount = D(d.refundAmount!);
      if (amount.lte(0) || amount.gt(max)) {
        throw validation('refundAmount', `Between ₱0.01 and ₱${max.toFixed(2)}.`);
      }
    }
    if (actor.type === 'STAFF' && d.resolution === 'FULL_REFUND' && d.refundAmount) {
      amount = D(d.refundAmount);
      if (amount.lte(0) || amount.gt(max))
        throw validation('refundAmount', `At most ₱${max.toFixed(2)}.`);
    }
    const refundId = await this.prisma.$transaction(async (tx) => {
      await this.moveInTx(
        tx,
        row,
        from,
        'APPROVED',
        {
          resolution: d.resolution,
          refundAmount: amount,
          requiresReturnShipment: d.requiresReturnShipment,
          ...(actor.type === 'SELLER'
            ? { sellerResponse: d.text, sellerRespondedAt: new Date() }
            : { staffDecisionNote: d.text, decidedById: actor.user.id }),
        },
        {
          actorType: actor.type,
          actorId: actor.user.id,
          note: `Return ${row.number} approved: ${d.resolution.replace('_', ' ').toLowerCase()}${amount ? ` ₱${amount.toFixed(2)}` : ''}`,
        },
      );
      await this.audit.record(
        {
          action: 'returns.approved',
          actorId: actor.user.id,
          entityType: 'return_request',
          entityId: row.id,
          metadata: {
            resolution: d.resolution,
            amount: amount?.toFixed(2) ?? null,
            by: actor.type,
          },
        },
        context,
        tx,
      );
      return d.requiresReturnShipment
        ? null
        : this.refundIfDueInTx(tx, row.id, actor.type === 'STAFF' ? actor.user.id : null);
    });
    if (refundId) await this.refunds.execute(refundId);
    await this.notifier.customer(
      row.orderId,
      'Return approved',
      d.requiresReturnShipment
        ? 'Your return was approved. Please send the item back and enter the tracking number on your order page.'
        : d.resolution === 'REPLACEMENT'
          ? 'Your return was approved; the seller will send a replacement.'
          : 'Your return was approved and your refund is on its way.',
    );
  }

  /** For refund resolutions: creates the refund and resolves the return. */
  private async refundIfDueInTx(
    tx: Tx,
    returnId: string,
    actorId: string | null,
  ): Promise<string | null> {
    const rr = await tx.returnRequest.findUniqueOrThrow({ where: { id: returnId } });
    if (rr.resolution !== 'FULL_REFUND' && rr.resolution !== 'PARTIAL_REFUND') return null;
    const refundId = await this.refunds.createForReturnInTx(tx, returnId, actorId);
    await tx.returnRequest.update({
      where: { id: returnId },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    return refundId;
  }

  private async move(
    row: ReturnRow,
    from: ReturnStatus[],
    to: ReturnStatus,
    data: Prisma.ReturnRequestUncheckedUpdateManyInput,
    event: { actorType: string; actorId: string; note: string },
  ) {
    await this.prisma.$transaction((tx) => this.moveInTx(tx, row, from, to, data, event));
  }

  /** Compare-and-set on the status, so two people acting at once cannot both succeed. */
  private async moveInTx(
    tx: Tx,
    row: Pick<ReturnRow, 'id' | 'orderId' | 'sellerOrderId'>,
    from: ReturnStatus[],
    to: ReturnStatus,
    data: Prisma.ReturnRequestUncheckedUpdateManyInput,
    event: { actorType: string; actorId: string; note: string },
  ) {
    await lockOrderInTx(tx, row.orderId);
    const { count } = await tx.returnRequest.updateMany({
      where: { id: row.id, status: { in: from } },
      data: { ...data, status: to },
    });
    if (count === 0)
      throw conflict('This return was just updated by someone else. Reload and try again.');
    await tx.orderEvent.create({
      data: {
        orderId: row.orderId,
        sellerOrderId: row.sellerOrderId,
        type: 'RETURN_UPDATED',
        actorType: event.actorType,
        actorId: event.actorId,
        note: event.note,
      },
    });
  }

  private async scoped(actor: Actor, id: string): Promise<ReturnRow> {
    const where: Prisma.ReturnRequestWhereInput = {
      id,
      ...(actor.type === 'CUSTOMER' ? { customerId: actor.user.id } : {}),
      ...(actor.type === 'SELLER' ? { sellerId: sellerScope(actor.user).sellerId } : {}),
    };
    const row = await this.prisma.returnRequest.findFirst({ where, include: returnInclude });
    if (!row) throw notFound();
    return row;
  }

  async get(actor: Actor, id: string): Promise<ReturnDto> {
    return this.dto(await this.scoped(actor, id));
  }

  async list(
    actor: Actor,
    query: { page: number; pageSize: number; status?: ReturnStatus; search?: string },
  ): Promise<PaginatedResponse<ReturnDto>> {
    const where: Prisma.ReturnRequestWhereInput = {
      ...(actor.type === 'CUSTOMER' ? { customerId: actor.user.id } : {}),
      ...(actor.type === 'SELLER' ? { sellerId: sellerScope(actor.user).sellerId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { number: { contains: query.search.toUpperCase() } },
              { order: { orderNumber: { contains: query.search.toUpperCase() } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.returnRequest.findMany({
        where,
        include: returnInclude,
        orderBy: [
          {
            createdAt:
              query.status === 'ESCALATED' || query.status === 'REQUESTED' ? 'asc' : 'desc',
          },
          { id: 'asc' },
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.returnRequest.count({ where }),
    ]);
    return {
      items: await Promise.all(rows.map((r) => this.dto(r))),
      page: query.page,
      pageSize: query.pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  private async dto(r: ReturnRow): Promise<ReturnDto> {
    const images = await Promise.all(
      r.images.map(async (i) => ({
        id: i.id,
        url: (await this.files.getDownloadUrl(i.fileId, FilePurpose.RETURN_IMAGE)).url,
      })),
    );
    return {
      id: r.id,
      number: r.number,
      orderId: r.orderId,
      orderNumber: r.order.orderNumber,
      sellerOrderId: r.sellerOrderId,
      sellerOrderNumber: r.sellerOrder.number,
      store: r.sellerOrder.store,
      customerName: `${r.customer.firstName} ${r.customer.lastName}`,
      status: r.status,
      reason: r.reason,
      description: r.description,
      requestedResolution: r.requestedResolution,
      resolution: r.resolution,
      refundAmount: r.refundAmount?.toFixed(2) ?? null,
      maxRefund: itemsValue(r).toFixed(2),
      requiresReturnShipment: r.requiresReturnShipment,
      sellerResponse: r.sellerResponse,
      sellerDeadline: r.sellerDeadline.toISOString(),
      escalationNote: r.escalationNote,
      staffDecisionNote: r.staffDecisionNote,
      restocked: r.restocked,
      items: r.items.map((ri) => ({
        orderItemId: ri.orderItemId,
        productName: ri.orderItem.productName,
        variantTitle: ri.orderItem.variantTitle,
        imageUrl: ri.orderItem.imageUrl,
        quantity: ri.quantity,
        amount: cents(ri.orderItem.lineTotal.mul(ri.quantity).div(ri.orderItem.quantity)).toFixed(
          2,
        ),
      })),
      images,
      shipments: r.shipments.map(shipmentDto),
      refunds: r.refunds.map(refundDto),
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    };
  }
}
