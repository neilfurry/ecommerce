import {
  canTransition,
  nextStatuses,
  SELLER_ORDER_STATUSES,
  SELLER_ORDER_TRANSITIONS,
  SHIPMENT_STATUSES,
  SHIPMENT_TO_SELLER_ORDER_STATUS,
  SHIPMENT_TRANSITIONS,
} from '@marketplace/shared-types';
import { CourierSignatureError, MockCourier, PreparedCourier } from './shipments/couriers';
import { sellerOrderPath } from './shipments/shipments.service';
import { waybillPdf } from './shipments/waybill-pdf';

describe('seller order state machine', () => {
  it('only lets the right actors make each move', () => {
    expect(canTransition('PENDING', 'PROCESSING', 'SELLER')).toBe(true);
    expect(canTransition('PENDING', 'PROCESSING', 'CUSTOMER')).toBe(false);
    expect(canTransition('AWAITING_PAYMENT', 'PENDING', 'PROVIDER')).toBe(true);
    // Nobody but a confirmed payment (or finance) releases an unpaid order to the seller.
    expect(canTransition('AWAITING_PAYMENT', 'PENDING', 'SELLER')).toBe(false);
    expect(canTransition('AWAITING_PAYMENT', 'PENDING', 'CUSTOMER')).toBe(false);
    // Customers cancel only before the seller starts.
    expect(canTransition('PENDING', 'CANCELLED', 'CUSTOMER')).toBe(true);
    expect(canTransition('PROCESSING', 'CANCELLED', 'CUSTOMER')).toBe(false);
    // Shipped parcels are never cancelled; they come back instead.
    expect(canTransition('SHIPPED', 'CANCELLED', 'STAFF')).toBe(false);
    expect(canTransition('SHIPPED', 'RETURNING_TO_SELLER', 'COURIER')).toBe(true);
    expect(canTransition('DELIVERED', 'COMPLETED', 'SYSTEM')).toBe(true);
  });

  it('has no way out of final statuses and no unknown statuses', () => {
    for (const final of ['COMPLETED', 'CANCELLED', 'RETURNED_TO_SELLER'] as const) {
      for (const actor of [
        'CUSTOMER',
        'SELLER',
        'STAFF',
        'COURIER',
        'PROVIDER',
        'SYSTEM',
      ] as const) {
        expect(nextStatuses(final, actor)).toEqual([]);
      }
    }
    for (const t of SELLER_ORDER_TRANSITIONS) {
      expect(SELLER_ORDER_STATUSES).toContain(t.from);
      expect(SELLER_ORDER_STATUSES).toContain(t.to);
      expect(t.actors.length).toBeGreaterThan(0);
    }
  });

  it('maps every shipment move to a seller order path the state machine allows', () => {
    for (const from of SHIPMENT_STATUSES) {
      for (const to of SHIPMENT_TRANSITIONS[from]) {
        const target = SHIPMENT_TO_SELLER_ORDER_STATUS[to];
        const start = SHIPMENT_TO_SELLER_ORDER_STATUS[from];
        if (!target || !start) continue;
        let status = start;
        for (const step of sellerOrderPath(status, target)) {
          expect([
            status,
            step,
            canTransition(status, step, 'COURIER') || canTransition(status, step, 'STAFF'),
          ]).toEqual([status, step, true]);
          status = step;
        }
        expect(status).toBe(target);
      }
    }
  });
});

describe('couriers', () => {
  it('signs mock courier updates and refuses tampered or stale ones', () => {
    const courier = new MockCourier('test-secret-for-the-mock-courier', false);
    const now = new Date('2026-11-26T08:00:00Z');
    const signed = courier.sign(
      { trackingNumber: 'MCK0000000001', status: 'DELIVERED', codCollected: '499.00' },
      now,
    );
    const [event] = courier.parseWebhook(signed.headers, signed.rawBody, now);
    expect(event).toMatchObject({
      trackingNumber: 'MCK0000000001',
      status: 'DELIVERED',
      codCollected: '499.00',
    });
    const forged = Buffer.from(signed.rawBody.toString().replace('499.00', '1.00'));
    expect(() => courier.parseWebhook(signed.headers, forged, now)).toThrow(CourierSignatureError);
    const later = new Date(now.getTime() + 10 * 60_000);
    expect(() => courier.parseWebhook(signed.headers, signed.rawBody, later)).toThrow(
      CourierSignatureError,
    );
    expect(() => courier.parseWebhook({}, signed.rawBody, now)).toThrow(CourierSignatureError);
  });

  it('never runs the mock courier in production and keeps real couriers unavailable until set up', async () => {
    expect(new MockCourier('test-secret-for-the-mock-courier', true).unavailableReason()).toMatch(
      /production/,
    );
    const jnt = new PreparedCourier('JNT');
    expect(jnt.unavailableReason()).toMatch(/J&T Express needs API credentials/);
    await expect(jnt.book()).rejects.toThrow(/credentials/);
  });

  it('writes a valid one-page PDF label marked as a test', () => {
    const pdf = waybillPdf({
      carrierLabel: 'Mock courier (test)',
      trackingNumber: 'MCK0123456789',
      reference: 'MP261126ABCDEF-1',
      serviceName: 'Standard',
      codAmount: 'PHP 1,499.00',
      from: ['Test Store', 'Quezon City'],
      to: ['Juan Dela Cruz', '+639171234567', '45 Kalayaan St, Quezon City'],
      items: '2 x Desk Lamp — “warm”',
      weightKg: '1.20',
      test: true,
    });
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('MCK0123456789');
    expect(text).toContain('TEST LABEL');
    expect(text).toContain('/Count 1');
  });
});
