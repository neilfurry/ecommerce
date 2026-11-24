import { AppConfig } from './app-config';

const validEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  S3_ACCESS_KEY_ID: 'access',
  S3_SECRET_ACCESS_KEY: 'super-secret-value',
  S3_BUCKET: 'marketplace-dev',
  CORS_ORIGINS: 'http://localhost:5173,http://localhost:5174',
};

describe('AppConfig.load', () => {
  it('parses a valid environment and applies defaults', () => {
    const config = AppConfig.load(validEnv, false);
    expect(config.http.port).toBe(3000);
    expect(config.http.corsOrigins).toEqual(['http://localhost:5173', 'http://localhost:5174']);
    expect(config.http.trustProxy).toBe(false);
    expect(config.http.swaggerEnabled).toBe(false);
    expect(config.rateLimit).toEqual({ windowSeconds: 60, maxRequests: 300 });
    expect(config.storage.forcePathStyle).toBe(true);
    expect(config.isProduction).toBe(false);
    expect(config.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('parses TRUST_PROXY hop counts', () => {
    expect(AppConfig.load({ ...validEnv, TRUST_PROXY: '2' }, false).http.trustProxy).toBe(2);
    expect(AppConfig.load({ ...validEnv, TRUST_PROXY: 'true' }, false).http.trustProxy).toBe(true);
  });

  it('lists every invalid variable without leaking secret values', () => {
    const attempt = () =>
      AppConfig.load(
        { ...validEnv, DATABASE_URL: 'mysql://nope', S3_SECRET_ACCESS_KEY: 'short' },
        false,
      );
    expect(attempt).toThrow(/DATABASE_URL/);
    expect(attempt).toThrow(/S3_SECRET_ACCESS_KEY/);
    expect(attempt).not.toThrow(/short/);
  });

  it('refuses automatic bucket creation in production', () => {
    expect(() =>
      AppConfig.load({ ...validEnv, NODE_ENV: 'production', S3_AUTO_CREATE_BUCKET: 'true' }, false),
    ).toThrow(/S3_AUTO_CREATE_BUCKET/);
  });

  it('refuses developer tools in production', () => {
    expect(() =>
      AppConfig.load({ ...validEnv, NODE_ENV: 'production', DEV_TOOLS_ENABLED: 'true' }, false),
    ).toThrow(/DEV_TOOLS_ENABLED/);
  });

  it('defaults storage limits and the public endpoint', () => {
    const config = AppConfig.load({ ...validEnv, S3_ENDPOINT: 'http://localhost:9000' }, false);
    expect(config.devToolsEnabled).toBe(false);
    expect(config.storage).toMatchObject({
      publicEndpoint: 'http://localhost:9000',
      signedUrlTtlSeconds: 300,
      uploadMaxBytes: 5 * 1024 * 1024,
    });
  });

  it('requires mandatory variables', () => {
    expect(() => AppConfig.load({}, false)).toThrow(/DATABASE_URL/);
  });
});
