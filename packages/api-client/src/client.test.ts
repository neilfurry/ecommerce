import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApiClient } from './client';
import { ApiError } from './errors';

const healthy = {
  status: 'ok',
  version: '0.1.0',
  uptimeSeconds: 10,
  timestamp: '2026-11-24T09:00:00.000Z',
  components: [{ name: 'database', status: 'up', critical: true, latencyMs: 2 }],
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('createApiClient', () => {
  it('builds versioned URLs and sends cookies', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(healthy));
    const client = createApiClient({ baseUrl: '/api/', fetchImpl });
    await client.health.get();
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/health',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('serialises query parameters, skipping undefined values', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = createApiClient({ baseUrl: '/api', fetchImpl });
    await client.request('/things', {
      schema: z.object({ ok: z.boolean() }),
      query: { page: 2, search: 'bigas', category: undefined },
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/v1/things?page=2&search=bigas');
  });

  it('sends JSON bodies with a content type', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = createApiClient({ baseUrl: '/api', fetchImpl });
    await client.request('/things', {
      method: 'POST',
      body: { price: '10.00' },
      schema: z.object({ ok: z.boolean() }),
    });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe('{"price":"10.00"}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('treats a 503 health report as data, not an error', async () => {
    const down = { ...healthy, status: 'down' };
    const client = createApiClient({
      baseUrl: '/api',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(down, 503)),
    });
    await expect(client.health.get()).resolves.toMatchObject({ status: 'down' });
  });

  it('turns the API error envelope into an ApiError', async () => {
    const client = createApiClient({
      baseUrl: '/api',
      fetchImpl: vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Request validation failed.',
              statusCode: 400,
              requestId: 'req-1',
              fieldErrors: [{ path: 'email', message: 'Invalid email' }],
            },
          },
          400,
        ),
      ),
    });
    const error = await client.health.live().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
      requestId: 'req-1',
      fieldErrors: [{ path: 'email', message: 'Invalid email' }],
      isClientError: true,
    });
  });

  it('falls back to the response status for non-envelope errors', async () => {
    const client = createApiClient({
      baseUrl: '/api',
      fetchImpl: vi.fn().mockResolvedValue(
        new Response('<html>Bad gateway</html>', {
          status: 502,
          headers: { 'x-request-id': 'gw-1' },
        }),
      ),
    });
    await expect(client.health.live()).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 502,
      requestId: 'gw-1',
    });
  });

  it('reports network failures as NETWORK_ERROR', async () => {
    const client = createApiClient({
      baseUrl: '/api',
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    });
    await expect(client.health.live()).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('rejects responses that do not match the contract', async () => {
    const client = createApiClient({
      baseUrl: '/api',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ status: 'ok', version: 1 })),
    });
    await expect(client.health.get()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('propagates aborts unchanged', async () => {
    const abort = new DOMException('Aborted', 'AbortError');
    const client = createApiClient({
      baseUrl: '/api',
      fetchImpl: vi.fn().mockRejectedValue(abort),
    });
    await expect(client.health.live()).rejects.toBe(abort);
  });
});

describe('devTools client', () => {
  it('uploads files as multipart without forcing a JSON content type', async () => {
    const file = {
      id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d6e',
      originalName: 'a.txt',
      contentType: 'text/plain',
      sizeBytes: 1,
      checksumSha256: 'a'.repeat(64),
      purpose: 'DEV_TEST',
      status: 'AVAILABLE',
      createdAt: '2026-11-24T09:00:00.000Z',
      updatedAt: '2026-11-24T09:00:00.000Z',
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(file, 201));
    const client = createApiClient({ baseUrl: '/api', fetchImpl });
    await client.devTools.uploadFile(new File(['x'], 'a.txt', { type: 'text/plain' }));
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/v1/dev/files');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('treats 204 responses as empty success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createApiClient({ baseUrl: '/api', fetchImpl });
    await expect(client.devTools.deleteFile('abc')).resolves.toBeUndefined();
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  it('encodes path segments', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createApiClient({ baseUrl: '/api', fetchImpl });
    await client.devTools.discardDeadLetter('system__12');
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/v1/dev/dead-letters/system__12');
  });
});
