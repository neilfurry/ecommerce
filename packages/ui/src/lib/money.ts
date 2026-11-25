const formatters = new Map<string, Intl.NumberFormat>();

/**
 * Displays a decimal-string amount from the API, e.g. "1499.50" → "₱1,499.50".
 * For display only: amounts are never calculated in the browser.
 */
export function formatMoney(amount: string | null | undefined, currency = 'PHP'): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    });
    formatters.set(currency, formatter);
  }
  return formatter.format(Number(amount));
}
