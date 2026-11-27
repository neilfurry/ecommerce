import { expect, request, type APIRequestContext, type APIResponse } from '@playwright/test';
import pg from 'pg';
import { API, DEMO_PASSWORD } from './env';

type App = 'storefront' | 'seller' | 'admin';

/**
 * A signed-in API session for steps a journey test needs another role to perform (the
 * courier delivering, a customer ordering from the seller under test, ...). The journey's own
 * steps always go through the browser UI.
 */
export class ApiSession {
  private constructor(
    readonly ctx: APIRequestContext,
    private readonly app: App,
    private csrf: string,
  ) {}

  static async open(
    app: App,
    auth: { storageState: string } | { email: string; password?: string } | null = null,
  ) {
    const ctx = await request.newContext({
      baseURL: `${API}/`,
      extraHTTPHeaders: { 'X-Client-App': app },
      storageState: auth && 'storageState' in auth ? auth.storageState : undefined,
    });
    const csrf = ((await (await ctx.get('auth/csrf')).json()) as { csrfToken: string }).csrfToken;
    const session = new ApiSession(ctx, app, csrf);
    if (auth && 'email' in auth) {
      await session.ok(
        session.post('auth/sign-in', {
          email: auth.email,
          password: auth.password ?? DEMO_PASSWORD,
        }),
      );
    }
    return session;
  }

  get(path: string) {
    return this.ctx.get(path);
  }

  post(path: string, data?: unknown, idempotencyKey?: string) {
    return this.ctx.post(path, {
      data: data ?? {},
      headers: {
        'X-CSRF-Token': this.csrf,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
    });
  }

  patch(path: string, data: unknown) {
    return this.ctx.patch(path, { data, headers: { 'X-CSRF-Token': this.csrf } });
  }

  /** Multipart upload (documents, attachments). */
  upload(
    path: string,
    field: string,
    file: { name: string; mimeType: string; buffer: Buffer },
    data?: object,
  ) {
    return this.ctx.post(path, {
      multipart: { [field]: file, ...(data ? { data: JSON.stringify(data) } : {}) },
      headers: { 'X-CSRF-Token': this.csrf },
    });
  }

  /** The JSON body of a successful response (fails the test with the error body otherwise). */
  async ok<T = Record<string, unknown>>(response: Promise<APIResponse> | APIResponse): Promise<T> {
    const res = await response;
    const text = await res.text();
    expect(res.ok(), `${res.url()} → ${res.status()} ${text.slice(0, 300)}`).toBe(true);
    return (text ? JSON.parse(text) : {}) as T;
  }

  dispose() {
    return this.ctx.dispose();
  }
}

/**
 * Moves a delivered seller order's return window into the past, standing in for the days a
 * real order waits before it can be settled. The only direct database write in the browser
 * tests; it changes timestamps, never amounts.
 */
export async function endReturnWindow(sellerOrderId: string) {
  const client = new pg.Client({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://marketplace:marketplace_dev_password@localhost:5432/marketplace',
  });
  await client.connect();
  try {
    await client.query(
      `UPDATE "seller_orders"
         SET "delivered_at" = now() - interval '10 days',
             "return_window_ends_at" = now() - interval '9 days'
       WHERE "id" = $1 AND "status" IN ('DELIVERED', 'COMPLETED')`,
      [sellerOrderId],
    );
  } finally {
    await client.end();
  }
}
