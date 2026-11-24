import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  envInteger,
  formatEnvIssues,
  logLevelSchema,
  nodeEnvSchema,
  redisUrlSchema,
} from '@marketplace/validation';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

export const workerEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  APP_VERSION: z.string().optional(),
  LOG_LEVEL: logLevelSchema,
  REDIS_URL: redisUrlSchema,
  WORKER_CONCURRENCY: envInteger(5, 1, 100),
  WORKER_HEARTBEAT_INTERVAL_SECONDS: envInteger(15, 1, 300),
});
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/** Typed, validated worker configuration; the class itself is the DI token. */
export class WorkerConfig {
  readonly nodeEnv: WorkerEnv['NODE_ENV'];
  readonly version: string;
  readonly logLevel: WorkerEnv['LOG_LEVEL'];
  readonly redisUrl: string;
  readonly concurrency: number;
  readonly heartbeatIntervalSeconds: number;

  constructor(env: WorkerEnv) {
    this.nodeEnv = env.NODE_ENV;
    this.version = env.APP_VERSION ?? readPackageVersion();
    this.logLevel = env.LOG_LEVEL;
    this.redisUrl = env.REDIS_URL;
    this.concurrency = env.WORKER_CONCURRENCY;
    this.heartbeatIntervalSeconds = env.WORKER_HEARTBEAT_INTERVAL_SECONDS;
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
