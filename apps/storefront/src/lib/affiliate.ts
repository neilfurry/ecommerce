import { AFFILIATE_QUERY_PARAM } from '@marketplace/shared-types';

const KEY = 'marketplace.affiliate';
/** The affiliate settings' default link window; the server decides whether a code applies. */
const DAYS = 30;

/** Remembers the code from an affiliate link (?aff=CODE) for the link window. */
export function captureAffiliate(search: string, now = Date.now()): string | null {
  const code = new URLSearchParams(search).get(AFFILIATE_QUERY_PARAM)?.trim().toUpperCase();
  if (!code || !/^[A-Z0-9]{3,20}$/.test(code)) return null;
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, expiresAt: now + DAYS * 86_400_000 }));
  } catch {
    // Storage can be unavailable (private mode): the link then only applies to this visit.
  }
  return code;
}

/** The remembered affiliate code, if the link window has not passed. */
export function currentAffiliateCode(now = Date.now()): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { code?: string; expiresAt?: number };
    if (!saved.code || !saved.expiresAt || saved.expiresAt < now) {
      localStorage.removeItem(KEY);
      return null;
    }
    return saved.code;
  } catch {
    return null;
  }
}
