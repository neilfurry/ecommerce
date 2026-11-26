import { GatewayError } from './gateway';
import { toCentavos } from './util';

/**
 * Seller payouts through a provider's disbursement API (Phase 6, ADR 0028). Only PayMongo is
 * implemented: transfers from the PayMongo wallet over InstaPay (or PESONet) with
 * POST /v2/batch_transfers. Without a configured wallet, payouts are paid manually by finance.
 */

export type PayoutRail = 'instapay' | 'pesonet';
export type ProviderTransferStatus = 'PROCESSING' | 'PAID' | 'FAILED';

export interface CreateTransferInput {
  /** Our payout reference; sent as the transfer's reference number (unique per attempt). */
  reference: string;
  amount: string;
  destination: { accountNumber: string; accountName: string; bic: string };
  description: string;
  rail?: PayoutRail;
}

export interface ProviderTransfer {
  id: string;
  status: ProviderTransferStatus;
  fee: string | null;
  failureReason: string | null;
  livemode: boolean;
}

export interface PayoutProvider {
  readonly code: 'PAYMONGO';
  readonly livemode: boolean;
  createTransfer(input: CreateTransferInput): Promise<ProviderTransfer>;
  retrieveTransfer(id: string): Promise<ProviderTransfer>;
}

export interface PayMongoPayoutsConfig {
  secretKey: string;
  wallet: { number: string; name: string; bic: string };
  apiBase?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const at = (value: unknown, ...path: (string | number)[]): unknown =>
  path.reduce<unknown>(
    (v, key) =>
      v && typeof v === 'object' ? (v as Record<string | number, unknown>)[key] : undefined,
    value,
  );
const str = (v: unknown) => (typeof v === 'string' ? v : null);

/** PayMongo transfer statuses mapped to ours (unknown values stay PROCESSING). */
export function transferStatus(status: string | null): ProviderTransferStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'succeeded':
    case 'success':
    case 'completed':
    case 'paid':
      return 'PAID';
    case 'failed':
    case 'cancelled':
    case 'canceled':
    case 'rejected':
    case 'returned':
      return 'FAILED';
    default:
      return 'PROCESSING';
  }
}

function transferOf(raw: unknown, livemode: boolean): ProviderTransfer {
  const attrs = (at(raw, 'attributes') ?? raw) as Record<string, unknown>;
  const id = str(at(raw, 'id')) ?? str(attrs.id);
  if (!id)
    throw new GatewayError('PayMongo returned a transfer without an id', 'BAD_RESPONSE', true);
  const fee = attrs.fee;
  return {
    id,
    status: transferStatus(str(attrs.status)),
    fee:
      typeof fee === 'number'
        ? (fee / 100).toFixed(2)
        : typeof fee === 'string' && /^\d+$/.test(fee)
          ? (Number(fee) / 100).toFixed(2)
          : null,
    failureReason:
      str(attrs.failure_message) ?? str(attrs.failed_reason) ?? str(at(attrs, 'error', 'message')),
    livemode,
  };
}

export class PayMongoPayouts implements PayoutProvider {
  readonly code = 'PAYMONGO' as const;
  readonly livemode: boolean;
  private readonly base: string;
  private readonly fetcher: typeof fetch;

  constructor(private readonly config: PayMongoPayoutsConfig) {
    if (!/^sk_(test|live)_/.test(config.secretKey)) {
      throw new Error('PAYMONGO_SECRET_KEY must start with sk_test_ or sk_live_');
    }
    if (!config.wallet.number) throw new Error('PAYMONGO_WALLET_ACCOUNT_NUMBER is missing');
    this.livemode = config.secretKey.startsWith('sk_live_');
    this.base = (config.apiBase ?? 'https://api.paymongo.com').replace(/\/$/, '');
    this.fetcher = config.fetch ?? fetch;
  }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 15_000);
    try {
      const response = await this.fetcher(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.secretKey}:`).toString('base64')}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (response.status >= 400) {
        const detail = str(at(json, 'errors', 0, 'detail')) ?? `HTTP ${response.status}`;
        const code = str(at(json, 'errors', 0, 'code')) ?? `http_${response.status}`;
        // A rejected request (4xx) is final; a server error or rate limit may be retried.
        throw new GatewayError(
          `PayMongo: ${detail}`,
          code,
          response.status >= 500 || response.status === 429,
        );
      }
      return json;
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError(
        `PayMongo could not be reached: ${(error as Error).message}`,
        'UNREACHABLE',
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async createTransfer(input: CreateTransferInput): Promise<ProviderTransfer> {
    const json = await this.call('POST', '/v2/batch_transfers', {
      transfers: [
        {
          provider: input.rail ?? 'instapay',
          amount: toCentavos(input.amount),
          currency: 'PHP',
          purpose: 'Disbursement',
          description: input.description.slice(0, 100),
          reference_number: input.reference,
          source_account: {
            number: this.config.wallet.number,
            name: this.config.wallet.name,
            bic: this.config.wallet.bic,
          },
          destination_account: {
            number: input.destination.accountNumber,
            name: input.destination.accountName,
            bic: input.destination.bic,
          },
          metadata: { payout_reference: input.reference },
        },
      ],
    });
    const transfers = (at(json, 'data', 'attributes', 'transfers') ??
      at(json, 'data', 'transfers') ??
      at(json, 'transfers') ??
      at(json, 'data')) as unknown;
    const first = Array.isArray(transfers) ? transfers[0] : transfers;
    return transferOf(first, this.livemode);
  }

  async retrieveTransfer(id: string): Promise<ProviderTransfer> {
    const json = await this.call('GET', `/v2/transfers/${encodeURIComponent(id)}`);
    return transferOf(at(json, 'data') ?? json, this.livemode);
  }
}
