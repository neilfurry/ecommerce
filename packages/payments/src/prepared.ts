import type { PaymentMethod } from '@marketplace/shared-types';
import {
  type CreatedCheckout,
  GatewayNotConfiguredError,
  type ParsedWebhook,
  type PaymentGateway,
  type RefundResult,
  type RetrievedCheckout,
  WebhookSignatureError,
} from './gateway';

/**
 * Adapters evaluated in ADR 0022 but not built yet. They exist so the configuration and the
 * admin screens can name them, and so a later integration only fills in these methods.
 * Every call fails clearly; nothing pretends to take a payment.
 */
abstract class PreparedGateway implements PaymentGateway {
  abstract readonly code: 'MAYA_BUSINESS' | 'XENDIT';
  readonly livemode = false;
  readonly methods: readonly PaymentMethod[] = [];
  protected abstract readonly missing: string;

  private notConfigured(): never {
    throw new GatewayNotConfiguredError(this.code, this.missing);
  }
  createCheckout(): Promise<CreatedCheckout> {
    return Promise.reject(new GatewayNotConfiguredError(this.code, this.missing));
  }
  retrieve(): Promise<RetrievedCheckout> {
    return Promise.reject(new GatewayNotConfiguredError(this.code, this.missing));
  }
  expire(): Promise<void> {
    return Promise.reject(new GatewayNotConfiguredError(this.code, this.missing));
  }
  refund(): Promise<RefundResult> {
    return Promise.reject(new GatewayNotConfiguredError(this.code, this.missing));
  }
  parseWebhook(): ParsedWebhook {
    // Never accept events for an adapter that is not built.
    throw new WebhookSignatureError(`${this.code} webhooks are not enabled`);
  }
  describe(): string {
    try {
      this.notConfigured();
    } catch (error) {
      return (error as Error).message;
    }
  }
}

/**
 * Maya Checkout: PAYMENT_SUCCESS / PAYMENT_FAILED / PAYMENT_EXPIRED webhooks (no body
 * signature: verify by source IP allow-list and by retrieving the payment), voids and refunds
 * enabled per merchant by Maya.
 */
export class MayaBusinessGateway extends PreparedGateway {
  readonly code = 'MAYA_BUSINESS' as const;
  protected readonly missing =
    'adapter not built; needs Maya Checkout sandbox keys and refund enablement from Maya';
}

/**
 * Xendit Payments API: x-callback-token webhooks (a shared token, no body signature), split
 * payments through xenPlatform sub-accounts (requires a xenPlatform agreement).
 */
export class XenditGateway extends PreparedGateway {
  readonly code = 'XENDIT' as const;
  protected readonly missing = 'adapter not built; needs Xendit test keys and callback token';
}
