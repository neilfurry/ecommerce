import { API_DEFAULT_VERSION } from '@marketplace/config';
import { CLIENT_APP_HEADER, type ClientApp, CSRF_HEADER } from '@marketplace/shared-types';
import {
  csrfResponseSchema,
  healthResponseSchema,
  livenessResponseSchema,
  type HealthResponse,
  type LivenessResponse,
} from '@marketplace/validation';
import { z } from 'zod';
import {
  createAccountClient,
  createAdminClient,
  createMarketplaceAdminClient,
  createSellerClient,
  createStoresPublicClient,
} from './admin';
import {
  createAdminCatalogClient,
  createCatalogClient,
  createSellerCatalogClient,
} from './catalog';
import { createFulfilmentClient } from './fulfilment';
import { createAdminShopClient, createSellerShopClient, createShopClient } from './shop';
import { createAuthClient } from './auth';
import { createDevToolsClient } from './dev-tools';
import { ApiError } from './errors';

export interface ApiClientOptions {
  /** Base path or URL of the API, e.g. "/api" (dev proxy) or "https://api.example.ph/api". */
  baseUrl: string;
  /** Which frontend this is: selects the session cookies and the roles allowed to sign in. */
  app: ClientApp;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * Called when the session can no longer be refreshed (signed out elsewhere, suspended,
   * expired). Frontends clear cached data and send the user to sign-in.
   */
  onSessionEnded?: () => void;
}

export interface RequestOptions<TSchema extends z.ZodType> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON-serialisable request body, or FormData for file uploads. */
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Every response is validated, so the UI never renders data the contract does not allow. */
  schema: TSchema;
  signal?: AbortSignal;
  /** Non-2xx statuses whose body is still a valid result (e.g. 503 from /health). */
  acceptStatuses?: number[];
  /** Internal: auth endpoints that must not trigger a token refresh. */
  skipRefresh?: boolean;
  /** 'blob' returns the body as a Blob (file downloads); the schema then validates the Blob. */
  responseType?: 'json' | 'blob';
  /** Extra request headers (e.g. Idempotency-Key). */
  headers?: Record<string, string>;
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient({ baseUrl, app, fetchImpl, onSessionEnded }: ApiClientOptions) {
  const root = `${baseUrl.replace(/\/+$/, '')}/v${API_DEFAULT_VERSION}`;
  const doFetch = fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const sessionEndedListeners = new Set<() => void>();
  const sessionEnded = () => {
    onSessionEnded?.();
    for (const listener of sessionEndedListeners) listener();
  };

  // CSRF token for state-changing requests, fetched on first use (single flight).
  let csrfToken: Promise<string> | null = null;
  const csrf = (force = false): Promise<string> => {
    if (!csrfToken || force) {
      csrfToken = send('/auth/csrf', { schema: csrfResponseSchema }, '').then(
        (body) => body.csrfToken,
        (error: unknown) => {
          csrfToken = null;
          throw error;
        },
      );
    }
    return csrfToken;
  };

  // One refresh at a time, however many requests saw TOKEN_EXPIRED together.
  let refreshing: Promise<boolean> | null = null;
  const refreshSession = (): Promise<boolean> => {
    refreshing ??= (async () => {
      try {
        const token = await csrf();
        await send('/auth/refresh', { method: 'POST', schema: z.unknown() }, token);
        return true;
      } catch (error) {
        // 409: another tab refreshed at the same moment; its new cookies are already set.
        return error instanceof ApiError && error.status === 409;
      }
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  };

  async function send<TSchema extends z.ZodType>(
    path: string,
    options: RequestOptions<TSchema>,
    token: string,
  ): Promise<z.output<TSchema>> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) query.set(key, String(value));
    }
    const url = `${root}${path}${query.size > 0 ? `?${query.toString()}` : ''}`;

    let response: Response;
    try {
      response = await doFetch(url, {
        method: options.method ?? 'GET',
        // Session cookies are HttpOnly; the browser attaches them.
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          [CLIENT_APP_HEADER]: app,
          ...(token ? { [CSRF_HEADER]: token } : {}),
          // FormData sets its own multipart boundary header.
          ...(options.body !== undefined && !(options.body instanceof FormData)
            ? { 'Content-Type': 'application/json' }
            : {}),
          ...options.headers,
        },
        body:
          options.body === undefined
            ? undefined
            : options.body instanceof FormData
              ? options.body
              : JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ApiError(
        'NETWORK_ERROR',
        'Could not connect to the server. Check your connection.',
        0,
      );
    }

    if (!response.ok && !options.acceptStatuses?.includes(response.status)) {
      throw await ApiError.fromResponse(response);
    }

    const payload: unknown =
      options.responseType === 'blob'
        ? await response.blob()
        : response.status === 204
          ? undefined
          : await response.json().catch(() => undefined);
    const parsed = options.schema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiError(
        'INVALID_RESPONSE',
        'The server returned an unexpected response.',
        response.status,
        response.headers.get('x-request-id') ?? undefined,
      );
    }
    return parsed.data;
  }

  /**
   * Sends a request with the app header and, for state-changing methods, the CSRF token.
   * An expired access token is refreshed once and the request retried; a stale CSRF token
   * is re-fetched and the request retried.
   */
  async function request<TSchema extends z.ZodType>(
    path: string,
    options: RequestOptions<TSchema>,
  ): Promise<z.output<TSchema>> {
    const unsafe = UNSAFE_METHODS.has(options.method ?? 'GET');
    const attempt = async () => send(path, options, unsafe ? await csrf() : '');
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.code === 'CSRF_FAILED' && unsafe) {
        await csrf(true);
        return attempt();
      }
      if (error.code === 'TOKEN_EXPIRED' && !options.skipRefresh) {
        if (await refreshSession()) return attempt();
        sessionEnded();
      }
      throw error;
    }
  }

  return {
    app,
    request,
    /** Subscribe to "the session ended and could not be refreshed". Returns an unsubscribe function. */
    onSessionEnded(listener: () => void): () => void {
      sessionEndedListeners.add(listener);
      return () => sessionEndedListeners.delete(listener);
    },
    auth: createAuthClient(request),
    admin: {
      ...createAdminClient(request),
      ...createMarketplaceAdminClient(request),
      catalog: createAdminCatalogClient(request),
      shop: createAdminShopClient(request),
    },
    seller: {
      ...createSellerClient(request),
      ...createSellerCatalogClient(request),
      shop: createSellerShopClient(request),
    },
    catalog: createCatalogClient(request),
    shop: createShopClient(request),
    /** Phase 5: payments, shipments, returns, refunds (customer, seller and admin groups). */
    fulfilment: createFulfilmentClient(request),
    stores: createStoresPublicClient(request),
    account: createAccountClient(request),
    devTools: createDevToolsClient(request),
    health: {
      /** Readiness of the API and its dependencies. A 503 still carries a valid report. */
      get: (signal?: AbortSignal): Promise<HealthResponse> =>
        request('/health', { schema: healthResponseSchema, acceptStatuses: [503], signal }),
      live: (signal?: AbortSignal): Promise<LivenessResponse> =>
        request('/health/live', { schema: livenessResponseSchema, signal }),
    },
  };
}
