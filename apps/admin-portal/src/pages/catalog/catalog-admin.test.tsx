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
const SELLER_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d70';
const PRODUCT_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5e01';
const CATEGORY_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5e03';
const CHILD_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5e06';
const BRAND_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5e07';

const json = (body: unknown, status = 200) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });
const page = <T,>(items: T[]) => ({
  items,
  page: 1,
  pageSize: 20,
  totalItems: items.length,
  totalPages: 1,
});

const summary = {
  id: PRODUCT_ID,
  sellerId: SELLER_ID,
  sellerName: 'Santos Trading',
  storeId: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d80',
  storeName: 'Santos Store',
  storeSlug: 'santos',
  name: 'Sinandomeng Rice 25 kg',
  slug: 'sinandomeng-rice-25-kg',
  status: 'PENDING_APPROVAL',
  category: { id: CATEGORY_ID, name: 'Rice', path: ['Groceries', 'Rice'] },
  brand: null as null | { id: string; name: string; status: string },
  thumbnailUrl: null,
  currency: 'PHP',
  priceRange: { min: '500.00', max: '500.00' },
  variantCount: 1,
  totalAvailable: 10,
  wholesaleEnabled: true,
  submittedAt: NOW,
  takenDown: false,
  updatedAt: NOW,
};

const detail = (overrides: Record<string, unknown> = {}) => ({
  ...summary,
  description: 'Well-milled rice from Nueva Ecija.',
  specifications: [{ name: 'Origin', value: 'Nueva Ecija' }],
  attributeValues: { net_weight: 25 },
  categoryAttributes: [
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
  seoTitle: null,
  seoDescription: null,
  seoKeywords: null,
  minOrderQuantity: 1,
  maxOrderQuantity: null,
  wholesaleMinOrderQuantity: 1,
  reviewNote: null,
  approvedAt: null,
  options: [],
  variants: [
    {
      id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5e02',
      sku: 'RICE-SIN-25',
      barcode: null,
      title: 'Default',
      options: {},
      regularPrice: '500.00',
      salePrice: null,
      saleStartsAt: null,
      saleEndsAt: null,
      trackInventory: true,
      weightGrams: null,
      lengthCm: null,
      widthCm: null,
      heightCm: null,
      status: 'ACTIVE',
      position: 0,
      stock: { onHand: 10, reserved: 0, available: 10 },
    },
  ],
  images: [],
  priceTiers: [
    {
      id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5e11',
      variantId: null,
      minQuantity: 10,
      unitPrice: '450.00',
      startsAt: null,
      endsAt: null,
    },
  ],
  events: [],
  missingForSubmission: [],
  createdAt: NOW,
  ...overrides,
});

const category = (id: string, name: string, depth: number, parentId: string | null) => ({
  id,
  parentId,
  name,
  slug: name.toLowerCase(),
  description: null,
  imageUrl: null,
  status: 'ACTIVE',
  sortOrder: 0,
  depth,
  path: depth ? ['Groceries', name] : [name],
  childCount: depth ? 0 : 1,
  productCount: depth ? 3 : 0,
  attributes: [],
  createdAt: NOW,
  updatedAt: NOW,
});

const brand = {
  id: BRAND_ID,
  name: 'Lola Recipes',
  slug: 'lola-recipes',
  description: null,
  status: 'PENDING',
  requestedBy: { sellerId: SELLER_ID, businessName: 'Santos Trading' },
  reviewNote: null,
  reviewedAt: null,
  productCount: 1,
  createdAt: NOW,
};

type Routes = Record<string, (init?: RequestInit) => Response>;

function fakeApi(permissions?: Permission[], overrides: Routes = {}) {
  const routes: Routes = {
    'GET /api/v1/auth/csrf': () => json({ csrfToken: 'csrf-test' }),
    'GET /api/v1/auth/session': () =>
      json(permissions ? sessionFor(['ADMIN'], permissions) : sessionFor()),
    'GET /api/v1/auth/mfa': () =>
      json({ enabled: false, enabledAt: null, recoveryCodesRemaining: 0 }),
    'GET /api/v1/products': () => json(page([summary])),
    [`GET /api/v1/products/${PRODUCT_ID}`]: () => json(detail()),
    [`POST /api/v1/products/${PRODUCT_ID}/review`]: () =>
      json(detail({ status: 'ACTIVE', approvedAt: NOW })),
    [`POST /api/v1/products/${PRODUCT_ID}/take-down`]: () =>
      json(detail({ status: 'INACTIVE', takenDown: true })),
    'GET /api/v1/categories/all': () =>
      json({
        categories: [
          category(CATEGORY_ID, 'Groceries', 0, null),
          category(CHILD_ID, 'Rice', 1, CATEGORY_ID),
        ],
      }),
    'POST /api/v1/categories': () => json(category(CHILD_ID, 'Snacks', 1, CATEGORY_ID), 201),
    'GET /api/v1/brands': () => json(page([brand])),
    [`POST /api/v1/brands/${BRAND_ID}/review`]: () => json({ ...brand, status: 'ACTIVE' }),
    'GET /api/v1/inventory/overview': () =>
      json({
        totals: {
          warehouses: 3,
          skus: 4,
          onHand: 250,
          reserved: 10,
          available: 240,
          damaged: 2,
          lowStock: 1,
          outOfStock: 0,
          activeReservations: 2,
        },
        sellers: page([
          {
            sellerId: SELLER_ID,
            businessName: 'Santos Trading',
            warehouses: 2,
            skus: 4,
            onHand: 250,
            reserved: 10,
            available: 240,
            damaged: 2,
            lowStock: 1,
            outOfStock: 0,
          },
        ]),
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

const callsTo = (api: ReturnType<typeof fakeApi>, method: string, path: string) =>
  api.mock.calls.filter(
    ([url, init]) => url.split('?')[0] === path && (init?.method ?? 'GET') === method,
  );
const bodyOf = (api: ReturnType<typeof fakeApi>, method: string, path: string) =>
  JSON.parse(String(callsTo(api, method, path)[0]?.[1]?.body)) as unknown;

describe('Product approval', () => {
  it('lists products waiting for approval by default', async () => {
    const api = fakeApi();
    renderAt('/catalog/products', api);
    expect(await screen.findByRole('link', { name: 'Sinandomeng Rice 25 kg' })).toBeInTheDocument();
    expect(callsTo(api, 'GET', '/api/v1/products')[0]![0]).toContain('status=PENDING_APPROVAL');
  });

  it('shows the submitted content and approves it', async () => {
    const api = fakeApi();
    renderAt(`/catalog/products/${PRODUCT_ID}`, api);
    expect(await screen.findByText('25 kg')).toBeInTheDocument();
    expect(screen.getByText('Nueva Ecija')).toBeInTheDocument();
    expect(screen.getByText(/10\+ units: ₱450.00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Approve/ }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Approve' }),
    );
    await vi.waitFor(() =>
      expect(bodyOf(api, 'POST', `/api/v1/products/${PRODUCT_ID}/review`)).toEqual({
        decision: 'APPROVE',
      }),
    );
  });

  it('needs a note to reject', async () => {
    const api = fakeApi();
    renderAt(`/catalog/products/${PRODUCT_ID}`, api);
    await userEvent.click(await screen.findByRole('button', { name: /Reject/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject product' }));
    expect(await within(dialog).findByText(/at least 5 characters/)).toBeInTheDocument();
    await userEvent.type(
      within(dialog).getByLabelText('What should the seller fix?'),
      'The photo is blurry.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject product' }));
    await vi.waitFor(() =>
      expect(bodyOf(api, 'POST', `/api/v1/products/${PRODUCT_ID}/review`)).toEqual({
        decision: 'REJECT',
        note: 'The photo is blurry.',
      }),
    );
  });

  it('cannot approve while the brand request is pending', async () => {
    const api = fakeApi(undefined, {
      [`GET /api/v1/products/${PRODUCT_ID}`]: () =>
        json(detail({ brand: { id: BRAND_ID, name: 'Lola Recipes', status: 'PENDING' } })),
    });
    renderAt(`/catalog/products/${PRODUCT_ID}`, api);
    expect(await screen.findByRole('button', { name: /Approve/ })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'decide on it first' })).toHaveAttribute(
      'href',
      '/catalog/brands',
    );
  });

  it('hides decisions from staff who can only read products', async () => {
    renderAt(`/catalog/products/${PRODUCT_ID}`, fakeApi(['catalog.products.read']));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sinandomeng Rice 25 kg' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Take down/ })).not.toBeInTheDocument();
  });
});

describe('Categories and brands', () => {
  it('shows the category tree and creates a subcategory', async () => {
    const api = fakeApi();
    renderAt('/catalog/categories', api);
    const tree = await screen.findByRole('list', { name: 'Category tree' });
    expect(within(tree).getByText('Rice')).toBeInTheDocument();
    // A category with products cannot be deleted.
    expect(screen.queryByRole('button', { name: 'Delete Rice' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add subcategory to Groceries' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Snacks');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await vi.waitFor(() =>
      expect(bodyOf(api, 'POST', '/api/v1/categories')).toMatchObject({
        name: 'Snacks',
        slug: 'snacks',
        parentId: CATEGORY_ID,
      }),
    );
  });

  it('approves a seller brand request', async () => {
    const api = fakeApi();
    renderAt('/catalog/brands', api);
    const row = (await screen.findByText('Lola Recipes')).closest('tr')!;
    expect(within(row).getByText('Santos Trading')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: /Approve/ }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Approve' }),
    );
    await vi.waitFor(() =>
      expect(bodyOf(api, 'POST', `/api/v1/brands/${BRAND_ID}/review`)).toEqual({
        decision: 'APPROVE',
      }),
    );
  });

  it('shows catalog navigation only with the permissions', async () => {
    renderAt('/system-health', fakeApi(['users.read']));
    const nav = (await screen.findAllByRole('navigation', { name: 'Main' }))[0]!;
    for (const name of ['Products', 'Categories', 'Brands', 'Inventory']) {
      expect(within(nav).queryByRole('link', { name })).not.toBeInTheDocument();
    }
  });
});

describe('Inventory overview', () => {
  it('shows totals and stock by seller', async () => {
    renderAt('/inventory', fakeApi());
    const row = (await screen.findByRole('link', { name: 'Santos Trading' })).closest('tr')!;
    expect(within(row).getByText('250')).toBeInTheDocument();
    expect(within(row).getByText('1 / 0')).toBeInTheDocument();
  });
});
