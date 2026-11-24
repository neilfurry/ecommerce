/**
 * End-to-end tests: boot the real Nest application against the real PostgreSQL, Redis and
 * S3-compatible storage configured in .env (start them with `pnpm infra:up`).
 */
const preset = require('../../../jest.nest-preset.cjs')();

/** @type {import('jest').Config} */
module.exports = {
  ...preset,
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  setupFiles: ['<rootDir>/setup-env.ts'],
  testTimeout: 30000,
};
