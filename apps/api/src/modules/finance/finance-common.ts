import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@marketplace/database';
import { ApiException } from '../../common/errors/api.exception';

export const D = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v);
export const ZERO = D(0);
export const m = (v: Prisma.Decimal | null | undefined) => (v ?? ZERO).toFixed(2);
export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const personName = (u: { firstName: string; lastName: string } | null | undefined) =>
  u ? `${u.firstName} ${u.lastName}`.trim() : null;

export const notFound = (what: string) =>
  new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found.`);
export const conflict = (message: string) =>
  new ApiException(HttpStatus.CONFLICT, 'CONFLICT', message);
export const invalid = (path: string, message: string) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', message, [
    { path, message },
  ]);

export function paged<T>(items: T[], page: number, pageSize: number, total: number) {
  return { items, page, pageSize, totalItems: total, totalPages: Math.ceil(total / pageSize) };
}

/** Start of a Philippine calendar day (UTC+8) as an instant. */
export const manilaDayStart = (date: string) => new Date(`${date}T00:00:00+08:00`);
/** Exclusive end of a Philippine calendar day. */
export const manilaDayEnd = (date: string) =>
  new Date(manilaDayStart(date).getTime() + 24 * 60 * 60 * 1000);

/** AES-256-GCM (key derived from the configured secret). Output: iv.tag.ciphertext, base64url. */
export function encryptField(plain: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(key).digest(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((b) => b.toString('base64url')).join('.');
}

export function decryptField(payload: string, key: string): string {
  const [iv, tag, data] = payload.split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !data) throw new Error('Malformed encrypted field');
  const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(key).digest(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export const maskAccount = (last4: string) => `•••• ${last4}`;

/** Seller payable accounts by their name in the API. */
export const SELLER_ACCOUNT_CODES = {
  PENDING: '2110',
  AVAILABLE: '2120',
  RESERVED: '2130',
  IN_PAYOUT: '2140',
} as const;
export const SELLER_ACCOUNT_BY_CODE: Record<string, keyof typeof SELLER_ACCOUNT_CODES> = {
  '2110': 'PENDING',
  '2120': 'AVAILABLE',
  '2130': 'RESERVED',
  '2140': 'IN_PAYOUT',
};

export const debitNormal = (type: string) => type === 'ASSET' || type === 'EXPENSE';
