import { createApiClient, createQueryClient } from '@marketplace/api-client';
import type { Permission } from '@marketplace/shared-types';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../app/providers';
import { buildRoutes } from '../../app/routes';
import { sessionFor } from '../../test/session';

const NOW = '2026-11-25T09:00:00.000Z';
const ORDER_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7001';
const SO1 = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7002';
const SO2 = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7003';
const SELLER_1 = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7004';
const SELLER_2 = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7005';
const STORE_1 = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7006';
const STORE_2 = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7007';
const CUSTOMER_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7008';
const REVIEW_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c7009';
const PRODUCT_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c700a';
const RULE_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c700b';
const CATEGORY_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c700c';

const json = (body: unknown, status = 200) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });
const page = <T,>(items: T[]) => ({
  items,
  page: 1,
  pageSize: 25,
  totalItems: items.length,
  totalPages: 1,
});

const address = {
  recipientName: 'Maria Cruz',
  mobile: '+639171112222',
  streetAddress: '45 Kalayaan St',
  addressLine2: null,
  barangay: 'Bagong Pag-asa',
  city: 'Quezon City',
  province: null,
  region: 'National Capital Region',
  postalCode: '1105',
  formatted: '45 Kalayaan St, Bagong Pag-asa, Quezon City, Metro Manila 1105',
};

const sellerOrder = (id: string, n: number, store: string, storeName: string, total: string) => ({
  id,
  number: `MP261125ABC123-${n}`,
  status: 'PENDING',
  sellerId: n === 1 ? SELLER_1 : SELLER_2,
  store: { id: store, name: storeName, slug: storeName.toLowerCase() },
  items: [],
  shipping: null,
  itemsSubtotal: total,
  wholesaleSavings: '0.00',
  sellerDiscount: '0.00',
  platformDiscount: '0.00',
  shippingFee: '0.00',
  shippingDiscount: '0.00',
  charges: [],
  vatAmount: '0.00',
  total,
  customerNote: null,
});

const orderSummary = {
  id: ORDER_ID,
  orderNumber: 'MP261125ABC123',
  status: 'PLACED',
  paymentMethod: 'COD',
  paymentStatus: 'PAY_ON_DELIVERY',
  grandTotal: '33598.00',
  currency: 'PHP',
  itemCount: 2,
  sellerCount: 2,
  preview: [],
  paymentDueAt: null,
  placedAt: NOW,
  customer: { id: CUSTOMER_ID, name: 'Maria Cruz', email: 'customer@marketplace.local' },
  buyerType: 'RETAIL',
};

const orderDetail = {
  ...orderSummary,
  address,
  contactEmail: 'customer@marketplace.local',
  sellerOrders: [
    sellerOrder(SO1, 1, STORE_1, 'Isla Tech Gadgets', '32999.00'),
    sellerOrder(SO2, 2, STORE_2, 'Click & Type', '599.00'),
  ],
  coupons: [{ code: 'FREESHIP', scope: 'PLATFORM', type: 'FREE_SHIPPING', amount: '150.00' }],
  totals: {
    itemsSubtotal: '33598.00',
    wholesaleSavings: '0.00',
    couponDiscount: '0.00',
    shippingFee: '150.00',
    shippingDiscount: '150.00',
    chargesTotal: '0.00',
    vatAmount: '3599.79',
    grandTotal: '33598.00',
  },
  vat: { rate: '0.1200', included: true },
  events: [{ type: 'PLACED', note: null, createdAt: NOW }],
  cancelledAt: null,
  cancelReason: null,
  cancellable: true,
  commissionAmount: '1679.90',
};

const sellerOrderSummary = {
  id: SO1,
  number: 'MP261125ABC123-1',
  orderNumber: 'MP261125ABC123',
  status: 'PENDING',
  paymentMethod: 'COD',
  paymentStatus: 'PAY_ON_DELIVERY',
  customerName: 'Maria Cruz',
  itemCount: 1,
  total: '32999.00',
  commissionAmount: '1649.95',
  store: { id: STORE_1, name: 'Isla Tech Gadgets' },
  seller: { id: SELLER_1, businessName: 'Isla Tech Inc.' },
  placedAt: NOW,
};

const review = {
  id: REVIEW_ID,
  rating: 1,
  title: 'Spam',
  body: 'Buy followers at example dot com',
  authorName: 'Juan D.',
  variantTitle: 'Black',
  createdAt: NOW,
  status: 'PUBLISHED',
  moderationNote: null,
  product: { id: PRODUCT_ID, name: 'Wireless Mouse' },
  store: { id: STORE_2, name: 'Click & Type' },
  customerEmail: 'customer@marketplace.local',
};

const settings = {
  checkout: {
    vat: { rate: '0.1200', pricesIncludeVat: true },
    charges: [],
    paymentWindowMinutes: 60,
    paymentMethods: ['COD', 'GCASH'],
  },
  shippingRates: {
    base: {
      sameCity: '80.00',
      sameRegion: '100.00',
      sameIslandGroup: '150.00',
      otherIslandGroup: '200.00',
    },
    perAdditionalKg: '25.00',
    volumetricDivisor: 3500,
    expressMultiplier: '1.60',
    sameDayFee: '180.00',
  },
  commissionRules: [{ id: RULE_ID, category: null, ratePercent: '5.00', updatedAt: NOW }],
};

type Routes = Record<string, (init?: RequestInit) => Response>;

function fakeApi(permissions?: Permission[], overrides: Routes = {}) {
  const routes: Routes = {
    'GET /api/v1/auth/csrf': () => json({ csrfToken: 'csrf-test' }),
    'GET /api/v1/auth/session': () =>
      json(permissions ? sessionFor(['ADMIN'], permissions) : sessionFor()),
    'GET /api/v1/auth/mfa': () =>
      json({ enabled: false, enabledAt: null, recoveryCodesRemaining: 0 }),
    'GET /api/v1/orders': () => json(page([orderSummary])),
    [`GET /api/v1/orders/${ORDER_ID}`]: () => json(orderDetail),
    'GET /api/v1/seller-orders': () => json(page([sellerOrderSummary])),
    'GET /api/v1/reviews': () => json(page([review])),
    [`PATCH /api/v1/reviews/${REVIEW_ID}`]: (init) =>
      json({ ...review, status: 'HIDDEN', moderationNote: JSON.parse(String(init?.body)).note }),
    'GET /api/v1/settings': () => json(settings),
    'PUT /api/v1/settings/checkout': (init) => json(JSON.parse(String(init?.body))),
    'PUT /api/v1/settings/commission-rules': () =>
      json({
        items: [
          ...settings.commissionRules,
          {
            id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c700d',
            category: { id: CATEGORY_ID, name: 'Laptops', path: ['Electronics', 'Laptops'] },
            ratePercent: '3.50',
            updatedAt: NOW,
          },
        ],
      }),
    'GET /api/v1/categories/all': () =>
      json({
        categories: [
          {
            id: CATEGORY_ID,
            parentId: null,
            name: 'Laptops',
            slug: 'laptops',
            description: null,
            imageUrl: null,
            status: 'ACTIVE',
            sortOrder: 0,
            depth: 1,
            path: ['Electronics', 'Laptops'],
            childCount: 0,
            productCount: 2,
            attributes: [],
            createdAt: NOW,
            updatedAt: NOW,
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
  return router;
}

const bodyOf = (api: ReturnType<typeof fakeApi>, method: string, path: string) => {
  const call = api.mock.calls.find(
    ([url, init]) => url.split('?')[0] === path && (init?.method ?? 'GET') === method,
  );
  return call ? (JSON.parse(String(call[1]?.body)) as unknown) : undefined;
};

describe('Admin Console sales', () => {
  it('lists customer orders and seller suborders', async () => {
    const user = userEvent.setup();
    renderAt('/orders', fakeApi());
    expect(await screen.findByRole('link', { name: 'MP261125ABC123' })).toBeInTheDocument();
    expect(screen.getByText('₱33,598.00')).toBeInTheDocument();
    expect(screen.getByText('2 · 2 items')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Seller orders' }));
    expect(await screen.findByRole('link', { name: 'MP261125ABC123-1' })).toBeInTheDocument();
    expect(screen.getByText('Isla Tech Inc.')).toBeInTheDocument();
    expect(screen.getByText('₱1,649.95')).toBeInTheDocument();
  });

  it('shows one order split into a suborder per seller', async () => {
    renderAt(`/orders/${ORDER_ID}`, fakeApi());
    expect(
      await screen.findByRole('heading', { name: 'Order MP261125ABC123' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Seller orders (2)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'MP261125ABC123-1' })).toHaveAttribute(
      'href',
      `/seller-orders/${SO1}`,
    );
    expect(screen.getByRole('link', { name: 'MP261125ABC123-2' })).toBeInTheDocument();
    expect(screen.getByText('₱1,679.90')).toBeInTheDocument();
    expect(screen.getByText('FREESHIP')).toBeInTheDocument();
  });

  it('hides a review with a reason', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderAt('/reviews', api);
    expect(await screen.findByText('Buy followers at example dot com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Reason/), 'Spam link');
    await user.click(within(dialog).getByRole('button', { name: 'Hide review' }));
    await vi.waitFor(() =>
      expect(bodyOf(api, 'PATCH', `/api/v1/reviews/${REVIEW_ID}`)).toEqual({
        status: 'HIDDEN',
        note: 'Spam link',
      }),
    );
  });

  it('saves the VAT rate as a fraction', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderAt('/settings', api);
    const vat = await screen.findByLabelText('VAT rate (%)');
    expect(vat).toHaveValue('12');
    await user.clear(vat);
    await user.type(vat, '10');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await vi.waitFor(() =>
      expect(bodyOf(api, 'PUT', '/api/v1/settings/checkout')).toEqual({
        vat: { rate: '0.1000', pricesIncludeVat: true },
        charges: [],
        paymentWindowMinutes: 60,
        paymentMethods: ['COD', 'GCASH'],
      }),
    );
  });

  it('rejects a payment window outside 5–60 minutes without calling the API', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderAt('/settings', api);
    const field = await screen.findByLabelText('Payment window (minutes)');
    await user.clear(field);
    await user.type(field, '600');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await vi.waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(bodyOf(api, 'PUT', '/api/v1/settings/checkout')).toBeUndefined();
  });

  it('sets the default commission rate', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderAt('/settings', api);
    await user.click(await screen.findByRole('tab', { name: 'Commission' }));
    expect(await screen.findAllByText('Default (all categories)')).not.toHaveLength(0);
    await user.type(screen.getByLabelText('Rate (%)'), '6.5');
    await user.click(screen.getByRole('button', { name: 'Set rate' }));
    await vi.waitFor(() =>
      expect(bodyOf(api, 'PUT', '/api/v1/settings/commission-rules')).toEqual({
        categoryId: null,
        ratePercent: '6.5',
      }),
    );
  });

  it('shows sales pages by permission', async () => {
    renderAt('/orders', fakeApi(['orders.read', 'reviews.moderate']));
    expect(await screen.findAllByRole('link', { name: 'Orders' })).not.toHaveLength(0);
    expect(screen.getAllByRole('link', { name: 'Reviews' })).not.toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Promotions' })).not.toBeInTheDocument();
  });
});
