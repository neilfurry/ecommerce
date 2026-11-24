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

export const apiEnvSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    APP_VERSION: z.string().optional(),
    API_PORT: envInteger(3000, 1, 65535),
    CORS_ORIGINS: envOriginList.default([]),
    TRUST_PROXY: trustProxySchema,
    LOG_LEVEL: logLevelSchema,
    RATE_LIMIT_WINDOW_SECONDS: envInteger(60, 1, 86_400),
    RATE_LIMIT_MAX_REQUESTS: envInteger(300, 1, 1_000_000),
    SWAGGER_ENABLED: envBoolean(false),

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

    /** Signs access tokens (HS256). At least 32 random characters; rotate by redeploying. */
    AUTH_JWT_SECRET: z.string().min(32, 'Use at least 32 random characters'),
    /** HMAC key for one-time SMS codes. At least 32 random characters. */
    AUTH_OTP_SECRET: z.string().min(32, 'Use at least 32 random characters'),
    AUTH_ACCESS_TOKEN_TTL_SECONDS: envInteger(900, 60, 3600),
    AUTH_CUSTOMER_SESSION_DAYS: envInteger(30, 1, 365),
    AUTH_STAFF_SESSION_HOURS: envInteger(12, 1, 168),
    AUTH_MAX_FAILED_SIGN_INS: envInteger(5, 3, 20),
    AUTH_LOCKOUT_MINUTES: envInteger(15, 1, 1440),
    /** Secure-only cookies. Defaults to true in production; local http needs false. */
    COOKIE_SECURE: envBoolean(false),
    /** Optional parent domain for cookies, e.g. ".marketplace.ph". Unset = API host only. */
    COOKIE_DOMAIN: z.string().optional(),

    /** Public URLs of the frontends, used in links sent by email. */
    STOREFRONT_URL: z.url().default('http://localhost:5173'),
    SELLER_PORTAL_URL: z.url().default('http://localhost:5174'),
    ADMIN_PORTAL_URL: z.url().default('http://localhost:5175'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.S3_AUTO_CREATE_BUCKET) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_AUTO_CREATE_BUCKET'],
        message: 'Must be false in production; provision buckets explicitly',
      });
    }
    if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'Must be true in production',
      });
    }
    if (env.AUTH_JWT_SECRET === env.AUTH_OTP_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_OTP_SECRET'],
        message: 'Must differ from AUTH_JWT_SECRET',
      });
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
