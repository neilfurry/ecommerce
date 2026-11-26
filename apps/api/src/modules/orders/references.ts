import { randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** e.g. "PAY-7K3M9Q2X": short, unambiguous references for payments, refunds and returns. */
export function newReference(prefix: 'PAY' | 'RF' | 'RT' | 'RMT'): string {
  let suffix = '';
  for (let i = 0; i < 8; i++) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}-${suffix}`;
}
