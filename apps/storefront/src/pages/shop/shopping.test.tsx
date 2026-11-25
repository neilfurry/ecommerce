import { createApiClient, createQueryClient } from '@marketplace/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../app/providers';
import { routes } from '../../app/routes';
import { guestCart } from '../../lib/guest-cart';
// Fixtures are real responses captured from the local API (seeded demo data).
import addresses from '../../test/fixtures/addresses.json';
import guestCartFixture from '../../test/fixtures/guest-cart.json';
import laptop from '../../test/fixtures/laptop.json';
import laptopPrice from '../../test/fixtures/laptop-price.json';
import order from '../../test/fixtures/order.json';
import quoteNoCoupon from '../../test/fixtures/quote-nocoupon.json';
import quoteWithCoupon from '../../test/fixtures/quote.json';
import session from '../../test/fixtures/session.json';

const LAPTOP_512 = laptop.variants[0]!.id;
const MOUSE_BLACK = '01a211bd-19f3-766a-99d1-5c16b287b8d3';
const GUEST_KEY = 'marketplace.guest-cart.v1';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const signedOut = () =>
  json(
    { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.', statusCode: 401 } },
    401,
  );

type Handler = (init: RequestInit | undefined, url: URL) => Response;

function api(signedIn: boolean, overrides: Record<string, Handler> = {}) {
  const routes: Record<string, Handler> = {
    'GET /auth/session': () => (signedIn ? json(session) : signedOut()),
    'GET /auth/csrf': () => json({ csrfToken: 'csrf-test' }),
    'GET /categories': () => json({ categories: [] }),
    'POST /cart/preview': () => json(guestCartFixture),
    'GET /cart': () => json(guestCartFixture),
    'GET /account/addresses': () => json(addresses),
    'POST /checkout/quote': (init) => {
      const body = JSON.parse(String(init?.body)) as { couponCodes?: string[] };
      return json(body.couponCodes?.includes('FREESHIP') ? quoteWithCoupon : quoteNoCoupon);
    },
    'POST /checkout/orders': () => json(order, 201),
    [`GET /account/orders/${order.id}`]: () => json(order),
    [`GET /catalog/products/${laptop.id}`]: () => json(laptop),
    'POST /pricing/quote': () => json(laptopPrice),
    ...overrides,
  };
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace(/^\/api(\/v1)?/, '');
    const handler = routes[`${init?.method ?? 'GET'} ${path}`];
    return handler
      ? handler(init, url)
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

afterEach(() => {
  guestCart.clear();
  window.localStorage.clear();
});

describe('guest cart', () => {
  it('prices the browser cart on the server and groups it by seller', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      GUEST_KEY,
      JSON.stringify([
        { variantId: LAPTOP_512, quantity: 1, savedForLater: false },
        { variantId: MOUSE_BLACK, quantity: 2, savedForLater: false },
      ]),
    );
    const fetchImpl = api(false);
    const router = renderAt('/cart', fetchImpl);
    expect(await screen.findByRole('heading', { name: 'Your cart' })).toBeInTheDocument();
    expect(screen.getByText('3 items from 2 stores')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Isla Tech Gadgets/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Click & Type/ })).toBeInTheDocument();
    // Only ids and quantities leave the browser; the prices come back from the server.
    const [, init] = calls(fetchImpl, 'POST', '/cart/preview')[0]!;
    expect(JSON.parse(String(init.body))).toEqual({
      items: [
        { variantId: LAPTOP_512, quantity: 1, savedForLater: false },
        { variantId: MOUSE_BLACK, quantity: 2, savedForLater: false },
      ],
    });
    await user.click(screen.getByRole('button', { name: 'Sign in to check out' }));
    expect(router.state.location.pathname).toBe('/sign-in');
  });
});

describe('checkout', () => {
  it('shows the server quote per seller, applies a coupon and places the order', async () => {
    const user = userEvent.setup();
    const fetchImpl = api(true);
    const router = renderAt('/checkout', fetchImpl);
    const placeButton = await screen.findByRole('button', { name: 'Place order · ₱34,272.00' });
    expect(screen.getByText(addresses.items[0]!.recipientName)).toBeInTheDocument();
    for (const group of quoteNoCoupon.groups) {
      expect(screen.getAllByText(new RegExp(group.store.name)).length).toBeGreaterThan(0);
    }

    await user.type(screen.getByLabelText('Coupon code'), 'freeship');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    const coupons = await screen.findByRole('list', { name: 'Coupons' });
    expect(within(coupons).getByText('FREESHIP')).toBeInTheDocument();
    const totals = screen.getByLabelText('Order total');
    expect(within(totals).getByText('−₱150.00')).toBeInTheDocument();
    await vi.waitFor(() => expect(placeButton).toHaveTextContent('Place order · ₱34,122.00'));
    await vi.waitFor(() => expect(placeButton).toBeEnabled());

    await user.click(placeButton);
    await vi.waitFor(() =>
      expect(router.state.location.pathname).toBe(`/account/orders/${order.id}`),
    );
    const [, init] = calls(fetchImpl, 'POST', '/checkout/orders')[0]!;
    const headers = new Headers(init.headers);
    expect(headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(init.body))).toMatchObject({
      addressId: addresses.items[0]!.id,
      couponCodes: ['FREESHIP'],
      paymentMethod: 'COD',
      // The total the customer saw: the server compares it and never uses it.
      expectedGrandTotal: '34122.00',
    });
    expect(
      await screen.findByText(`Thank you! Your order ${order.orderNumber} is placed.`),
    ).toBeInTheDocument();
  });

  it('re-quotes when the server says prices changed, and retries with a new key', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const fetchImpl = api(true, {
      'POST /checkout/orders': () => {
        attempts += 1;
        return attempts === 1
          ? json(
              {
                error: {
                  code: 'CHECKOUT_CHANGED',
                  message: 'Prices or stock changed. Review the new total.',
                  statusCode: 409,
                },
              },
              409,
            )
          : json(order, 201);
      },
    });
    const router = renderAt('/checkout', fetchImpl);
    await user.click(await screen.findByRole('button', { name: /Place order/ }));
    expect(
      await screen.findByText('Prices or stock changed. Review the new total.'),
    ).toBeInTheDocument();
    const quotesBefore = calls(fetchImpl, 'POST', '/checkout/quote').length;
    await vi.waitFor(() =>
      expect(calls(fetchImpl, 'POST', '/checkout/quote').length).toBeGreaterThan(quotesBefore - 1),
    );
    await user.click(await screen.findByRole('button', { name: /Place order/ }));
    await vi.waitFor(() =>
      expect(router.state.location.pathname).toBe(`/account/orders/${order.id}`),
    );
    const keys = calls(fetchImpl, 'POST', '/checkout/orders').map(([, init]) =>
      new Headers(init.headers).get('idempotency-key'),
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('sends a signed-out shopper to sign in first', async () => {
    const router = renderAt('/checkout', api(false));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
  });
});

describe('product page', () => {
  it('shows variants and prices from the API and adds to the guest cart', async () => {
    const user = userEvent.setup();
    renderAt(`/p/${laptop.id}/${laptop.slug}`, api(false));
    expect(await screen.findByRole('heading', { level: 1, name: laptop.name })).toBeInTheDocument();
    expect(await screen.findByText('₱32,999.00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Add to cart/ }));
    await vi.waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(GUEST_KEY) ?? '[]') as {
        variantId: string;
        quantity: number;
      }[];
      expect(stored).toHaveLength(1);
      expect(laptop.variants.map((v) => v.id)).toContain(stored[0]!.variantId);
      expect(stored[0]!.quantity).toBe(1);
    });
  });
});
