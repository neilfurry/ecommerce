import { createApiClient, createQueryClient } from '@marketplace/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from './providers';
import { sessionFor } from '../test/session';
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

/** Signed in as a super admin; every other call gets the 503 health report. */
function signedInFetch(session: unknown = sessionFor()) {
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
      apiClient={createApiClient({ baseUrl: '/api', app: 'admin', fetchImpl })}
      queryClient={queryClient}
    >
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

describe('admin-portal routes', () => {
  it('lands on Users when the role may see them', async () => {
    const router = renderAt('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/users');
  });

  it('otherwise lands on /system-health', async () => {
    const router = renderAt('/', signedInFetch(sessionFor(['WAREHOUSE_STAFF'], [])));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'System health' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/system-health');
  });

  it('renders a 503 health report as a service disruption, not an error', async () => {
    renderAt('/system-health', signedInFetch());
    expect(await screen.findByText('Service disruption')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('component-database')).getByText('Database is unreachable.'),
    ).toBeInTheDocument();
  });

  it('highlights the active navigation item', async () => {
    renderAt('/system-health', signedInFetch());
    const nav = (await screen.findAllByRole('navigation', { name: 'Main' }))[0]!;
    expect(within(nav).getByRole('link', { name: 'System health' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('opens the mobile navigation sheet', async () => {
    renderAt('/system-health', signedInFetch());
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
    const router = renderAt('/users', fetchImpl);
    expect(
      await screen.findByRole('heading', { name: /Sign in to the Admin Console/ }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
  });

  it('lists only the pages the signed-in role may open', async () => {
    renderAt(
      '/system-health',
      signedInFetch(sessionFor(['FINANCE_ADMIN'], ['users.read', 'audit.read'])),
    );
    const nav = (await screen.findAllByRole('navigation', { name: 'Main' }))[0]!;
    expect(within(nav).getByRole('link', { name: 'Users' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Audit log' })).toBeInTheDocument();
    expect(
      within(nav).queryByRole('link', { name: 'Roles & permissions' }),
    ).not.toBeInTheDocument();
    expect(
      within(nav).queryByRole('link', { name: 'Wholesale approvals' }),
    ).not.toBeInTheDocument();
  });

  it('refuses a page the role has no permission for', async () => {
    renderAt('/roles', signedInFetch(sessionFor(['FINANCE_ADMIN'], ['users.read'])));
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
  });
});
