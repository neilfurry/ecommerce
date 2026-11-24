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

/** Answers GET /auth/csrf itself and delegates every other call. */
function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    return url.endsWith('/auth/csrf')
      ? jsonResponse({ csrfToken: 'csrf-1' })
      : respond(url, init ?? {});
  });
}

/** Calls other than the CSRF token fetch. */
const apiCalls = (fetchImpl: ReturnType<typeof vi.fn>) =>
  fetchImpl.mock.calls.filter((call) => !String(call[0]).endsWith('/auth/csrf')) as [
    string,
    RequestInit,
  ][];

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('createApiClient', () => {
  it('builds versioned URLs and sends cookies', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(healthy));
    const client = createApiClient({ baseUrl: '/api/', app: 'admin', fetchImpl });
    await client.health.get();
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/health',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('serialises query parameters, skipping undefined values', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = createApiClient({ baseUrl: '/api', app: 'admin', fetchImpl });
    await client.request('/things', {
      schema: z.object({ ok: z.boolean() }),
      query: { page: 2, search: 'bigas', category: undefined },
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/v1/things?page=2&search=bigas');
  });

  it('sends JSON bodies with a content type and the CSRF token', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ ok: true }));
    const client = createApiClient({ baseUrl: '/api', app: 'admin', fetchImpl });
    await client.request('/things', {
      method: 'POST',
      body: { price: '10.00' },
      schema: z.object({ ok: z.boolean() }),
    });
    const init = apiCalls(fetchImpl)[0]![1];
    expect(init.body).toBe('{"price":"10.00"}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('csrf-1');
  });

  it('treats a 503 health report as data, not an error', async () => {
    const down = { ...healthy, status: 'down' };
    const client = createApiClient({
      baseUrl: '/api',
      app: 'admin',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(down, 503)),
    });
    await expect(client.health.get()).resolves.toMatchObject({ status: 'down' });
  });

  it('turns the API error envelope into an ApiError', async () => {
    const client = createApiClient({
      baseUrl: '/api',
      app: 'admin',
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
      app: 'admin',
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
      app: 'admin',
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    });
    await expect(client.health.live()).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('rejects responses that do not match the contract', async () => {
    const client = createApiClient({
      baseUrl: '/api',
      app: 'admin',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ status: 'ok', version: 1 })),
    });
    await expect(client.health.get()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('propagates aborts unchanged', async () => {
    const abort = new DOMException('Aborted', 'AbortError');
    const client = createApiClient({
      baseUrl: '/api',
      app: 'admin',
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
    const fetchImpl = fakeFetch(() => jsonResponse(file, 201));
    const client = createApiClient({ baseUrl: '/api', app: 'admin', fetchImpl });
    await client.devTools.uploadFile(new File(['x'], 'a.txt', { type: 'text/plain' }));
    const [url, init] = apiCalls(fetchImpl)[0]!;
    expect(url).toBe('/api/v1/dev/files');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('treats 204 responses as empty success', async () => {
    const fetchImpl = fakeFetch(() => new Response(null, { status: 204 }));
    const client = createApiClient({ baseUrl: '/api', app: 'admin', fetchImpl });
    await expect(client.devTools.deleteFile('abc')).resolves.toBeUndefined();
    expect(apiCalls(fetchImpl)[0]![1]).toMatchObject({ method: 'DELETE' });
  });

  it('encodes path segments', async () => {
    const fetchImpl = fakeFetch(() => new Response(null, { status: 204 }));
    const client = createApiClient({ baseUrl: '/api', app: 'admin', fetchImpl });
    await client.devTools.discardDeadLetter('system__12');
    expect(apiCalls(fetchImpl)[0]![0]).toBe('/api/v1/dev/dead-letters/system__12');
  });
});

const apiError = (code: string, statusCode: number) =>
  jsonResponse({ error: { code, message: code, statusCode, requestId: 'r' } }, statusCode);

const session = {
  user: {
    id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d6e',
    firstName: 'Ana',
    lastName: 'Reyes',
    email: 'ana@example.ph',
    emailVerified: true,
    mobile: null,
    mobileVerified: false,
    roles: ['ADMIN'],
    permissions: ['users.read'],
    wholesaleStatus: null,
  },
  app: 'admin',
  accessTokenExpiresAt: '2026-11-25T09:15:00.000Z',
};

describe('authentication handling', () => {
  it('names the app in every request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(session));
    await createApiClient({ baseUrl: '/api', app: 'seller', fetchImpl }).auth.session();
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).headers).toMatchObject({
      'x-client-app': 'seller',
    });
  });

  it('does not send a CSRF token on safe requests, and fetches it once for unsafe ones', async () => {
    const fetchImpl = fakeFetch((_url, init) =>
      init.method === 'GET' ? jsonResponse(session) : new Response(null, { status: 204 }),
    );
    const client = createApiClient({ baseUrl: '/api', app: 'admin', fetchImpl });
    await client.auth.session();
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).headers).not.toHaveProperty('x-csrf-token');
    await Promise.all([client.auth.signOut(), client.auth.forgotPassword('a@example.ph')]);
    expect(fetchImpl.mock.calls.filter((c) => String(c[0]).endsWith('/auth/csrf'))).toHaveLength(1);
  });

  it('returns a null session when signed out', async () => {
    const client = createApiClient({
      baseUrl: '/api',
      app: 'admin',
      fetchImpl: vi.fn().mockResolvedValue(apiError('UNAUTHENTICATED', 401)),
    });
    await expect(client.auth.session()).resolves.toBeNull();
  });

  it('refreshes an expired access token once and retries, even for concurrent requests', async () => {
    let refreshed = false;
    const fetchImpl = fakeFetch((url) => {
      if (url.endsWith('/auth/refresh')) {
        refreshed = true;
        return jsonResponse(session);
      }
      return refreshed ? jsonResponse(session) : apiError('TOKEN_EXPIRED', 401);
    });
    const client = createApiClient({ baseUrl: '/api', app: 'admin', fetchImpl });
    const results = await Promise.all([
      client.auth.session(),
      client.auth.session(),
      client.auth.session(),
    ]);
    expect(results.every((r) => r?.user.id === session.user.id)).toBe(true);
    expect(apiCalls(fetchImpl).filter(([url]) => url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('retries after a 409 refresh race (another tab already refreshed)', async () => {
    let calls = 0;
    const fetchImpl = fakeFetch((url) => {
      if (url.endsWith('/auth/refresh')) return apiError('CONFLICT', 409);
      calls += 1;
      return calls === 1 ? apiError('TOKEN_EXPIRED', 401) : jsonResponse(session);
    });
    const client = createApiClient({ baseUrl: '/api', app: 'admin', fetchImpl });
    await expect(client.auth.session()).resolves.toMatchObject({ app: 'admin' });
  });

  it('reports the end of the session when the refresh fails', async () => {
    const onSessionEnded = vi.fn();
    const listener = vi.fn();
    const fetchImpl = fakeFetch((url) =>
      url.endsWith('/auth/refresh')
        ? apiError('UNAUTHENTICATED', 401)
        : apiError('TOKEN_EXPIRED', 401),
    );
    const client = createApiClient({ baseUrl: '/api', app: 'admin', fetchImpl, onSessionEnded });
    const unsubscribe = client.onSessionEnded(listener);
    await expect(client.admin.roles.list()).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('never refreshes for the credential endpoints themselves', async () => {
    const fetchImpl = fakeFetch(() => apiError('TOKEN_EXPIRED', 401));
    const client = createApiClient({ baseUrl: '/api', app: 'admin', fetchImpl });
    await expect(client.auth.signIn('a@example.ph', 'x')).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
    expect(apiCalls(fetchImpl).some(([url]) => url.endsWith('/auth/refresh'))).toBe(false);
  });

  it('fetches a new CSRF token and retries once when the token is stale', async () => {
    let attempts = 0;
    const fetchImpl = fakeFetch(() => {
      attempts += 1;
      return attempts === 1 ? apiError('CSRF_FAILED', 403) : new Response(null, { status: 204 });
    });
    const client = createApiClient({ baseUrl: '/api', app: 'storefront', fetchImpl });
    await expect(client.auth.forgotPassword('a@example.ph')).resolves.toBeUndefined();
    expect(fetchImpl.mock.calls.filter((c) => String(c[0]).endsWith('/auth/csrf'))).toHaveLength(2);
  });
});
