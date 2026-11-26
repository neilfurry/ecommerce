import { createApiClient, createQueryClient } from '@marketplace/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../app/providers';
import { routes } from '../../app/routes';
import order from '../../test/fixtures/order.json';
import session from '../../test/fixtures/session.json';

const NOW = new Date().toISOString();
const LATER = new Date(Date.now() + 3_600_000).toISOString();
const PAYMENT_ID = '01a2120d-cdf9-748e-9a00-00000000aa01';
const SESSION_ID = 'cs_mock_test123';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
type Handler = (init: RequestInit | undefined) => Response;

const attempt = {
  id: PAYMENT_ID,
  reference: 'PAY-7K3M9Q2X',
  method: 'GCASH',
  provider: 'MOCK',
  status: 'PENDING',
  amount: order.grandTotal,
  test: true,
  checkoutUrl: `http://localhost:5173/pay/mock/${SESSION_ID}`,
  expiresAt: LATER,
  paidAt: null,
  failureMessage: null,
  proofs: [],
  createdAt: NOW,
};

/** The captured COD order, turned into one waiting for a (test) GCash payment. */
const awaiting = {
  ...order,
  status: 'AWAITING_PAYMENT',
  paymentMethod: 'GCASH',
  paymentStatus: 'PENDING',
  paymentDueAt: LATER,
  cancellable: true,
  sellerOrders: order.sellerOrders.map((so) => ({ ...so, status: 'AWAITING_PAYMENT', cod: null })),
  payment: { ...order.payment, attempts: [attempt], canPay: true },
};

const so0 = order.sellerOrders[0]!;
/** One package delivered by the mock courier, inside its return window. */
const delivered = {
  ...order,
  sellerOrders: [
    {
      ...so0,
      status: 'DELIVERED',
      deliveredAt: NOW,
      returnWindowEndsAt: LATER,
      shipments: [
        {
          id: '01a2120d-cdf9-748e-9a00-00000000bb01',
          direction: 'FORWARD',
          carrier: 'MOCK',
          carrierName: 'Mock courier (test)',
          serviceName: 'Standard',
          trackingNumber: 'MCK0123456789',
          status: 'DELIVERED',
          codAmount: '0.00',
          hasWaybill: true,
          test: true,
          failedAttempts: 0,
          pickedUpAt: NOW,
          deliveredAt: NOW,
          createdAt: NOW,
          events: [
            {
              id: '01a2120d-cdf9-748e-9a00-00000000bb02',
              status: 'DELIVERED',
              description: 'Delivered',
              location: 'Recipient address',
              occurredAt: NOW,
              source: 'CARRIER',
            },
          ],
        },
      ],
      actions: { ...so0.actions, cancel: false, requestReturn: true },
    },
    ...order.sellerOrders.slice(1),
  ],
};

function api(detail: unknown, overrides: Record<string, Handler> = {}) {
  const routes: Record<string, Handler> = {
    'GET /auth/session': () => json(session),
    'GET /auth/csrf': () => json({ csrfToken: 'csrf-test' }),
    'GET /categories': () => json({ categories: [] }),
    'GET /cart': () => json({ groups: [], items: [], itemCount: 0, subtotal: '0.00' }),
    [`GET /account/orders/${order.id}`]: () => json(detail),
    ...overrides,
  };
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/api(\/v1)?/, '');
    const handler = routes[`${init?.method ?? 'GET'} ${path}`];
    return handler
      ? handler(init)
      : json({ error: { code: 'NOT_FOUND', message: 'Not found', statusCode: 404 } }, 404);
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

function renderAt(path: string, fetchImpl: typeof fetch) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  render(
    <AppProviders
      apiClient={createApiClient({ baseUrl: '/api', app: 'storefront', fetchImpl })}
      queryClient={queryClient}
    >
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

const calls = (fetchImpl: ReturnType<typeof api>, method: string, path: string) =>
  fetchImpl.mock.calls.filter(
    ([input, init]) =>
      new URL(String(input), 'http://localhost').pathname.endsWith(path) &&
      ((init as RequestInit | undefined)?.method ?? 'GET') === method,
  ) as [RequestInfo, RequestInit][];

describe('paying for an order', () => {
  it('marks test payments and opens the provider page with “Pay now”', async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const fetchImpl = api(awaiting, {
      [`POST /account/orders/${order.id}/payments`]: () =>
        json({ payment: attempt, checkoutUrl: attempt.checkoutUrl }),
    });
    renderAt(`/account/orders/${order.id}`, fetchImpl);
    const panel = await screen.findByTestId('payment-panel');
    expect(within(panel).getByText(/Test payment — no real money moves/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: /Pay .* now/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(attempt.checkoutUrl));
    expect(calls(fetchImpl, 'POST', `/account/orders/${order.id}/payments`)).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('asks the server to verify after returning from the payment page (the redirect proves nothing)', async () => {
    const fetchImpl = api(awaiting, {
      [`POST /account/orders/${order.id}/payments/verify`]: () => json(awaiting),
    });
    const router = renderAt(`/account/orders/${order.id}?payment=${attempt.reference}`, fetchImpl);
    await waitFor(() =>
      expect(calls(fetchImpl, 'POST', `/account/orders/${order.id}/payments/verify`)).toHaveLength(
        1,
      ),
    );
    await waitFor(() => expect(router.state.location.search).toBe(''));
    // Still waiting: the page does not claim the order is paid.
    expect(await screen.findByTestId('payment-panel')).toBeInTheDocument();
  });

  it('completes the mock provider page and returns to the order', async () => {
    const user = userEvent.setup();
    const mockSession = {
      id: SESSION_ID,
      status: 'OPEN',
      amount: order.grandTotal,
      paymentReference: attempt.reference,
      method: 'GCASH',
      orderId: order.id,
      orderNumber: order.orderNumber,
      test: true,
    };
    const fetchImpl = api(awaiting, {
      [`GET /dev/mock-payments/${SESSION_ID}`]: () => json(mockSession),
      [`POST /dev/mock-payments/${SESSION_ID}`]: () => json({ ...mockSession, status: 'PAID' }),
      [`POST /account/orders/${order.id}/payments/verify`]: () => json(awaiting),
    });
    const router = renderAt(`/pay/mock/${SESSION_ID}`, fetchImpl);
    expect(await screen.findByText('Test payment page')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pay (test)' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/account/orders/${order.id}`));
    const [, init] = calls(fetchImpl, 'POST', `/dev/mock-payments/${SESSION_ID}`)[0]!;
    expect(JSON.parse(String(init.body))).toEqual({ outcome: 'paid' });
  });
});

describe('after delivery', () => {
  it('shows tracking and requests a return with the chosen items', async () => {
    const user = userEvent.setup();
    const fetchImpl = api(delivered, {
      'POST /account/returns': () => json({}, 500),
    });
    renderAt(`/account/orders/${order.id}`, fetchImpl);
    expect(await screen.findByText('MCK0123456789')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Return or refund' }));
    const dialog = await screen.findByRole('dialog');
    const item = so0.items[0]!;
    await user.clear(within(dialog).getByLabelText(item.productName));
    await user.type(within(dialog).getByLabelText(item.productName), '1');
    await user.type(within(dialog).getByLabelText('What happened?'), 'The screen arrived cracked.');
    await user.click(within(dialog).getByRole('button', { name: 'Request return' }));
    await waitFor(() => expect(calls(fetchImpl, 'POST', '/account/returns')).toHaveLength(1));
    const [, init] = calls(fetchImpl, 'POST', '/account/returns')[0]!;
    const form = init.body as FormData;
    expect(JSON.parse(String(form.get('data')))).toMatchObject({
      sellerOrderId: so0.id,
      items: [{ orderItemId: item.id, quantity: 1 }],
      reason: 'DAMAGED',
      requestedResolution: 'FULL_REFUND',
    });
  });
});
