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
const PRODUCT_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5e01';
const VARIANT_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5e02';
const CATEGORY_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5e03';
const WAREHOUSE_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5e04';
const LEVEL_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5e05';
const NOW = '2026-11-25T09:00:00.000Z';

const ALL = [
  'seller.profile.manage',
  'seller.store.manage',
  'seller.members.read',
  'seller.members.manage',
  'seller.products.manage',
  'seller.pricing.manage',
  'seller.inventory.manage',
];

const session = (permissions = ALL, roles = ['SELLER_OWNER']) => ({
  user: {
    id: OWNER_ID,
    firstName: 'Lito',
    lastName: 'Santos',
    email: 'seller.owner@marketplace.local',
    emailVerified: true,
    mobile: '+639171234567',
    mobileVerified: false,
    roles,
    permissions,
    wholesaleStatus: null,
    mfaEnabled: false,
    seller: { id: SELLER_ID, businessName: 'Santos Trading', status: 'VERIFIED', isOwner: true },
  },
  app: 'seller',
  accessTokenExpiresAt: '2026-11-25T09:15:00.000Z',
});

const variant = {
  id: VARIANT_ID,
  sku: 'RICE-SIN-25',
  barcode: null,
  title: 'Default',
  options: {},
  regularPrice: '500.00',
  salePrice: null,
  saleStartsAt: null,
  saleEndsAt: null,
  trackInventory: true,
  weightGrams: 25000,
  lengthCm: null,
  widthCm: null,
  heightCm: null,
  status: 'ACTIVE',
  position: 0,
  stock: { onHand: 120, reserved: 0, available: 120 },
};

const summary = {
  id: PRODUCT_ID,
  sellerId: SELLER_ID,
  sellerName: 'Santos Trading',
  storeId: STORE_ID,
  storeName: 'Santos Store',
  storeSlug: 'santos',
  name: 'Sinandomeng Rice 25 kg',
  slug: 'sinandomeng-rice-25-kg',
  status: 'DRAFT',
  category: { id: CATEGORY_ID, name: 'Rice & Grains', path: ['Groceries', 'Rice & Grains'] },
  brand: null,
  thumbnailUrl: null,
  currency: 'PHP',
  priceRange: { min: '500.00', max: '500.00' },
  variantCount: 1,
  totalAvailable: 120,
  wholesaleEnabled: true,
  submittedAt: null,
  takenDown: false,
  updatedAt: NOW,
};

const detail = (overrides: Record<string, unknown> = {}) => ({
  ...summary,
  description: 'Well-milled rice from Nueva Ecija, soft and fragrant.',
  specifications: [],
  attributeValues: { net_weight: 25 },
  categoryAttributes: [],
  seoTitle: null,
  seoDescription: null,
  seoKeywords: null,
  minOrderQuantity: 1,
  maxOrderQuantity: null,
  wholesaleMinOrderQuantity: 1,
  reviewNote: null,
  approvedAt: null,
  options: [],
  variants: [variant],
  images: [],
  priceTiers: [],
  events: [],
  missingForSubmission: ['Add at least one photo'],
  createdAt: NOW,
  ...overrides,
});

const level = {
  id: LEVEL_ID,
  warehouse: { id: WAREHOUSE_ID, name: 'Quezon City main', code: 'QC-1' },
  variant: { id: VARIANT_ID, sku: 'RICE-SIN-25', title: 'Default' },
  product: { id: PRODUCT_ID, name: 'Sinandomeng Rice 25 kg', status: 'ACTIVE' },
  quantityOnHand: 12,
  reservedQuantity: 4,
  availableQuantity: 8,
  damagedQuantity: 1,
  lowStockThreshold: 10,
  isLowStock: true,
  updatedAt: NOW,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const page = (items: unknown[]) => ({
  items,
  page: 1,
  pageSize: 20,
  totalItems: items.length,
  totalPages: 1,
});

type Routes = Record<string, (init?: RequestInit) => Response>;

function api(overrides: Routes = {}, sessionBody: unknown = session()) {
  const routes: Routes = {
    'GET /auth/session': () => json(sessionBody),
    'GET /auth/csrf': () => json({ csrfToken: 'csrf-test' }),
    'GET /products/mine': () => json(page([summary])),
    [`GET /products/${PRODUCT_ID}`]: () => json(detail()),
    'GET /stores/mine': () =>
      json({ stores: [{ id: STORE_ID, name: 'Santos Store', status: 'ACTIVE' }], canCreate: true }),
    'GET /categories': () =>
      json({
        categories: [
          {
            id: CATEGORY_ID,
            parentId: null,
            name: 'Rice & Grains',
            slug: 'rice',
            description: null,
            imageUrl: null,
            status: 'ACTIVE',
            sortOrder: 0,
            depth: 0,
            path: ['Rice & Grains'],
            childCount: 0,
            productCount: 1,
            attributes: [],
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
      }),
    [`GET /categories/${CATEGORY_ID}/attributes`]: () =>
      json({
        categoryId: CATEGORY_ID,
        attributes: [
          {
            id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5e10',
            categoryId: CATEGORY_ID,
            code: 'net_weight',
            name: 'Net weight',
            type: 'NUMBER',
            options: [],
            unit: 'kg',
            isRequired: true,
            sortOrder: 0,
          },
        ],
      }),
    'GET /brands': () => json(page([])),
    [`GET /products/${PRODUCT_ID}/customer-prices`]: () => json({ items: [] }),
    'GET /inventory/summary': () =>
      json({
        warehouses: 1,
        skus: 1,
        onHand: 12,
        reserved: 4,
        available: 8,
        damaged: 1,
        lowStock: 1,
        outOfStock: 0,
        activeReservations: 2,
      }),
    'GET /inventory/stock': () => json({ ...page([level]), pageSize: 25 }),
    'GET /inventory/warehouses': () =>
      json({
        warehouses: [
          {
            id: WAREHOUSE_ID,
            name: 'Quezon City main',
            code: 'QC-1',
            addressLine1: '12 Mabini St',
            addressLine2: null,
            barangay: null,
            city: 'Quezon City',
            province: 'Metro Manila',
            postalCode: '1105',
            contactName: null,
            phone: null,
            status: 'ACTIVE',
            isDefault: true,
            totals: { skus: 1, onHand: 12, reserved: 4, damaged: 1 },
            createdAt: NOW,
          },
        ],
      }),
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

const bodyOf = (fetchImpl: ReturnType<typeof api>, method: string, path: string) => {
  const call = fetchImpl.mock.calls.find(
    ([input, init]) =>
      String(input).endsWith(path) && (init as RequestInit | undefined)?.method === method,
  );
  return call
    ? (JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>)
    : undefined;
};

describe('Seller Center catalog', () => {
  it('lists products with price, stock and status', async () => {
    renderAt('/products', api());
    const row = (await screen.findByRole('link', { name: 'Sinandomeng Rice 25 kg' })).closest(
      'tr',
    )!;
    expect(within(row).getByText('₱500.00')).toBeInTheDocument();
    expect(within(row).getByText('Draft')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Add product/ })).toBeInTheDocument();
  });

  it('hides "Add product" from employees without seller.products.manage', async () => {
    renderAt('/products', api({}, session(['seller.members.read'], ['SELLER_ACCOUNTING'])));
    await screen.findByRole('link', { name: 'Sinandomeng Rice 25 kg' });
    expect(screen.queryByRole('link', { name: /Add product/ })).not.toBeInTheDocument();
  });

  it('shows what is missing and keeps submit disabled', async () => {
    renderAt(`/products/${PRODUCT_ID}`, api());
    expect(
      await screen.findByRole('list', { name: 'Missing before submission' }),
    ).toHaveTextContent('Add at least one photo');
    expect(screen.getByRole('button', { name: /Submit for approval/ })).toBeDisabled();
  });

  it('generates variants from options with a SKU prefix and price', async () => {
    const fetchImpl = api({ [`PUT /products/${PRODUCT_ID}/options`]: () => json(detail()) });
    renderAt(`/products/${PRODUCT_ID}`, fetchImpl);
    await userEvent.click(await screen.findByRole('tab', { name: /Variants/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Add option/ }));
    await userEvent.type(screen.getByLabelText('Option 1'), 'Size');
    await userEvent.type(screen.getByLabelText('Values, separated by commas'), 'S, M, L');
    expect(screen.getByText('3 combination(s)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save options' }));
    await vi.waitFor(() =>
      expect(bodyOf(fetchImpl, 'PUT', `/products/${PRODUCT_ID}/options`)).toEqual({
        options: [{ name: 'Size', values: ['S', 'M', 'L'] }],
        generate: { skuPrefix: 'RICE', regularPrice: '500.00' },
      }),
    );
  });

  it('saves wholesale tiers as entered', async () => {
    const fetchImpl = api({ [`PUT /products/${PRODUCT_ID}/price-tiers`]: () => json(detail()) });
    renderAt(`/products/${PRODUCT_ID}`, fetchImpl);
    await userEvent.click(await screen.findByRole('tab', { name: 'Pricing' }));
    for (const [qty, price] of [
      ['10', '450.00'],
      ['50', '420.00'],
    ]) {
      await userEvent.click(screen.getByRole('button', { name: /Add tier/ }));
      const rows = screen.getAllByLabelText(/from quantity$/);
      await userEvent.type(rows[rows.length - 1]!, qty!);
      const prices = screen.getAllByLabelText(/unit price$/);
      await userEvent.type(prices[prices.length - 1]!, price!);
    }
    await userEvent.click(screen.getByRole('button', { name: 'Save tiers' }));
    await vi.waitFor(() =>
      expect(bodyOf(fetchImpl, 'PUT', `/products/${PRODUCT_ID}/price-tiers`)).toEqual({
        tiers: [
          { variantId: null, minQuantity: '10', unitPrice: '450.00', startsAt: null, endsAt: null },
          { variantId: null, minQuantity: '50', unitPrice: '420.00', startsAt: null, endsAt: null },
        ],
      }),
    );
  });

  it('shows category attributes on the details tab', async () => {
    renderAt(`/products/${PRODUCT_ID}`, api());
    expect(await screen.findByLabelText('Net weight (kg) *')).toHaveValue('25');
  });

  it('warns that content changes to an approved product need approval again', async () => {
    renderAt(
      `/products/${PRODUCT_ID}`,
      api({
        [`GET /products/${PRODUCT_ID}`]: () =>
          json(detail({ status: 'ACTIVE', missingForSubmission: [] })),
      }),
    );
    expect(await screen.findByText(/sends the product back for\s+approval/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hide/ })).toBeInTheDocument();
  });
});

describe('Seller Center inventory', () => {
  it('shows totals and flags low stock', async () => {
    renderAt('/inventory', api());
    const row = (await screen.findByRole('link', { name: 'Sinandomeng Rice 25 kg' })).closest(
      'tr',
    )!;
    expect(within(row).getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('Units on hand').nextSibling).toHaveTextContent('12');
  });

  it('hides stock adjustments from employees without seller.inventory.manage', async () => {
    renderAt(
      '/inventory/adjustments',
      api({}, session(['seller.members.read', 'seller.products.manage'], ['SELLER_ENCODER'])),
    );
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    const nav = (await screen.findAllByRole('navigation', { name: 'Main' }))[0]!;
    expect(within(nav).queryByRole('link', { name: 'Stock adjustments' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Movement history' })).toBeInTheDocument();
  });

  it('lists warehouses with their stock totals', async () => {
    renderAt('/inventory/warehouses', api());
    expect(await screen.findByRole('heading', { name: 'Quezon City main' })).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add warehouse/ })).toBeInTheDocument();
  });
});
