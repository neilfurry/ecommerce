import { createApiClient, createQueryClient } from '@marketplace/api-client';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from './providers';
import { routes } from './routes';

const healthReport = {
  status: 'ok',
  version: '0.1.0',
  uptimeSeconds: 60,
  timestamp: '2026-11-24T09:00:00.000Z',
  components: [
    { name: 'database', status: 'up', critical: true, latencyMs: 3 },
    { name: 'redis', status: 'up', critical: true, latencyMs: 1 },
    { name: 'storage', status: 'up', critical: true, latencyMs: 9 },
    { name: 'worker', status: 'up', critical: false, latencyMs: 2 },
  ],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const signedOut = () =>
  json(
    { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.', statusCode: 401 } },
    401,
  );

function renderAt(path: string, fetchImpl: typeof fetch = vi.fn()) {
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
  return { router, fetchImpl };
}

describe('storefront routes', () => {
  it('renders the home page inside the store layout', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1, name: /trusted sellers/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'System status' })).toHaveAttribute('href', '/status');
  });

  it('renders live system status from the API', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/auth/session')
        ? signedOut()
        : new Response(JSON.stringify(healthReport)),
    );
    renderAt('/status', fetchImpl as unknown as typeof fetch);
    expect(await screen.findByText('All systems operational')).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/health', expect.anything());
  });

  it('shows an error with a retry action when the API is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    renderAt('/status', fetchImpl);
    expect(await screen.findByText('Unable to reach the API')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeEnabled();
  });

  it('shows a not-found page for unknown paths', () => {
    renderAt('/no-such-page');
    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });
});
