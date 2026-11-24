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
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(8),
    S3_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'Must be a valid S3 bucket name'),
    S3_FORCE_PATH_STYLE: envBoolean(true),
    S3_AUTO_CREATE_BUCKET: envBoolean(false),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.S3_AUTO_CREATE_BUCKET) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_AUTO_CREATE_BUCKET'],
        message: 'Must be false in production; provision buckets explicitly',
      });
    }
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;
