import {
  envBoolean,
  envInteger,
  envOriginList,
  logLevelSchema,
  nodeEnvSchema,
  postgresUrlSchema,
  redisUrlSchema,
} from '@marketplace/validation';
import { z } from 'zod';

/** "false" | "true" | hop count → value accepted by Express "trust proxy". */
const trustProxySchema = z
  .string()
  .trim()
  .toLowerCase()
  .default('false')
  .transform((value, ctx): boolean | number => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    const hops = Number(value);
    if (Number.isInteger(hops) && hops >= 0) return hops;
    ctx.addIssue({ code: 'custom', message: 'Must be true, false, or a hop count' });
    return z.NEVER;
  });

const apiEnvObject = z.object({
  NODE_ENV: nodeEnvSchema,
  APP_VERSION: z.string().optional(),
  API_PORT: envInteger(3000, 1, 65535),
  CORS_ORIGINS: envOriginList.default([]),
  TRUST_PROXY: trustProxySchema,
  LOG_LEVEL: logLevelSchema,
  RATE_LIMIT_WINDOW_SECONDS: envInteger(60, 1, 86_400),
  RATE_LIMIT_MAX_REQUESTS: envInteger(300, 1, 1_000_000),
  SWAGGER_ENABLED: envBoolean(false),

  /** Internal port serving Prometheus metrics at /metrics (0 = off). Never expose publicly. */
  METRICS_PORT: envInteger(0, 0, 65535),
  /** Sentry-compatible error tracking (Sentry or GlitchTip). Unset = off. */
  SENTRY_DSN: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
  SENTRY_ENVIRONMENT: z.string().optional(),

  DATABASE_URL: postgresUrlSchema,
  REDIS_URL: redisUrlSchema,

  S3_ENDPOINT: z.url().optional(),
  /** Endpoint written into signed URLs (what browsers can reach). Defaults to S3_ENDPOINT. */
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(8),
  S3_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'Must be a valid S3 bucket name'),
  S3_FORCE_PATH_STYLE: envBoolean(true),
  S3_AUTO_CREATE_BUCKET: envBoolean(false),
  STORAGE_SIGNED_URL_TTL_SECONDS: envInteger(300, 30, 86_400),
  UPLOAD_MAX_BYTES: envInteger(5 * 1024 * 1024, 1024, 100 * 1024 * 1024),

  DEV_TOOLS_ENABLED: envBoolean(false),
  /**
   * Shipping rates. Both use the admin-editable rate table (Admin Console > Settings):
   * "mock" labels them as a mock courier (development only); "rate_table" is for production,
   * with sellers booking their own courier and entering tracking numbers.
   */
  SHIPPING_PROVIDER: z.enum(['mock', 'rate_table']).default('mock'),

  /**
   * Online payments (GCash, Maya, cards, QR Ph): "mock" simulates them locally (never real
   * money, refused in production); "paymongo" uses PayMongo with the keys below (sk_test_
   * keys = sandbox).
   */
  PAYMENT_PROVIDER: z.enum(['mock', 'paymongo']).default('mock'),
  PAYMONGO_SECRET_KEY: z.string().optional(),
  PAYMONGO_WEBHOOK_SECRET: z.string().optional(),
  PAYMONGO_CHECKOUT_VERSION: z.enum(['v1', 'v2']).default('v2'),
  /** Signs the mock payment provider's and mock courier's webhooks (development). */
  MOCK_WEBHOOK_SECRET: z.string().min(16).default('local-mock-webhook-secret-change-me'),
  /**
   * PayMongo payouts (Phase 6): the wallet money is sent from (GET /v2/wallets shows it).
   * Without an account number, payouts are recorded manually only.
   */
  PAYMONGO_WALLET_ACCOUNT_NUMBER: z.string().optional(),
  PAYMONGO_WALLET_ACCOUNT_NAME: z.string().optional(),
  PAYMONGO_WALLET_BIC: z.string().default('PAEYPHM2XXX'),
  /** Encrypts sellers' bank account numbers (AES-256-GCM). At least 32 random characters. */
  FINANCE_ENCRYPTION_KEY: z
    .string()
    .min(32, 'Use at least 32 random characters')
    .default('dev-only-finance-key-change-me-0123456789abcdef'),
  /**
   * Staging only: lets a NODE_ENV=production deployment use PayMongo test keys (sk_test_).
   * Leave unset in production; the API refuses test keys there otherwise.
   */
  ALLOW_TEST_PAYMENTS: envBoolean(false),
  /** Public base URL of this API, for provider callbacks shown in the admin console. */
  API_PUBLIC_URL: z.url().default('http://localhost:3000'),

  /** Signs access tokens (HS256). At least 32 random characters; rotate by redeploying. */
  AUTH_JWT_SECRET: z.string().min(32, 'Use at least 32 random characters'),
  /** HMAC key for one-time SMS codes. At least 32 random characters. */
  AUTH_OTP_SECRET: z.string().min(32, 'Use at least 32 random characters'),
  /** Encrypts authenticator-app secrets at rest. Changing it disables everyone's two-step verification. */
  AUTH_MFA_ENCRYPTION_KEY: z.string().min(32, 'Use at least 32 random characters'),
  AUTH_ACCESS_TOKEN_TTL_SECONDS: envInteger(900, 60, 3600),
  AUTH_CUSTOMER_SESSION_DAYS: envInteger(30, 1, 365),
  AUTH_STAFF_SESSION_HOURS: envInteger(12, 1, 168),
  AUTH_MAX_FAILED_SIGN_INS: envInteger(5, 3, 20),
  AUTH_LOCKOUT_MINUTES: envInteger(15, 1, 1440),
  /** Secure-only cookies. Defaults to true in production; local http needs false. */
  COOKIE_SECURE: envBoolean(false),
  /**
   * Admin Console staff must turn on two-step verification (an authenticator app) before
   * they can do anything else. Required in production.
   */
  STAFF_MFA_REQUIRED: envBoolean(false),
  /** Optional parent domain for cookies, e.g. ".marketplace.ph". Unset = API host only. */
  COOKIE_DOMAIN: z.string().optional(),

  /** Public URLs of the frontends, used in links sent by email. */
  STOREFRONT_URL: z.url().default('http://localhost:5173'),
  SELLER_PORTAL_URL: z.url().default('http://localhost:5174'),
  ADMIN_PORTAL_URL: z.url().default('http://localhost:5175'),
});

export const apiEnvSchema = apiEnvObject.superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && env.S3_AUTO_CREATE_BUCKET) {
    ctx.addIssue({
      code: 'custom',
      path: ['S3_AUTO_CREATE_BUCKET'],
      message: 'Must be false in production; provision buckets explicitly',
    });
  }
  if (env.NODE_ENV === 'production' && !env.STAFF_MFA_REQUIRED) {
    ctx.addIssue({
      code: 'custom',
      path: ['STAFF_MFA_REQUIRED'],
      message: 'Must be true in production (staff accounts handle payouts, refunds and user data)',
    });
  }
  if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
    ctx.addIssue({
      code: 'custom',
      path: ['COOKIE_SECURE'],
      message: 'Must be true in production',
    });
  }
  const secrets = [env.AUTH_JWT_SECRET, env.AUTH_OTP_SECRET, env.AUTH_MFA_ENCRYPTION_KEY];
  if (new Set(secrets).size !== secrets.length && env.AUTH_JWT_SECRET !== env.AUTH_OTP_SECRET) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_MFA_ENCRYPTION_KEY'],
      message: 'Must differ from AUTH_JWT_SECRET and AUTH_OTP_SECRET',
    });
  }
  if (env.AUTH_JWT_SECRET === env.AUTH_OTP_SECRET) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_OTP_SECRET'],
      message: 'Must differ from AUTH_JWT_SECRET',
    });
  }
  if (env.NODE_ENV === 'production' && env.SHIPPING_PROVIDER === 'mock') {
    ctx.addIssue({
      code: 'custom',
      path: ['SHIPPING_PROVIDER'],
      message: 'Mock shipping is for development; use SHIPPING_PROVIDER=rate_table in production',
    });
  }
  if (env.NODE_ENV === 'production' && env.PAYMENT_PROVIDER === 'mock') {
    ctx.addIssue({
      code: 'custom',
      path: ['PAYMENT_PROVIDER'],
      message: 'Mock payments are for development; configure a payment provider in production',
    });
  }
  if (env.PAYMENT_PROVIDER === 'paymongo') {
    if (!env.PAYMONGO_SECRET_KEY?.match(/^sk_(test|live)_/)) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMONGO_SECRET_KEY'],
        message: 'Required for PayMongo: a secret key starting with sk_test_ or sk_live_',
      });
    }
    if (!env.PAYMONGO_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMONGO_WEBHOOK_SECRET'],
        message: 'Required for PayMongo: the secret shown when you create the webhook',
      });
    }
  }
  if (env.NODE_ENV === 'production') {
    for (const issue of productionSecretIssues(env)) ctx.addIssue({ code: 'custom', ...issue });
  }
  if (env.NODE_ENV === 'production' && env.DEV_TOOLS_ENABLED) {
    ctx.addIssue({
      code: 'custom',
      path: ['DEV_TOOLS_ENABLED'],
      message: 'Must be false in production',
    });
  }
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

/** Values shipped in .env.example and the dev Compose file: never valid in production. */
const DEVELOPMENT_SECRET = /dev-only|change-me|marketplace_dev|^marketplace$/i;

/**
 * Production must not run with development credentials or test payment settings: secrets
 * copied from .env.example, PayMongo test keys, or plain-http public URLs.
 */
function productionSecretIssues(env: z.infer<typeof apiEnvObject>) {
  const issues: { path: string[]; message: string }[] = [];
  const secrets: (keyof typeof env)[] = [
    'AUTH_JWT_SECRET',
    'AUTH_OTP_SECRET',
    'AUTH_MFA_ENCRYPTION_KEY',
    'FINANCE_ENCRYPTION_KEY',
    'S3_SECRET_ACCESS_KEY',
  ];
  for (const key of secrets) {
    if (DEVELOPMENT_SECRET.test(String(env[key]))) {
      issues.push({ path: [key], message: 'Development value; set a random secret in production' });
    }
  }
  if (/marketplace_dev_password/.test(env.DATABASE_URL)) {
    issues.push({ path: ['DATABASE_URL'], message: 'Uses the development database password' });
  }
  if (env.PAYMONGO_SECRET_KEY?.startsWith('sk_test_') && !env.ALLOW_TEST_PAYMENTS) {
    issues.push({
      path: ['PAYMONGO_SECRET_KEY'],
      message:
        'PayMongo test key in production; use sk_live_ (ALLOW_TEST_PAYMENTS=true is for staging only)',
    });
  }
  for (const key of [
    'API_PUBLIC_URL',
    'STOREFRONT_URL',
    'SELLER_PORTAL_URL',
    'ADMIN_PORTAL_URL',
  ] as const) {
    if (!env[key].startsWith('https://')) {
      issues.push({ path: [key], message: 'Must be an https:// URL in production' });
    }
  }
  return issues;
}
