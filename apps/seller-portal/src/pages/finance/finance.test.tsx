import { createApiClient, createQueryClient } from '@marketplace/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../app/providers';
import { routes } from '../../app/routes';

const NOW = '2026-11-26T09:00:00.000Z';
const OWNER_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7301';
const SELLER_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7302';
const ACCOUNT_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7303';
const PAYOUT_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7304';
const SETTLEMENT_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7305';
const SO_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7306';
const DOC_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7307';

const OWNER = [
  'seller.finance.read',
  'seller.payouts.manage',
  'seller.profile.manage',
  'seller.orders.read',
];

const session = (permissions: string[]) => ({
  user: {
    id: OWNER_ID,
    firstName: 'Lito',
    lastName: 'Santos',
    email: 'seller.owner@marketplace.local',
    emailVerified: true,
    mobile: '+639171234567',
    mobileVerified: false,
    roles: ['SELLER_OWNER'],
    permissions,
    wholesaleStatus: null,
    mfaEnabled: false,
    seller: { id: SELLER_ID, businessName: 'Santos Trading', status: 'VERIFIED', isOwner: true },
  },
  app: 'seller',
  accessTokenExpiresAt: '2026-11-26T09:15:00.000Z',
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const page = (items: unknown[]) => ({
  items,
  page: 1,
  pageSize: 20,
  totalItems: items.length,
  totalPages: 1,
});

const balances = {
  pending: '1880.00',
  held: '0.00',
  available: '1870.00',
  reserved: '0.00',
  inPayout: '0.00',
  paid: '0.00',
  withdrawable: '1870.00',
  minimumPayout: '100.00',
  currency: 'PHP',
};
const overview = {
  balances,
  summary: {
    from: '2026-11-01',
    to: '2026-11-30',
    grossSales: '2000.00',
    commission: '120.00',
    paymentFees: '0.00',
    refunds: '0.00',
    shippingCredits: '0.00',
    netEarnings: '1880.00',
    orders: 1,
  },
  nextSettlement: {
    periodStart: '2026-11-22T16:00:00.000Z',
    periodEnd: '2026-11-29T16:00:00.000Z',
  },
  bankAccountVerified: true,
  taxProfileVerified: false,
};
const bankAccount = {
  id: ACCOUNT_ID,
  institutionCode: 'BNORPHMM',
  institutionName: 'BDO Unibank',
  accountName: 'Santos Trading',
  accountNumberMasked: '•••• 7890',
  status: 'VERIFIED',
  isDefault: true,
  reviewNote: null,
  reviewedAt: NOW,
  createdAt: NOW,
  seller: { id: SELLER_ID, name: 'Santos Trading' },
};
const settlement = {
  id: SETTLEMENT_ID,
  reference: 'ST-ABCDEFGH',
  seller: { id: SELLER_ID, name: 'Santos Trading' },
  periodStart: '2026-11-15T16:00:00.000Z',
  periodEnd: '2026-11-22T16:00:00.000Z',
  ordersCount: 1,
  grossSales: '2000.00',
  shippingCredits: '0.00',
  commission: '120.00',
  paymentFees: '0.00',
  refunds: '0.00',
  commissionReversals: '0.00',
  otherAdjustments: '0.00',
  netSettled: '1880.00',
  withholdingBase: '2000.00',
  withholdingTax: '10.00',
  withholding: {
    code: 'PH-EWT-EMARKETPLACE',
    ratePercent: '0.5',
    basePercent: '100',
    exempt: false,
    reason: null,
  },
  openingAvailable: '0.00',
  closingAvailable: '1870.00',
  journal: { id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7308', reference: 'JE-ABCDEFGH' },
  createdAt: NOW,
  lines: [
    {
      sellerOrderId: SO_ID,
      orderNumber: 'MP261120ABC123-1',
      grossSales: '2000.00',
      shippingCredits: '0.00',
      commission: '120.00',
      paymentFees: '0.00',
      refunds: '0.00',
      commissionReversals: '0.00',
      otherAdjustments: '0.00',
      net: '1880.00',
      withholdingBase: '2000.00',
    },
  ],
  documents: [{ id: DOC_ID, type: 'SERVICE_INVOICE', number: 'SI-2026-000001', total: '120.00' }],
};

function api(
  permissions = OWNER,
  overrides: Record<string, (init?: RequestInit) => Response> = {},
) {
  const routes: Record<string, (init?: RequestInit) => Response> = {
    'GET /auth/session': () => json(session(permissions)),
    'GET /auth/csrf': () => json({ csrfToken: 'csrf-test' }),
    'GET /seller/finance/overview': () => json(overview),
    'GET /seller/finance/bank-accounts': () => json({ items: [bankAccount] }),
    'GET /seller/finance/payouts': () => json(page([])),
    'POST /seller/finance/payouts': (init) => {
      const body = JSON.parse(String(init?.body)) as { amount: string };
      return json(
        {
          id: PAYOUT_ID,
          reference: 'PO-7K3M9Q2X',
          seller: { id: SELLER_ID, name: 'Santos Trading' },
          amount: body.amount,
          currency: 'PHP',
          method: 'MANUAL',
          status: 'REQUESTED',
          destination: {
            institutionName: 'BDO Unibank',
            institutionCode: 'BNORPHMM',
            accountName: 'Santos Trading',
            accountNumberMasked: '•••• 7890',
          },
          transferReference: null,
          transferFee: '0.00',
          failureReason: null,
          livemode: false,
          requestedBy: 'Lito Santos',
          requestedAt: NOW,
          approvedAt: null,
          paidAt: null,
          closedAt: null,
          events: [],
          actions: [],
        },
        201,
      );
    },
    [`GET /seller/finance/settlements/${SETTLEMENT_ID}`]: () => json(settlement),
    ...overrides,
  };
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const handler = routes[`${init?.method ?? 'GET'} ${url.pathname.replace(/^\/api\/v1/, '')}`];
    return handler
      ? handler(init)
      : json({ error: { code: 'NOT_FOUND', message: 'nope', statusCode: 404 } }, 404);
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

function renderAt(path: string, fetchImpl: typeof fetch) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  render(
    <AppProviders
      apiClient={createApiClient({ baseUrl: '/api', app: 'seller', fetchImpl })}
      queryClient={queryClient}
    >
      <RouterProvider router={router} />
    </AppProviders>,
  );
}

describe('Seller Center finance', () => {
  it('shows balances from the ledger and what is missing before payouts', async () => {
    renderAt('/finance', api());
    const cards = await screen.findByLabelText('Balances');
    expect(within(cards).getByText('₱1,880.00')).toBeInTheDocument();
    expect(within(cards).getByText('₱1,870.00')).toBeInTheDocument();
    expect(screen.getByText('Before your first payout')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'tax profile' })).toBeInTheDocument();
  });

  it('requests a payout to a verified account with one idempotency key', async () => {
    const user = userEvent.setup();
    const fetchImpl = api();
    renderAt('/finance/payouts', fetchImpl);
    await user.click(await screen.findByRole('button', { name: 'Request a payout' }));
    const dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByLabelText('Amount');
    await user.clear(amount);
    await user.type(amount, '1000.00');
    await user.click(within(dialog).getByRole('button', { name: 'Request' }));
    const calls = () =>
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([u, init]) =>
          String(u).includes('/seller/finance/payouts') &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
    await waitFor(() => expect(calls()).toHaveLength(1));
    const body = JSON.parse(String((calls()[0]![1] as RequestInit).body)) as Record<string, string>;
    expect(body).toMatchObject({ amount: '1000.00', bankAccountId: ACCOUNT_ID });
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('shows a settlement statement with withholding and the service invoice', async () => {
    renderAt(`/finance/settlements/${SETTLEMENT_ID}`, api());
    expect(
      await screen.findByRole('heading', { name: 'Statement ST-ABCDEFGH' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/PH-EWT-EMARKETPLACE: 0.5% of 100%/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Service invoice SI-2026-000001' })).toHaveAttribute(
      'href',
      `/finance/documents/${DOC_ID}`,
    );
    expect(screen.getByRole('link', { name: 'MP261120ABC123-1' })).toHaveAttribute(
      'href',
      `/orders/${SO_ID}`,
    );
  });

  it('hides payout requests from employees without the permission', async () => {
    renderAt('/finance/payouts', api(['seller.finance.read']));
    expect(await screen.findByRole('heading', { name: 'Payouts' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request a payout' })).not.toBeInTheDocument();
  });
});
