/** Integration tests: boot the worker against the real Redis from .env. */
const preset = require('../../../jest.nest-preset.cjs')();

/** @type {import('jest').Config} */
module.exports = {
  ...preset,
  rootDir: '.',
  testRegex: '.*\\.integration-spec\\.ts$',
  setupFiles: ['<rootDir>/setup-env.ts'],
  testTimeout: 30000,
};
