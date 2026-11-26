import { createApiClient, createQueryClient } from '@marketplace/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../app/providers';
import { routes } from '../app/routes';

const SELLER_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d70';
const OWNER_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d6e';
const STORE_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d80';
const ORDER_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c6001';
const SUBORDER_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c6002';
const ITEM_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c6003';
const PRODUCT_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c6004';
const VARIANT_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c6005';
const COUPON_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c6006';
const SALE_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c6007';
const RULE_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c6008';
const NOW = '2026-11-25T09:00:00.000Z';

const ALL = [
  'seller.profile.manage',
  'seller.store.manage',
  'seller.products.manage',
  'seller.inventory.manage',
  'seller.orders.read',
  'seller.marketing.manage',
];

const sessionBody = (permissions = ALL) => ({
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
  accessTokenExpiresAt: '2026-11-25T09:15:00.000Z',
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const page = (items: unknown[]) => ({
  items,
  page: 1,
  pageSize: 20,
  totalItems: items.length,
  totalPages: 1,
});

const summary = {
  id: SUBORDER_ID,
  number: 'MP261125ABC123-1',
  orderNumber: 'MP261125ABC123',
  status: 'PENDING',
  paymentMethod: 'COD',
  paymentStatus: 'PAY_ON_DELIVERY',
  customerName: 'Maria Cruz',
  itemCount: 2,
  total: '1078.00',
  commissionAmount: '49.90',
  store: { id: STORE_ID, name: 'Santos Store' },
  seller: { id: SELLER_ID, businessName: 'Santos Trading' },
  cancellationRequested: false,
  trackingNumber: null,
  placedAt: NOW,
};

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

const orderDetail = {
  id: SUBORDER_ID,
  number: summary.number,
  status: 'PENDING',
  sellerId: SELLER_ID,
  store: { id: STORE_ID, name: 'Santos Store', slug: 'santos' },
  items: [
    {
      id: ITEM_ID,
      productId: PRODUCT_ID,
      variantId: VARIANT_ID,
      productSlug: 'sinandomeng-rice-25-kg',
      sku: 'RICE-SIN-25',
      productName: 'Sinandomeng Rice 25 kg',
      variantTitle: 'Default',
      options: {},
      imageUrl: null,
      quantity: 2,
      unitPrice: '499.00',
      regularUnitPrice: '500.00',
      lineSubtotal: '998.00',
      sellerDiscount: '0.00',
      platformDiscount: '0.00',
      lineTotal: '998.00',
      vatAmount: '106.93',
      priceSource: 'SALE',
      reviewed: false,
    },
  ],
  shipping: {
    method: 'STANDARD',
    carrier: 'Mock Express',
    serviceName: 'Standard',
    origin: 'Quezon City',
    weightGrams: 50000,
    chargeableWeightGrams: 50000,
    fee: '80.00',
    discount: '0.00',
    etaMinDays: 1,
    etaMaxDays: 2,
  },
  itemsSubtotal: '998.00',
  wholesaleSavings: '0.00',
  sellerDiscount: '0.00',
  platformDiscount: '0.00',
  shippingFee: '80.00',
  shippingDiscount: '0.00',
  charges: [],
  vatAmount: '115.50',
  total: '1078.00',
  customerNote: null,
  acceptedAt: null,
  shippedAt: null,
  deliveredAt: null,
  completedAt: null,
  cancelledAt: null,
  cancelReason: null,
  returnWindowEndsAt: null,
  shipments: [],
  cod: { expectedAmount: '1078.00', status: 'PENDING', collectedAt: null },
  cancellationRequest: null,
  returns: [],
  refunds: [],
  notes: [],
  actions: {
    accept: true,
    cancel: true,
    requestCancellation: false,
    answerCancellation: false,
    bookShipment: false,
    updateShipment: false,
    confirmReceived: false,
    requestReturn: false,
    moveTo: [],
    canManage: true,
  },
  ledger: [],
  orderId: ORDER_ID,
  orderNumber: summary.orderNumber,
  paymentMethod: 'COD',
  paymentStatus: 'PAY_ON_DELIVERY',
  buyerType: 'RETAIL',
  customer: { name: 'Maria Cruz', email: 'customer@marketplace.local' },
  address,
  commission: {
    amount: '49.90',
    items: [
      {
        orderItemId: ITEM_ID,
        ruleId: RULE_ID,
        ratePercent: '5.00',
        base: '998.00',
        amount: '49.90',
      },
    ],
  },
  coupons: [],
  events: [
    {
      type: 'PLACED',
      sellerOrderId: null,
      fromStatus: null,
      toStatus: null,
      actorType: 'CUSTOMER',
      note: null,
      createdAt: NOW,
    },
  ],
  placedAt: NOW,
};

const coupon = {
  id: COUPON_ID,
  code: 'SANTOS50',
  scope: 'SELLER',
  seller: { id: SELLER_ID, businessName: 'Santos Trading' },
  name: 'Fifty off',
  description: null,
  type: 'FIXED_AMOUNT',
  value: '50.00',
  maxDiscount: null,
  minSpend: '500.00',
  startsAt: '2026-11-01T00:00:00.000Z',
  endsAt: '2027-11-01T00:00:00.000Z',
  usageLimit: 100,
  perCustomerLimit: 1,
  usedCount: 3,
  status: 'ACTIVE',
  createdAt: NOW,
};

const sale = {
  id: SALE_ID,
  title: 'Payday Flash Sale',
  startsAt: '2026-11-25T00:00:00.000Z',
  endsAt: '2026-11-30T00:00:00.000Z',
  status: 'ACTIVE',
  phase: 'RUNNING',
  items: [
    {
      id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c6009',
      sellerId: SELLER_ID,
      sellerName: 'Santos Trading',
      productId: PRODUCT_ID,
      productName: 'Sinandomeng Rice 25 kg',
      variantId: VARIANT_ID,
      sku: 'RICE-SIN-25',
      variantTitle: 'Default',
      regularPrice: '500.00',
      flashPrice: '420.00',
      quantityLimit: 30,
      soldQuantity: 4,
      perOrderLimit: 2,
      status: 'ACTIVE',
    },
  ],
};

function api(permissions = ALL, overrides: Record<string, (init?: RequestInit) => Response> = {}) {
  const routes: Record<string, (init?: RequestInit) => Response> = {
    'GET /auth/session': () => json(sessionBody(permissions)),
    'GET /auth/csrf': () => json({ csrfToken: 'csrf-test' }),
    'GET /seller/orders': () => json(page([summary])),
    'GET /seller/orders/counts': () =>
      json({
        NEW: 1,
        PROCESSING: 0,
        READY_FOR_PICKUP: 0,
        SHIPPED: 0,
        COMPLETED: 0,
        CANCELLED: 0,
        returns: 0,
        cancellationRequests: 0,
      }),
    [`GET /seller/orders/${SUBORDER_ID}`]: () => json(orderDetail),
    'GET /seller/coupons': () => json(page([coupon])),
    'POST /seller/coupons': (init) =>
      json({ ...coupon, ...(JSON.parse(String(init?.body)) as object), id: COUPON_ID }),
    'GET /seller/flash-sales': () => json({ items: [sale] }),
    ...overrides,
  };
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace(/^\/api(\/v1)?/, '');
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
      apiClient={createApiClient({ baseUrl: '/api', app: 'seller', fetchImpl })}
      queryClient={queryClient}
    >
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

describe('Seller Center sales', () => {
  it('lists suborders with totals and commission, and opens one', async () => {
    const user = userEvent.setup();
    const router = renderAt('/orders', api());
    const link = await screen.findByRole('link', { name: 'MP261125ABC123-1' });
    const table = screen.getByRole('table', { name: 'Orders' });
    expect(within(table).getByText('Maria Cruz')).toBeInTheDocument();
    expect(within(table).getByText('₱1,078.00')).toBeInTheDocument();
    expect(within(table).getByText('₱49.90')).toBeInTheDocument();
    expect(within(table).getByText('New')).toBeInTheDocument();
    await user.click(link);
    expect(router.state.location.pathname).toBe(`/orders/${SUBORDER_ID}`);
    expect(
      await screen.findByRole('heading', { name: 'Order MP261125ABC123-1' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Sinandomeng Rice 25 kg')).toBeInTheDocument();
    expect(screen.getByText(/Commission 5.00% of ₱998.00 = ₱49.90/)).toBeInTheDocument();
    expect(screen.getByText(address.formatted)).toBeInTheDocument();
    // Fulfilment: what the seller can do next, and the shipments and payables sections.
    expect(screen.getByRole('button', { name: 'Accept and start preparing' })).toBeInTheDocument();
    expect(screen.getByText('No shipment yet.')).toBeInTheDocument();
    expect(screen.getByText(/Nothing posted yet/)).toBeInTheDocument();
  });

  it('hides orders from employees without the orders permission', async () => {
    renderAt('/orders', api(ALL.filter((p) => p !== 'seller.orders.read')));
    expect(await screen.findByRole('heading', { name: /permission|access/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Orders' })).not.toBeInTheDocument();
  });

  it('creates a store coupon with the API shape', async () => {
    const user = userEvent.setup();
    const fetchImpl = api();
    renderAt('/marketing/coupons', fetchImpl);
    expect(await screen.findByText('SANTOS50')).toBeInTheDocument();
    expect(screen.getByText('₱50.00 off, min. ₱500.00')).toBeInTheDocument();
    expect(screen.getByText('3 / 100')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /New coupon/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Code'), 'RICE10');
    await user.type(within(dialog).getByLabelText('Name'), 'Ten percent off rice');
    await user.type(within(dialog).getByLabelText('Percent off'), '10');
    await user.type(within(dialog).getByLabelText(/Maximum discount/), '200');
    await user.click(within(dialog).getByRole('button', { name: 'Create coupon' }));
    await vi.waitFor(() => {
      const call = fetchImpl.mock.calls.find(
        ([input, init]) =>
          String(input).endsWith('/seller/coupons') &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String((call![1] as RequestInit).body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        code: 'RICE10',
        name: 'Ten percent off rice',
        type: 'PERCENTAGE',
        value: '10',
        maxDiscount: '200',
        minSpend: '0',
        perCustomerLimit: 1,
        usageLimit: null,
        status: 'ACTIVE',
      });
      expect(new Date(String(body.endsAt)) > new Date(String(body.startsAt))).toBe(true);
    });
  });

  it('shows validation from the shared schema before calling the API', async () => {
    const user = userEvent.setup();
    const fetchImpl = api();
    renderAt('/marketing/coupons', fetchImpl);
    await user.click(await screen.findByRole('button', { name: /New coupon/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Code'), 'BIG');
    await user.type(within(dialog).getByLabelText('Name'), 'Too big');
    await user.type(within(dialog).getByLabelText('Percent off'), '150');
    await user.click(within(dialog).getByRole('button', { name: 'Create coupon' }));
    expect(await within(dialog).findByText('Between 1 and 100 percent')).toBeInTheDocument();
    expect(
      fetchImpl.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST'),
    ).toBe(false);
  });

  it('lists flash sales with the seller’s items', async () => {
    renderAt('/marketing/flash-sales', api());
    expect(await screen.findByRole('heading', { name: 'Payday Flash Sale' })).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('₱420.00')).toBeInTheDocument();
    expect(screen.getByText(/4 \/ 30 sold · max 2 per order/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add a product/ })).toBeInTheDocument();
  });

  it('shows sales navigation by permission', async () => {
    renderAt('/marketing/flash-sales', api());
    const nav = await screen.findAllByRole('link', { name: 'Orders' });
    expect(nav.length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Coupons' }).length).toBeGreaterThan(0);
  });
});
