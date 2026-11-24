import type { HealthResponse } from '@marketplace/validation';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { formatUptime, SystemStatusPanel } from './system-status-panel';

const degraded: HealthResponse = {
  status: 'degraded',
  version: '0.1.0',
  uptimeSeconds: 3725,
  timestamp: '2026-11-24T09:00:00.000Z',
  components: [
    { name: 'database', status: 'up', critical: true, latencyMs: 4 },
    { name: 'redis', status: 'up', critical: true, latencyMs: 1 },
    { name: 'storage', status: 'up', critical: true, latencyMs: 12 },
    {
      name: 'worker',
      status: 'down',
      critical: false,
      latencyMs: null,
      message: 'No background worker heartbeat in the last 60 seconds.',
    },
  ],
};

describe('SystemStatusPanel', () => {
  it('shows a loading skeleton', () => {
    render(
      <SystemStatusPanel
        health={undefined}
        isLoading
        error={null}
        isRefreshing={false}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Loading system status')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders overall status, components, latency and messages', () => {
    render(
      <SystemStatusPanel
        health={degraded}
        isLoading={false}
        error={null}
        isRefreshing={false}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByTestId('overall-status')).toHaveTextContent('Degraded performance');
    expect(screen.getByText(/API v0\.1\.0 · up 1h 2m/)).toBeInTheDocument();
    const database = screen.getByTestId('component-database');
    expect(within(database).getByText('Database (PostgreSQL)')).toBeInTheDocument();
    expect(within(database).getByText('4 ms')).toBeInTheDocument();
    const worker = screen.getByTestId('component-worker');
    expect(within(worker).getByText('(non-critical)')).toBeInTheDocument();
    expect(within(worker).getByText(/No background worker heartbeat/)).toBeInTheDocument();
    expect(within(worker).getByText('Down')).toBeInTheDocument();
  });

  it('calls onRefresh when the refresh button is clicked', async () => {
    const onRefresh = vi.fn();
    render(
      <SystemStatusPanel
        health={degraded}
        isLoading={false}
        error={null}
        isRefreshing={false}
        onRefresh={onRefresh}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('disables refresh while a refresh is in flight', () => {
    render(
      <SystemStatusPanel
        health={degraded}
        isLoading={false}
        error={null}
        isRefreshing
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled();
  });

  it('shows an error state with the request id and a retry button when there is no data', async () => {
    const onRefresh = vi.fn();
    render(
      <SystemStatusPanel
        health={undefined}
        isLoading={false}
        error={{ message: 'Network error', requestId: 'req-42' }}
        isRefreshing={false}
        onRefresh={onRefresh}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to reach the API');
    expect(screen.getByText('req-42')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('keeps showing stale data when a background refresh fails', () => {
    render(
      <SystemStatusPanel
        health={degraded}
        isLoading={false}
        error={{ message: 'Timed out.' }}
        isRefreshing={false}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText(/Latest refresh failed: Timed out\./)).toBeInTheDocument();
    expect(screen.getByTestId('component-database')).toBeInTheDocument();
  });
});

describe('formatUptime', () => {
  it.each([
    [42, '42s'],
    [125, '2m'],
    [3725, '1h 2m'],
    [90_061, '1d 1h'],
  ])('formats %i seconds as %s', (seconds, expected) => {
    expect(formatUptime(seconds)).toBe(expected);
  });
});
