/** Unit tests: src/**\/*.spec.ts. No Redis required. */
const preset = require('../../jest.nest-preset.cjs')();

/** @type {import('jest').Config} */
module.exports = {
  ...preset,
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
};
