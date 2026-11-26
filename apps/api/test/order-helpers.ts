import type { INestApplication } from '@nestjs/common';
import type { PaymentMethod } from '@marketplace/shared-types';
import {
  mockPaymentSessionSchema,
  orderDetailSchema,
  type OrderDetail,
  sellerOrderDetailSchema,
  shipmentSchema,
} from '@marketplace/validation';
import request from 'supertest';
import { PaymentGatewaysService } from '../src/modules/orders/payments/payment-gateways.service';
import type { TestClient } from './auth-helpers';
import { placeOrder, type Shopper } from './shop-helpers';

/** The mock checkout session id is the last part of its checkout URL. */
export const sessionOf = (order: OrderDetail) => {
  const url = order.payment.attempts.find((a) => a.checkoutUrl)?.checkoutUrl;
  if (!url) throw new Error(`Order ${order.orderNumber} has no open checkout`);
  return url.split('/').pop()!;
};

/** Places an order (buy now) with the given method and returns its detail. */
export async function order(
  buyer: Shopper,
  items: { variantId: string; quantity: number }[],
  paymentMethod: PaymentMethod = 'GCASH',
): Promise<OrderDetail> {
  // Several items go through the cart (one seller order per store); one item is "buy now".
  if (items.length > 1) {
    for (const item of items) await buyer.client.post('/api/v1/cart/items').send(item).expect(200);
  }
  const res = await placeOrder(buyer.client, {
    addressId: buyer.addressId,
    ...(items.length === 1 ? { buyNow: items[0]! } : {}),
    paymentMethod,
  });
  if (res.status !== 201)
    throw new Error(`Order failed ${res.status}: ${JSON.stringify(res.body)}`);
  return orderDetailSchema.parse(res.body);
}

/** The customer completes the mock checkout page (a signed webhook is processed). */
export async function payMock(
  client: TestClient,
  detail: OrderDetail,
  outcome: 'paid' | 'failed' = 'paid',
) {
  const res = await client
    .post(`/api/v1/dev/mock-payments/${sessionOf(detail)}`)
    .send({ outcome })
    .expect(200);
  return mockPaymentSessionSchema.parse(res.body);
}

export async function orderOf(client: TestClient, id: string) {
  return orderDetailSchema.parse(
    (await client.get(`/api/v1/account/orders/${id}`).expect(200)).body,
  );
}

export async function sellerOrderOf(client: TestClient, id: string) {
  return sellerOrderDetailSchema.parse(
    (await client.get(`/api/v1/seller/orders/${id}`).expect(200)).body,
  );
}

/** Delivers a signed mock-provider event over HTTP, as the provider would. */
export function deliverMockEvent(
  app: INestApplication,
  event: unknown,
  tamper?: (raw: string) => string,
) {
  const signed = app.get(PaymentGatewaysService).mock!.sign(event);
  const raw = signed.rawBody.toString();
  return request(app.getHttpServer())
    .post('/api/v1/payments/webhooks/mock')
    .set(signed.headers)
    .set('Content-Type', 'application/json')
    .send(tamper ? tamper(raw) : raw);
}

/** Seller accepts and books the mock courier; returns the shipment. */
export async function acceptAndShip(seller: TestClient, sellerOrderId: string) {
  await seller.post(`/api/v1/seller/orders/${sellerOrderId}/accept`).expect(200);
  return shipmentSchema.parse(
    (
      await seller
        .post(`/api/v1/seller/orders/${sellerOrderId}/shipments`)
        .send({ carrier: 'MOCK' })
        .expect(200)
    ).body,
  );
}

/** Staff make the mock courier report a status (through its signed webhook). */
export async function courier(
  staff: TestClient,
  shipmentId: string,
  status: string,
  codCollected?: string,
) {
  return shipmentSchema.parse(
    (
      await staff
        .post(`/api/v1/shipments/${shipmentId}/simulate`)
        .send({ status, ...(codCollected ? { codCollected } : {}) })
        .expect(200)
    ).body,
  );
}
