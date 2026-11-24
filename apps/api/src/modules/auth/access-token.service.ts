import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ClientApp } from '@marketplace/shared-types';
import { AppConfig } from '../../config/app-config';

export const ACCESS_TOKEN_ISSUER = 'marketplace-api';

export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  /** Session id: lets a revoked session's access tokens be rejected immediately. */
  sid: string;
  app: ClientApp;
  iat: number;
  exp: number;
}

export type AccessTokenVerification =
  { valid: true; claims: AccessTokenClaims } | { valid: false; reason: 'expired' | 'invalid' };

const base64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');
const HEADER = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

/**
 * Short-lived access tokens: compact JWTs (HS256) carried in an HttpOnly cookie.
 * Only identity is inside; roles and permissions are resolved per request, so changes
 * take effect immediately. The audience is the client app, so a storefront token is
 * useless in the Admin Console.
 */
@Injectable()
export class AccessTokenService {
  constructor(private readonly config: AppConfig) {}

  get ttlSeconds(): number {
    return this.config.auth.accessTokenTtlSeconds;
  }

  issue(subject: { userId: string; sessionId: string; app: ClientApp }, now = Date.now()) {
    const iat = Math.floor(now / 1000);
    const exp = iat + this.ttlSeconds;
    const payload = base64url(
      JSON.stringify({
        iss: ACCESS_TOKEN_ISSUER,
        aud: `marketplace:${subject.app}`,
        sub: subject.userId,
        sid: subject.sessionId,
        app: subject.app,
        iat,
        exp,
      }),
    );
    const unsigned = `${HEADER}.${payload}`;
    return { token: `${unsigned}.${this.sign(unsigned)}`, expiresAt: new Date(exp * 1000) };
  }

  verify(token: string, expectedApp: ClientApp, now = Date.now()): AccessTokenVerification {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== HEADER) return { valid: false, reason: 'invalid' };
    const [header, payload, signature] = parts as [string, string, string];
    const expected = Buffer.from(this.sign(`${header}.${payload}`));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { valid: false, reason: 'invalid' };
    }
    let claims: Record<string, unknown>;
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      return { valid: false, reason: 'invalid' };
    }
    if (
      claims.iss !== ACCESS_TOKEN_ISSUER ||
      claims.aud !== `marketplace:${expectedApp}` ||
      claims.app !== expectedApp ||
      typeof claims.sub !== 'string' ||
      typeof claims.sid !== 'string' ||
      typeof claims.exp !== 'number' ||
      typeof claims.iat !== 'number'
    ) {
      return { valid: false, reason: 'invalid' };
    }
    if (claims.exp * 1000 <= now) return { valid: false, reason: 'expired' };
    return { valid: true, claims: claims as unknown as AccessTokenClaims };
  }

  private sign(data: string): string {
    return createHmac('sha256', this.config.auth.jwtSecret).update(data).digest('base64url');
  }
}
