// Runs before every e2e test file, before .env is loaded (dotenv never overrides these).
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.E2E_LOG_LEVEL ?? 'silent';
process.env.SWAGGER_ENABLED = 'true';
