import { z } from 'zod';

/**
 * Building blocks for validating process.env in the API and worker.
 * Environment variables are always strings, so every helper parses from a string.
 */

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);

/** "true"/"false"/"1"/"0"/"yes"/"no"/"on"/"off" (case-insensitive) → boolean. */
export function envBoolean(defaultValue: boolean) {
  return z
    .string()
    .trim()
    .toLowerCase()
    .refine((value) => TRUE_VALUES.has(value) || FALSE_VALUES.has(value), {
      message: 'Must be true or false',
    })
    .transform((value) => TRUE_VALUES.has(value))
    .optional()
    .transform((value) => value ?? defaultValue);
}

/** Integer within [min, max], with a default when unset. */
export function envInteger(defaultValue: number, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return z.coerce.number().int().min(min).max(max).default(defaultValue);
}

/** Comma-separated list of absolute http(s) URLs (no paths), e.g. CORS origins. */
export const envOriginList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  )
  .pipe(
    z.array(
      z.url({ protocol: /^https?$/ }).refine((value) => new URL(value).pathname === '/', {
        message: 'Origins must not contain a path',
      }),
    ),
  );

export const nodeEnvSchema = z.enum(['development', 'test', 'production']).default('development');

export const logLevelSchema = z
  .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  .default('info');

export const postgresUrlSchema = z
  .string()
  .regex(/^postgres(ql)?:\/\//, 'Must be a postgresql:// connection string');

export const redisUrlSchema = z
  .string()
  .regex(/^rediss?:\/\//, 'Must be a redis:// or rediss:// URL');

/** Formats Zod issues for a fail-fast start-up error without echoing secret values. */
export function formatEnvIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}
