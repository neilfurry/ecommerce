import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ConcurrentUpdateError,
  FilePurpose,
  InvalidTransitionError,
  lockOrderInTx,
  postCodCollectedInTx,
  postShippingCreditIfDueInTx,
  Prisma,
  transitionSellerOrderInTx,
} from '@marketplace/database';
import {
  type AuthenticatedUser,
  type Carrier,
  type OrderActor,
  CARRIER_LABELS,
  CARRIERS,
  type PaginatedResponse,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUSES,
  SHIPMENT_TO_SELLER_ORDER_STATUS,
  SHIPMENT_TRANSITIONS,
  type SellerOrderStatus,
  type ShipmentStatus,
} from '@marketplace/shared-types';
import type {
  BookShipmentRequest,
  CarrierStatus,
  OrderAddress,
  ShipmentDto,
  ShipmentUpdateRequest,
} from '@marketplace/validation';
import type { RequestContext } from '../../../common/auth/auth.decorators';
import { ApiException } from '../../../common/errors/api.exception';
import { AppConfig } from '../../../config/app-config';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { FilesService } from '../../files/files.service';
import { InventoryService } from '../../inventory/inventory.service';
import { PlatformSettingsService } from '../../settings/platform-settings.service';
import { settleCodPaymentInTx } from '../cod/cod.service';
import { shipmentDto } from '../order-mapping';
import { OrderNotifier } from '../order-notifier.service';
import { convertSellerOrderStockInTx, restockItemsInTx } from '../order-stock';
import { RefundsService } from '../refunds/refunds.service';
import {
  type CourierAdapter,
  CourierSignatureError,
  MockCourier,
  PreparedCourier,
  SelfDelivery,
} from './couriers';
import { waybillPdf } from './waybill-pdf';

type Tx = Prisma.TransactionClient;

const notFound = (what = 'Shipment') =>
  new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found.`);
const conflict = (message: string) => new ApiException(HttpStatus.CONFLICT, 'CONFLICT', message);
const invalid = (message: string) =>
  new ApiException(HttpStatus.CONFLICT, 'INVALID_TRANSITION', message);

/** Who reported a shipment status. */
export type ShipmentSource = 'CARRIER' | 'SELLER' | 'STAFF' | 'CUSTOMER' | 'SYSTEM';
const ACTOR_OF: Record<ShipmentSource, OrderActor> = {
  CARRIER: 'COURIER',
  SELLER: 'SELLER',
  STAFF: 'STAFF',
  CUSTOMER: 'CUSTOMER',
  SYSTEM: 'SYSTEM',
};

interface StatusUpdate {
  status: ShipmentStatus;
  description?: string | null;
  location?: string | null;
  occurredAt?: Date;
  source: ShipmentSource;
  externalEventId?: string | null;
  actorId?: string | null;
  codCollected?: string | null;
}

/** Work to do after the transaction commits. */
interface AfterCommit {
  stockLevelIds: string[];
  refundIds: string[];
  notify: { sellerOrderId: string; orderId: string; status: ShipmentStatus } | null;
}

/** How the seller order must move for a shipment status (intermediate steps included). */
export function sellerOrderPath(
  from: SellerOrderStatus,
  target: SellerOrderStatus,
): SellerOrderStatus[] {
  if (from === target) return [];
  const ladder: Partial<Record<SellerOrderStatus, SellerOrderStatus[]>> = {
    // A courier may skip "picked up" and report the parcel already moving or delivered.
    DELIVERED: from === 'READY_FOR_PICKUP' ? ['SHIPPED', 'DELIVERED'] : ['DELIVERED'],
    DELIVERY_FAILED:
      from === 'READY_FOR_PICKUP' ? ['SHIPPED', 'DELIVERY_FAILED'] : ['DELIVERY_FAILED'],
    RETURNING_TO_SELLER:
      from === 'READY_FOR_PICKUP' ? ['SHIPPED', 'RETURNING_TO_SELLER'] : ['RETURNING_TO_SELLER'],
    RETURNED_TO_SELLER:
      from === 'RETURNING_TO_SELLER'
        ? ['RETURNED_TO_SELLER']
        : from === 'READY_FOR_PICKUP'
          ? ['SHIPPED', 'RETURNING_TO_SELLER', 'RETURNED_TO_SELLER']
          : ['RETURNING_TO_SELLER', 'RETURNED_TO_SELLER'],
  };
  return ladder[target] ?? [target];
}

/**
 * Shipments: booking with a courier (the mock courier locally, or a delivery the seller
 * arranged and tracks), waybills, tracking updates and what they mean for the seller order,
 * stock and cash on delivery.
 */
@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);
  readonly mockCourier: MockCourier;
  private readonly adapters: Record<Carrier, CourierAdapter>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly files: FilesService,
    private readonly inventory: InventoryService,
    private readonly refunds: RefundsService,
    private readonly audit: AuditService,
    private readonly notifier: OrderNotifier,
    config: AppConfig,
  ) {
    this.mockCourier = new MockCourier(
      `${config.payments.mockWebhookSecret}:courier`,
      config.isProduction,
    );
    this.adapters = {
      MOCK: this.mockCourier,
      SELF: new SelfDelivery(),
      JNT: new PreparedCourier('JNT'),
      LBC: new PreparedCourier('LBC'),
      NINJA_VAN: new PreparedCourier('NINJA_VAN'),
      FLASH: new PreparedCourier('FLASH'),
      TWO_GO: new PreparedCourier('TWO_GO'),
    };
  }

  /** Whether a courier has an integration ready to book (used by the settings page). */
  carrierAvailable = (carrier: Carrier) => this.adapters[carrier].unavailableReason() === null;

  async carriers(): Promise<{ items: CarrierStatus[] }> {
    const enabled = (await this.settings.orders()).carriers;
    return {
      items: CARRIERS.map((carrier) => {
        const adapter = this.adapters[carrier];
        const reason = adapter.unavailableReason();
        return {
          carrier,
          label: CARRIER_LABELS[carrier],
          enabled: reason === null && (enabled[carrier] ?? false),
          available: reason === null,
          livemode: adapter.livemode,
          note: reason,
        };
      }),
    };
  }

  // ---- Booking -------------------------------------------------------------------------------

  /**
   * Books the delivery of a seller order the seller has accepted (PROCESSING). The mock
   * courier returns a tracking number and a test label; a self-arranged delivery records the
   * seller's courier and tracking number. The seller order becomes Ready for pickup.
   */
  async book(
    actor: { source: 'SELLER' | 'STAFF'; user: AuthenticatedUser; sellerId: string | null },
    sellerOrderId: string,
    input: BookShipmentRequest,
    context: RequestContext,
  ): Promise<ShipmentDto> {
    const so = await this.prisma.sellerOrder.findFirst({
      where: { id: sellerOrderId, ...(actor.sellerId ? { sellerId: actor.sellerId } : {}) },
      include: {
        order: { select: { orderNumber: true, paymentMethod: true, shippingAddress: true } },
        shippingGroup: true,
        store: { select: { name: true } },
        items: { select: { productName: true, quantity: true } },
        codCollection: true,
      },
    });
    if (!so) throw notFound('Order');
    if (so.status !== 'PROCESSING') {
      throw invalid(
        'Accept the order first; a shipment can be booked while it is being processed.',
      );
    }
    const carrier = input.carrier;
    const adapter = this.adapters[carrier];
    const unavailable = adapter.unavailableReason();
    if (unavailable) throw conflict(unavailable);
    const enabled = (await this.settings.orders()).carriers;
    if (!enabled[carrier])
      throw conflict(`${CARRIER_LABELS[carrier]} is not enabled by the marketplace.`);

    const address = so.order.shippingAddress as unknown as OrderAddress;
    const origin = (so.shippingGroup?.origin ?? {}) as { label?: string };
    const codAmount =
      so.order.paymentMethod === 'COD' ? (so.codCollection?.expectedAmount ?? so.total) : null;
    const itemsText = so.items.map((i) => `${i.quantity} x ${i.productName}`).join(', ');
    const weightGrams = so.shippingGroup?.chargeableWeightGrams ?? 500;
    let parcel: { trackingNumber: string; providerShipmentId: string | null };
    if (carrier === 'SELF') {
      parcel = { trackingNumber: input.trackingNumber!.toUpperCase(), providerShipmentId: null };
    } else {
      try {
        parcel = await adapter.book({
          reference: so.number,
          serviceName: so.shippingGroup?.serviceName ?? 'Standard',
          origin: { label: origin.label ?? '', contact: so.store.name },
          destination: {
            label: address.formatted,
            recipient: address.recipientName,
            mobile: address.mobile,
          },
          weightGrams,
          codAmount: codAmount?.toFixed(2) ?? null,
          items: itemsText,
        });
      } catch (error) {
        throw new ApiException(
          HttpStatus.BAD_GATEWAY,
          'PROVIDER_ERROR',
          `${CARRIER_LABELS[carrier]} could not book the shipment: ${(error as Error).message}`,
        );
      }
    }

    // The label is generated before the transaction (object storage is not transactional).
    let waybillFileId: string | null = null;
    if (carrier !== 'SELF') {
      const pdf = waybillPdf({
        carrierLabel: CARRIER_LABELS[carrier],
        trackingNumber: parcel.trackingNumber,
        reference: so.number,
        serviceName: so.shippingGroup?.serviceName ?? 'Standard',
        codAmount: codAmount ? `PHP ${codAmount.toFixed(2)}` : null,
        from: [so.store.name, origin.label ?? ''],
        to: [address.recipientName, address.mobile, address.formatted],
        items: itemsText,
        weightKg: (weightGrams / 1000).toFixed(2),
        test: !adapter.livemode,
      });
      const stored = await this.files.upload({
        buffer: pdf,
        originalName: `waybill-${parcel.trackingNumber}.pdf`,
        purpose: FilePurpose.WAYBILL,
      });
      waybillFileId = stored.id;
    }

    let shipmentId: string;
    try {
      shipmentId = await this.prisma.$transaction(async (tx) => {
        await lockOrderInTx(tx, so.orderId);
        const shipment = await tx.shipment.create({
          data: {
            sellerOrderId,
            direction: 'FORWARD',
            carrier,
            carrierName: carrier === 'SELF' ? input.carrierName! : CARRIER_LABELS[carrier],
            serviceName: so.shippingGroup?.serviceName ?? 'Standard',
            trackingNumber: parcel.trackingNumber,
            providerShipmentId: parcel.providerShipmentId,
            status: 'BOOKED',
            codAmount: codAmount ?? 0,
            waybillFileId,
            weightGrams,
            origin: { label: origin.label ?? '', store: so.store.name },
            destination: { label: address.formatted, recipient: address.recipientName },
            livemode: adapter.livemode,
            bookedById: actor.user.id,
            lastEventAt: new Date(),
            events: {
              create: {
                status: 'BOOKED',
                description:
                  carrier === 'SELF'
                    ? `Handed to ${input.carrierName} by the seller`
                    : 'Shipment booked; waiting for pickup',
                occurredAt: new Date(),
                source: actor.source,
                actorId: actor.user.id,
              },
            },
          },
        });
        if (so.codCollection) {
          await tx.codCollection.update({
            where: { id: so.codCollection.id },
            data: { shipmentId: shipment.id, carrier },
          });
        }
        await transitionSellerOrderInTx(tx, {
          sellerOrderId,
          to: 'READY_FOR_PICKUP',
          actor: actor.source,
          actorId: actor.user.id,
          expectedFrom: ['PROCESSING'],
          eventType: 'SHIPMENT_CREATED',
          note: `${carrier === 'SELF' ? input.carrierName : CARRIER_LABELS[carrier]} ${parcel.trackingNumber}`,
        });
        await postShippingCreditIfDueInTx(tx, sellerOrderId);
        await this.audit.record(
          {
            action: 'shipments.booked',
            actorId: actor.user.id,
            entityType: 'shipment',
            entityId: shipment.id,
            metadata: { carrier, sellerOrder: so.number },
          },
          context,
          tx,
        );
        return shipment.id;
      });
    } catch (error) {
      if (waybillFileId)
        await this.files.delete(waybillFileId, FilePurpose.WAYBILL).catch(() => undefined);
      if (carrier !== 'SELF') await adapter.cancel(parcel.trackingNumber).catch(() => undefined);
      throw this.translate(error, 'This order already has an active shipment.');
    }
    return this.get(shipmentId);
  }

  /** Cancels a booked shipment before pickup; the seller order goes back to Processing. */
  async cancel(
    actor: { source: 'SELLER' | 'STAFF'; user: AuthenticatedUser; sellerId: string | null },
    shipmentId: string,
    context: RequestContext,
  ): Promise<ShipmentDto> {
    const shipment = await this.prisma.shipment.findFirst({
      where: {
        id: shipmentId,
        ...(actor.sellerId ? { sellerOrder: { sellerId: actor.sellerId } } : {}),
      },
    });
    if (!shipment) throw notFound();
    if (shipment.status !== 'BOOKED')
      throw invalid('Only shipments waiting for pickup can be cancelled.');
    try {
      await this.adapters[shipment.carrier].cancel(shipment.trackingNumber);
    } catch (error) {
      throw new ApiException(HttpStatus.BAD_GATEWAY, 'PROVIDER_ERROR', (error as Error).message);
    }
    await this.prisma.$transaction(async (tx) => {
      const owner = await tx.sellerOrder.findUniqueOrThrow({
        where: { id: shipment.sellerOrderId },
        select: { orderId: true },
      });
      await lockOrderInTx(tx, owner.orderId);
      const { count } = await tx.shipment.updateMany({
        where: { id: shipmentId, status: 'BOOKED' },
        data: { status: 'CANCELLED', lastEventAt: new Date() },
      });
      if (count === 0) throw conflict('The shipment was just updated; reload and try again.');
      await tx.shipmentEvent.create({
        data: {
          shipmentId,
          status: 'CANCELLED',
          description: 'Booking cancelled',
          occurredAt: new Date(),
          source: actor.source,
          actorId: actor.user.id,
        },
      });
      await tx.codCollection.updateMany({
        where: { shipmentId, status: 'PENDING' },
        data: { shipmentId: null, carrier: null },
      });
      if (shipment.direction === 'FORWARD' && !shipment.returnRequestId) {
        await transitionSellerOrderInTx(tx, {
          sellerOrderId: shipment.sellerOrderId,
          to: 'PROCESSING',
          actor: actor.source,
          actorId: actor.user.id,
          expectedFrom: ['READY_FOR_PICKUP'],
          eventType: 'SHIPMENT_UPDATED',
          note: `Shipment ${shipment.trackingNumber} cancelled`,
        });
      }
      await this.audit.record(
        {
          action: 'shipments.cancelled',
          actorId: actor.user.id,
          entityType: 'shipment',
          entityId: shipmentId,
        },
        context,
        tx,
      );
    });
    return this.get(shipmentId);
  }

  // ---- Status updates ------------------------------------------------------------------------

  /**
   * A status reported by a seller (self-arranged deliveries) or staff (any shipment, e.g.
   * from the courier's portal). Moves that the shipment state machine does not allow are refused.
   */
  async update(
    actor: { source: 'SELLER' | 'STAFF'; user: AuthenticatedUser; sellerId: string | null },
    shipmentId: string,
    input: ShipmentUpdateRequest,
  ): Promise<ShipmentDto> {
    const shipment = await this.prisma.shipment.findFirst({
      where: {
        id: shipmentId,
        ...(actor.sellerId ? { sellerOrder: { sellerId: actor.sellerId } } : {}),
      },
    });
    if (!shipment) throw notFound();
    if (actor.source === 'SELLER' && shipment.carrier !== 'SELF') {
      throw conflict('Courier shipments are updated by the courier’s tracking.');
    }
    await this.applyAndFollowUp(
      shipmentId,
      {
        status: input.status,
        description: input.description ?? null,
        location: input.location ?? null,
        source: actor.source,
        actorId: actor.user.id,
      },
      true,
    );
    return this.get(shipmentId);
  }

  /** The customer confirms a self-arranged delivery arrived. */
  async confirmReceived(customerId: string, sellerOrderId: string): Promise<void> {
    const shipment = await this.prisma.shipment.findFirst({
      where: {
        sellerOrderId,
        direction: 'FORWARD',
        returnRequestId: null,
        status: { notIn: ['CANCELLED', 'DELIVERED', 'RETURNING', 'RETURNED'] },
        sellerOrder: { order: { customerId } },
      },
    });
    if (!shipment) throw notFound('Shipment');
    if (shipment.carrier !== 'SELF') {
      throw conflict('Courier deliveries are confirmed by the courier.');
    }
    await this.applyAndFollowUp(
      shipment.id,
      {
        status: 'DELIVERED',
        description: 'Received by the customer',
        source: 'CUSTOMER',
        actorId: customerId,
      },
      true,
    );
  }

  /** Signed tracking update from a courier (only the mock courier has webhooks today). */
  async courierWebhook(
    carrier: 'MOCK',
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer | undefined,
  ): Promise<{ received: true; duplicate: boolean }> {
    if (!rawBody)
      throw new ApiException(HttpStatus.BAD_REQUEST, 'BAD_REQUEST', 'Empty webhook body.');
    const adapter = this.adapters[carrier];
    if (adapter.unavailableReason()) throw notFound('Webhook endpoint');
    let events;
    try {
      events = adapter.parseWebhook(headers, rawBody);
    } catch (error) {
      if (error instanceof CourierSignatureError) {
        this.logger.warn(`Courier webhook refused: ${error.message}`);
        throw new ApiException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Invalid signature.');
      }
      throw error;
    }
    let duplicate = true;
    for (const event of events) {
      if (!SHIPMENT_STATUSES.includes(event.status)) continue;
      const source = 'mock-courier';
      try {
        await this.prisma.webhookEvent.create({
          data: {
            source,
            eventId: event.eventId.slice(0, 160),
            eventType: `shipment.${event.status.toLowerCase()}`,
            payload: { ...event, occurredAt: event.occurredAt.toISOString() },
          },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
          throw error;
        const existing = await this.prisma.webhookEvent.findUniqueOrThrow({
          where: { source_eventId: { source, eventId: event.eventId.slice(0, 160) } },
        });
        if (existing.status === 'PROCESSED' || existing.status === 'IGNORED') continue;
      }
      duplicate = false;
      const shipment = await this.prisma.shipment.findFirst({
        where: { carrier, trackingNumber: event.trackingNumber },
        select: { id: true },
      });
      const mark = (status: 'PROCESSED' | 'IGNORED' | 'FAILED', error: string | null) =>
        this.prisma.webhookEvent.update({
          where: { source_eventId: { source, eventId: event.eventId.slice(0, 160) } },
          data: {
            status,
            error,
            attempts: { increment: 1 },
            processedAt: status === 'FAILED' ? null : new Date(),
          },
        });
      if (!shipment) {
        await mark('IGNORED', 'No shipment has this tracking number.');
        continue;
      }
      try {
        const applied = await this.applyAndFollowUp(
          shipment.id,
          {
            status: event.status,
            description: event.description || null,
            location: event.location,
            occurredAt: event.occurredAt,
            source: 'CARRIER',
            externalEventId: event.eventId,
            codCollected: event.codCollected,
          },
          false,
        );
        await mark(
          applied ? 'PROCESSED' : 'IGNORED',
          applied ? null : 'Status not applicable now (recorded in history).',
        );
      } catch (error) {
        await mark('FAILED', (error as Error).message.slice(0, 1000)).catch(() => undefined);
        throw new ApiException(
          HttpStatus.INTERNAL_SERVER_ERROR,
          'INTERNAL_ERROR',
          'Event not processed; retry.',
        );
      }
    }
    return { received: true, duplicate };
  }

  /** Staff (development): the mock courier reports a status, through the signed webhook path. */
  async simulate(shipmentId: string, status: ShipmentStatus, codCollected?: string) {
    const shipment = await this.prisma.shipment.findUnique({ where: { id: shipmentId } });
    if (!shipment) throw notFound();
    if (shipment.carrier !== 'MOCK')
      throw conflict('Only mock courier shipments can be simulated.');
    if (this.mockCourier.unavailableReason()) throw notFound();
    const signed = this.mockCourier.sign({
      trackingNumber: shipment.trackingNumber,
      status,
      description: SHIPMENT_STATUS_LABELS[status],
      location: status === 'DELIVERED' ? 'Recipient address' : 'Mock hub',
      codCollected:
        status === 'DELIVERED' && shipment.codAmount.gt(0)
          ? (codCollected ?? shipment.codAmount.toFixed(2))
          : null,
    });
    await this.courierWebhook('MOCK', signed.headers, signed.rawBody);
    return this.get(shipmentId);
  }

  /** Applies a status in one transaction, then does the follow-up work. Returns whether applied. */
  private async applyAndFollowUp(
    shipmentId: string,
    update: StatusUpdate,
    strict: boolean,
  ): Promise<boolean> {
    const returnWindowDays = (await this.settings.orders()).returns.windowDays;
    const after: AfterCommit = { stockLevelIds: [], refundIds: [], notify: null };
    let applied: boolean;
    try {
      applied = await this.prisma.$transaction(
        (tx) => this.applyStatusInTx(tx, shipmentId, update, { strict, returnWindowDays, after }),
        { timeout: 20_000 },
      );
    } catch (error) {
      throw this.translate(error);
    }
    if (after.stockLevelIds.length > 0) await this.inventory.checkLowStock(after.stockLevelIds);
    for (const id of after.refundIds) await this.refunds.execute(id);
    if (after.notify) await this.notifyStatus(after.notify);
    return applied;
  }

  /**
   * The heart of tracking: records the event (once per courier event id), moves the
   * shipment if the move is allowed, and for a delivery shipment moves its seller order:
   * picked up → Shipped (held stock leaves the warehouse), delivered → Delivered (return
   * window starts; cash on delivery becomes collected), returned → Returned to seller (stock
   * back, cash on delivery not collected, paid money refunded).
   */
  async applyStatusInTx(
    tx: Tx,
    shipmentId: string,
    update: StatusUpdate,
    options: { strict: boolean; returnWindowDays: number; after: AfterCommit },
  ): Promise<boolean> {
    const owner = await tx.shipment.findUnique({
      where: { id: shipmentId },
      select: { sellerOrder: { select: { orderId: true } } },
    });
    if (owner) await lockOrderInTx(tx, owner.sellerOrder.orderId);
    const [shipment] = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "shipments" WHERE "id" = ${shipmentId}::uuid FOR UPDATE`;
    if (!shipment) throw notFound();
    const row = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    if (update.externalEventId) {
      const seen = await tx.shipmentEvent.count({
        where: { shipmentId, externalEventId: update.externalEventId },
      });
      if (seen > 0) return false;
    }
    const occurredAt = update.occurredAt ?? new Date();
    const from = row.status as ShipmentStatus;
    const allowed = SHIPMENT_TRANSITIONS[from].includes(update.status);
    await tx.shipmentEvent.create({
      data: {
        shipmentId,
        status: update.status,
        description: (update.description || SHIPMENT_STATUS_LABELS[update.status]).slice(0, 300),
        location: update.location ?? null,
        occurredAt,
        source: update.source,
        externalEventId: update.externalEventId ?? null,
        actorId: update.actorId ?? null,
      },
    });
    if (!allowed) {
      if (options.strict) {
        throw invalid(
          `A shipment that is "${SHIPMENT_STATUS_LABELS[from]}" cannot become "${SHIPMENT_STATUS_LABELS[update.status]}".`,
        );
      }
      // Out-of-order or late courier events stay in the history without moving anything.
      return false;
    }
    await tx.shipment.update({
      where: { id: shipmentId },
      data: {
        status: update.status,
        lastEventAt: occurredAt,
        ...(update.status === 'PICKED_UP' || (from === 'BOOKED' && !row.pickedUpAt)
          ? { pickedUpAt: row.pickedUpAt ?? occurredAt }
          : {}),
        ...(update.status === 'DELIVERED' ? { deliveredAt: occurredAt } : {}),
        ...(update.status === 'DELIVERY_FAILED' ? { failedAttempts: { increment: 1 } } : {}),
      },
    });

    if (row.direction === 'FORWARD' && !row.returnRequestId) {
      await this.followSellerOrderInTx(tx, row, update, options);
    } else if (row.returnRequestId && update.status === 'DELIVERED') {
      // Return parcels reaching the seller and replacement parcels reaching the customer.
      if (row.direction === 'RETURN') {
        await tx.orderEvent.create({
          data: {
            orderId: (
              await tx.sellerOrder.findUniqueOrThrow({
                where: { id: row.sellerOrderId },
                select: { orderId: true },
              })
            ).orderId,
            sellerOrderId: row.sellerOrderId,
            type: 'RETURN_UPDATED',
            actorType: ACTOR_OF[update.source],
            note: `Returned parcel ${row.trackingNumber} delivered to the seller`,
          },
        });
      } else {
        await tx.returnRequest.updateMany({
          where: { id: row.returnRequestId, status: { in: ['APPROVED', 'RECEIVED'] } },
          data: { status: 'RESOLVED', resolvedAt: occurredAt },
        });
      }
    }
    return true;
  }

  private async followSellerOrderInTx(
    tx: Tx,
    shipment: Prisma.ShipmentGetPayload<object>,
    update: StatusUpdate,
    options: { returnWindowDays: number; after: AfterCommit },
  ) {
    const so = await tx.sellerOrder.findUniqueOrThrow({
      where: { id: shipment.sellerOrderId },
      select: { id: true, orderId: true, status: true },
    });
    const target = SHIPMENT_TO_SELLER_ORDER_STATUS[update.status];
    if (!target) return;
    const actor = ACTOR_OF[update.source];
    let status = so.status as SellerOrderStatus;
    for (const step of sellerOrderPath(status, target)) {
      if (step === 'SHIPPED' && status === 'READY_FOR_PICKUP') {
        options.after.stockLevelIds.push(
          ...(await convertSellerOrderStockInTx(tx, so.id, update.actorId ?? null)),
        );
      }
      await transitionSellerOrderInTx(tx, {
        sellerOrderId: so.id,
        to: step,
        actor,
        actorId: update.actorId ?? null,
        expectedFrom: [status],
        eventType: 'SHIPMENT_UPDATED',
        note: `${shipment.trackingNumber}: ${SHIPMENT_STATUS_LABELS[update.status]}`,
        returnWindowDays: options.returnWindowDays,
      });
      status = step;
    }
    if (target === 'DELIVERED') {
      const collected = await tx.codCollection.updateMany({
        where: { sellerOrderId: so.id, status: 'PENDING' },
        data: {
          status: 'COLLECTED',
          collectedAt: update.occurredAt ?? new Date(),
          ...(update.codCollected
            ? { collectedAmount: new Prisma.Decimal(update.codCollected) }
            : {}),
        },
      });
      if (collected.count > 0) {
        // Without an amount from the courier, the expected amount is taken as collected.
        await tx.$executeRaw`
          UPDATE "cod_collections" SET "collected_amount" = "expected_amount"
          WHERE "seller_order_id" = ${so.id}::uuid AND "collected_amount" IS NULL`;
        const collection = await tx.codCollection.findUniqueOrThrow({
          where: { sellerOrderId: so.id },
          select: { id: true },
        });
        await postCodCollectedInTx(tx, collection.id);
        await tx.orderEvent.create({
          data: {
            orderId: so.orderId,
            sellerOrderId: so.id,
            type: 'COD_COLLECTED',
            actorType: actor,
            note: 'Cash collected on delivery; waiting for the courier’s remittance.',
          },
        });
      }
    }
    if (target === 'RETURNED_TO_SELLER') {
      const items = await tx.orderItem.findMany({
        where: { sellerOrderId: so.id },
        select: { id: true, quantity: true },
      });
      await restockItemsInTx(
        tx,
        items.map((i) => ({ orderItemId: i.id, quantity: i.quantity })),
        true,
        `Parcel ${shipment.trackingNumber} returned undelivered`,
        update.actorId ?? null,
      );
      await tx.codCollection.updateMany({
        where: { sellerOrderId: so.id, status: 'PENDING' },
        data: { status: 'FAILED' },
      });
      await settleCodPaymentInTx(tx, so.orderId);
      const refundId = await this.refunds.createForCancellationInTx(tx, so.id, null);
      if (refundId) options.after.refundIds.push(refundId);
    }
    if (['SHIPPED', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNED_TO_SELLER'].includes(target)) {
      options.after.notify = { sellerOrderId: so.id, orderId: so.orderId, status: update.status };
    }
  }

  private async notifyStatus(n: NonNullable<AfterCommit['notify']>) {
    // Shipped and delivered are ORDER_SHIPPED / ORDER_DELIVERED notification events, written
    // with the status change (see onSellerOrderStatusInTx); kick their delivery.
    await this.notifier.kick();
    const messages: Partial<Record<ShipmentStatus, [string, string]>> = {
      DELIVERY_FAILED: [
        'Delivery attempt failed',
        'The courier could not deliver a parcel from your order. They will try again or contact you.',
      ],
      RETURNED: [
        'Parcel returned to the seller',
        'A parcel could not be delivered and went back to the seller. Any payment for it will be refunded.',
      ],
    };
    const message = messages[n.status];
    if (message) await this.notifier.customer(n.orderId, message[0], message[1]);
    if (n.status === 'DELIVERY_FAILED' || n.status === 'RETURNED') {
      await this.notifier.seller(
        n.sellerOrderId,
        message![0],
        `Shipment update: ${SHIPMENT_STATUS_LABELS[n.status]}.`,
      );
    }
  }

  // ---- Views ---------------------------------------------------------------------------------

  async get(id: string): Promise<ShipmentDto> {
    const row = await this.prisma.shipment.findUnique({
      where: { id },
      include: { events: { orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (!row) throw notFound();
    return shipmentDto(row);
  }

  /** The label PDF, for the shipment's seller or staff. */
  async waybill(id: string, sellerId: string | null) {
    const row = await this.prisma.shipment.findFirst({
      where: { id, ...(sellerId ? { sellerOrder: { sellerId } } : {}) },
      select: { waybillFileId: true },
    });
    if (!row?.waybillFileId) throw notFound('Waybill');
    return this.files.openContent(row.waybillFileId, FilePurpose.WAYBILL);
  }

  async list(query: {
    page: number;
    pageSize: number;
    status?: ShipmentStatus;
    carrier?: Carrier;
    search?: string;
  }): Promise<
    PaginatedResponse<
      ShipmentDto & {
        sellerOrder: { id: string; number: string; status: SellerOrderStatus };
        seller: { id: string; businessName: string };
      }
    >
  > {
    const where: Prisma.ShipmentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.carrier ? { carrier: query.carrier } : {}),
      ...(query.search
        ? {
            OR: [
              { trackingNumber: { contains: query.search.toUpperCase() } },
              { sellerOrder: { number: { contains: query.search.toUpperCase() } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.shipment.findMany({
        where,
        include: {
          events: { orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }] },
          sellerOrder: {
            select: {
              id: true,
              number: true,
              status: true,
              seller: { select: { id: true, businessName: true } },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.shipment.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        ...shipmentDto(r),
        sellerOrder: {
          id: r.sellerOrder.id,
          number: r.sellerOrder.number,
          status: r.sellerOrder.status,
        },
        seller: r.sellerOrder.seller,
      })),
      page: query.page,
      pageSize: query.pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /** Database and state-machine errors as API errors. */
  translate(error: unknown, uniqueMessage = 'This was just changed by someone else.'): unknown {
    if (error instanceof InvalidTransitionError) return invalid(error.message);
    if (error instanceof ConcurrentUpdateError) return conflict(error.message);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return conflict(uniqueMessage);
    }
    return error;
  }
}
