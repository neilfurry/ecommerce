/**
 * Monetary amounts cross the API boundary as decimal STRINGS (e.g. "1499.50"),
 * never as JavaScript numbers, so no floating-point rounding can occur.
 * See docs/adr/0004-money-and-currency.md.
 */
export type DecimalString = string;

/** ISO 4217 alphabetic currency code, e.g. "PHP". */
export type CurrencyCode = string;

export interface Money {
  amount: DecimalString;
  currency: CurrencyCode;
}
