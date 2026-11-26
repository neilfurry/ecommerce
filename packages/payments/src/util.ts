import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebhookSignatureError, type WebhookHeaders } from './gateway';

/** "1234.5" → 123450 centavos; refuses anything that is not a plain amount. */
export function toCentavos(amount: string): number {
  if (!/^\d+(\.\d{1,4})?$/.test(amount)) throw new Error(`Invalid amount: ${amount}`);
  const [whole, fraction = ''] = amount.split('.');
  const centavos = Number(whole) * 100 + Number(fraction.padEnd(4, '0').slice(0, 2));
  // Sub-centavo digits must be zero: money is always rounded before it reaches a gateway.
  if (Number(fraction.padEnd(4, '0').slice(2)) !== 0) throw new Error(`Not rounded: ${amount}`);
  if (!Number.isSafeInteger(centavos)) throw new Error(`Amount too large: ${amount}`);
  return centavos;
}

/** 123450 → "1234.50" */
export function fromCentavos(centavos: number): string {
  if (!Number.isInteger(centavos) || centavos < 0) throw new Error(`Invalid centavos: ${centavos}`);
  return `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;
}

export function header(headers: WebhookHeaders, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

export function hmacHex(secret: string, message: string | Buffer): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

/** Constant-time comparison of two hex signatures. */
export function sameSignature(expected: string, given: string): boolean {
  if (!/^[0-9a-f]+$/i.test(given) || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given, 'hex'));
}

/** Parses "t=1496734173,te=abc,li=" into { t: '1496734173', te: 'abc', li: '' }. */
export function parseSignatureHeader(value: string): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const piece of value.split(',')) {
    const index = piece.indexOf('=');
    if (index <= 0) continue;
    parts[piece.slice(0, index).trim()] = piece.slice(index + 1).trim();
  }
  return parts;
}

/** Rejects stale or future-dated signatures (replay protection). */
export function checkTimestamp(timestamp: string | undefined, now: Date, toleranceSeconds: number) {
  const seconds = Number(timestamp);
  if (!timestamp || !Number.isInteger(seconds)) {
    throw new WebhookSignatureError('Missing signature timestamp');
  }
  if (Math.abs(now.getTime() / 1000 - seconds) > toleranceSeconds) {
    throw new WebhookSignatureError('Signature timestamp outside the allowed window');
  }
}

export function parseJson(rawBody: Buffer): unknown {
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new WebhookSignatureError('Body is not JSON');
  }
}

/** Safe nested read of untrusted JSON. */
export function at(value: unknown, ...path: (string | number)[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

export const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
