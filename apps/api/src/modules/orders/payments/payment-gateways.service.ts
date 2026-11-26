import { Injectable, Logger } from '@nestjs/common';
import {
  eventOutcome,
  GatewayNotConfiguredError,
  MayaBusinessGateway,
  MockGateway,
  type MockSessionStore,
  mockEventOutcome,
  type PaymentGateway,
  PayMongoGateway,
  type WebhookOutcome,
  XenditGateway,
} from '@marketplace/payments';
import {
  PAYMENT_PROVIDER_LABELS,
  type OnlinePaymentProvider,
  type PaymentMethod,
} from '@marketplace/shared-types';
import type { PaymentGatewayStatus } from '@marketplace/validation';
import { AppConfig } from '../../../config/app-config';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/** Webhook sources as stored in webhook_events.source. */
export const WEBHOOK_SOURCES = { MOCK: 'mock-payments', PAYMONGO: 'paymongo' } as const;

/**
 * The payment gateways this API can use. Exactly one takes new online payments (the
 * PAYMENT_PROVIDER setting): the mock locally, PayMongo when its keys are configured.
 * Payments started with another gateway (e.g. mock payments made before switching) can
 * still be verified and refunded through it while it is configured.
 */
@Injectable()
export class PaymentGatewaysService {
  private readonly logger = new Logger(PaymentGatewaysService.name);
  readonly mock: MockGateway | null;
  readonly paymongo: PayMongoGateway | null;
  private readonly prepared = {
    MAYA_BUSINESS: new MayaBusinessGateway(),
    XENDIT: new XenditGateway(),
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {
    const { payments } = config;
    // The mock never runs in production (the env schema refuses PAYMENT_PROVIDER=mock there too).
    this.mock = config.isProduction
      ? null
      : new MockGateway({
          webhookSecret: payments.mockWebhookSecret,
          checkoutPageUrl: `${config.appUrls.storefront}/pay/mock`,
          store: this.mockStore(),
        });
    this.paymongo = payments.paymongo
      ? new PayMongoGateway({
          secretKey: payments.paymongo.secretKey,
          webhookSecret: payments.paymongo.webhookSecret,
          checkoutVersion: payments.paymongo.checkoutVersion,
        })
      : null;
    if (this.paymongo?.livemode) this.logger.warn('PayMongo LIVE keys are configured.');
  }

  /** The gateway new online payments go to. */
  get active(): PaymentGateway {
    const gateway = this.config.payments.provider === 'paymongo' ? this.paymongo : this.mock;
    if (!gateway) {
      throw new GatewayNotConfiguredError(
        this.config.payments.provider,
        'PAYMENT_PROVIDER names a gateway that is not configured',
      );
    }
    return gateway;
  }

  /** The gateway that handled an existing payment (verification, expiry, refunds). */
  forProvider(provider: string): PaymentGateway {
    switch (provider) {
      case 'MOCK':
        if (this.mock) return this.mock;
        throw new GatewayNotConfiguredError('Mock', 'the mock gateway is disabled in production');
      case 'PAYMONGO':
        if (this.paymongo) return this.paymongo;
        throw new GatewayNotConfiguredError('PayMongo', 'PAYMONGO_SECRET_KEY is not set');
      case 'MAYA_BUSINESS':
        return this.prepared.MAYA_BUSINESS;
      case 'XENDIT':
        return this.prepared.XENDIT;
      default:
        throw new GatewayNotConfiguredError(provider, 'not an online gateway');
    }
  }

  supports(method: PaymentMethod): boolean {
    try {
      return this.active.methods.includes(method);
    } catch {
      return false;
    }
  }

  /** Re-derives the outcome of a stored (already verified) webhook event, for reprocessing. */
  outcomeOf(source: string, payload: unknown): WebhookOutcome {
    if (source === WEBHOOK_SOURCES.MOCK) return mockEventOutcome(payload);
    if (source === WEBHOOK_SOURCES.PAYMONGO) {
      const p = payload as {
        data?: { attributes?: { type?: string; livemode?: boolean; data?: unknown } };
      };
      const attributes = p.data?.attributes;
      if (!attributes?.type) return { kind: 'ignored' };
      if (this.paymongo && attributes.livemode !== this.paymongo.livemode)
        return { kind: 'ignored' };
      return eventOutcome(attributes.type, attributes.data);
    }
    return { kind: 'ignored' };
  }

  /** What staff see under Payments › Gateways. */
  statuses(): PaymentGatewayStatus[] {
    const activeCode: OnlinePaymentProvider =
      this.config.payments.provider === 'paymongo' ? 'PAYMONGO' : 'MOCK';
    const row = (
      provider: OnlinePaymentProvider,
      gateway: PaymentGateway | null,
      note: string | null,
    ): PaymentGatewayStatus => ({
      provider,
      label: PAYMENT_PROVIDER_LABELS[provider],
      active: provider === activeCode && gateway !== null,
      livemode: gateway?.livemode ?? false,
      methods: gateway ? [...gateway.methods] : [],
      note,
    });
    return [
      row(
        'MOCK',
        this.mock,
        this.mock
          ? 'Test payments only: no money moves. Customers see a "Test payment" page.'
          : 'Disabled in production.',
      ),
      row(
        'PAYMONGO',
        this.paymongo,
        this.paymongo
          ? this.paymongo.livemode
            ? 'Live keys: real payments.'
            : 'Test (sandbox) keys: no real money moves.'
          : 'Set PAYMONGO_SECRET_KEY and PAYMONGO_WEBHOOK_SECRET to enable the sandbox.',
      ),
      row(
        'MAYA_BUSINESS',
        null,
        'Prepared, not connected: needs a Maya Business merchant account, API keys and refund enablement by Maya.',
      ),
      row(
        'XENDIT',
        null,
        'Prepared, not connected: needs a Xendit account and API keys (evaluated in ADR 0022).',
      ),
    ];
  }

  /** The mock's checkout sessions live in the database so they survive API restarts. */
  private mockStore(): MockSessionStore {
    const prisma = this.prisma;
    return {
      async create(session) {
        await prisma.mockPaymentSession.create({
          data: {
            id: session.id,
            paymentReference: session.paymentReference,
            amount: session.amount,
            status: 'OPEN',
          },
        });
      },
      async get(id) {
        const row = await prisma.mockPaymentSession.findUnique({ where: { id } });
        return row
          ? {
              id: row.id,
              paymentReference: row.paymentReference,
              amount: row.amount.toFixed(2),
              status: row.status as 'OPEN',
              paymentId: row.paymentId,
            }
          : null;
      },
      async update(id, change) {
        await prisma.mockPaymentSession.update({
          where: { id },
          data: {
            status: change.status,
            ...(change.paymentId ? { paymentId: change.paymentId } : {}),
          },
        });
      },
    };
  }
}
