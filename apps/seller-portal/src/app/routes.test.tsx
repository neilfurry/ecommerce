import { createApiClient, createQueryClient } from '@marketplace/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from './providers';
import { routes } from './routes';

const downReport = {
  status: 'down',
  version: '0.1.0',
  uptimeSeconds: 5,
  timestamp: '2026-11-24T09:00:00.000Z',
  components: [
    {
      name: 'database',
      status: 'down',
      critical: true,
      latencyMs: null,
      message: 'Database is unreachable.',
    },
    { name: 'redis', status: 'up', critical: true, latencyMs: 1 },
    { name: 'storage', status: 'up', critical: true, latencyMs: 9 },
    { name: 'worker', status: 'up', critical: false, latencyMs: 2 },
  ],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const session = {
  user: {
    id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d6e',
    firstName: 'Lito',
    lastName: 'Santos',
    email: 'seller.owner@marketplace.local',
    emailVerified: true,
    mobile: null,
    mobileVerified: false,
    roles: ['SELLER_OWNER'],
    permissions: [],
    wholesaleStatus: null,
    mfaEnabled: false,
    seller: {
      id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d70',
      businessName: 'Santos Trading',
      status: 'VERIFIED',
      isOwner: true,
    },
  },
  app: 'seller',
  accessTokenExpiresAt: '2026-11-25T09:15:00.000Z',
};

/** Signed in as a seller owner; every other call gets the 503 health report. */
function signedInFetch() {
  return vi.fn(async (input: RequestInfo | URL) =>
    String(input).endsWith('/auth/session') ? json(session) : json(downReport, 503),
  ) as unknown as typeof fetch;
}

function renderAt(path: string, fetchImpl: typeof fetch = signedInFetch()) {
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

describe('seller-portal routes', () => {
  it('redirects the index route to /system-status', async () => {
    const router = renderAt('/', signedInFetch());
    expect(
      await screen.findByRole('heading', { level: 1, name: 'System status' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/system-status');
  });

  it('renders a 503 health report as a service disruption, not an error', async () => {
    renderAt('/system-status', signedInFetch());
    expect(await screen.findByText('Service disruption')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('component-database')).getByText('Database is unreachable.'),
    ).toBeInTheDocument();
  });

  it('highlights the active navigation item', async () => {
    renderAt('/system-status', signedInFetch());
    const nav = (await screen.findAllByRole('navigation', { name: 'Main' }))[0]!;
    expect(within(nav).getByRole('link', { name: 'System status' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('opens the mobile navigation sheet', async () => {
    renderAt('/system-status', signedInFetch());
    await userEvent.click(await screen.findByRole('button', { name: 'Open navigation' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('shows a not-found page for unknown paths', async () => {
    renderAt('/no-such-page');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });

  it('sends signed-out visitors to the sign-in page', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in', statusCode: 401 } }, 401),
    ) as unknown as typeof fetch;
    const router = renderAt('/system-status', fetchImpl);
    expect(
      await screen.findByRole('heading', { name: /Sign in to the Seller Center/ }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
  });

  it('shows who is signed in', async () => {
    renderAt('/system-status');
    expect(
      await screen.findByRole('button', { name: 'Account menu for Lito Santos' }),
    ).toBeInTheDocument();
  });
});
