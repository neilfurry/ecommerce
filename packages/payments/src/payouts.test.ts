import { describe, expect, it } from 'vitest';
import { GatewayError } from './gateway';
import { PayMongoPayouts, transferStatus } from './payouts';

const wallet = { number: '0000000001', name: 'Marketplace Inc.', bic: 'PAEYPHM2XXX' };

function fakeFetch(
  status: number,
  body: unknown,
  seen: { url?: string; init?: RequestInit }[] = [],
) {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

describe('PayMongo payouts', () => {
  it('needs a secret key and a source wallet', () => {
    expect(() => new PayMongoPayouts({ secretKey: 'pk_test_x', wallet })).toThrow(/sk_test_/);
    expect(
      () => new PayMongoPayouts({ secretKey: 'sk_test_x', wallet: { ...wallet, number: '' } }),
    ).toThrow(/WALLET/);
  });

  it('sends one InstaPay transfer in centavos from the wallet to the seller account', async () => {
    const seen: { url?: string; init?: RequestInit }[] = [];
    const payouts = new PayMongoPayouts({
      secretKey: 'sk_test_abc',
      wallet,
      fetch: fakeFetch(
        200,
        { data: { attributes: { transfers: [{ id: 'tr_1', status: 'pending', fee: 1000 }] } } },
        seen,
      ),
    });
    const transfer = await payouts.createTransfer({
      reference: 'PO-ABC',
      amount: '1234.50',
      destination: { accountNumber: '001234567890', accountName: 'Test Trading', bic: 'BNORPHMM' },
      description: 'Marketplace payout PO-ABC',
    });
    expect(transfer).toEqual({
      id: 'tr_1',
      status: 'PROCESSING',
      fee: '10.00',
      failureReason: null,
      livemode: false,
    });
    expect(seen[0]!.url).toBe('https://api.paymongo.com/v2/batch_transfers');
    const body = JSON.parse(seen[0]!.init!.body as string);
    expect(body.transfers[0]).toMatchObject({
      provider: 'instapay',
      amount: 123450,
      currency: 'PHP',
      reference_number: 'PO-ABC',
      source_account: { number: '0000000001', bic: 'PAEYPHM2XXX' },
      destination_account: { number: '001234567890', name: 'Test Trading', bic: 'BNORPHMM' },
    });
    expect((seen[0]!.init!.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('sk_test_abc:').toString('base64')}`,
    );
  });

  it('treats a rejected request as final and a server error as retryable (unknown outcome)', async () => {
    const reject = new PayMongoPayouts({
      secretKey: 'sk_test_abc',
      wallet,
      fetch: fakeFetch(400, {
        errors: [{ code: 'invalid_destination_account', detail: 'Account not found' }],
      }),
    });
    const input = {
      reference: 'PO-X',
      amount: '10.00',
      destination: { accountNumber: '1', accountName: 'A', bic: 'B' },
      description: 'x',
    };
    await expect(reject.createTransfer(input)).rejects.toMatchObject({
      code: 'invalid_destination_account',
      retryable: false,
    });
    const down = new PayMongoPayouts({
      secretKey: 'sk_test_abc',
      wallet,
      fetch: fakeFetch(503, {}),
    });
    const error = await down.createTransfer(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as GatewayError).retryable).toBe(true);
  });

  it('maps transfer statuses', () => {
    expect(transferStatus('succeeded')).toBe('PAID');
    expect(transferStatus('failed')).toBe('FAILED');
    expect(transferStatus('pending')).toBe('PROCESSING');
    expect(transferStatus(null)).toBe('PROCESSING');
  });
});
