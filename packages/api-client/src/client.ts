import { API_DEFAULT_VERSION } from '@marketplace/config';
import {
  healthResponseSchema,
  livenessResponseSchema,
  type HealthResponse,
  type LivenessResponse,
} from '@marketplace/validation';
import type { z } from 'zod';
import { createDevToolsClient } from './dev-tools';
import { ApiError } from './errors';

export interface ApiClientOptions {
  /** Base path or URL of the API, e.g. "/api" (dev proxy) or "https://api.example.ph/api". */
  baseUrl: string;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
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
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient({ baseUrl, fetchImpl }: ApiClientOptions) {
  const root = `${baseUrl.replace(/\/+$/, '')}/v${API_DEFAULT_VERSION}`;
  const doFetch = fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function request<TSchema extends z.ZodType>(
    path: string,
    options: RequestOptions<TSchema>,
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
        // Cookies carry the session from Phase 2 onwards.
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          // FormData sets its own multipart boundary header.
          ...(options.body !== undefined && !(options.body instanceof FormData)
            ? { 'Content-Type': 'application/json' }
            : {}),
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
      response.status === 204 ? undefined : await response.json().catch(() => undefined);
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

  return {
    request,
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
