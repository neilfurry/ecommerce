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
const MEMBER_ID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d90';
const NOW = '2026-11-25T09:00:00.000Z';

const SELLER_PERMISSIONS = [
  'seller.profile.manage',
  'seller.store.manage',
  'seller.members.read',
  'seller.members.manage',
];

function sessionFor(options: { status?: string; permissions?: string[]; isOwner?: boolean } = {}) {
  return {
    user: {
      id: OWNER_ID,
      firstName: 'Lito',
      lastName: 'Santos',
      email: 'seller.owner@marketplace.local',
      emailVerified: true,
      mobile: '+639171234567',
      mobileVerified: false,
      roles: [options.isOwner === false ? 'SELLER_ENCODER' : 'SELLER_OWNER'],
      permissions: options.permissions ?? SELLER_PERMISSIONS,
      wholesaleStatus: null,
      mfaEnabled: false,
      seller: {
        id: SELLER_ID,
        businessName: 'Santos Trading',
        status: options.status ?? 'VERIFIED',
        isOwner: options.isOwner ?? true,
      },
    },
    app: 'seller',
    accessTokenExpiresAt: '2026-11-25T09:15:00.000Z',
  };
}

function sellerDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: SELLER_ID,
    status: 'PENDING',
    businessName: 'Santos Trading',
    businessType: 'SOLE_PROPRIETORSHIP',
    owner: { id: OWNER_ID, name: 'Lito Santos', email: 'seller.owner@marketplace.local' },
    email: 'seller.owner@marketplace.local',
    mobile: '+639171234567',
    city: 'Quezon City',
    province: 'Metro Manila',
    submittedAt: null,
    createdAt: NOW,
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
    documents: [],
    events: [
      {
        id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5da0',
        type: 'REGISTERED',
        fromStatus: null,
        toStatus: 'PENDING',
        note: null,
        actor: 'Lito Santos',
        createdAt: NOW,
      },
    ],
    missingForSubmission: ['Business registration certificate', 'BIR certificate of registration'],
    legalDetailsEditable: true,
    storeCount: 0,
    memberCount: 1,
    ...overrides,
  };
}

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
  status: 'INACTIVE',
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

const team = {
  members: [
    {
      id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d91',
      userId: OWNER_ID,
      name: 'Lito Santos',
      email: 'seller.owner@marketplace.local',
      status: 'ACTIVE',
      isOwner: true,
      roles: ['SELLER_OWNER'],
      extraPermissions: [],
      effectivePermissions: SELLER_PERMISSIONS,
      joinedAt: NOW,
      lastSignInAt: NOW,
    },
    {
      id: MEMBER_ID,
      userId: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d92',
      name: 'Ana Cruz',
      email: 'ana@example.ph',
      status: 'ACTIVE',
      isOwner: false,
      roles: ['SELLER_ENCODER'],
      extraPermissions: [],
      effectivePermissions: ['seller.members.read'],
      joinedAt: NOW,
      lastSignInAt: null,
    },
  ],
  invitations: [],
  assignableRoles: ['SELLER_MANAGER', 'SELLER_ENCODER', 'SELLER_ORDER_PROCESSOR'],
  assignablePermissions: SELLER_PERMISSIONS,
};

const json = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status });

type Handler = (url: URL, init: RequestInit | undefined) => Response | undefined;

function api(session: unknown, handler: Handler = () => undefined) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const custom = handler(url, init);
    if (custom) return custom;
    const path = url.pathname.replace(/^\/api(\/v1)?/, '');
    if (path === '/auth/session') return json(session);
    if (path === '/auth/csrf') return json({ csrfToken: 'csrf-test' });
    if (path === '/sellers/me') return json(sellerDetail());
    if (path === '/stores/mine') return json({ stores: [store], canCreate: true });
    if (path === `/stores/${STORE_ID}`) return json(store);
    if (path === '/seller/members') return json(team);
    return json({ error: { code: 'NOT_FOUND', message: 'Not found', statusCode: 404 } }, 404);
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

describe('seller center pages', () => {
  it('dashboard points a pending seller at the verification checklist', async () => {
    renderAt('/dashboard', api(sessionFor({ status: 'PENDING' })));
    expect(await screen.findByRole('heading', { name: 'Hello, Lito' })).toBeInTheDocument();
    expect(screen.getByText(/2 item\(s\) left before you can submit/)).toBeInTheDocument();
  });

  it('verification page lists what is missing and keeps submit disabled', async () => {
    renderAt('/verification', api(sessionFor({ status: 'PENDING' })));
    expect(await screen.findByRole('heading', { name: 'Before you submit' })).toBeInTheDocument();
    expect(screen.getAllByText('Business registration certificate').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Submit for verification/ })).toBeDisabled();
  });

  it('hides the employees page from people without seller.members.read', async () => {
    renderAt('/employees', api(sessionFor({ permissions: [], isOwner: false })));
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    const nav = (await screen.findAllByRole('navigation', { name: 'Main' }))[0]!;
    expect(within(nav).queryByRole('link', { name: 'Employees' })).not.toBeInTheDocument();
  });

  it('owner invites an employee with a role', async () => {
    const fetchImpl = api(sessionFor(), (url, init) =>
      url.pathname.endsWith('/seller/members/invitations') && init?.method === 'POST'
        ? json({ id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5dff' }, 201)
        : undefined,
    );
    renderAt('/employees', fetchImpl);
    expect(await screen.findByText('Ana Cruz')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Invite employee/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Email'), 'new.staff@example.ph');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(await within(dialog).findByText('Choose at least one role')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByLabelText('Seller encoder'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    await vi.waitFor(() => {
      const call = fetchImpl.mock.calls.find(
        ([input, init]) =>
          String(input).endsWith('/seller/members/invitations') &&
          (init as RequestInit)?.method === 'POST',
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({
        email: 'new.staff@example.ph',
        roles: ['SELLER_ENCODER'],
        permissions: [],
      });
    });
  });

  it('does not offer actions on the owner row', async () => {
    renderAt('/employees', api(sessionFor()));
    const ownerRow = (await screen.findByText('seller.owner@marketplace.local')).closest('tr')!;
    expect(within(ownerRow).queryByRole('button')).not.toBeInTheDocument();
    const anaRow = screen.getByText('ana@example.ph').closest('tr')!;
    expect(within(anaRow).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('store page is read-only without seller.store.manage', async () => {
    renderAt(
      `/stores/${STORE_ID}`,
      api(sessionFor({ permissions: ['seller.members.read'], isOwner: false })),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Santos Hardware' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Changing it needs the store-management permission/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save details' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Store name')).toBeDisabled();
  });

  it('sign-in page links to seller registration', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in', statusCode: 401 } }, 401),
    ) as unknown as typeof fetch;
    const router = renderAt('/sign-in', fetchImpl);
    await userEvent.click(await screen.findByRole('link', { name: 'Register your business' }));
    expect(router.state.location.pathname).toBe('/register');
    expect(await screen.findByRole('heading', { name: 'Sell with us' })).toBeInTheDocument();
  });
});
