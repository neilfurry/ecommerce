import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  envBoolean,
  envInteger,
  formatEnvIssues,
  logLevelSchema,
  nodeEnvSchema,
  redisUrlSchema,
} from '@marketplace/validation';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

export const workerEnvSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    APP_VERSION: z.string().optional(),
    LOG_LEVEL: logLevelSchema,
    REDIS_URL: redisUrlSchema,
    /** Optional override of every queue's concurrency; unset = per-queue defaults. */
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).optional(),
    WORKER_HEARTBEAT_INTERVAL_SECONDS: envInteger(15, 1, 300),
    DEV_TOOLS_ENABLED: envBoolean(false),
    SMTP_HOST: z.string().min(1).default('localhost'),
    SMTP_PORT: envInteger(1025, 1, 65535),
    SMTP_SECURE: envBoolean(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    MAIL_FROM: z.string().min(3).default('Marketplace <no-reply@marketplace.local>'),
    SMS_PROVIDER: z.enum(['mock', 'semaphore']).default('mock'),
    SEMAPHORE_API_KEY: z.string().optional(),
    SEMAPHORE_SENDER_NAME: z.string().max(11).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.DEV_TOOLS_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_TOOLS_ENABLED'],
        message: 'Must be false in production',
      });
    }
    if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'mock') {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_PROVIDER'],
        message: 'The mock provider sends nothing; use a real provider in production',
      });
    }
    if (env.SMS_PROVIDER === 'semaphore' && !env.SEMAPHORE_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['SEMAPHORE_API_KEY'],
        message: 'Required when SMS_PROVIDER=semaphore',
      });
    }
  });
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/** Typed, validated worker configuration; the class itself is the DI token. */
export class WorkerConfig {
  readonly nodeEnv: WorkerEnv['NODE_ENV'];
  readonly version: string;
  readonly logLevel: WorkerEnv['LOG_LEVEL'];
  readonly redisUrl: string;
  readonly concurrencyOverride: number | undefined;
  readonly heartbeatIntervalSeconds: number;
  readonly devToolsEnabled: boolean;
  readonly smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string | undefined;
    password: string | undefined;
    from: string;
  };
  readonly sms: {
    provider: 'mock' | 'semaphore';
    semaphoreApiKey: string | undefined;
    semaphoreSenderName: string | undefined;
  };

  constructor(env: WorkerEnv) {
    this.nodeEnv = env.NODE_ENV;
    this.version = env.APP_VERSION ?? readPackageVersion();
    this.logLevel = env.LOG_LEVEL;
    this.redisUrl = env.REDIS_URL;
    this.concurrencyOverride = env.WORKER_CONCURRENCY;
    this.heartbeatIntervalSeconds = env.WORKER_HEARTBEAT_INTERVAL_SECONDS;
    this.devToolsEnabled = env.DEV_TOOLS_ENABLED;
    this.smtp = {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER || undefined,
      password: env.SMTP_PASSWORD || undefined,
      from: env.MAIL_FROM,
    };
    this.sms = {
      provider: env.SMS_PROVIDER,
      semaphoreApiKey: env.SEMAPHORE_API_KEY || undefined,
      semaphoreSenderName: env.SEMAPHORE_SENDER_NAME || undefined,
    };
  }

  static load(environment: NodeJS.ProcessEnv = process.env, loadFiles = true): WorkerConfig {
    if (loadFiles) {
      const cwd = process.cwd();
      for (const file of [path.join(cwd, '.env'), path.resolve(cwd, '../../.env')]) {
        if (existsSync(file)) loadDotenv({ path: file, quiet: true });
      }
    }
    const result = workerEnvSchema.safeParse(environment);
    if (!result.success) {
      throw new Error(
        `Invalid worker environment configuration:\n${formatEnvIssues(result.error)}\n` +
          'Check your .env file against .env.example.',
      );
    }
    return new WorkerConfig(result.data);
  }
}

function readPackageVersion(): string {
  let dir = __dirname;
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = path.join(dir, 'package.json');
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === '@marketplace/worker' && pkg.version) return pkg.version;
    }
    dir = path.dirname(dir);
  }
  return '0.0.0';
}
