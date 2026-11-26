import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { CARRIER_LABELS, type Carrier, type ShipmentStatus } from '@marketplace/shared-types';

export interface CourierBooking {
  reference: string;
  serviceName: string;
  origin: { label: string; contact: string };
  destination: { label: string; recipient: string; mobile: string };
  weightGrams: number;
  codAmount: string | null;
  items: string;
}

export interface BookedParcel {
  trackingNumber: string;
  providerShipmentId: string | null;
}

export interface CourierEvent {
  /** The courier's own id for the event (repeated deliveries are stored once). */
  eventId: string;
  trackingNumber: string;
  status: ShipmentStatus;
  description: string;
  location: string | null;
  occurredAt: Date;
  /** Cash collected on delivery, when the courier reports it. */
  codCollected: string | null;
}

export class CourierSignatureError extends Error {}

/**
 * A courier integration. Booking creates the parcel at the courier; tracking updates arrive
 * as signed webhooks. Real couriers (J&T Express, LBC, Ninja Van, Flash Express, 2GO) are
 * prepared here and stay unavailable until their API credentials and documentation exist.
 */
export interface CourierAdapter {
  readonly carrier: Carrier;
  readonly livemode: boolean;
  /** null when it can book shipments; otherwise why not. */
  unavailableReason(): string | null;
  book(booking: CourierBooking): Promise<BookedParcel>;
  cancel(trackingNumber: string): Promise<void>;
  parseWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
    now?: Date,
  ): CourierEvent[];
}

export const MOCK_COURIER_SIGNATURE_HEADER = 'x-mock-courier-signature';

const hex = (secret: string, message: string) =>
  createHmac('sha256', secret).update(message).digest('hex');

/**
 * Development courier: tracking numbers "MCK…", a generated test label, and status updates
 * that staff trigger from the Admin Console (or tests). Updates are sent as signed webhooks
 * to the API's own courier webhook endpoint, so the real processing path runs.
 */
export class MockCourier implements CourierAdapter {
  readonly carrier = 'MOCK' as const;
  readonly livemode = false;

  constructor(
    private readonly secret: string,
    private readonly production: boolean,
  ) {}

  unavailableReason() {
    return this.production ? 'The mock courier cannot be used in production.' : null;
  }

  async book(): Promise<BookedParcel> {
    const digits = Array.from({ length: 10 }, () => randomInt(10)).join('');
    return {
      trackingNumber: `MCK${digits}`,
      providerShipmentId: `mock_${randomBytes(6).toString('hex')}`,
    };
  }

  async cancel(): Promise<void> {}

  /** A signed tracking update, as the courier would send it. */
  sign(
    update: {
      trackingNumber: string;
      status: ShipmentStatus;
      description?: string;
      location?: string;
      codCollected?: string | null;
    },
    now = new Date(),
  ) {
    const body = {
      eventId: `mce_${randomBytes(9).toString('base64url')}`,
      trackingNumber: update.trackingNumber,
      status: update.status,
      description: update.description ?? null,
      location: update.location ?? null,
      occurredAt: now.toISOString(),
      codCollected: update.codCollected ?? null,
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    const t = Math.floor(now.getTime() / 1000).toString();
    return {
      headers: {
        [MOCK_COURIER_SIGNATURE_HEADER]: `t=${t},v1=${hex(this.secret, `${t}.${rawBody.toString()}`)}`,
      },
      rawBody,
    };
  }

  parseWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
    now = new Date(),
  ): CourierEvent[] {
    const raw = headers[MOCK_COURIER_SIGNATURE_HEADER];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) throw new CourierSignatureError('Missing signature');
    const parts = Object.fromEntries(value.split(',').map((p) => p.split('=') as [string, string]));
    const t = Number(parts.t);
    if (!Number.isInteger(t) || Math.abs(now.getTime() / 1000 - t) > 300) {
      throw new CourierSignatureError('Signature timestamp outside the allowed window');
    }
    const expected = hex(this.secret, `${parts.t}.${rawBody.toString()}`);
    const given = parts.v1 ?? '';
    if (
      given.length !== expected.length ||
      !timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'))
    ) {
      throw new CourierSignatureError('Signature does not match');
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString()) as Record<string, unknown>;
    } catch {
      throw new CourierSignatureError('Body is not JSON');
    }
    return [
      {
        eventId: String(body.eventId),
        trackingNumber: String(body.trackingNumber),
        status: body.status as ShipmentStatus,
        description: typeof body.description === 'string' ? body.description : '',
        location: typeof body.location === 'string' ? body.location : null,
        occurredAt: new Date(String(body.occurredAt)),
        codCollected: typeof body.codCollected === 'string' ? body.codCollected : null,
      },
    ];
  }
}

/** The seller arranged the delivery and enters the courier and tracking number. */
export class SelfDelivery implements CourierAdapter {
  readonly carrier = 'SELF' as const;
  readonly livemode = true;
  unavailableReason() {
    return null;
  }
  async book(): Promise<BookedParcel> {
    throw new Error('Self-arranged deliveries are not booked through an API');
  }
  async cancel(): Promise<void> {}
  parseWebhook(): CourierEvent[] {
    throw new CourierSignatureError('No webhooks for self-arranged deliveries');
  }
}

/** A courier we can integrate once its API credentials and documentation are available. */
export class PreparedCourier implements CourierAdapter {
  readonly livemode = true;
  constructor(readonly carrier: Exclude<Carrier, 'MOCK' | 'SELF'>) {}
  unavailableReason() {
    return `${CARRIER_LABELS[this.carrier]} needs API credentials, a merchant account and its API documentation before it can be connected.`;
  }
  book(): Promise<BookedParcel> {
    return Promise.reject(new Error(this.unavailableReason()));
  }
  cancel(): Promise<void> {
    return Promise.reject(new Error(this.unavailableReason()));
  }
  parseWebhook(): CourierEvent[] {
    throw new CourierSignatureError(`${this.carrier} webhooks are not enabled`);
  }
}
