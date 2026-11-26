import { createApiClient, createQueryClient } from '@marketplace/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../app/providers';
import { buildRoutes } from '../../app/routes';
import { sessionFor } from '../../test/session';

const NOW = '2026-11-26T09:00:00.000Z';
const SELLER_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7201';
const PAYOUT_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7202';
const RULE_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7203';
const JOURNAL_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7204';
const ACCOUNT_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7205';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const page = <T,>(items: T[]) => ({
  items,
  page: 1,
  pageSize: 25,
  totalItems: items.length,
  totalPages: 1,
});

const payout = (status: string, actions: string[]) => ({
  id: PAYOUT_ID,
  reference: 'PO-7K3M9Q2X',
  seller: { id: SELLER_ID, name: 'Isla Tech Inc.' },
  amount: '1000.00',
  currency: 'PHP',
  method: 'MANUAL',
  status,
  destination: {
    institutionName: 'BDO Unibank',
    institutionCode: 'BNORPHMM',
    accountName: 'Isla Tech Inc.',
    accountNumberMasked: '•••• 7890',
  },
  transferReference: null,
  transferFee: '0.00',
  failureReason: null,
  livemode: false,
  requestedBy: 'Isla Owner',
  requestedAt: NOW,
  approvedAt: null,
  paidAt: null,
  closedAt: null,
  events: [
    {
      id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7206',
      type: 'REQUESTED',
      fromStatus: null,
      toStatus: 'REQUESTED',
      actor: 'Isla Owner',
      note: null,
      createdAt: NOW,
    },
  ],
  actions,
});

const rule = {
  id: RULE_ID,
  scope: 'SELLER',
  type: 'PERCENTAGE',
  category: null,
  seller: { id: SELLER_ID, name: 'Isla Tech Inc.' },
  product: null,
  ratePercent: '7.00',
  fixedAmount: null,
  effectiveFrom: NOW,
  effectiveTo: null,
  state: 'CURRENT',
  reason: null,
  createdBy: 'Fina Admin',
  endedBy: null,
  createdAt: NOW,
};

const journal = {
  id: JOURNAL_ID,
  reference: 'JE-ABCDEFGH',
  type: 'MANUAL',
  status: 'DRAFT',
  description: 'Owner capital',
  currency: 'PHP',
  occurredAt: NOW,
  postedAt: null,
  source: null,
  reversalOf: null,
  reversedBy: null,
  createdBy: 'Fina Admin',
  postedBy: null,
  totalDebit: '1000.00',
  totalCredit: '1000.00',
  entries: [
    {
      id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7207',
      lineNo: 1,
      account: { code: '1010', name: 'Cash in bank' },
      seller: null,
      sellerOrder: null,
      kind: null,
      debit: '1000.00',
      credit: '0.00',
      description: null,
    },
    {
      id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7208',
      lineNo: 2,
      account: { code: '3010', name: "Owner's equity" },
      seller: null,
      sellerOrder: null,
      kind: null,
      debit: '0.00',
      credit: '1000.00',
      description: null,
    },
  ],
};

function fakeApi(
  permissions: string[],
  overrides: Record<string, (init?: RequestInit) => Response> = {},
) {
  const routes: Record<string, (init?: RequestInit) => Response> = {
    'GET /api/v1/auth/csrf': () => json({ csrfToken: 'csrf-test' }),
    'GET /api/v1/auth/session': () => json(sessionFor(['FINANCE_ADMIN'], permissions as never)),
    'GET /api/v1/auth/mfa': () =>
      json({ enabled: false, enabledAt: null, recoveryCodesRemaining: 0 }),
    [`GET /api/v1/finance/payouts/${PAYOUT_ID}`]: () =>
      json(payout('REQUESTED', ['APPROVE', 'REJECT'])),
    [`POST /api/v1/finance/payouts/${PAYOUT_ID}/approve`]: () =>
      json(payout('APPROVED', ['MARK_PAID', 'MARK_FAILED', 'REJECT'])),
    [`POST /api/v1/finance/payouts/${PAYOUT_ID}/mark-paid`]: () =>
      json(payout('PAID', ['REVERSE'])),
    'GET /api/v1/finance/commission-rules': () => json(page([rule])),
    'POST /api/v1/finance/commission-rules': () => json(rule, 201),
    [`POST /api/v1/finance/commission-rules/${RULE_ID}/end`]: () =>
      json({ ...rule, state: 'ENDED', effectiveTo: NOW }),
    [`GET /api/v1/finance/journals/${JOURNAL_ID}`]: () => json(journal),
    [`POST /api/v1/finance/journals/${JOURNAL_ID}/post`]: () =>
      json({ ...journal, status: 'POSTED', postedAt: NOW }),
    'GET /api/v1/finance/reports/trial-balance': () =>
      json({
        from: '2026-11-01',
        to: '2026-11-26',
        rows: [
          {
            code: '1010',
            name: 'Cash in bank',
            type: 'ASSET',
            opening: '0.00',
            debit: '1000.00',
            credit: '0.00',
            closing: '1000.00',
          },
          {
            code: '3010',
            name: "Owner's equity",
            type: 'EQUITY',
            opening: '0.00',
            debit: '0.00',
            credit: '1000.00',
            closing: '1000.00',
          },
        ],
        totalDebit: '1000.00',
        totalCredit: '1000.00',
        balanced: true,
      }),
    'GET /api/v1/finance/accounts': () =>
      json({
        items: [
          {
            id: ACCOUNT_ID,
            code: '1010',
            name: 'Cash in bank',
            type: 'ASSET',
            description: null,
            sellerSubledger: false,
            system: true,
            active: true,
            balance: '1000.00',
          },
        ],
      }),
    ...overrides,
  };
  return vi.fn(async (url: string, init?: RequestInit) => {
    const handler = routes[`${init?.method ?? 'GET'} ${url.split('?')[0]!}`];
    return handler
      ? handler(init)
      : json({ error: { code: 'NOT_FOUND', message: 'nope', statusCode: 404 } }, 404);
  });
}

function renderAt(path: string, fetchImpl: ReturnType<typeof fakeApi>) {
  const router = createMemoryRouter(buildRoutes(false), { initialEntries: [path] });
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  render(
    <AppProviders
      apiClient={createApiClient({
        baseUrl: '/api',
        app: 'admin',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })}
      queryClient={queryClient}
    >
      <RouterProvider router={router} />
    </AppProviders>,
  );
}

const called = (api: ReturnType<typeof fakeApi>, method: string, path: string) =>
  api.mock.calls.filter(
    ([url, init]) => url.split('?')[0] === path && (init?.method ?? 'GET') === method,
  );
const bodyOf = (api: ReturnType<typeof fakeApi>, method: string, path: string) => {
  const call = called(api, method, path)[0];
  return call ? (JSON.parse(String(call[1]?.body)) as Record<string, unknown>) : undefined;
};

const ALL = [
  'finance.read',
  'finance.manage',
  'commission.manage',
  'commission.exempt',
  'tax.manage',
  'ledger.post',
  'settlements.manage',
  'payouts.approve',
  'payouts.process',
];

describe('Admin Console accounting', () => {
  it('approves a payout, then records the bank transfer with its reference', async () => {
    const user = userEvent.setup();
    let state = 'REQUESTED';
    const api = fakeApi(ALL, {
      [`GET /api/v1/finance/payouts/${PAYOUT_ID}`]: () =>
        json(
          state === 'REQUESTED'
            ? payout('REQUESTED', ['APPROVE', 'REJECT'])
            : payout('APPROVED', ['MARK_PAID', 'MARK_FAILED', 'REJECT']),
        ),
      [`POST /api/v1/finance/payouts/${PAYOUT_ID}/approve`]: () => {
        state = 'APPROVED';
        return json(payout('APPROVED', ['MARK_PAID', 'MARK_FAILED', 'REJECT']));
      },
    });
    renderAt(`/finance/payouts/${PAYOUT_ID}`, api);
    expect(await screen.findByRole('heading', { name: 'Payout PO-7K3M9Q2X' })).toBeInTheDocument();
    expect(screen.getByText(/•••• 7890/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Approve' }),
    );
    await waitFor(() =>
      expect(called(api, 'POST', `/api/v1/finance/payouts/${PAYOUT_ID}/approve`)).toHaveLength(1),
    );
    await user.click(await screen.findByRole('button', { name: 'Record payment' }));
    await user.type(await screen.findByLabelText('Transfer reference'), 'BDO-778899');
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    await waitFor(() =>
      expect(bodyOf(api, 'POST', `/api/v1/finance/payouts/${PAYOUT_ID}/mark-paid`)).toEqual({
        transferReference: 'BDO-778899',
        transferFee: '0.00',
      }),
    );
  });

  it('only shows payout actions to staff with the permission', async () => {
    renderAt(`/finance/payouts/${PAYOUT_ID}`, fakeApi(['finance.read']));
    expect(await screen.findByRole('heading', { name: 'Payout PO-7K3M9Q2X' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('lists commission rules and ends one (history is kept)', async () => {
    const user = userEvent.setup();
    const api = fakeApi(ALL);
    renderAt('/finance/commission', api);
    const table = await screen.findByRole('table', { name: 'Commission rules' });
    expect(await within(table).findByText('Isla Tech Inc.')).toBeInTheDocument();
    expect(within(table).getByText('7%')).toBeInTheDocument();
    await user.click(within(table).getByRole('button', { name: 'End' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'End rule' }),
    );
    await waitFor(() =>
      expect(called(api, 'POST', `/api/v1/finance/commission-rules/${RULE_ID}/end`)).toHaveLength(
        1,
      ),
    );
  });

  it('creates a category commission rule from the dialog', async () => {
    const user = userEvent.setup();
    const api = fakeApi(ALL);
    renderAt('/finance/commission', api);
    await user.click(await screen.findByRole('button', { name: 'New rule' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Category id'), SELLER_ID);
    await user.type(within(dialog).getByLabelText('Rate (%)'), '7');
    await user.click(within(dialog).getByRole('button', { name: 'Create rule' }));
    await waitFor(() =>
      expect(bodyOf(api, 'POST', '/api/v1/finance/commission-rules')).toMatchObject({
        scope: 'CATEGORY',
        type: 'PERCENTAGE',
        categoryId: SELLER_ID,
        sellerId: null,
        productId: null,
        ratePercent: '7',
      }),
    );
  });

  it('posts a draft manual journal', async () => {
    const user = userEvent.setup();
    const api = fakeApi(ALL);
    renderAt(`/finance/journals/${JOURNAL_ID}`, api);
    expect(await screen.findByRole('heading', { name: 'Journal JE-ABCDEFGH' })).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Post' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Post' }),
    );
    await waitFor(() =>
      expect(called(api, 'POST', `/api/v1/finance/journals/${JOURNAL_ID}/post`)).toHaveLength(1),
    );
  });

  it('shows a balanced trial balance', async () => {
    renderAt('/finance/reports?tab=trial-balance', fakeApi(['finance.read']));
    expect(await screen.findByText('Debits equal credits.')).toBeInTheDocument();
    expect(screen.getAllByText('₱1,000.00').length).toBeGreaterThan(0);
  });

  it('lists the accounting pages in the navigation for finance staff', async () => {
    renderAt('/finance/ledger', fakeApi(['finance.read']));
    expect(await screen.findByRole('link', { name: 'Financial dashboard' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Ledger' }).length).toBeGreaterThan(0);
  });
});
