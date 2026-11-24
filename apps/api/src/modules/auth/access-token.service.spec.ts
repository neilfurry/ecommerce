import type { AppConfig } from '../../config/app-config';
import { AccessTokenService } from './access-token.service';

const make = (secret = 'unit-test-jwt-secret-with-enough-length') =>
  new AccessTokenService({ auth: { jwtSecret: secret, accessTokenTtlSeconds: 900 } } as AppConfig);

describe('AccessTokenService', () => {
  const service = make();
  const subject = { userId: 'user-1', sessionId: 'session-1', app: 'seller' as const };

  it('issues a token that verifies for the same app', () => {
    const now = Date.UTC(2026, 10, 25, 9, 0, 0);
    const { token, expiresAt } = service.issue(subject, now);
    expect(expiresAt.getTime()).toBe(now + 900_000);
    const result = service.verify(token, 'seller', now + 1000);
    expect(result).toEqual({
      valid: true,
      claims: expect.objectContaining({ sub: 'user-1', sid: 'session-1', app: 'seller' }),
    });
  });

  it('reports expiry separately from invalidity', () => {
    const now = Date.now();
    const { token } = service.issue(subject, now);
    expect(service.verify(token, 'seller', now + 900_000)).toEqual({
      valid: false,
      reason: 'expired',
    });
  });

  it('rejects a token for another app (audience)', () => {
    const { token } = service.issue(subject);
    expect(service.verify(token, 'admin')).toEqual({ valid: false, reason: 'invalid' });
  });

  it('rejects a token signed with another secret', () => {
    const { token } = make('another-secret-that-is-long-enough-123').issue(subject);
    expect(service.verify(token, 'seller')).toEqual({ valid: false, reason: 'invalid' });
  });

  it('rejects a token whose payload was edited', () => {
    const { token } = service.issue(subject);
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'someone-else', sid: 'x', app: 'seller' }),
    ).toString('base64url');
    expect(service.verify(`${header}.${forged}.${signature}`, 'seller')).toEqual({
      valid: false,
      reason: 'invalid',
    });
  });

  it.each(['', 'a.b', 'not.a.jwt', 'a.b.c.d'])('rejects malformed input %p', (token) => {
    expect(service.verify(token, 'seller').valid).toBe(false);
  });
});
