import { AppConfig } from './app-config';

const validEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  S3_ACCESS_KEY_ID: 'access',
  S3_SECRET_ACCESS_KEY: 'super-secret-value',
  S3_BUCKET: 'marketplace-dev',
  CORS_ORIGINS: 'http://localhost:5173,http://localhost:5174',
  AUTH_JWT_SECRET: 'j'.repeat(32),
  AUTH_OTP_SECRET: 'o'.repeat(32),
  AUTH_MFA_ENCRYPTION_KEY: 'm'.repeat(32),
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

  it('applies auth defaults', () => {
    const config = AppConfig.load(validEnv, false);
    expect(config.auth).toMatchObject({
      accessTokenTtlSeconds: 900,
      customerSessionDays: 30,
      staffSessionHours: 12,
      maxFailedSignIns: 5,
      lockoutMinutes: 15,
      signInLimitPerMinute: 10,
      cookieSecure: false,
    });
    expect(config.appUrls.storefront).toBe('http://localhost:5173');
  });

  it('accepts a sign-in limit between 3 and 100 per minute', () => {
    const at = (value: string) =>
      AppConfig.load({ ...validEnv, AUTH_SIGN_IN_LIMIT_PER_MINUTE: value }, false);
    expect(at('30').auth.signInLimitPerMinute).toBe(30);
    expect(() => at('1')).toThrow(/AUTH_SIGN_IN_LIMIT_PER_MINUTE/);
    expect(() => at('500')).toThrow(/AUTH_SIGN_IN_LIMIT_PER_MINUTE/);
  });

  it('rejects weak or reused auth secrets', () => {
    expect(() => AppConfig.load({ ...validEnv, AUTH_JWT_SECRET: 'short' }, false)).toThrow(
      /AUTH_JWT_SECRET/,
    );
    expect(() =>
      AppConfig.load({ ...validEnv, AUTH_OTP_SECRET: validEnv.AUTH_JWT_SECRET }, false),
    ).toThrow(/AUTH_OTP_SECRET/);
  });

  it('requires secure cookies in production', () => {
    expect(() => AppConfig.load({ ...validEnv, NODE_ENV: 'production' }, false)).toThrow(
      /COOKIE_SECURE/,
    );
  });

  it('requires mandatory variables', () => {
    expect(() => AppConfig.load({}, false)).toThrow(/DATABASE_URL/);
  });
  describe('production', () => {
    const productionEnv = {
      ...validEnv,
      NODE_ENV: 'production',
      COOKIE_SECURE: 'true',
      STAFF_MFA_REQUIRED: 'true',
      SHIPPING_PROVIDER: 'rate_table',
      PAYMENT_PROVIDER: 'paymongo',
      PAYMONGO_SECRET_KEY: 'sk_live_abcdefghijklmnop',
      PAYMONGO_WEBHOOK_SECRET: 'whsk_abcdefghijklmnop',
      FINANCE_ENCRYPTION_KEY: 'f'.repeat(40),
      API_PUBLIC_URL: 'https://api.example.ph',
      STOREFRONT_URL: 'https://shop.example.ph',
      SELLER_PORTAL_URL: 'https://seller.example.ph',
      ADMIN_PORTAL_URL: 'https://admin.example.ph',
    };

    it('starts with live payments and the rate-table shipping provider', () => {
      const config = AppConfig.load(productionEnv, false);
      expect(config.isProduction).toBe(true);
      expect(config.shippingProvider).toBe('rate_table');
    });

    it('refuses development secrets copied from .env.example', () => {
      const attempt = () =>
        AppConfig.load(
          {
            ...productionEnv,
            AUTH_JWT_SECRET: 'dev-only-jwt-secret-change-me-0123456789abcdef',
            FINANCE_ENCRYPTION_KEY: 'dev-only-finance-key-change-me-0123456789abcdef',
            S3_SECRET_ACCESS_KEY: 'marketplace_dev_secret',
            DATABASE_URL: 'postgresql://marketplace:marketplace_dev_password@db:5432/marketplace',
          },
          false,
        );
      for (const key of [
        'AUTH_JWT_SECRET',
        'FINANCE_ENCRYPTION_KEY',
        'S3_SECRET_ACCESS_KEY',
        'DATABASE_URL',
      ]) {
        expect(attempt).toThrow(new RegExp(key));
      }
    });

    it('refuses PayMongo test keys unless explicitly allowed for staging', () => {
      const test = { ...productionEnv, PAYMONGO_SECRET_KEY: 'sk_test_abcdefghijklmnop' };
      expect(() => AppConfig.load(test, false)).toThrow(/PAYMONGO_SECRET_KEY/);
      expect(AppConfig.load({ ...test, ALLOW_TEST_PAYMENTS: 'true' }, false).isProduction).toBe(
        true,
      );
    });

    it('requires two-step verification for staff', () => {
      expect(() =>
        AppConfig.load({ ...productionEnv, STAFF_MFA_REQUIRED: 'false' }, false),
      ).toThrow(/STAFF_MFA_REQUIRED/);
    });

    it('refuses mock shipping and plain-http public URLs', () => {
      expect(() => AppConfig.load({ ...productionEnv, SHIPPING_PROVIDER: 'mock' }, false)).toThrow(
        /SHIPPING_PROVIDER/,
      );
      expect(() =>
        AppConfig.load({ ...productionEnv, STOREFRONT_URL: 'http://shop.example.ph' }, false),
      ).toThrow(/STOREFRONT_URL/);
    });
  });
});
