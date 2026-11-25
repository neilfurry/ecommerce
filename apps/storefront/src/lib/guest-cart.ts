import type { CartLineInput } from '@marketplace/validation';

/**
 * A guest's cart, kept in this browser until they sign in (then merged into their account).
 * Only variant ids and quantities are stored: prices always come from the server.
 */
export interface GuestLine {
  variantId: string;
  quantity: number;
  savedForLater: boolean;
}

const KEY = 'marketplace.guest-cart.v1';
const listeners = new Set<() => void>();
let memory: GuestLine[] = [];

function read(): GuestLine[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (l): l is GuestLine =>
          typeof l === 'object' &&
          l !== null &&
          typeof (l as GuestLine).variantId === 'string' &&
          Number.isInteger((l as GuestLine).quantity),
      )
      .slice(0, 100);
  } catch {
    // Storage can be unavailable (private mode, blocked cookies): keep the cart in memory.
    return memory;
  }
}

function write(lines: GuestLine[]) {
  memory = lines;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    // Kept in memory only.
  }
  snapshot = lines;
  for (const listener of listeners) listener();
}

let snapshot: GuestLine[] | null = null;

export const guestCart = {
  get(): GuestLine[] {
    snapshot ??= read();
    return snapshot;
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key === KEY) {
        snapshot = read();
        listener();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener('storage', onStorage);
    };
  },
  add(input: CartLineInput) {
    const lines = [...guestCart.get()];
    const quantity = Number(input.quantity);
    const existing = lines.find((l) => l.variantId === input.variantId);
    if (existing) {
      existing.quantity = existing.savedForLater ? quantity : existing.quantity + quantity;
      existing.savedForLater = input.savedForLater ?? false;
    } else {
      lines.push({
        variantId: input.variantId,
        quantity,
        savedForLater: input.savedForLater ?? false,
      });
    }
    write(lines.map((l) => ({ ...l })));
  },
  update(variantId: string, change: { quantity?: number; savedForLater?: boolean }) {
    write(guestCart.get().map((l) => (l.variantId === variantId ? { ...l, ...change } : l)));
  },
  remove(variantId: string) {
    write(guestCart.get().filter((l) => l.variantId !== variantId));
  },
  clear() {
    write([]);
  },
};
