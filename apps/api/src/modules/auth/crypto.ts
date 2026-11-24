import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** 256-bit random token, URL-safe (refresh tokens, email links, CSRF tokens). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 hex digest. Tokens are stored hashed so a database leak reveals nothing usable. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Six-digit one-time code from a cryptographically secure source. */
export function randomOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * Keyed hash of an OTP bound to its challenge, so a database leak cannot be brute-forced
 * offline (only 10^6 possible codes) without the server secret.
 */
export function hashOtp(secret: string, challengeId: string, code: string): string {
  return createHmac('sha256', secret).update(`${challengeId}:${code}`).digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
