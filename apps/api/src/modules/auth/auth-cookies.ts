import type { ClientApp } from '@marketplace/shared-types';
import type { CookieOptions, Request, Response } from 'express';
import type { AppConfig } from '../../config/app-config';

/**
 * Each frontend gets its own cookie pair, so signing in to the storefront and the Admin
 * Console in the same browser keeps two independent sessions (cookies ignore ports, so
 * on localhost all apps share one cookie jar).
 *
 *   mp_<app>_at  access token   HttpOnly, path /api              (minutes)
 *   mp_<app>_rt  refresh token  HttpOnly, path /api/v1/auth      (hours/days; only sent to auth routes)
 *   mp_csrf      CSRF secret    HttpOnly, path /api              (compared with the X-CSRF-Token header)
 */
export const accessCookieName = (app: ClientApp) => `mp_${app}_at`;
export const refreshCookieName = (app: ClientApp) => `mp_${app}_rt`;
export const CSRF_COOKIE = 'mp_csrf';

const ACCESS_PATH = '/api';
const REFRESH_PATH = '/api/v1/auth';

function baseOptions(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.auth.cookieSecure,
    sameSite: 'lax',
    domain: config.auth.cookieDomain,
  };
}

export function setSessionCookies(
  response: Response,
  config: AppConfig,
  app: ClientApp,
  tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: Date },
): void {
  response.cookie(accessCookieName(app), tokens.accessToken, {
    ...baseOptions(config),
    path: ACCESS_PATH,
    // Outlives the JWT slightly so an expired token reaches the API and yields TOKEN_EXPIRED.
    maxAge: (config.auth.accessTokenTtlSeconds + 300) * 1000,
  });
  response.cookie(refreshCookieName(app), tokens.refreshToken, {
    ...baseOptions(config),
    path: REFRESH_PATH,
    expires: tokens.refreshExpiresAt,
  });
}

export function clearSessionCookies(response: Response, config: AppConfig, app: ClientApp): void {
  response.clearCookie(accessCookieName(app), { ...baseOptions(config), path: ACCESS_PATH });
  response.clearCookie(refreshCookieName(app), { ...baseOptions(config), path: REFRESH_PATH });
}

export function setCsrfCookie(response: Response, config: AppConfig, token: string): void {
  response.cookie(CSRF_COOKIE, token, { ...baseOptions(config), path: ACCESS_PATH });
}

export function readCookie(request: Request, name: string): string | undefined {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
