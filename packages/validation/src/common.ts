import { z } from 'zod';

export const uuidSchema = z.uuid();

/** ISO 4217 alphabetic code, upper-case, e.g. "PHP". */
export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO 4217 currency code, e.g. "PHP"');

export interface DecimalStringOptions {
  /** Maximum digits after the decimal point. Default 2 (centavos). */
  scale?: number;
  /** Maximum digits before the decimal point. Default 15, matching Decimal(19,4). */
  precision?: number;
  /** Allow a leading minus sign. Default false. */
  allowNegative?: boolean;
}

/**
 * A monetary or quantity amount transported as a decimal string, e.g. "1499.50".
 * Numbers are rejected on purpose: JSON numbers become IEEE-754 floats in JavaScript.
 */
export function decimalStringSchema(options: DecimalStringOptions = {}) {
  const { scale = 2, precision = 15, allowNegative = false } = options;
  const sign = allowNegative ? '-?' : '';
  const fraction = scale > 0 ? `(\\.\\d{1,${scale}})?` : '';
  const pattern = new RegExp(`^${sign}(0|[1-9]\\d{0,${precision - 1}})${fraction}$`);
  return z
    .string()
    .regex(
      pattern,
      `Must be a decimal string with at most ${scale} decimal place(s)${allowNegative ? '' : ' and no sign'}`,
    );
}

export const moneySchema = z.object({
  amount: decimalStringSchema(),
  currency: currencyCodeSchema,
});

export const MAX_PAGE_SIZE = 100;

/** Query-string pagination. Values arrive as strings and are coerced. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
