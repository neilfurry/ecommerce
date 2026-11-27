import { createApiClient, createQueryClient } from '@marketplace/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../app/providers';
import { buildRoutes } from '../../app/routes';
import { sessionFor } from '../../test/session';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const report = (name: string, granularity: string) => ({
  name,
  title: 'Sales',
  range: { from: '2026-11-01', to: '2026-11-30', granularity },
  kpis: [
    { key: 'gmv', label: 'GMV', value: '15400.00', unit: 'PHP' },
    { key: 'orders', label: 'Orders', value: '12', unit: 'count' },
    { key: 'paymentSuccess', label: 'Payment success rate', value: '91.67', unit: '%' },
  ],
  series: {
    keys: [{ key: 'gmv', label: 'GMV', unit: 'PHP' }],
    points: [{ period: '2026-11', values: { gmv: '15400.00' } }],
  },
  table: {
    columns: [
      { key: 'period', label: 'Period', type: 'text' },
      { key: 'gmv', label: 'GMV', type: 'money' },
    ],
    rows: [{ period: '2026-11', gmv: '15400.00' }],
  },
  generatedAt: '2026-11-27T00:00:00.000Z',
});

function renderAt(path: string, fetchImpl: ReturnType<typeof vi.fn>) {
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
}

describe('Analytics', () => {
  it('shows KPI cards and the table from the API, and asks again for another period', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const path = url.split('?')[0]!;
      const query = new URLSearchParams(url.split('?')[1] ?? '');
      if (path === '/api/v1/auth/session')
        return json(sessionFor(['ADMIN'], ['reports.read'] as never));
      if (path === '/api/v1/auth/mfa')
        return json({ enabled: false, enabledAt: null, recoveryCodesRemaining: 0 });
      if (path === '/api/v1/reports/sales')
        return json(report('sales', query.get('granularity') ?? 'day'));
      return json({ error: { code: 'NOT_FOUND', message: 'nope', statusCode: 404 } }, 404);
    });
    renderAt('/analytics', fetchImpl);
    const kpis = await screen.findByTestId('kpi-cards');
    expect(within(kpis).getByText('GMV')).toBeInTheDocument();
    expect(within(kpis).getByText('₱15,400.00')).toBeInTheDocument();
    expect(within(kpis).getByText('91.67%')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '2026-11' })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Period'), 'month');
    await waitFor(() =>
      expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('granularity=month'))).toBe(
        true,
      ),
    );
  });
});
