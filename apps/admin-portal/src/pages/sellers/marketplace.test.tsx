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
const OWNER_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d71';
const STORE_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d80';
const USER_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d90';
const DOC_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5da1';

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
  id: SELLER_ID,
  status: 'UNDER_REVIEW',
  businessName: 'Santos Trading',
  businessType: 'SOLE_PROPRIETORSHIP',
  owner: { id: OWNER_ID, name: 'Lito Santos', email: 'lito@example.ph' },
  email: 'lito@example.ph',
  mobile: '+639171234567',
  city: 'Quezon City',
  province: 'Metro Manila',
  submittedAt: NOW,
  createdAt: NOW,
};

const detail = (overrides: Record<string, unknown> = {}) => ({
  ...summary,
  addressLine1: '1 Rizal St',
  addressLine2: null,
  barangay: 'Bagumbayan',
  postalCode: '1110',
  registrationNumber: 'DTI-123',
  tin: '123-456-789-000',
  vatRegistered: false,
  statusNote: null,
  reviewedAt: null,
  verifiedAt: null,
  documents: [
    {
      id: DOC_ID,
      type: 'BUSINESS_REGISTRATION',
      description: null,
      fileName: 'dti.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      uploadedBy: { id: OWNER_ID, name: 'Lito Santos' },
      createdAt: NOW,
    },
  ],
  events: [
    {
      id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5db0',
      type: 'SUBMITTED',
      fromStatus: 'PENDING',
      toStatus: 'UNDER_REVIEW',
      note: null,
      actor: 'Lito Santos',
      createdAt: NOW,
    },
  ],
  missingForSubmission: [],
  legalDetailsEditable: false,
  storeCount: 0,
  memberCount: 1,
  ...overrides,
});

const store = {
  id: STORE_ID,
  sellerId: SELLER_ID,
  sellerName: 'Santos Trading',
  name: 'Santos Hardware',
  slug: 'santos-hardware',
  description: null,
  logoUrl: null,
  bannerUrl: null,
  email: null,
  phone: null,
  addressLine1: null,
  addressLine2: null,
  barangay: null,
  city: null,
  province: null,
  postalCode: null,
  socialLinks: {},
  status: 'ACTIVE',
  statusNote: null,
  customDomain: null,
  settings: {
    primaryColor: '#0f766e',
    accentColor: null,
    announcement: null,
    shippingPolicy: null,
    returnPolicy: null,
    vacationMode: false,
    vacationMessage: null,
  },
  createdAt: NOW,
  updatedAt: NOW,
};

const userDetail = {
  id: USER_ID,
  firstName: 'Lito',
  lastName: 'Santos',
  email: 'lito@example.ph',
  emailVerified: true,
  mobile: null,
  mobileVerified: false,
  status: 'ACTIVE',
  roles: ['SELLER_OWNER'],
  lastSignInAt: NOW,
  createdAt: NOW,
  activeSessions: 2,
  lockedUntil: null,
  mfaEnabled: true,
  seller: {
    id: SELLER_ID,
    businessName: 'Santos Trading',
    status: 'VERIFIED',
    isOwner: true,
    memberStatus: 'ACTIVE',
  },
};

const roleList = {
  roles: [
    {
      code: 'ADMIN',
      name: 'Admin',
      description: 'Runs the marketplace',
      scope: 'platform',
      locked: false,
      permissions: ['users.read', 'sellers.read'],
      userCount: 1,
    },
    {
      code: 'SELLER_MANAGER',
      name: 'Seller manager',
      description: 'Runs a seller business day to day',
      scope: 'seller',
      locked: false,
      permissions: ['seller.store.manage'],
      userCount: 0,
    },
    {
      code: 'SELLER_OWNER',
      name: 'Seller owner',
      description: 'Owns a seller business',
      scope: 'seller',
      locked: true,
      permissions: ['seller.profile.manage', 'seller.store.manage'],
      userCount: 1,
    },
  ],
  permissions: [
    { code: 'users.read', description: 'View user accounts', scope: 'platform' },
    { code: 'sellers.read', description: 'View sellers', scope: 'platform' },
    { code: 'seller.profile.manage', description: 'Edit the business profile', scope: 'seller' },
    { code: 'seller.store.manage', description: 'Manage stores', scope: 'seller' },
  ],
};

type Routes = Record<string, (init?: RequestInit) => Response>;

function fakeApi(permissions?: Permission[], overrides: Routes = {}) {
  const routes: Routes = {
    'GET /api/v1/auth/csrf': () => json({ csrfToken: 'csrf-test' }),
    'GET /api/v1/auth/session': () =>
      json(permissions ? sessionFor(['ADMIN'], permissions) : sessionFor()),
    'GET /api/v1/auth/mfa': () =>
      json({ enabled: false, enabledAt: null, recoveryCodesRemaining: 0 }),
    'GET /api/v1/sellers': () => json(page([summary])),
    [`GET /api/v1/sellers/${SELLER_ID}`]: () => json(detail()),
    [`POST /api/v1/sellers/${SELLER_ID}/review`]: () =>
      json(detail({ status: 'VERIFIED', verifiedAt: NOW })),
    'GET /api/v1/stores': () => json(page([store])),
    [`POST /api/v1/stores/${STORE_ID}/suspend`]: () =>
      json({ ...store, status: 'SUSPENDED', statusNote: 'Counterfeit goods' }),
    [`GET /api/v1/users/${USER_ID}`]: () => json(userDetail),
    [`POST /api/v1/users/${USER_ID}/mfa/reset`]: () => json(undefined, 204),
    'GET /api/v1/roles': () => json(roleList),
    ...overrides,
  };
  return vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0]!;
    const handler = routes[`${init?.method ?? 'GET'} ${path}`];
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

describe('Sellers', () => {
  it('lists applications waiting for review by default', async () => {
    const api = fakeApi();
    renderAt('/sellers', api);
    expect(await screen.findByRole('link', { name: 'Santos Trading' })).toBeInTheDocument();
    const [url] = callsTo(api, 'GET', '/api/v1/sellers')[0]!;
    expect(url).toContain('status=UNDER_REVIEW');
  });

  it('approves an application under review', async () => {
    const api = fakeApi();
    renderAt(`/sellers/${SELLER_ID}`, api);
    await userEvent.click(await screen.findByRole('button', { name: /Approve/ }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await vi.waitFor(() => {
      const [call] = callsTo(api, 'POST', `/api/v1/sellers/${SELLER_ID}/review`);
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ decision: 'APPROVE' });
    });
  });

  it('requires a reason to reject', async () => {
    const api = fakeApi();
    renderAt(`/sellers/${SELLER_ID}`, api);
    await userEvent.click(await screen.findByRole('button', { name: /Reject/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject application' }));
    expect(await within(dialog).findByText(/at least 5 characters/)).toBeInTheDocument();
    expect(callsTo(api, 'POST', `/api/v1/sellers/${SELLER_ID}/review`)).toHaveLength(0);
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'TIN does not match BIR form');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject application' }));
    await vi.waitFor(() => {
      const [call] = callsTo(api, 'POST', `/api/v1/sellers/${SELLER_ID}/review`);
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        decision: 'REJECT',
        note: 'TIN does not match BIR form',
      });
    });
  });

  it('hides review actions from staff without sellers.review', async () => {
    renderAt(`/sellers/${SELLER_ID}`, fakeApi(['sellers.read']));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Santos Trading' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Suspend/ })).not.toBeInTheDocument();
    // Documents are still viewable through the API (audited there).
    expect(screen.getByRole('button', { name: /View/ })).toBeInTheDocument();
  });

  it('hides Sellers and Stores navigation without the permissions', async () => {
    renderAt('/system-health', fakeApi(['users.read']));
    const nav = (await screen.findAllByRole('navigation', { name: 'Main' }))[0]!;
    expect(within(nav).queryByRole('link', { name: 'Sellers' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Stores' })).not.toBeInTheDocument();
  });
});

describe('Stores', () => {
  it('suspends a store with a reason', async () => {
    const api = fakeApi();
    renderAt('/stores', api);
    expect(await screen.findByText('Santos Hardware')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Suspend/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Counterfeit goods');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspend store' }));
    await vi.waitFor(() => {
      const [call] = callsTo(api, 'POST', `/api/v1/stores/${STORE_ID}/suspend`);
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ reason: 'Counterfeit goods' });
    });
  });
});

describe('Roles', () => {
  it('shows each role only the permissions of its own scope', async () => {
    renderAt('/roles', fakeApi());
    const admin = (await screen.findByRole('heading', { name: 'Admin' })).closest(
      '[data-slot="card"]',
    ) as HTMLElement;
    expect(within(admin).getByText('View user accounts')).toBeInTheDocument();
    expect(within(admin).queryByText('Manage stores')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Seller teams' }));
    const manager = (await screen.findByRole('heading', { name: 'Seller manager' })).closest(
      '[data-slot="card"]',
    ) as HTMLElement;
    expect(within(manager).getByText('Manage stores')).toBeInTheDocument();
    expect(within(manager).queryByText('View user accounts')).not.toBeInTheDocument();
    const owner = screen
      .getByRole('heading', { name: 'Seller owner' })
      .closest('[data-slot="card"]') as HTMLElement;
    expect(
      within(owner).getByRole('checkbox', { name: /Edit the business profile/ }),
    ).toBeDisabled();
  });
});

describe('User detail', () => {
  it('shows the seller and resets two-step verification', async () => {
    const api = fakeApi();
    renderAt(`/users/${USER_ID}`, api);
    expect(await screen.findByRole('link', { name: 'Santos Trading' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Reset two-step verification/ }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset' }));
    await vi.waitFor(() =>
      expect(callsTo(api, 'POST', `/api/v1/users/${USER_ID}/mfa/reset`)).toHaveLength(1),
    );
  });
});
