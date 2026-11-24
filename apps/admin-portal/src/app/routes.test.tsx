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

function renderAt(path: string, fetchImpl: typeof fetch = vi.fn()) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  render(
    <AppProviders
      apiClient={createApiClient({ baseUrl: '/api', fetchImpl })}
      queryClient={queryClient}
    >
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

describe('admin-portal routes', () => {
  it('redirects the index route to /system-health', async () => {
    const router = renderAt(
      '/',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(downReport), { status: 503 })),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'System health' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/system-health');
  });

  it('renders a 503 health report as a service disruption, not an error', async () => {
    renderAt(
      '/system-health',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(downReport), { status: 503 })),
    );
    expect(await screen.findByText('Service disruption')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('component-database')).getByText('Database is unreachable.'),
    ).toBeInTheDocument();
  });

  it('highlights the active navigation item', async () => {
    renderAt(
      '/system-health',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(downReport), { status: 503 })),
    );
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]!;
    expect(within(nav).getByRole('link', { name: 'System health' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('opens the mobile navigation sheet', async () => {
    renderAt(
      '/system-health',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(downReport), { status: 503 })),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('shows a not-found page for unknown paths', () => {
    renderAt('/no-such-page');
    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });
});
