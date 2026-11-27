import type { NestExpressApplication } from '@nestjs/platform-express';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, ROLES_KEY } from '../src/common/auth/auth.decorators';
import { createTestApp } from './test-app';

export interface RouteAccess {
  route: string;
  access: 'public' | 'roles' | 'permissions' | 'signed-in';
}

/** Every HTTP route with how it is protected, read from the decorators Nest uses. */
export function routeInventory(app: NestExpressApplication): RouteAccess[] {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const routes: RouteAccess[] = [];
  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    const base = String(Reflect.getMetadata(PATH_METADATA, metatype) ?? '');
    const proto = Object.getPrototypeOf(instance) as object;
    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = (proto as Record<string, unknown>)[name] as object;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      if (path === undefined) continue;
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
      const targets = [handler as never, metatype as never];
      const has = (key: string) => {
        const value = reflector.getAllAndOverride<unknown>(key, targets);
        return Array.isArray(value) ? value.length > 0 : Boolean(value);
      };
      const access = has(IS_PUBLIC_KEY)
        ? 'public'
        : has(PERMISSIONS_KEY)
          ? 'permissions'
          : has(ROLES_KEY)
            ? 'roles'
            : 'signed-in';
      routes.push({
        route: `${method} /${base}/${path}`.replace(/\/+/g, '/').replace(/\/$/, ''),
        access,
      });
    }
  }
  return routes.sort((a, b) => a.route.localeCompare(b.route));
}

/**
 * Routes reachable without a role or permission. Every other route must declare @Roles or
 * @RequirePermissions; a new route that does neither fails this test until it is reviewed and
 * added here (OWASP ASVS V4.1.3: deny by default).
 */
const PUBLIC_ROUTES = [
  'GET /auth/csrf',
  'GET /catalog/products',
  'GET /catalog/products/:id',
  'GET /catalog/products/:productId/reviews',
  'GET /catalog/review-images/:fileId',
  'GET /catalog/stores/:storeId/ratings',
  'GET /catalog/suggest',
  'GET /categories',
  'GET /categories/:id',
  'GET /categories/:id/attributes',
  'GET /categories/:id/image',
  'GET /health',
  'GET /health/live',
  'GET /locations',
  'GET /products/images/:imageId/:size',
  'GET /storefront/banners/:id/image',
  'GET /storefront/campaigns',
  'GET /storefront/home',
  'GET /stores/:id/:kind',
  'GET /stores/by-slug/:slug',
  'GET /stores/slug-availability',
  'POST /auth/customers/sign-in/otp',
  'POST /auth/customers/sign-in/otp/verify',
  'POST /auth/customers/sign-up',
  'POST /auth/customers/sign-up/verify',
  'POST /auth/email/verify',
  'POST /auth/invitations/accept',
  'POST /auth/mfa/verify',
  'POST /auth/otp/resend',
  'POST /auth/password/forgot',
  'POST /auth/password/reset',
  'POST /auth/refresh',
  'POST /auth/seller-invitations/accept',
  'POST /auth/seller-invitations/preview',
  'POST /auth/sellers/sign-up',
  'POST /auth/sign-in',
  'POST /auth/sign-out',
  'POST /cart/preview',
  'POST /payments/webhooks/mock',
  'POST /payments/webhooks/paymongo',
  'POST /pricing/quote',
  'POST /shipping/webhooks/mock-courier',
  'POST /storefront/affiliate-clicks',
];

/** Any signed-in account: the caller's own session, settings and notifications. */
const SIGNED_IN_ROUTES = [
  'DELETE /notifications/push-subscriptions',
  'GET /auth/mfa',
  'GET /auth/session',
  'GET /notifications',
  'GET /notifications/preferences',
  // The service limits these to the owning seller or staff with the read permission
  // (checked in seller-isolation tests).
  'GET /products/:id',
  'GET /stores/:id',
  'POST /auth/email/resend-verification',
  'POST /auth/mfa/disable',
  'POST /auth/mfa/recovery-codes',
  'POST /auth/mfa/totp/enable',
  'POST /auth/mfa/totp/setup',
  'POST /auth/password/change',
  'POST /auth/sign-out-everywhere',
  'POST /notifications/push-subscriptions',
  'POST /notifications/read',
  'PUT /notifications/preferences',
];

describe('Route access inventory (Phase 8 security audit)', () => {
  let app: NestExpressApplication;
  let routes: RouteAccess[];

  beforeAll(async () => {
    app = await createTestApp();
    routes = routeInventory(app);
  });
  afterAll(() => app.close());

  it('finds every controller route', () => {
    expect(routes.length).toBeGreaterThan(400);
  });

  it('only the reviewed routes are public', () => {
    expect(routes.filter((r) => r.access === 'public').map((r) => r.route)).toEqual(
      [...PUBLIC_ROUTES].sort((a, b) => a.localeCompare(b)),
    );
  });

  it('every other route needs a role or permission, except the reviewed self-service routes', () => {
    expect(routes.filter((r) => r.access === 'signed-in').map((r) => r.route)).toEqual(
      [...SIGNED_IN_ROUTES].sort((a, b) => a.localeCompare(b)),
    );
  });

  it('staff-only areas are permission-gated, not just role-gated', () => {
    const adminAreas =
      /^(GET|POST|PUT|PATCH|DELETE) \/(admin|finance|payments\/(?!webhooks)|analytics|audit)/;
    const loose = routes.filter((r) => adminAreas.test(r.route) && r.access !== 'permissions');
    expect(loose.map((r) => r.route)).toEqual([]);
  });
});
