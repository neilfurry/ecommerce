// Runs before every e2e test file, before .env is loaded (dotenv never overrides these).
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.E2E_LOG_LEVEL ?? 'silent';
process.env.SWAGGER_ENABLED = 'true';
process.env.DEV_TOOLS_ENABLED = process.env.DEV_TOOLS_ENABLED ?? 'true';
process.env.S3_AUTO_CREATE_BUCKET = 'true';
// Small limit so the oversized-upload test stays fast.
process.env.UPLOAD_MAX_BYTES = '1048576';
// Test clients send X-Forwarded-For so each gets its own per-IP rate-limit bucket.
process.env.TRUST_PROXY = '1';
