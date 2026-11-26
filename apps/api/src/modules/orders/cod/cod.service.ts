import { HttpStatus, Injectable } from '@nestjs/common';
import {
  lockOrderInTx,
  postCodFeeInTx,
  postCodRemittanceInTx,
  postSellerEarningsInTx,
  Prisma,
} from '@marketplace/database';
import type { AuthenticatedUser, Carrier, PaginatedResponse } from '@marketplace/shared-types';
import type {
  CodCollectionDto,
  RecordRemittanceRequest,
  RemittanceDto,
} from '@marketplace/validation';
import type { RequestContext } from '../../../common/auth/auth.decorators';
import { ApiException } from '../../../common/errors/api.exception';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

const conflict = (message: string) => new ApiException(HttpStatus.CONFLICT, 'CONFLICT', message);
const m = (d: Prisma.Decimal) => d.toFixed(2);

const collectionInclude = {
  sellerOrder: {
    select: { number: true, seller: { select: { businessName: true } } },
  },
  shipment: { select: { trackingNumber: true } },
} satisfies Prisma.CodCollectionInclude;

function collectionDto(
  c: Prisma.CodCollectionGetPayload<{ include: typeof collectionInclude }>,
): CodCollectionDto {
  return {
    id: c.id,
    sellerOrderId: c.sellerOrderId,
    sellerOrderNumber: c.sellerOrder.number,
    orderId: c.orderId,
    carrier: c.carrier,
    trackingNumber: c.shipment?.trackingNumber ?? null,
    sellerName: c.sellerOrder.seller.businessName,
    expectedAmount: m(c.expectedAmount),
    collectedAmount: c.collectedAmount ? m(c.collectedAmount) : null,
    status: c.status,
    collectedAt: c.collectedAt?.toISOString() ?? null,
    remittanceId: c.remittanceId,
  };
}

/**
 * After a COD collection fails (seller order cancelled or parcel returned): when no parcel
 * of the order is left to collect, the COD payment is settled with what was remitted
 * (PAID), or closed when nothing was (CANCELLED; the order's payment becomes VOIDED).
 */
export async function settleCodPaymentInTx(tx: Prisma.TransactionClient, orderId: string) {
  const [payment] = await tx.$queryRaw<
    { id: string; status: string; amount_received: Prisma.Decimal }[]
  >`
    SELECT "id", "status"::text, "amount_received" FROM "payments"
    WHERE "order_id" = ${orderId}::uuid AND "provider" = 'COD' AND "status" = 'PENDING' FOR UPDATE`;
  if (!payment) return;
  const open = await tx.codCollection.count({
    where: { orderId, status: { in: ['PENDING', 'COLLECTED'] } },
  });
  if (open > 0) return;
  const paid = new Prisma.Decimal(payment.amount_received).gt(0);
  await tx.payment.update({
    where: { id: payment.id },
    data: paid ? { status: 'PAID', paidAt: new Date() } : { status: 'CANCELLED' },
  });
  await tx.paymentEvent.create({
    data: {
      paymentId: payment.id,
      type: paid ? 'COD_SETTLED' : 'CANCELLED',
      fromStatus: 'PENDING',
      toStatus: paid ? 'PAID' : 'CANCELLED',
      data: { reason: 'No parcel left to collect.' },
    },
  });
  await tx.order.update({
    where: { id: orderId },
    data: { paymentStatus: paid ? 'PAID' : 'VOIDED' },
  });
}

/**
 * Cash on delivery. Each seller order of a COD order has a collection: PENDING until the
 * courier delivers, COLLECTED when the courier (or a self-delivering seller) took the cash,
 * REMITTED when finance confirms the courier paid it to the marketplace. Only remittance
 * counts as money received: the payment, the order's payment status and the seller's earnings
 * change then, never at delivery.
 */
@Injectable()
export class CodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async collections(query: {
    page: number;
    pageSize: number;
    status?: CodCollectionDto['status'];
    carrier?: Carrier;
  }): Promise<PaginatedResponse<CodCollectionDto>> {
    const where: Prisma.CodCollectionWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.carrier ? { carrier: query.carrier } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.codCollection.findMany({
        where,
        include: collectionInclude,
        orderBy: [{ collectedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.codCollection.count({ where }),
    ]);
    return {
      items: rows.map(collectionDto),
      page: query.page,
      pageSize: query.pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /**
   * Finance records a courier's remittance covering some collected parcels. The amount must
   * equal what those parcels collected, or come with an explanation (kept for follow-up).
   * The same courier reference cannot be recorded twice.
   */
  async recordRemittance(
    staff: AuthenticatedUser,
    input: RecordRemittanceRequest,
    context: RequestContext,
  ): Promise<RemittanceDto> {
    const ids = [...new Set(input.collectionIds)].sort();
    let remittanceId: string;
    try {
      remittanceId = await this.prisma.$transaction(
        async (tx) => {
          const orderIds = await tx.codCollection.findMany({
            where: { id: { in: ids } },
            select: { orderId: true },
            distinct: ['orderId'],
            orderBy: { orderId: 'asc' },
          });
          for (const o of orderIds) await lockOrderInTx(tx, o.orderId);
          const rows = await tx.$queryRaw<
            {
              id: string;
              order_id: string;
              seller_order_id: string;
              carrier: string | null;
              status: string;
              collected_amount: Prisma.Decimal | null;
            }[]
          >`SELECT "id", "order_id", "seller_order_id", "carrier"::text, "status"::text, "collected_amount"
            FROM "cod_collections" WHERE "id" = ANY(${ids}::uuid[]) ORDER BY "id" FOR UPDATE`;
          if (rows.length !== ids.length) throw conflict('Some collections were not found.');
          const wrong = rows.find((r) => r.status !== 'COLLECTED' || r.carrier !== input.carrier);
          if (wrong) {
            throw conflict(
              wrong.status !== 'COLLECTED'
                ? 'Only collected, not yet remitted parcels can be included.'
                : 'All parcels must have been delivered by the remitting courier.',
            );
          }
          const expected = rows.reduce(
            (s, r) => s.add(r.collected_amount ?? 0),
            new Prisma.Decimal(0),
          );
          const amount = new Prisma.Decimal(input.amount);
          if (!amount.eq(expected) && !input.discrepancyNote) {
            throw new ApiException(
              HttpStatus.UNPROCESSABLE_ENTITY,
              'VALIDATION_FAILED',
              `The parcels collected ₱${expected.toFixed(2)}; explain the difference.`,
              [{ path: 'discrepancyNote', message: 'Explain why the amount differs' }],
            );
          }
          const remittance = await tx.codRemittance.create({
            data: {
              carrier: input.carrier,
              reference: input.reference,
              remittedAt: new Date(input.remittedAt),
              amount,
              expectedAmount: expected,
              discrepancyNote: amount.eq(expected) ? null : input.discrepancyNote!,
              recordedById: staff.id,
            },
          });
          await tx.codCollection.updateMany({
            where: { id: { in: ids } },
            data: { status: 'REMITTED', remittanceId: remittance.id },
          });
          const now = new Date();
          await postCodRemittanceInTx(tx, remittance.id);
          const byOrder = new Map<string, typeof rows>();
          for (const r of rows) byOrder.set(r.order_id, [...(byOrder.get(r.order_id) ?? []), r]);
          for (const [orderId, collections] of [...byOrder].sort(([a], [b]) =>
            a.localeCompare(b),
          )) {
            const received = collections.reduce(
              (s, r) => s.add(r.collected_amount ?? 0),
              new Prisma.Decimal(0),
            );
            const [payment] = await tx.$queryRaw<{ id: string; status: string }[]>`
              SELECT "id", "status"::text FROM "payments"
              WHERE "order_id" = ${orderId}::uuid AND "provider" = 'COD' FOR UPDATE`;
            if (!payment) throw new Error(`COD order ${orderId} has no COD payment`);
            const open = await tx.codCollection.count({
              where: { orderId, status: { in: ['PENDING', 'COLLECTED'] } },
            });
            await tx.payment.update({
              where: { id: payment.id },
              data: {
                amountReceived: { increment: received },
                ...(open === 0 ? { status: 'PAID', paidAt: now } : {}),
              },
            });
            await tx.paymentEvent.create({
              data: {
                paymentId: payment.id,
                type: 'COD_REMITTED',
                fromStatus: payment.status as 'PENDING',
                toStatus: open === 0 ? 'PAID' : null,
                actorId: staff.id,
                data: { remittance: input.reference, amount: received.toFixed(2) },
              },
            });
            await tx.order.update({
              where: { id: orderId },
              data: { paymentStatus: open === 0 ? 'PAID' : 'PARTIALLY_PAID' },
            });
            for (const c of collections) {
              await postSellerEarningsInTx(tx, c.seller_order_id, now);
              await postCodFeeInTx(tx, c.id, now);
              await tx.orderEvent.create({
                data: {
                  orderId,
                  sellerOrderId: c.seller_order_id,
                  type: 'COD_REMITTED',
                  actorType: 'STAFF',
                  actorId: staff.id,
                  note: `₱${(c.collected_amount ?? new Prisma.Decimal(0)).toFixed(2)} remitted (${input.reference})`,
                },
              });
            }
          }
          await this.audit.record(
            {
              action: 'cod.remittance_recorded',
              actorId: staff.id,
              entityType: 'cod_remittance',
              entityId: remittance.id,
              metadata: {
                carrier: input.carrier,
                parcels: ids.length,
                discrepancy: !amount.eq(expected),
              },
            },
            context,
            tx,
          );
          return remittance.id;
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('A remittance with this courier reference was already recorded.');
      }
      throw error;
    }
    return (await this.remittances({ page: 1, pageSize: 1, id: remittanceId })).items[0]!;
  }

  async remittances(query: {
    page: number;
    pageSize: number;
    id?: string;
  }): Promise<PaginatedResponse<RemittanceDto>> {
    const where: Prisma.CodRemittanceWhereInput = query.id ? { id: query.id } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.codRemittance.findMany({
        where,
        include: {
          recordedBy: { select: { firstName: true, lastName: true } },
          _count: { select: { collections: true } },
        },
        orderBy: [{ remittedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.codRemittance.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        carrier: r.carrier,
        reference: r.reference,
        remittedAt: r.remittedAt.toISOString(),
        amount: m(r.amount),
        expectedAmount: m(r.expectedAmount),
        discrepancyNote: r.discrepancyNote,
        collections: r._count.collections,
        recordedBy: `${r.recordedBy.firstName} ${r.recordedBy.lastName}`,
        createdAt: r.createdAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }
}
