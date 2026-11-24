/** Unit tests: src/**\/*.spec.ts. No database or network required. */
const preset = require('../../jest.nest-preset.cjs')();

/** @type {import('jest').Config} */
module.exports = {
  ...preset,
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  collectCoverageFrom: ['**/*.ts', '!**/*.spec.ts', '!generated/**', '!main.ts'],
  coverageDirectory: '../coverage',
};
