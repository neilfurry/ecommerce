import { createApiClient, createQueryClient } from '@marketplace/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../app/providers';
import { buildRoutes } from '../../app/routes';
import { sessionFor } from '../../test/session';

const NOW = '2026-11-26T09:00:00.000Z';
const PROOF_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7101';
const PAYMENT_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7102';
const ORDER_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7103';
const SO_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7104';
const COD_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7105';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const page = <T,>(items: T[]) => ({
  items,
  page: 1,
  pageSize: 25,
  totalItems: items.length,
  totalPages: 1,
});

const proof = {
  id: PROOF_ID,
  status: 'SUBMITTED',
  bankName: 'BDO',
  referenceNumber: 'BDO-111',
  amount: '1499.00',
  transferredAt: NOW,
  rejectionReason: null,
  createdAt: NOW,
  reviewedAt: null,
  payment: { id: PAYMENT_ID, reference: 'PAY-7K3M9Q2X', amount: '1499.00', status: 'PENDING' },
  order: {
    id: ORDER_ID,
    orderNumber: 'MP261126ABCDEF',
    status: 'AWAITING_PAYMENT',
    paymentDueAt: NOW,
  },
  customer: { name: 'Maria Cruz', email: 'customer@marketplace.local' },
  reviewedBy: null,
};

const collection = {
  id: COD_ID,
  sellerOrderId: SO_ID,
  sellerOrderNumber: 'MP261126ABCDEF-1',
  orderId: ORDER_ID,
  carrier: 'MOCK',
  trackingNumber: 'MCK0123456789',
  sellerName: 'Isla Tech Inc.',
  expectedAmount: '1078.00',
  collectedAmount: '1078.00',
  status: 'COLLECTED',
  collectedAt: NOW,
  remittanceId: null,
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
    'GET /api/v1/payments/bank-transfer-proofs': () => json(page([proof])),
    [`POST /api/v1/payments/bank-transfer-proofs/${PROOF_ID}/approve`]: () =>
      json({ ...proof, status: 'APPROVED', reviewedAt: NOW, reviewedBy: 'Fina Admin' }),
    'GET /api/v1/cod/collections': () => json(page([collection])),
    'GET /api/v1/cod/remittances': () => json(page([])),
    'POST /api/v1/cod/remittances': (init) => {
      const body = JSON.parse(String(init?.body)) as { reference: string; amount: string };
      return json({
        id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7106',
        carrier: 'MOCK',
        reference: body.reference,
        remittedAt: NOW,
        amount: body.amount,
        expectedAmount: '1078.00',
        discrepancyNote: null,
        collections: 1,
        recordedBy: 'Fina Admin',
        createdAt: NOW,
      });
    },
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

const FINANCE = ['payments.read', 'payments.manage', 'refunds.manage', 'cod.manage'];

describe('Admin Console finance', () => {
  it('approves a bank transfer proof after confirming', async () => {
    const user = userEvent.setup();
    const api = fakeApi(FINANCE);
    renderAt('/bank-transfers', api);
    const table = await screen.findByRole('table', { name: 'Bank transfer proofs' });
    expect(await within(table).findByText('BDO-111')).toBeInTheDocument();
    await user.click(within(table).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Confirm ₱1,499.00 arrived\?/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /Confirm|Continue|Approve/ }));
    await waitFor(() =>
      expect(
        called(api, 'POST', `/api/v1/payments/bank-transfer-proofs/${PROOF_ID}/approve`),
      ).toHaveLength(1),
    );
  });

  it('hides approval from staff who may only look', async () => {
    renderAt('/bank-transfers', fakeApi(['payments.read']));
    const table = await screen.findByRole('table', { name: 'Bank transfer proofs' });
    expect(await within(table).findByText('BDO-111')).toBeInTheDocument();
    expect(within(table).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('records a courier remittance for selected collected parcels', async () => {
    const user = userEvent.setup();
    const api = fakeApi(FINANCE);
    renderAt('/cod', api);
    await user.click(await screen.findByRole('checkbox', { name: 'Include MP261126ABCDEF-1' }));
    await user.type(screen.getByLabelText('Remittance reference'), 'RMT-0001');
    await user.type(screen.getByLabelText('Amount received (₱)'), '1078.00');
    await user.type(screen.getByLabelText('Received on'), '2026-11-26T10:00');
    await user.click(screen.getByRole('button', { name: 'Record remittance' }));
    await waitFor(() => expect(called(api, 'POST', '/api/v1/cod/remittances')).toHaveLength(1));
    const body = JSON.parse(
      String(called(api, 'POST', '/api/v1/cod/remittances')[0]![1]?.body),
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      carrier: 'MOCK',
      reference: 'RMT-0001',
      amount: '1078.00',
      collectionIds: [COD_ID],
    });
    expect(body).not.toHaveProperty('discrepancyNote');
  });
});
