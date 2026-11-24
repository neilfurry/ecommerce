import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { ApiError } from './errors';
import { ApiClientProvider, createQueryClient, toDisplayError, useSystemHealth } from './react';

const healthy = {
  status: 'ok',
  version: '0.1.0',
  uptimeSeconds: 10,
  timestamp: '2026-11-24T09:00:00.000Z',
  components: [],
};

function wrapperWith(fetchImpl: typeof fetch) {
  const queryClient = createQueryClient();
  const client = createApiClient({ baseUrl: '/api', fetchImpl });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

describe('useSystemHealth', () => {
  it('loads the health report through the API client', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(healthy), { status: 200 }));
    const { result } = renderHook(() => useSystemHealth(), { wrapper: wrapperWith(fetchImpl) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.status).toBe('ok');
  });
});

describe('createQueryClient retry policy', () => {
  const retry = createQueryClient().getDefaultOptions().queries?.retry as (
    count: number,
    error: unknown,
  ) => boolean;

  it('never retries client errors', () => {
    expect(retry(0, new ApiError('NOT_FOUND', 'Not found', 404))).toBe(false);
  });

  it('retries server and network errors up to twice', () => {
    const networkError = new ApiError('NETWORK_ERROR', 'offline', 0);
    expect(retry(0, networkError)).toBe(true);
    expect(retry(1, networkError)).toBe(true);
    expect(retry(2, networkError)).toBe(false);
  });
});

describe('toDisplayError', () => {
  it('exposes message and request id of ApiErrors', () => {
    expect(toDisplayError(new ApiError('INTERNAL_ERROR', 'Boom', 500, 'req-7'))).toEqual({
      message: 'Boom',
      requestId: 'req-7',
    });
  });

  it('hides unknown error details', () => {
    expect(toDisplayError(new Error('stack trace with secrets'))?.message).not.toContain('secrets');
  });

  it('returns null when there is no error', () => {
    expect(toDisplayError(null)).toBeNull();
  });
});
