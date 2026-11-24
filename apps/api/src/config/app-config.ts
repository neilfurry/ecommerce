import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { formatEnvIssues } from '@marketplace/validation';
import { config as loadDotenv } from 'dotenv';
import { apiEnvSchema, type ApiEnv } from './env.schema';

/**
 * Typed, validated configuration for the API.
 * Injected via Nest DI using the class itself as the token:
 *   constructor(private readonly config: AppConfig) {}
 */
export class AppConfig {
  readonly nodeEnv: ApiEnv['NODE_ENV'];
  readonly isProduction: boolean;
  readonly version: string;
  readonly http: {
    port: number;
    corsOrigins: string[];
    trustProxy: boolean | number;
    swaggerEnabled: boolean;
  };
  readonly logLevel: ApiEnv['LOG_LEVEL'];
  readonly rateLimit: { windowSeconds: number; maxRequests: number };
  readonly database: { url: string };
  readonly redis: { url: string };
  readonly storage: {
    endpoint: string | undefined;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    forcePathStyle: boolean;
    autoCreateBucket: boolean;
  };

  constructor(env: ApiEnv) {
    this.nodeEnv = env.NODE_ENV;
    this.isProduction = env.NODE_ENV === 'production';
    this.version = env.APP_VERSION ?? readPackageVersion();
    this.http = {
      port: env.API_PORT,
      corsOrigins: env.CORS_ORIGINS,
      trustProxy: env.TRUST_PROXY,
      swaggerEnabled: env.SWAGGER_ENABLED,
    };
    this.logLevel = env.LOG_LEVEL;
    this.rateLimit = {
      windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
      maxRequests: env.RATE_LIMIT_MAX_REQUESTS,
    };
    this.database = { url: env.DATABASE_URL };
    this.redis = { url: env.REDIS_URL };
    this.storage = {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      bucket: env.S3_BUCKET,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      autoCreateBucket: env.S3_AUTO_CREATE_BUCKET,
    };
  }

  /**
   * Loads .env files (app folder, then repository root; real environment variables win),
   * validates them, and throws a readable error listing every invalid variable.
   */
  static load(environment: NodeJS.ProcessEnv = process.env, loadFiles = true): AppConfig {
    if (loadFiles) loadEnvFiles();
    const result = apiEnvSchema.safeParse(environment);
    if (!result.success) {
      throw new Error(
        `Invalid API environment configuration:\n${formatEnvIssues(result.error)}\n` +
          'Check your .env file against .env.example.',
      );
    }
    return new AppConfig(result.data);
  }
}

function loadEnvFiles(): void {
  const cwd = process.cwd();
  for (const file of [path.join(cwd, '.env'), path.resolve(cwd, '../../.env')]) {
    if (existsSync(file)) loadDotenv({ path: file, quiet: true });
  }
}

/** Walks up from this file to the API package.json; works from src/ (tests) and dist/ (runtime). */
function readPackageVersion(): string {
  let dir = __dirname;
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = path.join(dir, 'package.json');
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === '@marketplace/api' && pkg.version) return pkg.version;
    }
    dir = path.dirname(dir);
  }
  return '0.0.0';
}
